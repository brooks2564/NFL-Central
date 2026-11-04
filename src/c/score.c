// ── Score celebration: ball through the uprights + popup ──────────────────
#include "app.h"

#define SCORE_FRAMES    16
#define SCORE_FRAME_MS  90
#define POPUP_MS        4000

const char *score_event_title(int delta, bool *td_pending) {
  if (delta >= 6) {                         // 6 = TD, 7 = TD + kick, 8 = TD + 2-pt
    *td_pending = (delta == 6);
    return "TOUCHDOWN!";
  }
  if (delta == 3) {
    *td_pending = false;
    return "FIELD GOAL!";
  }
  if (delta == 1 || delta == 2) {
    if (*td_pending) {                      // the try after a touchdown
      *td_pending = false;
      return NULL;
    }
    return delta == 2 ? "SAFETY!" : NULL;
  }
  return NULL;
}

// Draws one frame of the celebration filling `bounds`: the field-green
// background flashes, a football rises through yellow uprights, and the
// title and score sit underneath.
void score_draw(GContext *ctx, GRect bounds, int frame, const char *title, const char *line2) {
  bool on = (frame / 2) % 2 == 0;
  graphics_context_set_fill_color(ctx, on ? GColorDarkGreen : GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  int cx = bounds.origin.x + bounds.size.w / 2;
  int top = bounds.origin.y + 4;
  const int post_h = 44, half_w = 20;

  // Uprights: a stem, a crossbar and two posts
  graphics_context_set_stroke_color(ctx, GColorYellow);
  graphics_context_set_stroke_width(ctx, 3);
  graphics_draw_line(ctx, GPoint(cx, top + post_h), GPoint(cx, top + post_h - 12));
  graphics_draw_line(ctx, GPoint(cx - half_w, top + post_h - 12), GPoint(cx + half_w, top + post_h - 12));
  graphics_draw_line(ctx, GPoint(cx - half_w, top + post_h - 12), GPoint(cx - half_w, top));
  graphics_draw_line(ctx, GPoint(cx + half_w, top + post_h - 12), GPoint(cx + half_w, top));
  graphics_context_set_stroke_width(ctx, 1);

  // The football climbs from below the crossbar to between the posts
  GBitmap *ball = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_FOOTBALL);
  if (ball) {
    GSize sz = gbitmap_get_bounds(ball).size;
    int t = frame < 10 ? frame : 10;
    int by = top + post_h - 4 - t * 4;
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, ball, GRect(cx - sz.w / 2, by, sz.w, sz.h));
    gbitmap_destroy(ball);
  }

  int y = top + post_h;
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, title ? title : "", fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(bounds.origin.x, y - 2, bounds.size.w, 32),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  if (line2 && line2[0] && bounds.size.h > y - bounds.origin.y + 50) {
    graphics_draw_text(ctx, line2, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(bounds.origin.x + ROUND_PAD, y + 28, bounds.size.w - 2 * ROUND_PAD, 56),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  }
}

// ── Popup window ──────────────────────────────────────────────────────────
static Window *s_window;
static Layer *s_canvas;
static AppTimer *s_frame_timer, *s_close_timer;
static int s_frame;
static char s_abbr[4];
static char s_title[20];
static char s_line2[40];

static void canvas_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  // Leave room on top for the team logo on tall screens
  GRect area = GRect(0, b.size.h / 2 - 70, b.size.w, 150);
  score_draw(ctx, area, s_frame % SCORE_FRAMES, s_title, s_line2);
  GBitmap *logo = team_logo(s_abbr, true);
  if (logo) {
    GSize sz = gbitmap_get_bounds(logo).size;
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, logo, GRect((b.size.w - sz.w) / 2, area.origin.y - sz.h - 6,
                                                  sz.w, sz.h));
  }
}

static void frame_tick(void *ctx) {
  s_frame++;
  layer_mark_dirty(s_canvas);
  s_frame_timer = app_timer_register(SCORE_FRAME_MS, frame_tick, NULL);
}

static void close_popup(void *ctx) {
  s_close_timer = NULL;
  if (s_window) window_stack_remove(s_window, true);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_canvas = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
  s_frame = 0;
  s_frame_timer = app_timer_register(SCORE_FRAME_MS, frame_tick, NULL);
}

static void window_unload(Window *window) {
  if (s_frame_timer) app_timer_cancel(s_frame_timer);
  if (s_close_timer) app_timer_cancel(s_close_timer);
  s_frame_timer = s_close_timer = NULL;
  layer_destroy(s_canvas);
  window_destroy(s_window);
  s_window = NULL;
}

void score_popup_show(const char *abbr, const char *title, const char *line2) {
  strncpy(s_abbr, abbr ? abbr : "", sizeof(s_abbr) - 1);
  s_abbr[sizeof(s_abbr) - 1] = '\0';
  strncpy(s_title, title ? title : "", sizeof(s_title) - 1);
  s_title[sizeof(s_title) - 1] = '\0';
  strncpy(s_line2, line2 ? line2 : "", sizeof(s_line2) - 1);
  s_line2[sizeof(s_line2) - 1] = '\0';

  if (s_window) {   // already showing: restart with the new score
    s_frame = 0;
    if (s_close_timer) app_timer_cancel(s_close_timer);
    s_close_timer = app_timer_register(POPUP_MS, close_popup, NULL);
    layer_mark_dirty(s_canvas);
    return;
  }
  s_window = window_create();
  window_set_background_color(s_window, GColorBlack);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
  s_close_timer = app_timer_register(POPUP_MS, close_popup, NULL);
}
