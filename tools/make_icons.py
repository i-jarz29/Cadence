#!/usr/bin/env python3
"""Generate Cadence PWA icons: three staggered bars (timeline / list) on slate."""
from PIL import Image, ImageDraw
import os

OUT = "../icons"
os.makedirs(OUT, exist_ok=True)

BG = (51, 65, 92)          # --accent  #33415c
BG_DEEP = (40, 51, 74)
BAR = (240, 237, 230)      # warm off-white
DOT = (177, 84, 58)        # --cat-mma, a small accent of colour

def render(size, pad_frac):
    S = 1024
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)
    # subtle vertical depth
    for y in range(S):
        t = y / S
        d.line([(0, y), (S, y)], fill=(
            int(BG[0] * (1 - t) + BG_DEEP[0] * t),
            int(BG[1] * (1 - t) + BG_DEEP[1] * t),
            int(BG[2] * (1 - t) + BG_DEEP[2] * t)))
    inset = int(S * pad_frac)
    area = S - 2 * inset
    bar_h = int(area * 0.155)
    gap = int((area - 3 * bar_h) / 2)
    widths = [1.0, 0.62, 0.82]
    for i, w in enumerate(widths):
        y0 = inset + i * (bar_h + gap)
        x1 = inset + int(area * w)
        r = bar_h / 2
        d.rounded_rectangle([inset, y0, x1, y0 + bar_h], radius=r, fill=BAR)
    # a single dot on the middle bar's open end
    my0 = inset + 1 * (bar_h + gap)
    cx = inset + int(area * widths[1]) + gap + bar_h // 2
    cy = my0 + bar_h // 2
    rr = bar_h * 0.42
    if cx + rr < S - inset:
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=DOT)
    return img.resize((size, size), Image.LANCZOS)

render(192, 0.20).save(f"{OUT}/icon-192.png")
render(512, 0.20).save(f"{OUT}/icon-512.png")
render(512, 0.28).save(f"{OUT}/icon-512-maskable.png")
render(180, 0.20).save(f"{OUT}/icon-180.png")
print("wrote icons to", OUT)
for f in sorted(os.listdir(OUT)):
    print(" ", f)
