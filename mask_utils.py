"""Mask handling for the Video Frame Picker (rectangle, freehand, MaskEditor)."""

import base64
import io
import json

import numpy as np
from PIL import Image, ImageDraw

FILL_COLORS = {
    "yellow": (255, 255, 0),
    "red": (255, 0, 0),
    "green": (0, 255, 0),
    "blue": (0, 0, 255),
    "white": (255, 255, 255),
    "black": (0, 0, 0),
}
MASK_SOURCES = ["none", "MaskEditor", "rectangle", "freehand"]


def parse_crop_data(crop_data):
    if not crop_data or not crop_data.strip():
        return {}
    try:
        data = json.loads(crop_data)
    except json.JSONDecodeError:
        print(f"[VideoFramePicker] ignoring invalid crop_data: {crop_data[:80]!r}")
        return {}
    return data if isinstance(data, dict) else {}


def decode_png(data_url, size, mode):
    img = Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[-1]))).convert(mode)
    return img if img.size == size else img.resize(size, Image.Resampling.BILINEAR)


def rect_to_pixels(rect, w, h):
    try:
        x, y, rw, rh = (float(v) for v in rect)
    except (TypeError, ValueError):
        return None
    x0, y0 = round(min(max(x, 0.0), 1.0) * w), round(min(max(y, 0.0), 1.0) * h)
    x1, y1 = round(min(max(x + rw, 0.0), 1.0) * w), round(min(max(y + rh, 0.0), 1.0) * h)
    return (x0, y0, x1, y1) if x1 - x0 >= 1 and y1 - y0 >= 1 else None


def render_shape(strokes, w, h):
    """Boolean (h, w) array of the freehand shape; strokes use coordinates relative to the frame."""
    canvas = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(canvas)
    for stroke in strokes or []:
        pts = [(float(p[0]) * w, float(p[1]) * h) for p in stroke.get("p", []) if len(p) >= 2]
        if not pts:
            continue
        kind = stroke.get("t", "brush")
        if kind == "lasso":
            if len(pts) >= 3:
                draw.polygon(pts, fill=255)
            continue
        value = 0 if kind == "erase" else 255
        width = max(1.0, float(stroke.get("s", 0.02)) * w)
        r = width / 2.0
        if len(pts) > 1:
            draw.line(pts, fill=value, width=round(width))
        for px, py in pts:
            draw.ellipse((px - r, py - r, px + r, py + r), fill=value)
    return np.array(canvas) > 127


def apply_mask(rgb, mask_source, fill_color, crop_data, crop_to_mask):
    """Returns (rgb uint8 (H, W, 3), mask float32 (H, W)). An empty rectangle/freehand mask covers the whole frame."""
    h, w = rgb.shape[:2]
    data = parse_crop_data(crop_data)

    if data.get("paint"):
        paint = decode_png(data["paint"], (w, h), "RGBA")
        rgb = np.array(Image.alpha_composite(Image.fromarray(rgb).convert("RGBA"), paint).convert("RGB"))

    mask = np.zeros((h, w), dtype=np.float32)
    if mask_source == "MaskEditor" and data.get("mask"):
        mask = np.asarray(decode_png(data["mask"], (w, h), "L"), dtype=np.float32) / 255.0
    elif mask_source == "rectangle":
        box = rect_to_pixels(data.get("rect"), w, h)
        if box is None:
            mask[:] = 1.0
        else:
            mask[box[1]:box[3], box[0]:box[2]] = 1.0
    elif mask_source == "freehand":
        shape = render_shape(data.get("strokes"), w, h)
        if shape.any():
            mask = shape.astype(np.float32)
            rgb = rgb.copy()
            rgb[~shape] = FILL_COLORS.get(fill_color, FILL_COLORS["yellow"])
        else:
            mask[:] = 1.0

    if crop_to_mask:
        hit = mask >= 0.5
        if hit.any():
            rows, cols = np.where(hit.any(axis=1))[0], np.where(hit.any(axis=0))[0]
            rgb, mask = rgb[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1], mask[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
    return rgb, mask
