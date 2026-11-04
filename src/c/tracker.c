// ── Live score tracker: polls this week's games, fires alerts ─────────────
// Game rows look like:
//   M|away|awayScore|home|homeScore|status text|gameId|state|quarter|redZoneTeam
// where state is P (pre-game), L (live) or F (final), quarter is 1-4 (5 = OT)
// and redZoneTeam is the team with the ball inside the 20, if any.
// A row "N|text" says why your team has no game this week (a bye).
#include "app.h"

#define POLL_MS    30000
#define MAX_GAMES  24
#define ONE_SCORE  8      // a touchdown plus a two-point try

typedef struct {
  int id;
  int away, home;
  bool td_pending[2];     // away, home: the last score was a bare touchdown
  bool close_fired;
  char red_zone[4];       // team that was in the red zone at the last poll
} Game;

static Table *s_table;
static Game s_games[MAX_GAMES];
static int s_num_games;
static int s_listener = -1;
static AppTimer *s_poll_timer;
static TrackerHandler s_on_change;

static int s_fav_game;
static bool s_fav_live;
static char s_fav_status[40];

int tracker_fav_game(const char **status, bool *live) {
  if (status) *status = s_fav_status;
  if (live) *live = s_fav_live;
  return s_fav_game;
}

static Game *find_game(int id) {
  for (int i = 0; i < s_num_games; i++) {
    if (s_games[i].id == id) return &s_games[i];
  }
  return NULL;
}

static void vibrate(const uint32_t *pattern, uint32_t n) {
  vibes_enqueue_custom_pattern((VibePattern) { .durations = pattern, .num_segments = n });
}

// Followed teams: vibrate, and show the popup unless that game is on screen
// (the game screen does its own flashing then).
static void alert_score(int id, const char *title, const char *scorer,
                        const char *away, int as, const char *home, int hs) {
  if (!settings_is_followed(scorer)) return;
  if (g_settings.vibrate) {
    static const uint32_t td[] = {300, 100, 300, 100, 600};
    static const uint32_t fg[] = {300, 100, 300};
    vibrate(strcmp(title, "TOUCHDOWN!") == 0 ? td : fg,
            strcmp(title, "TOUCHDOWN!") == 0 ? 5 : 3);
  }
  if (id == g_viewing_game) return;
  char line[40];
  snprintf(line, sizeof(line), "%s %d - %d %s", away, as, hs, home);
  score_popup_show(scorer, title, line);
}

static void on_games(const char *data, const char *error, void *ctx) {
  if (error) return;
  table_parse(s_table, data);

  s_fav_game = 0;
  s_fav_live = false;
  s_fav_status[0] = '\0';
  const char *note = "";

  for (int r = 0; r < s_table->nrows; r++) {
    char kind = table_get(s_table, r, 0)[0];
    if (kind == 'N') {
      note = table_get(s_table, r, 1);
      continue;
    }
    if (kind != 'M') continue;
    const char *away = table_get(s_table, r, 1);
    const char *home = table_get(s_table, r, 3);
    int as = atoi(table_get(s_table, r, 2));
    int hs = atoi(table_get(s_table, r, 4));
    const char *status = table_get(s_table, r, 5);
    int id = atoi(table_get(s_table, r, 6));
    char state = table_get(s_table, r, 7)[0];
    int quarter = atoi(table_get(s_table, r, 8));
    const char *rz = table_get(s_table, r, 9);
    if (id == 0) continue;

    Game *g = find_game(id);
    if (!g && s_num_games < MAX_GAMES) {
      g = &s_games[s_num_games++];
      memset(g, 0, sizeof(*g));
      g->id = id;
      g->away = as;
      g->home = hs;
    } else if (g) {
      if (state == 'L') {
        const char *title;
        if (as > g->away && (title = score_event_title(as - g->away, &g->td_pending[0]))) {
          alert_score(id, title, away, away, as, home, hs);
        }
        if (hs > g->home && (title = score_event_title(hs - g->home, &g->td_pending[1]))) {
          alert_score(id, title, home, away, as, home, hs);
        }
      }
      g->away = as;
      g->home = hs;
    }

    if (g && state == 'L') {
      // Red zone: a followed team's offense just got inside the 20
      if (rz[0] && strcmp(rz, g->red_zone) != 0 && g_settings.red_zone && settings_is_followed(rz)) {
        static const uint32_t pattern[] = {150, 100, 150};
        vibrate(pattern, 3);
      }
      // One-score game in the 4th quarter or overtime, once per game
      if (!g->close_fired && quarter >= 4 && abs(as - hs) <= ONE_SCORE) {
        g->close_fired = true;
        if (g_settings.close_game && (settings_is_followed(away) || settings_is_followed(home))) {
          static const uint32_t pattern[] = {200, 100, 200, 100, 200};
          vibrate(pattern, 5);
          if (id != g_viewing_game) {
            char line[40];
            snprintf(line, sizeof(line), "%s %d-%d %s %s", away, as, hs, home, status);
            score_popup_show(settings_is_followed(away) ? away : home, "CLOSE GAME!", line);
          }
        }
      }
    }
    if (g) {
      strncpy(g->red_zone, state == 'L' ? rz : "", sizeof(g->red_zone) - 1);
      g->red_zone[sizeof(g->red_zone) - 1] = '\0';
    }

    bool fav = g_settings.fav[0] &&
               (strcmp(away, g_settings.fav) == 0 || strcmp(home, g_settings.fav) == 0);
    if (fav && (!s_fav_game || state == 'L')) {
      s_fav_game = id;
      s_fav_live = (state == 'L');
      if (state == 'P') {
        snprintf(s_fav_status, sizeof(s_fav_status), "%s @ %s %s", away, home, status);
      } else {
        snprintf(s_fav_status, sizeof(s_fav_status), "%s %d-%d %s %s", away, as, hs, home, status);
      }
    }
  }
  if (!s_fav_game && note[0]) {
    strncpy(s_fav_status, note, sizeof(s_fav_status) - 1);
    s_fav_status[sizeof(s_fav_status) - 1] = '\0';
  }
  if (s_on_change) s_on_change();
}

static void poll(void *ctx) {
  comm_request(REQ_GAMES, "");
  s_poll_timer = app_timer_register(POLL_MS, poll, NULL);
}

void tracker_init(TrackerHandler on_change) {
  s_on_change = on_change;
  s_table = malloc(sizeof(Table));
  s_table->nrows = 0;
  s_listener = comm_listen(REQ_GAMES, NULL, on_games, NULL);
  poll(NULL);
}

void tracker_deinit(void) {
  if (s_poll_timer) app_timer_cancel(s_poll_timer);
  comm_unlisten(s_listener);
  free(s_table);
}
