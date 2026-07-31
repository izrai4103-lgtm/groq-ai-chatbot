#!/usr/bin/env python3
"""
🔍 Pillow Analyzer — mesin analisis gambar untuk Zanco-Ai.
Membaca bytes gambar dari stdin, lalu mengembalikan JSON teknis:
dimensi, format, mode, EXIF, warna dominan, kecerahan.
"""
import sys
import json
import io

try:
    from PIL import Image, ImageStat, ImageOps, ExifTags
except ImportError:
    print(json.dumps({"ok": False, "error": "PIL tidak tersedia"}))
    sys.exit(1)


def main():
    data = sys.stdin.buffer.read()
    if not data:
        print(json.dumps({"ok": False, "error": "gambar kosong"}))
        sys.exit(1)

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:
        print(json.dumps({"ok": False, "error": "gambar tidak valid: %s" % e}))
        sys.exit(1)

    w, h = img.size
    fmt = (img.format or "unknown").upper()
    mode = img.mode
    exif = {}

    try:
        ex = img.getexif()
        if ex:
            for tag, val in ex.items():
                name = ExifTags.TAGS.get(tag, str(tag))
                if name in ("DateTime", "DateTimeOriginal", "Make", "Model",
                            "Software", "Orientation", "ExposureTime",
                            "FNumber", "ISOSpeedRatings", "FocalLength",
                            "LensModel"):
                    exif[name] = str(val)
    except Exception:
        pass

    # Warna dominan (quantize median cut)
    colors = []
    try:
        rgb = ImageOps.exif_transpose(img).convert("RGB")
        q = rgb.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
        pal = q.getpalette() or []
        for cnt, idx in sorted(q.getcolors(), key=lambda x: -x[0])[:5]:
            r, g, b = pal[idx * 3: idx * 3 + 3]
            colors.append({"hex": "#%02x%02x%02x" % (r, g, b), "count": int(cnt)})
    except Exception:
        pass

    # Kecerahan rata-rata (0-100)
    brightness = None
    try:
        gray = ImageOps.exif_transpose(img).convert("L")
        brightness = round(ImageStat.Stat(gray).mean[0] / 255.0 * 100, 1)
    except Exception:
        pass

    print(json.dumps({
        "ok": True,
        "engine": "pillow",
        "width": w,
        "height": h,
        "format": fmt,
        "mode": mode,
        "exif": exif,
        "colors": colors,
        "brightness": brightness,
        "bytes": len(data),
    }))


if __name__ == "__main__":
    main()
