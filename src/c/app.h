// ── NFL Central · shared definitions ────────────────────────────────────────
#pragma once
#include <pebble.h>

// Request / response types. Must match REQ_* in src/pkjs/index.js exactly.
enum {
  REQ_STATIC    = 0,  // built on the watch, never sent to the phone
  REQ_GAMES     = 1,  // this week's games
  REQ_GAME      = 2,  // one game (ARG = ESPN event id)
  REQ_STANDINGS = 3,  // ARG = DIV, AFC, NFC, L
  REQ_TEAM      = 4,  // ARG = team abbreviation
  REQ_LEADERS   = 5,  // ARG = stat category
  REQ_PLAYOFFS  = 6,
  REQ_SETTINGS  = 7,  // ask the phone to resend settings
  REQ_SET_FAV   = 8,  // ARG = team abbreviation
  REQ_WEEK      = 9,  // ARG = "seasontype:week", e.g. "2:9"
};

// ── Table: phone data is rows separated by '\n', fields separated by '|' ──
#define TABLE_BUF       4096
#define TABLE_MAX_ROWS  64
#define TABLE_MAX_COLS  12

typedef struct {
  char buf[TABLE_BUF];
  char *cell[TABLE_MAX_ROWS][TABLE_MAX_COLS];
  uint8_t ncols[TABLE_MAX_ROWS];
  int nrows;
} Table;

void table_parse(Table *t, const char *src);
const char *table_get(const Table *t, int row, int col);

// ── Settings (sent by the phone, saved on the watch) ──────────────────────
typedef struct {
  char fav[4];          // favorite team, e.g. "KC"
  char follow[132];     // other followed teams, e.g. "BUF,SF"
  bool vibrate;         // alert on touchdowns, field goals and safeties
  bool auto_open;       // open your team's live game on launch
  bool red_zone;        // alert when a followed team's offense reaches the red zone
  bool close_game;      // alert when a followed team's game is a one-score game in the 4th
} Settings;

extern Settings g_settings;
extern int g_viewing_game;   // game id on screen right now (0 = none)

bool settings_is_followed(const char *abbr);
void settings_set_favorite(const char *abbr);

// ── Phone messaging (comm.c) ──────────────────────────────────────────────
typedef void (*CommHandler)(const char *data, const char *error, void *ctx);
typedef void (*SettingsHandler)(DictionaryIterator *iter);

void comm_init(SettingsHandler on_settings);
void comm_request(int type, const char *arg);
int  comm_listen(int type, const char *arg, CommHandler cb, void *ctx);  // arg NULL = any
void comm_unlisten(int id);

// ── Teams and logos (teams.c) ─────────────────────────────────────────────
#define NUM_TEAMS 32
#define NUM_DIVISIONS 8
typedef struct {
  const char *abbr;
  const char *name;
  char div;        // 'A'..'H', an index into DIVISION_NAMES
  uint32_t color;  // team color, used for the end zones
} TeamInfo;

extern const TeamInfo TEAMS[NUM_TEAMS];
extern const char *DIVISION_NAMES[NUM_DIVISIONS];
int team_index(const char *abbr);
GColor team_color(const char *abbr);
bool abbr_in_list(const char *list, const char *abbr);
GBitmap *team_logo(const char *abbr, bool large);   // don't keep the pointer
void team_logos_deinit(void);

// ── Generic list screen (list_window.c) ───────────────────────────────────
typedef struct ListWindow ListWindow;
ListWindow *list_window_push(int req, const char *arg);
ListWindow *list_window_push_static(const char *data);
void list_window_set_static(ListWindow *lw, const char *data);
ListWindow *list_window_push_team_chooser(void);
const char *static_content(const char *name);

// ── Score celebration (score.c) ───────────────────────────────────────────
// A football flies through the uprights. `title` is the headline
// ("TOUCHDOWN!"), `who` is who scored ("J. Smith-Njigba"), `what` is the play
// ("19 yd pass") and `line2` is the score. Any of them can be empty.
void score_draw(GContext *ctx, GRect bounds, int frame, const char *title,
                const char *who, const char *what, const char *line2);
void score_popup_show(const char *abbr, const char *title, const char *who, const char *what,
                      const char *line2);
// What a jump in a team's score means: "TOUCHDOWN!", "FIELD GOAL!", "SAFETY!"
// or NULL (extra points and two-point tries). `td_pending` is per team and
// per game: it is set after a bare 6 so that the 1 or 2 that follows is
// recognized as the conversion, not a safety.
const char *score_event_title(int delta, bool *td_pending);

// ── Live score tracker (tracker.c) ────────────────────────────────────────
typedef void (*TrackerHandler)(void);
void tracker_init(TrackerHandler on_change);
void tracker_deinit(void);
int  tracker_fav_game(const char **status, bool *live);

// Screen layout helpers
#define ROUND_PAD PBL_IF_ROUND_ELSE(26, 4)
