"""Generate the 5 sample drawings in public/samples/.

Each sample is a single-pen sketch on paper. Some are flat "scans", some are
"photos" (paper rotated + perspective on a desk) to exercise paper detection.

    python scripts/gen-samples.py

Uses Windows' Ink Free font for handwriting; falls back to PIL's default.
"""
from __future__ import annotations

import math
import os
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 900
INK = (28, 32, 52)
PAPER = (246, 242, 232)
OUT = Path(__file__).resolve().parent.parent / "public" / "samples"
FONT_PATHS = ["C:/Windows/Fonts/Inkfree.ttf", "C:/Windows/Fonts/segoepr.ttf"]


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


class Pen:
    def __init__(self, img: Image.Image, seed: int):
        self.d = ImageDraw.Draw(img)
        self.rng = random.Random(seed)

    def stroke(self, pts: list[tuple[float, float]], width: float = 6, wobble: float = 2.2) -> None:
        dense: list[tuple[float, float]] = []
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            n = max(2, int(math.hypot(x2 - x1, y2 - y1) / 6))
            for i in range(n):
                t = i / n
                dense.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
        dense.append(pts[-1])
        phase = self.rng.random() * 10
        out = []
        for i, (x, y) in enumerate(dense):
            o = math.sin(i * 0.18 + phase) * wobble + self.rng.uniform(-0.6, 0.6)
            out.append((x + o * 0.4, y + o))
        w = max(2, int(width + self.rng.uniform(-0.8, 0.8)))
        self.d.line(out, fill=INK, width=w, joint="curve")
        r = w / 2
        for x, y in (out[0], out[-1]):
            self.d.ellipse([x - r, y - r, x + r, y + r], fill=INK)

    def line(self, x1, y1, x2, y2, **kw) -> None:
        self.stroke([(x1, y1), (x2, y2)], **kw)

    def zigzag(self, x, y, w, h, teeth=6) -> None:
        pts = [(x, y)]
        for i in range(teeth):
            pts.append((x + (i + 0.5) * w / teeth, y - h))
            pts.append((x + (i + 1) * w / teeth, y))
        self.stroke(pts, width=5, wobble=1)

    def circle(self, cx, cy, r, n=28, width=5) -> None:
        pts = [(cx + math.cos(a) * r * self.rng.uniform(0.95, 1.05), cy + math.sin(a) * r)
               for a in np.linspace(0, 2 * math.pi * 1.04, n)]
        self.stroke(pts, width=width, wobble=0.8)

    def star(self, cx, cy, r) -> None:
        pts = []
        for i in range(11):
            a = -math.pi / 2 + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.45
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        self.stroke(pts, width=5, wobble=0.6)

    def text(self, x, y, s, size=56, angle=0.0) -> None:
        f = font(size)
        box = self.d.textbbox((0, 0), s, font=f)
        tw, th = box[2] - box[0] + 20, box[3] - box[1] + 30
        layer = Image.new("L", (tw, th), 0)
        ImageDraw.Draw(layer).text((10 - box[0], 10 - box[1]), s, font=f, fill=255)
        layer = layer.rotate(angle, expand=True, resample=Image.BICUBIC)
        self.d._image.paste(INK, (int(x), int(y)), layer)  # noqa: SLF001

    def arrow(self, x1, y1, x2, y2) -> None:
        self.line(x1, y1, x2, y2, width=4, wobble=0.6)
        a = math.atan2(y2 - y1, x2 - x1)
        for s in (-1, 1):
            self.line(x2, y2, x2 - 22 * math.cos(a + s * 0.5), y2 - 22 * math.sin(a + s * 0.5), width=4, wobble=0.3)

    # ---- doodles ----
    def cactus(self, x, base, h=150) -> None:
        self.stroke([(x, base), (x, base - h), (x + 30, base - h - 10), (x + 40, base - h), (x + 40, base)], width=6)
        self.stroke([(x, base - h * 0.55), (x - 35, base - h * 0.55), (x - 35, base - h * 0.85)], width=5)
        self.stroke([(x + 40, base - h * 0.4), (x + 75, base - h * 0.4), (x + 75, base - h * 0.7)], width=5)
        for i in range(5):
            yy = base - 20 - i * 25
            self.line(x + 8, yy, x + 14, yy - 6, width=3, wobble=0)

    def trampoline(self, x, base, w=150) -> None:
        self.stroke([(x, base - 45), (x + w / 2, base - 30), (x + w, base - 45)], width=6, wobble=0.6)
        self.line(x + 10, base - 42, x + 5, base, width=5)
        self.line(x + w - 10, base - 42, x + w - 5, base, width=5)
        for i in range(4):
            self.line(x + 25 + i * 30, base - 30, x + 35 + i * 30, base - 12, width=3, wobble=0.3)

    def cloud(self, x, y, w=220) -> None:
        pts = [(x, y)]
        bumps = 4
        for i in range(bumps):
            cx = x + (i + 0.5) * w / bumps
            for a in np.linspace(math.pi, 2 * math.pi, 7):
                pts.append((cx + math.cos(a) * w / bumps / 2, y + math.sin(a) * 34))
        pts += [(x + w, y), (x + w - 10, y + 22), (x + 10, y + 22), (x, y)]
        self.stroke(pts, width=5, wobble=0.6)

    def dog(self, x, base) -> None:
        self.stroke([(x, base - 60), (x + 110, base - 60), (x + 110, base - 30), (x, base - 30), (x, base - 60)], width=5)
        for lx in (x + 10, x + 30, x + 80, x + 100):
            self.line(lx, base - 30, lx, base, width=5)
        self.circle(x - 20, base - 78, 28)
        self.stroke([(x - 40, base - 100), (x - 50, base - 128), (x - 28, base - 104)], width=4)
        self.stroke([(x + 110, base - 60), (x + 140, base - 90)], width=4)
        self.d.ellipse([x - 32, base - 86, x - 24, base - 78], fill=INK)

    def chai(self, x, base) -> None:
        self.stroke([(x, base - 70), (x + 10, base), (x + 60, base), (x + 70, base - 70), (x, base - 70)], width=5)
        self.stroke([(x + 68, base - 55), (x + 92, base - 50), (x + 90, base - 25), (x + 63, base - 22)], width=4)
        for i in range(3):
            sx = x + 15 + i * 20
            self.stroke([(sx, base - 85), (sx + 8, base - 100), (sx, base - 115), (sx + 8, base - 130)], width=3, wobble=0.3)

    def flag(self, x, base) -> None:
        self.line(x, base, x, base - 150, width=6)
        self.stroke([(x, base - 150), (x + 70, base - 130), (x, base - 105)], width=5, wobble=0.4)

    def door(self, x, base) -> None:
        self.stroke([(x, base), (x, base - 120), (x + 70, base - 120), (x + 70, base)], width=6)
        self.d.ellipse([x + 52, base - 64, x + 60, base - 56], fill=INK)

    def stick(self, x, base) -> None:
        self.circle(x, base - 95, 16, width=5)
        self.line(x, base - 79, x, base - 35, width=5)
        self.line(x, base - 35, x - 18, base, width=5)
        self.line(x, base - 35, x + 18, base, width=5)
        self.line(x - 22, base - 65, x + 22, base - 60, width=5)

    def coin(self, x, y) -> None:
        self.text(x, y, "$", size=64)


def paper(seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    base = np.ones((H, W, 3), dtype=np.float32) * np.array(PAPER, dtype=np.float32)
    base += rng.normal(0, 3.5, (H, W, 1))
    for y in range(80, H, 46):  # faint ruled lines
        base[y : y + 2, :, :] -= np.array([18, 10, 0])
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))


def photo(sheet: Image.Image, seed: int) -> Image.Image:
    """Place the sheet on a desk with rotation + perspective + lighting."""
    rng = random.Random(seed)
    cw, ch = 2000, 1250
    desk = np.zeros((ch, cw, 3), dtype=np.float32)
    yy, xx = np.mgrid[0:ch, 0:cw]
    desk[...] = np.array([92, 70, 52])
    desk += (np.sin(xx / 13.0 + np.sin(yy / 80.0) * 3) * 6)[..., None]
    desk = Image.fromarray(np.clip(desk, 0, 255).astype(np.uint8))

    ox, oy = 200, 175
    quad_dst = [
        (ox + rng.uniform(-40, 40), oy + rng.uniform(-30, 30)),
        (ox + W + rng.uniform(-40, 40), oy + rng.uniform(-30, 50)),
        (ox + W + rng.uniform(-30, 60), oy + H + rng.uniform(-20, 40)),
        (ox + rng.uniform(-60, 20), oy + H + rng.uniform(-30, 30)),
    ]
    coeffs = perspective_coeffs(quad_dst, [(0, 0), (W, 0), (W, H), (0, H)])
    warped = sheet.convert("RGBA").transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    shadow = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 14, y + 18) for x, y in quad_dst], fill=(0, 0, 0, 110))
    desk = desk.convert("RGBA")
    desk.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    desk.alpha_composite(warped)
    light = np.linspace(1.05, 0.86, cw)[None, :, None] * np.linspace(1.0, 0.92, ch)[:, None, None]
    arr = np.asarray(desk.convert("RGB"), dtype=np.float32) * light
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return img.filter(ImageFilter.GaussianBlur(0.7))


def perspective_coeffs(src, dst):
    """Coefficients mapping output (src quad) pixels back to input (dst quad)."""
    m = []
    for (x, y), (u, v) in zip(src, dst):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(m, dtype=np.float64)
    b = np.array([c for p in dst for c in p], dtype=np.float64)
    return np.linalg.solve(a, b).tolist()


# ---------------- the 5 levels ----------------

def s1_basics(p: Pen) -> None:
    p.line(60, 800, 620, 805)
    p.zigzag(640, 805, 180, 45)
    p.line(840, 800, 1540, 796)
    p.line(380, 620, 640, 615)
    p.line(900, 560, 1150, 565)
    p.line(1240, 430, 1480, 425)
    p.text(110, 690, "P", size=96)
    p.star(1400, 360, 42)
    p.coin(470, 520)
    p.coin(990, 470)
    p.text(1050, 110, "low gravity", size=72, angle=3)


def s2_desert(p: Pen) -> None:
    p.line(40, 820, 1560, 815)
    p.text(90, 710, "P", size=96)
    p.cactus(420, 818, 150)
    p.trampoline(640, 818)
    p.cloud(850, 520)
    p.cloud(1150, 380, 200)
    p.cactus(1000, 818, 120)
    p.flag(1300, 375)
    p.text(80, 90, "enemies get faster", size=60, angle=-2)
    p.text(110, 180, "E", size=80)
    p.arrow(170, 230, 260, 230)


def s3_mess(p: Pen) -> None:
    p.line(50, 810, 700, 812)
    p.line(820, 810, 1550, 805)
    p.line(300, 610, 560, 606)
    p.line(760, 520, 1020, 525)
    p.line(1180, 640, 1500, 636)
    p.text(80, 700, "P", size=96)
    p.dog(1100, 806)
    p.arrow(1040, 700, 960, 700)
    p.chai(400, 604)
    p.coin(860, 420)
    p.coin(1300, 540)
    p.door(1420, 805)
    p.text(60, 60, "coins = speed boost", size=58, angle=-1.5)
    p.text(820, 60, "boss: angry mess uncle", size=54, angle=1.5)
    p.text(880, 130, "throws rotis", size=54, angle=1.5)


def s4_night(p: Pen) -> None:
    p.line(50, 820, 520, 822)
    p.stroke([(560, 820), (980, 600)], width=6)
    p.line(1000, 600, 1300, 598)
    p.line(1350, 470, 1560, 466)
    p.line(700, 380, 900, 384)
    p.text(90, 710, "P", size=96)
    p.text(420, 720, "E", size=80)
    p.arrow(400, 690, 330, 690)
    p.text(1215, 495, "E", size=80)
    p.arrow(1205, 460, 1140, 460)
    p.zigzag(1020, 598, 100, 38, teeth=4)
    p.star(1470, 400, 40)
    p.coin(780, 290)
    p.text(80, 80, "night mode", size=66, angle=-2)
    p.text(80, 170, "time limit 45 sec", size=56, angle=-1)


def s5_stairs(p: Pen) -> None:
    p.line(40, 830, 400, 832)
    p.stick(120, 828)
    p.line(470, 720, 640, 722)
    p.line(720, 610, 890, 612)
    p.zigzag(900, 832, 300, 40, teeth=7)
    p.line(980, 500, 1150, 498)
    p.line(1240, 330, 1440, 326)
    p.flag(1380, 326)
    p.coin(540, 620)
    p.coin(800, 510)
    p.coin(1050, 400)
    p.text(80, 80, "double jump!", size=66, angle=-3)
    p.text(80, 170, "super speed", size=60, angle=-1)


SAMPLES = [
    ("01-basics", s1_basics, True),
    ("02-desert", s2_desert, False),
    ("03-mess-uncle", s3_mess, True),
    ("04-night-run", s4_night, False),
    ("05-stairway", s5_stairs, True),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (name, draw, as_photo) in enumerate(SAMPLES):
        sheet = paper(i)
        draw(Pen(sheet, seed=i * 7 + 1))
        img = photo(sheet, i) if as_photo else sheet
        img.thumbnail((1600, 1600))
        img.save(OUT / f"{name}.jpg", quality=86)
        thumb = sheet.copy()
        thumb.thumbnail((480, 480))
        thumb.save(OUT / f"{name}.thumb.jpg", quality=80)
        print("wrote", name, img.size)


if __name__ == "__main__":
    main()
