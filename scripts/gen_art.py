#!/usr/bin/env python3
"""Draw the NFL Central app icons and banner.

Writes:
  resources/images/menu_icon.png     25x25 launcher icon (1-bit, white on black)
  screenshots/icon_144.png           app store icons
  screenshots/icon_80.png
  screenshots/icon_25.png
  screenshots/banner.png             720x320 app store banner

Everything is drawn at a large size and scaled down so edges stay smooth.
Needs Pillow:  pip3 install Pillow
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHOTS = os.path.join(ROOT, "screenshots")
RES = os.path.join(ROOT, "resources", "images")

# Pebble 64-color palette values
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
FIELD = (0, 85, 0)          # dark green
FIELD_LINE = (0, 170, 85)   # lighter green for yard lines
BROWN = (170, 85, 0)
DARK_BROWN = (85, 0, 0)
YELLOW = (255, 255, 0)
LIME = (85, 255, 85)
GRAY = (170, 170, 170)

BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SS = 4  # supersampling factor


def font(size):
    return ImageFont.truetype(BOLD, size)


def football(n, body=BROWN, edge=DARK_BROWN, lace=WHITE, angle=35):
    """A football on a transparent n x n square, tilted `angle` degrees."""
    m = n * 2   # draw big, rotate, shrink back
    img = Image.new("RGBA", (m, m), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = m / 2, m / 2
    rx, ry = m * 0.45, m * 0.27
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=edge)
    k = m * 0.012
    d.ellipse((cx - rx + k, cy - ry + k, cx + rx - k, cy + ry - k), fill=body)
    # stripes near both tips
    for s in (-1, 1):
        for off in (0.60, 0.68):
            x = cx + s * rx * off
            half = ry * (1 - off ** 2) ** 0.5 * 0.95
            d.line([(x, cy - half), (x, cy + half)], fill=lace, width=max(2, int(m * 0.018)))
    # laces
    d.line([(cx - rx * 0.30, cy), (cx + rx * 0.30, cy)], fill=lace, width=max(2, int(m * 0.02)))
    for i in range(-2, 3):
        x = cx + i * rx * 0.13
        d.line([(x, cy - ry * 0.28), (x, cy + ry * 0.28)], fill=lace, width=max(2, int(m * 0.018)))
    img = img.rotate(angle, resample=Image.BICUBIC)
    return img.resize((n, n), Image.LANCZOS)


def draw_icon(size, app_ball=False):
    """Green field with yard lines, yellow uprights and a tilted football.

    With app_ball=True the football is the same pixel icon the app uses on the
    field graphic, scaled up by a whole number so its edges stay crisp.
    """
    n = size * SS
    img = Image.new("RGB", (n, n), BLACK)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, n - 1, n - 1), radius=int(n * 0.2), fill=FIELD)

    # yard lines
    for i in range(1, 6):
        y = int(n * (0.30 + 0.14 * i))
        d.line([(int(n * 0.06), y), (int(n * 0.94), y)], fill=FIELD_LINE, width=max(2, int(n * 0.012)))

    # uprights: stem, crossbar, two posts
    w = max(3, int(n * 0.035))
    cx = n * 0.5
    if app_ball:   # smaller posts so the bigger ball has room
        d.line([(cx, n * 0.27), (cx, n * 0.19)], fill=YELLOW, width=w)
        d.line([(n * 0.34, n * 0.19), (n * 0.66, n * 0.19)], fill=YELLOW, width=w)
        d.line([(n * 0.34, n * 0.19), (n * 0.34, n * 0.04)], fill=YELLOW, width=w)
        d.line([(n * 0.66, n * 0.19), (n * 0.66, n * 0.04)], fill=YELLOW, width=w)
        tile = img.resize((size, size), Image.LANCZOS)
        ball = Image.open(os.path.join(RES, "football.png")).convert("RGBA")
        k = int(size * 0.70) // ball.width            # whole-number scale
        ball = ball.resize((ball.width * k, ball.height * k), Image.NEAREST)
        tile.paste(ball, ((size - ball.width) // 2, int(size * 0.62 - ball.height / 2)), ball)
        return tile
    d.line([(cx, n * 0.40), (cx, n * 0.28)], fill=YELLOW, width=w)
    d.line([(n * 0.30, n * 0.28), (n * 0.70, n * 0.28)], fill=YELLOW, width=w)
    d.line([(n * 0.30, n * 0.28), (n * 0.30, n * 0.08)], fill=YELLOW, width=w)
    d.line([(n * 0.70, n * 0.28), (n * 0.70, n * 0.08)], fill=YELLOW, width=w)

    # football
    fb = football(int(n * 0.70))
    img.paste(fb, (int(n * 0.15), int(n * 0.33)), fb)
    return img.resize((size, size), Image.LANCZOS)


def draw_menu_icon():
    """25x25, 1-bit: a white football outline with laces, tilted. White on
    black, like the rest of the Pebble launcher icons."""
    n = 25 * 16
    img = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(img)
    cx, cy = n / 2, n / 2
    rx, ry = n * 0.47, n * 0.28
    lw = int(n * 0.07)
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=255, width=lw)
    d.line([(cx - rx * 0.32, cy), (cx + rx * 0.32, cy)], fill=255, width=int(n * 0.05))
    for i in (-1, 0, 1):
        x = cx + i * rx * 0.2
        d.line([(x, cy - ry * 0.4), (x, cy + ry * 0.4)], fill=255, width=int(n * 0.045))
    for s in (-1, 1):
        x = cx + s * rx * 0.62
        half = ry * (1 - 0.62 ** 2) ** 0.5
        d.line([(x, cy - half), (x, cy + half)], fill=255, width=int(n * 0.05))
    img = img.rotate(35, resample=Image.BICUBIC)
    img = img.resize((25, 25), Image.LANCZOS)
    return img.point(lambda v: 255 if v > 80 else 0).convert("1")


def draw_banner():
    w, h = 720, 320
    img = Image.new("RGB", (w, h), BLACK)
    icon = draw_icon(240, app_ball=True)
    img.paste(icon, (40, 40))
    d = ImageDraw.Draw(img)

    x = 312
    d.text((x, 22), "NFL", font=font(124), fill=WHITE)
    title = "Central"
    tsize = 96
    while d.textlength(title, font=font(tsize)) > w - x - 24:
        tsize -= 1
    d.text((x, 138), title, font=font(tsize), fill=LIME)
    d.rectangle((x + 4, 256, x + 4 + 64, 261), fill=YELLOW)
    tagline = "Scores | Field View | Standings"
    size = 26
    while d.textlength(tagline, font=font(size)) > w - x - 24:
        size -= 1
    d.text((x, 270), tagline, font=font(size), fill=GRAY)
    return img


def main():
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(RES, exist_ok=True)
    draw_menu_icon().save(os.path.join(RES, "menu_icon.png"))
    # 144 px gets the app's football at a whole-number scale; the smaller
    # sizes are shrunk from the big banner-size icon
    big = draw_icon(240, app_ball=True)
    draw_icon(144, app_ball=True).save(os.path.join(SHOTS, "icon_144.png"))
    for size in (80, 25):
        big.resize((size, size), Image.LANCZOS).save(os.path.join(SHOTS, "icon_%d.png" % size))
    draw_banner().save(os.path.join(SHOTS, "banner.png"))
    print("done")


if __name__ == "__main__":
    main()
