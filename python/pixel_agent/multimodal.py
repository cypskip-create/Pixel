"""Python-first multimodal processing for Pixel (Hermes vision & image-gen parity).

Capabilities:
  - Vision capability validation (`is_vision_capable_model`, `assert_vision_capable_model`).
  - Image history budgeting (`enforce_image_history_budget`) so old screenshots don't blow context.
  - Real Set-of-Marks (SoM) PNG annotation (`annotate_som_png_base64`): draws crisp bounding
    boxes and numbered badges directly onto captured window PNGs using Pillow when available
    or a built-in pure-Python stdlib PNG codec (`zlib` + `struct`, filter types 0-4).
  - Multi-provider image generation (`generate_image_artifact`: OpenAI `gpt-image-1`, FAL.ai Flux).
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import ssl
import struct
import time
import urllib.error
import urllib.request
import uuid
import zlib
from pathlib import Path
from typing import Any, Optional

VISION_CAPABLE_PATTERNS = (
    re.compile(r"gpt-4o", re.I),
    re.compile(r"gpt-4\.1", re.I),
    re.compile(r"gpt-5", re.I),
    re.compile(r"claude-(?:3|4|sonnet|opus|haiku)", re.I),
    re.compile(r"gemini-(?:1\.5|2\.|3\.)", re.I),
    re.compile(r"grok-(?:2-vision|3|4)", re.I),
    re.compile(r"qwen.*vl", re.I),
    re.compile(r"llava", re.I),
    re.compile(r"pixtral", re.I),
    re.compile(r"vision", re.I),
)

MAX_IMAGE_BYTES = 16 * 1024 * 1024  # 16 MiB safety cap

# Compact 3x5 bitmap font for digits 0-9 (each row is 3 bits)
_DIGIT_FONT_3X5: dict[str, tuple[str, ...]] = {
    "0": ("111", "101", "101", "101", "111"),
    "1": ("010", "110", "010", "010", "111"),
    "2": ("111", "001", "111", "100", "111"),
    "3": ("111", "001", "111", "001", "111"),
    "4": ("101", "101", "111", "001", "001"),
    "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"),
    "7": ("111", "001", "010", "010", "010"),
    "8": ("111", "101", "111", "101", "111"),
    "9": ("111", "101", "111", "001", "111"),
}

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def is_vision_capable_model(model: str) -> bool:
    name = (model or "").strip()
    if not name:
        return False
    return any(p.search(name) for p in VISION_CAPABLE_PATTERNS)


def assert_vision_capable_model(model: str) -> dict[str, Any]:
    if is_vision_capable_model(model):
        return {"ok": True, "model": model}
    return {
        "ok": False,
        "model": model,
        "error": (
            f'Model "{model}" does not advertise vision input support. '
            "Switch to a vision-capable model (e.g. gpt-4o, claude-sonnet-4, gemini-2.5-flash) "
            "or use accessibility-tree (ax) mode."
        ),
    }


def enforce_image_history_budget(
    messages: list[dict[str, Any]],
    max_images: int = 4,
) -> tuple[list[dict[str, Any]], int]:
    """Keep at most `max_images` newest image blocks across message history."""
    limit = max(0, int(max_images))
    image_slots: list[tuple[int, int]] = []
    for msg_idx, msg in enumerate(messages):
        content = msg.get("content")
        if isinstance(content, list):
            for part_idx, part in enumerate(content):
                if isinstance(part, dict) and part.get("type") in ("image_url", "image"):
                    image_slots.append((msg_idx, part_idx))

    if len(image_slots) <= limit:
        return messages, 0

    drop_count = len(image_slots) - limit
    to_drop = set(image_slots[:drop_count])
    updated: list[dict[str, Any]] = []
    for msg_idx, msg in enumerate(messages):
        content = msg.get("content")
        if not isinstance(content, list):
            updated.append(msg)
            continue
        new_parts: list[Any] = []
        for part_idx, part in enumerate(content):
            if (msg_idx, part_idx) in to_drop:
                new_parts.append({"type": "text", "text": "[Earlier image omitted to stay within image history budget]"})
            else:
                new_parts.append(part)
        copied = dict(msg)
        copied["content"] = new_parts
        updated.append(copied)
    return updated, drop_count


# ---------------------------------------------------------------------------
# Pure-Python PNG codec (RGB/RGBA 8-bit, filter types 0-4) for Set-of-Marks
# ---------------------------------------------------------------------------

def _paeth_predictor(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_png_rgba(png_bytes: bytes) -> tuple[int, int, bytearray]:
    """Decode an 8-bit RGB or RGBA non-interlaced PNG into (width, height, rgba_bytearray)."""
    if len(png_bytes) < 24 or png_bytes[:8] != _PNG_SIGNATURE:
        raise ValueError("Input is not a valid PNG image.")

    pos = 8
    width = 0
    height = 0
    bit_depth = 0
    color_type = 0
    interlace = 0
    idat_chunks: list[bytes] = []

    while pos + 8 <= len(png_bytes):
        length, chunk_type = struct.unpack(">I4s", png_bytes[pos : pos + 8])
        pos += 8
        data = png_bytes[pos : pos + length]
        pos += length + 4  # skip CRC
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filt, interlace = struct.unpack(">IIBBBBB", data[:13])
        elif chunk_type == b"IDAT":
            idat_chunks.append(data)
        elif chunk_type == b"IEND":
            break

    if width <= 0 or height <= 0 or bit_depth != 8 or interlace != 0:
        raise ValueError(f"Unsupported PNG format (w={width}, h={height}, depth={bit_depth}, interlace={interlace}).")
    if color_type not in (2, 6):
        raise ValueError(f"Unsupported PNG color type {color_type} (expected 2=RGB or 6=RGBA).")

    bpp = 3 if color_type == 2 else 4
    stride = width * bpp
    raw = zlib.decompress(b"".join(idat_chunks))
    if len(raw) < height * (stride + 1):
        raise ValueError("Truncated PNG pixel data.")

    recon = bytearray(height * stride)
    prev_row = bytearray(stride)
    src = 0
    for y in range(height):
        filt = raw[src]
        src += 1
        row = bytearray(raw[src : src + stride])
        src += stride
        if filt == 1:  # Sub
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif filt == 2:  # Up
            for i in range(stride):
                row[i] = (row[i] + prev_row[i]) & 0xFF
        elif filt == 3:  # Average
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((left + prev_row[i]) >> 1)) & 0xFF
        elif filt == 4:  # Paeth
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                up = prev_row[i]
                up_left = prev_row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + _paeth_predictor(left, up, up_left)) & 0xFF
        elif filt != 0:
            raise ValueError(f"Unknown PNG filter byte {filt}.")
        recon[y * stride : (y + 1) * stride] = row
        prev_row = row

    if bpp == 4:
        return width, height, recon

    rgba = bytearray(width * height * 4)
    dst = 0
    for i in range(0, len(recon), 3):
        rgba[dst] = recon[i]
        rgba[dst + 1] = recon[i + 1]
        rgba[dst + 2] = recon[i + 2]
        rgba[dst + 3] = 255
        dst += 4
    return width, height, rgba


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = binascii.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def encode_png_rgba(width: int, height: int, rgba: bytearray) -> bytes:
    """Encode an 8-bit RGBA bytearray into a valid PNG byte buffer."""
    stride = width * 4
    raw = bytearray(height * (stride + 1))
    dst = 0
    for y in range(height):
        raw[dst] = 0  # Filter None
        dst += 1
        row_start = y * stride
        raw[dst : dst + stride] = rgba[row_start : row_start + stride]
        dst += stride
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=6)
    return _PNG_SIGNATURE + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b"")


def _set_px(rgba: bytearray, width: int, height: int, x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if 0 <= x < width and 0 <= y < height:
        idx = (y * width + x) * 4
        rgba[idx] = color[0]
        rgba[idx + 1] = color[1]
        rgba[idx + 2] = color[2]
        rgba[idx + 3] = color[3]


def _fill_rect(
    rgba: bytearray,
    width: int,
    height: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int, int],
) -> None:
    xa = max(0, min(width - 1, x0))
    xb = max(0, min(width - 1, x1))
    ya = max(0, min(height - 1, y0))
    yb = max(0, min(height - 1, y1))
    for y in range(ya, yb + 1):
        row = y * width * 4
        for x in range(xa, xb + 1):
            idx = row + x * 4
            rgba[idx] = color[0]
            rgba[idx + 1] = color[1]
            rgba[idx + 2] = color[2]
            rgba[idx + 3] = color[3]


def _draw_rect_outline(
    rgba: bytearray,
    width: int,
    height: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int, int],
    thickness: int = 2,
) -> None:
    for t in range(thickness):
        for x in range(max(0, x0), min(width, x1 + 1)):
            _set_px(rgba, width, height, x, y0 + t, color)
            _set_px(rgba, width, height, x, y1 - t, color)
        for y in range(max(0, y0), min(height, y1 + 1)):
            _set_px(rgba, width, height, x0 + t, y, color)
            _set_px(rgba, width, height, x1 - t, y, color)


def _draw_badge(
    rgba: bytearray,
    width: int,
    height: int,
    x: int,
    y: int,
    label: str,
    scale: int = 2,
) -> None:
    digits = [ch for ch in label if ch in _DIGIT_FONT_3X5]
    if not digits:
        return
    pad = 3
    char_w = 3 * scale
    char_h = 5 * scale
    gap = scale
    box_w = pad * 2 + len(digits) * char_w + (len(digits) - 1) * gap
    box_h = pad * 2 + char_h
    bx0 = max(0, min(width - box_w - 1, x))
    by0 = max(0, min(height - box_h - 1, y))
    # High-contrast crimson badge with white border and crisp white digits
    _fill_rect(rgba, width, height, bx0, by0, bx0 + box_w, by0 + box_h, (220, 38, 38, 255))
    _draw_rect_outline(rgba, width, height, bx0, by0, bx0 + box_w, by0 + box_h, (255, 255, 255, 255), thickness=1)
    cx = bx0 + pad
    cy = by0 + pad
    for ch in digits:
        glyph = _DIGIT_FONT_3X5[ch]
        for gy, row_bits in enumerate(glyph):
            for gx, bit in enumerate(row_bits):
                if bit == "1":
                    _fill_rect(
                        rgba,
                        width,
                        height,
                        cx + gx * scale,
                        cy + gy * scale,
                        cx + (gx + 1) * scale - 1,
                        cy + (gy + 1) * scale - 1,
                        (255, 255, 255, 255),
                    )
        cx += char_w + gap


def annotate_som_png_base64(
    png_base64: str,
    elements: list[dict[str, Any]],
    window_bounds: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Draw real numbered Set-of-Marks boxes & badges onto a PNG screenshot."""
    raw_bytes = base64.b64decode(png_base64)
    width, height, rgba = decode_png_rgba(raw_bytes)

    origin_x = int((window_bounds or {}).get("x", 0) or 0)
    origin_y = int((window_bounds or {}).get("y", 0) or 0)
    win_w = int((window_bounds or {}).get("width", width) or width)
    win_h = int((window_bounds or {}).get("height", height) or height)
    scale_x = (width / win_w) if win_w > 0 else 1.0
    scale_y = (height / win_h) if win_h > 0 else 1.0

    annotated_count = 0
    for el in elements:
        bounds = el.get("bounds")
        if not isinstance(bounds, dict):
            continue
        idx = el.get("index")
        if not isinstance(idx, int):
            continue
        bx = int(round((float(bounds.get("x", 0)) - origin_x) * scale_x))
        by = int(round((float(bounds.get("y", 0)) - origin_y) * scale_y))
        bw = max(6, int(round(float(bounds.get("width", 0)) * scale_x)))
        bh = max(6, int(round(float(bounds.get("height", 0)) * scale_y)))
        if bx >= width or by >= height or bx + bw <= 0 or by + bh <= 0:
            continue
        x0 = max(0, bx)
        y0 = max(0, by)
        x1 = min(width - 1, bx + bw)
        y1 = min(height - 1, by + bh)
        _draw_rect_outline(rgba, width, height, x0, y0, x1, y1, (220, 38, 38, 255), thickness=2)
        _draw_badge(rgba, width, height, x0, max(0, y0 - 16), str(idx), scale=2)
        annotated_count += 1

    out_png = encode_png_rgba(width, height, rgba)
    return {
        "ok": True,
        "annotatedBase64": base64.b64encode(out_png).decode("ascii"),
        "width": width,
        "height": height,
        "annotatedCount": annotated_count,
    }


def generate_image_artifact(
    *,
    prompt: str,
    provider: str = "openai",
    api_key: str = "",
    output_dir: str = "",
    model: str = "",
    size: str = "1024x1024",
    base_url: str = "",
    timeout_s: float = 60.0,
) -> dict[str, Any]:
    """Generate a real image artifact via OpenAI or FAL.ai and write PNG to output_dir."""
    clean_prompt = (prompt or "").strip()
    if not clean_prompt:
        return {"ok": False, "error": "Image generation prompt cannot be empty."}
    if not (api_key or "").strip():
        return {"ok": False, "error": f"Image generation requires a configured API key for '{provider}'."}

    prov = (provider or "openai").strip().lower()
    out_root = Path(output_dir) if output_dir else Path(os.getcwd()) / "artifacts"
    out_root.mkdir(parents=True, exist_ok=True)
    ssl_ctx = ssl.create_default_context()

    try:
        if prov == "openai":
            resolved_model = model or "gpt-image-1"
            url = f"{(base_url or 'https://api.openai.com/v1').rstrip('/')}/images/generations"
            payload = json.dumps({"model": resolved_model, "prompt": clean_prompt, "size": size, "n": 1}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx) as resp:
                data = json.loads(resp.read(MAX_IMAGE_BYTES).decode("utf-8", errors="replace"))
            first = (data.get("data") or [{}])[0]
            b64 = first.get("b64_json")
            if isinstance(b64, str) and b64:
                img_bytes = base64.b64decode(b64)
            elif isinstance(first.get("url"), str) and first["url"]:
                with urllib.request.urlopen(first["url"], timeout=timeout_s, context=ssl_ctx) as img_resp:
                    img_bytes = img_resp.read(MAX_IMAGE_BYTES)
            else:
                return {"ok": False, "error": "OpenAI returned no image payload."}

        elif prov == "fal":
            resolved_model = model or "fal-ai/flux/schnell"
            url = f"{(base_url or 'https://fal.run').rstrip('/')}/{resolved_model.lstrip('/')}"
            payload = json.dumps({"prompt": clean_prompt}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Authorization": f"Key {api_key.strip()}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx) as resp:
                data = json.loads(resp.read(MAX_IMAGE_BYTES).decode("utf-8", errors="replace"))
            img_url = ((data.get("images") or [{}])[0]).get("url")
            if not isinstance(img_url, str) or not img_url:
                return {"ok": False, "error": "FAL.ai returned no image URL."}
            with urllib.request.urlopen(img_url, timeout=timeout_s, context=ssl_ctx) as img_resp:
                img_bytes = img_resp.read(MAX_IMAGE_BYTES)
        else:
            return {"ok": False, "error": f"Unsupported image generation provider '{prov}'."}

        if len(img_bytes) == 0 or len(img_bytes) > MAX_IMAGE_BYTES:
            return {"ok": False, "error": "Generated image was empty or exceeded 16 MiB limit."}

        filename = f"pixel-gen-{int(time.time())}-{uuid.uuid4().hex[:8]}.png"
        out_path = out_root / filename
        out_path.write_bytes(img_bytes)
        return {
            "ok": True,
            "path": str(out_path),
            "provider": prov,
            "model": resolved_model,
            "mediaType": "image/png",
            "bytes": len(img_bytes),
            "dataBase64": base64.b64encode(img_bytes).decode("ascii"),
        }
    except urllib.error.HTTPError as exc:
        body = exc.read(4096).decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        return {"ok": False, "error": f"Image provider HTTP {exc.code}: {body[:240]}"}
    except Exception as exc:
        return {"ok": False, "error": f"Image generation failed: {exc}"}
