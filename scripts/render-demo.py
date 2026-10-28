"""Render the real offline CUI output into an explicitly labeled demo GIF."""
import argparse
import os
import re
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--node", default=shutil.which("node") or "node")
parser.add_argument("--font", default=str(Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts/DejaVuSansMono.ttf"))
args = parser.parse_args()
result = subprocess.run(
    [args.node, str(ROOT / "bin/portdoc.js"), "demo", "--lang", "en", "--no-color"],
    cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True,
)
lines = result.stdout.rstrip().splitlines()
font = ImageFont.truetype(args.font, 20)
small = ImageFont.truetype(args.font, 16)
line_height = 29
visible_lines = 26
width, height = 1120, 940
background = "#10151e"
normal = "#d8e1ef"
muted = "#8b9bb3"
cyan = "#70d9ee"
green = "#8ee6a2"
yellow = "#f2cb77"
red = "#f598a6"


def render(shown, scroll=0):
    canvas = Image.new("RGB", (width, height), "#080c12")
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((12, 12, width - 12, height - 12), radius=16, fill=background, outline="#2c394d", width=2)
    for x, color in ((39, "#e98686"), (63, "#d7b76b"), (87, "#6ebd8b")):
        draw.ellipse((x, 34, x + 11, 45), fill=color)
    draw.text((120, 26), "portdoc 0.6  /  Windows + WSL + Docker", font=small, fill=muted)
    draw.text((36, 73), "PS> portdoc demo --lang en", font=font, fill=cyan)
    if scroll:
        draw.text((36, 111), f"... {scroll} preceding lines", font=small, fill=muted)
    display = shown[scroll:scroll + visible_lines]
    for index, line in enumerate(display):
        color = normal
        if line.startswith("DEMO") or "UNKNOWN" in line:
            color = yellow
        elif line in ("ENDPOINT MATRIX", "OWNERSHIP", "FINDINGS", "NEXT") or line.startswith("PORTDOC"):
            color = cyan
        elif line.startswith(("╭", "╰", "│")):
            color = muted
        elif "Test-NetConnection" in line:
            color = green
        elif "Project" in line or "Command:" in line:
            color = green
        draw.text((36, 143 + index * line_height), line, font=font, fill=color)
        for token in re.finditer(r"✓ \d+ ms|× REFUSED", line):
            draw.text((36 + font.getlength(line[:token.start()]), 143 + index * line_height), token.group(), font=font, fill=green if token.group().startswith("✓") else red)
    draw.text((36, height - 43), "SIMULATED FIXTURE  /  run portdoc <port> for your machine", font=small, fill=muted)
    return canvas


# Eight seconds: command, address comparison, project identity, next step.
frames = [render([]), render(lines[:16]), render(lines[:24]), render(lines, max(0, len(lines) - visible_lines))]
durations = [650, 2350, 1800, 3200]
docs = ROOT / "docs"
docs.mkdir(exist_ok=True)
frames[0].save(docs / "demo.gif", save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=2)
render(lines[:24]).save(docs / "demo.png")
print(f"Rendered docs/demo.gif ({sum(durations)} ms) and docs/demo.png from {len(lines)} actual CUI lines.")
