from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "snapdeck_logo.png"
OUT_DIR = ROOT / "icons"


def _ensure_rgba(img: Image.Image) -> Image.Image:
    if img.mode != "RGBA":
        return img.convert("RGBA")
    return img


def _contain_on_square(img: Image.Image, size: int, background=(0, 0, 0, 0), padding: int = 0) -> Image.Image:
    # Creates an exact size×size image, containing the source with optional padding.
    if padding < 0 or padding * 2 >= size:
        raise ValueError("padding must be >= 0 and less than half the size")

    canvas = Image.new("RGBA", (size, size), background)
    max_side = size - padding * 2

    src = img.copy()
    src.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    left = (size - src.size[0]) // 2
    top = (size - src.size[1]) // 2
    canvas.paste(src, (left, top), src)
    return canvas


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source logo: {SRC}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    base = _ensure_rgba(Image.open(SRC))

    # Standard icons: use transparent background, mild padding so it looks balanced.
    standard_padding = 20
    icon_192 = _contain_on_square(base, 192, padding=standard_padding)
    icon_512 = _contain_on_square(base, 512, padding=56)

    # Maskable icons should be safe inside the circle/squircle crop.
    # Use more padding so the logo doesn't get clipped.
    maskable_padding_192 = 32
    maskable_padding_512 = 96
    mask_192 = _contain_on_square(base, 192, padding=maskable_padding_192)
    mask_512 = _contain_on_square(base, 512, padding=maskable_padding_512)

    icon_192.save(OUT_DIR / "icon-192.png", optimize=True)
    icon_512.save(OUT_DIR / "icon-512.png", optimize=True)
    mask_192.save(OUT_DIR / "maskable-192.png", optimize=True)
    mask_512.save(OUT_DIR / "maskable-512.png", optimize=True)

    print("Generated:")
    for p in [
        OUT_DIR / "icon-192.png",
        OUT_DIR / "icon-512.png",
        OUT_DIR / "maskable-192.png",
        OUT_DIR / "maskable-512.png",
    ]:
        print(f"- {p.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
