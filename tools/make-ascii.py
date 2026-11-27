"""Convert a portrait photo into ASCII art for the profile card.

Usage: python3 tools/make-ascii.py tools/avatar.png > src/ascii.txt
Requires Pillow. Works best with a light, plain background.
"""
import sys

from PIL import Image, ImageOps

COLS = 54
# Darker pixels get denser glyphs; near-white background becomes blank.
RAMP = "@%#*+=-:. "
BG_THRESHOLD = 225


def main(path: str) -> None:
    img = Image.open(path).convert("L")
    img = ImageOps.autocontrast(img, cutoff=2)
    w, h = img.size
    # Terminal glyphs are roughly twice as tall as they are wide.
    rows = int(h / w * COLS * 0.5)
    img = img.resize((COLS, rows), Image.LANCZOS)
    px = img.load()
    lines = []
    for y in range(rows):
        line = ""
        for x in range(COLS):
            v = px[x, y]
            if v >= BG_THRESHOLD:
                line += " "
            else:
                line += RAMP[min(len(RAMP) - 2, v * (len(RAMP) - 1) // BG_THRESHOLD)]
        lines.append(line.rstrip())
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tools/avatar.png")
