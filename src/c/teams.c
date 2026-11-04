// ── Teams, colors and logos ───────────────────────────────────────────────
#include "app.h"

// Team order is the order in the standings: AFC East, North, South, West,
// then NFC East, North, South, West. `div` runs 'A' to 'H' in that order.
const TeamInfo TEAMS[NUM_TEAMS] = {
  {"BUF", "Bills", 'A', 0x00338d},
  {"MIA", "Dolphins", 'A', 0x008e97},
  {"NE", "Patriots", 'A', 0xc60c30},
  {"NYJ", "Jets", 'A', 0x115740},
  {"BAL", "Ravens", 'B', 0x29126f},
  {"CIN", "Bengals", 'B', 0xfb4f14},
  {"CLE", "Browns", 'B', 0x8a3324},
  {"PIT", "Steelers", 'B', 0xffb612},
  {"HOU", "Texans", 'C', 0xeb0028},
  {"IND", "Colts", 'C', 0x003b75},
  {"JAX", "Jaguars", 'C', 0x007487},
  {"TEN", "Titans", 'C', 0x4495d2},
  {"DEN", "Broncos", 'D', 0xfc4c02},
  {"KC", "Chiefs", 'D', 0xe31837},
  {"LV", "Raiders", 'D', 0xa5acaf},
  {"LAC", "Chargers", 'D', 0x0080c6},
  {"DAL", "Cowboys", 'E', 0x002a5c},
  {"NYG", "Giants", 'E', 0x003c7f},
  {"PHI", "Eagles", 'E', 0x06424d},
  {"WSH", "Commanders", 'E', 0x5a1414},
  {"CHI", "Bears", 'F', 0x0b1c3a},
  {"DET", "Lions", 'F', 0x0076b6},
  {"GB", "Packers", 'F', 0x204e32},
  {"MIN", "Vikings", 'F', 0x4f2683},
  {"ATL", "Falcons", 'G', 0xa71930},
  {"CAR", "Panthers", 'G', 0x0085ca},
  {"NO", "Saints", 'G', 0xd3bc8d},
  {"TB", "Buccaneers", 'G', 0xbd1c36},
  {"ARI", "Cardinals", 'H', 0xa40227},
  {"LAR", "Rams", 'H', 0x003594},
  {"SF", "49ers", 'H', 0xaa0000},
  {"SEA", "Seahawks", 'H', 0x69be28},
};

const char *DIVISION_NAMES[NUM_DIVISIONS] = {
  "AFC East", "AFC North", "AFC South", "AFC West",
  "NFC East", "NFC North", "NFC South", "NFC West",
};

// Same order as TEAMS
#define LOGOS(a) {RESOURCE_ID_LOGO_##a##_LG, RESOURCE_ID_LOGO_##a##_SM}
static const uint32_t LOGO_IDS[NUM_TEAMS][2] = {
  LOGOS(BUF), LOGOS(MIA), LOGOS(NE), LOGOS(NYJ), LOGOS(BAL), LOGOS(CIN), LOGOS(CLE), LOGOS(PIT), LOGOS(HOU), LOGOS(IND), LOGOS(JAX), LOGOS(TEN), LOGOS(DEN), LOGOS(KC), LOGOS(LV), LOGOS(LAC), LOGOS(DAL), LOGOS(NYG), LOGOS(PHI), LOGOS(WSH), LOGOS(CHI), LOGOS(DET), LOGOS(GB), LOGOS(MIN), LOGOS(ATL), LOGOS(CAR), LOGOS(NO), LOGOS(TB), LOGOS(ARI), LOGOS(LAR), LOGOS(SF), LOGOS(SEA)
};

// True if `abbr` is one of the comma-separated abbreviations in `list`
bool abbr_in_list(const char *list, const char *abbr) {
  if (!abbr || !abbr[0] || !list) return false;
  size_t n = strlen(abbr);
  const char *p = list;
  while (*p) {
    const char *end = strchr(p, ',');
    size_t len = end ? (size_t)(end - p) : strlen(p);
    if (len == n && strncmp(p, abbr, n) == 0) return true;
    if (!end) break;
    p = end + 1;
  }
  return false;
}

int team_index(const char *abbr) {
  if (!abbr || !abbr[0]) return -1;
  for (int i = 0; i < NUM_TEAMS; i++) {
    if (strcmp(TEAMS[i].abbr, abbr) == 0) return i;
  }
  return -1;
}

GColor team_color(const char *abbr) {
  int i = team_index(abbr);
  return i >= 0 ? GColorFromHEX(TEAMS[i].color) : GColorWhite;
}

// Small logos are cached for every team. Large logos use a few rotating
// slots, so callers must draw right away and never keep the pointer.
#define LG_SLOTS 4
static GBitmap *s_small[NUM_TEAMS];
static GBitmap *s_large[LG_SLOTS];
static int s_large_team[LG_SLOTS] = {-1, -1, -1, -1};
static int s_large_next;

GBitmap *team_logo(const char *abbr, bool large) {
  int i = team_index(abbr);
  if (i < 0) return NULL;
  if (!large) {
    if (!s_small[i]) s_small[i] = gbitmap_create_with_resource(LOGO_IDS[i][1]);
    return s_small[i];
  }
  for (int s = 0; s < LG_SLOTS; s++) {
    if (s_large_team[s] == i) return s_large[s];
  }
  int s = s_large_next;
  s_large_next = (s_large_next + 1) % LG_SLOTS;
  if (s_large[s]) gbitmap_destroy(s_large[s]);
  s_large[s] = gbitmap_create_with_resource(LOGO_IDS[i][0]);
  s_large_team[s] = i;
  return s_large[s];
}

void team_logos_deinit(void) {
  for (int i = 0; i < NUM_TEAMS; i++) {
    if (s_small[i]) gbitmap_destroy(s_small[i]);
    s_small[i] = NULL;
  }
  for (int s = 0; s < LG_SLOTS; s++) {
    if (s_large[s]) gbitmap_destroy(s_large[s]);
    s_large[s] = NULL;
    s_large_team[s] = -1;
  }
}
