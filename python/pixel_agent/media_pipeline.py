"""Phase 8: Unified Python Voice & Multimodal Pipeline Consolidation.

Adapted from Hermes `tools/vision_tools_image_prep.py`, `tools/image_generation_tool.py`,
`tools/video_generation_tool.py`, `tools/transcription_tools.py`, and `tools/tts_tool_providers.py`.
"""

from __future__ import annotations

from typing import Any, Optional

from .workspace_services import WorkspaceServices

STT_PROVIDERS = ("local_whisper", "openai", "mistral", "deepgram", "gemini")
TTS_PROVIDERS = ("local_piper", "openai", "elevenlabs", "edge", "minimax", "gemini", "xai")
IMAGE_PROVIDERS = ("openai", "fal")
VIDEO_PROVIDERS = ("fal", "xai")

IMAGE_MAGIC_HEADERS: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),
)


def prepare_vision_image(raw_bytes: bytes, *, max_bytes: int = 4 * 1024 * 1024) -> dict[str, Any]:
    """Validate image magic header and enforce size cap before forwarding to vision models."""
    if not raw_bytes:
        return {"ok": False, "error": "Image payload is empty."}
    if len(raw_bytes) > max_bytes:
        return {"ok": False, "error": f"Image exceeds {max_bytes} byte limit ({len(raw_bytes)} bytes)."}
    detected_mime: Optional[str] = None
    for magic, mime in IMAGE_MAGIC_HEADERS:
        if raw_bytes.startswith(magic):
            if mime == "image/webp" and raw_bytes[8:12] != b"WEBP":
                continue
            detected_mime = mime
            break
    if not detected_mime:
        return {"ok": False, "error": "Unsupported or invalid image header."}
    return {"ok": True, "mimeType": detected_mime, "bytes": len(raw_bytes)}


def multimodal_provider_catalog() -> dict[str, Any]:
    return {
        "stt": list(STT_PROVIDERS),
        "tts": list(TTS_PROVIDERS),
        "image": list(IMAGE_PROVIDERS),
        "video": list(VIDEO_PROVIDERS),
    }


def register_generated_media_artifact(
    workspace: WorkspaceServices,
    *,
    kind: str,
    name: str,
    mime_type: str,
    file_path: str,
    size_bytes: int = 0,
    prompt: str = "",
    project_id: str = "default",
    profile_id: Optional[str] = None,
) -> dict[str, Any]:
    """Persist generated image/audio/video directly into Pixel's authoritative Python Artifacts registry."""
    clean_kind = kind if kind in ("image", "audio", "video", "document", "file") else "file"
    return workspace.register_artifact(
        kind=clean_kind,
        name=name,
        mime_type=mime_type,
        file_path=file_path,
        size_bytes=size_bytes,
        preview_text=prompt[:300],
        project_id=project_id,
        profile_id=profile_id,
    )
