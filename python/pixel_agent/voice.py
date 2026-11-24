"""Python-first voice STT, TTS, and GPT-Live SDP negotiation (Hermes voice parity).

Uses Python stdlib HTTP/TLS so all cloud speech providers work out of the box on
Windows without extra binary wheels. Credentials are passed strictly per request
over private stdio and never written to disk or logs.
"""

from __future__ import annotations

import base64
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Optional

TTS_RESPONSE_BODY_LIMIT_BYTES = 16 * 1024 * 1024  # 16 MiB audio cap

CLOUD_STT_PROVIDERS = frozenset({"openai", "mistral", "deepgram", "custom"})
CLOUD_TTS_PROVIDERS = frozenset({"openai", "elevenlabs", "xai", "gemini", "minimax", "mistral", "deepinfra"})


def split_into_speech_segments(text: str, max_chars: int = 240) -> list[str]:
    """Split text into sentence-sized segments for low-latency TTS streaming."""
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    segments: list[str] = []
    current = ""
    for s in sentences:
        if not s:
            continue
        if len(s) > max_chars:
            if current:
                segments.append(current)
                current = ""
            for i in range(0, len(s), max_chars):
                segments.append(s[i : i + max_chars].strip())
            continue
        candidate = f"{current} {s}".strip() if current else s
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                segments.append(current)
            current = s
    if current:
        segments.append(current)
    return segments


def _build_multipart_wav(wav_bytes: bytes, fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----PixelBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode("utf-8")
        )
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n"
        f"Content-Type: audio/wav\r\n\r\n".encode("utf-8")
        + wav_bytes
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def transcribe_cloud(
    *,
    provider: str,
    wav_base64: str,
    api_key: str = "",
    model: str = "",
    language: str = "auto",
    base_url: str = "",
    local_only: bool = False,
    timeout_s: float = 30.0,
) -> dict[str, Any]:
    """Transcribe WAV audio through an authorized cloud STT provider."""
    prov = (provider or "local").strip().lower()
    if local_only and prov in CLOUD_STT_PROVIDERS:
        return {
            "ok": False,
            "provider": prov,
            "text": "",
            "error": f"Blocked by local-only privacy mode: cloud STT provider '{prov}' is not allowed.",
        }
    if prov not in CLOUD_STT_PROVIDERS:
        return {"ok": False, "provider": prov, "text": "", "error": f"Provider '{prov}' is not a cloud STT provider."}
    if not (api_key or "").strip():
        return {"ok": False, "provider": prov, "text": "", "error": f"Missing API key for STT provider '{prov}'."}

    try:
        wav_bytes = base64.b64decode(wav_base64)
    except Exception as exc:
        return {"ok": False, "provider": prov, "text": "", "error": f"Invalid base64 WAV audio: {exc}"}

    ssl_ctx = ssl.create_default_context()
    try:
        if prov == "deepgram":
            dg_model = model or "nova-2"
            qs = f"model={urllib.parse.quote(dg_model)}&smart_format=true"
            if language and language != "auto":
                qs += f"&language={urllib.parse.quote(language)}"
            url = f"{(base_url or 'https://api.deepgram.com/v1').rstrip('/')}/listen?{qs}"
            req = urllib.request.Request(
                url,
                data=wav_bytes,
                headers={"Authorization": f"Token {api_key.strip()}", "Content-Type": "audio/wav"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx) as resp:
                data = json.loads(resp.read(2_000_000).decode("utf-8", errors="replace"))
            alt = (((data.get("results") or {}).get("channels") or [{}])[0].get("alternatives") or [{}])[0]
            text = str(alt.get("transcript") or "").strip()
            return {"ok": bool(text), "provider": prov, "model": dg_model, "text": text, **({} if text else {"noSpeech": True})}

        # OpenAI / Mistral / Custom OpenAI-compatible /audio/transcriptions
        default_urls = {
            "openai": "https://api.openai.com/v1",
            "mistral": "https://api.mistral.ai/v1",
            "custom": "http://127.0.0.1:8080/v1",
        }
        default_models = {
            "openai": "whisper-1",
            "mistral": "voxtral-mini-latest",
            "custom": "whisper-1",
        }
        resolved_model = model or default_models[prov]
        endpoint_base = (base_url or default_urls[prov]).rstrip("/")
        url = endpoint_base if endpoint_base.endswith("/audio/transcriptions") else f"{endpoint_base}/audio/transcriptions"
        fields = {"model": resolved_model}
        if language and language != "auto":
            fields["language"] = language
        body, ctype = _build_multipart_wav(wav_bytes, fields)
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Authorization": f"Bearer {api_key.strip()}", "Content-Type": ctype},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx if url.startswith("https://") else None) as resp:
            data = json.loads(resp.read(2_000_000).decode("utf-8", errors="replace"))
        text = str(data.get("text") or "").strip()
        return {
            "ok": bool(text),
            "provider": prov,
            "model": resolved_model,
            "text": text,
            "language": data.get("language") or language,
            **({} if text else {"noSpeech": True}),
        }
    except urllib.error.HTTPError as exc:
        body = exc.read(2048).decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        return {"ok": False, "provider": prov, "text": "", "error": f"STT HTTP {exc.code}: {body[:200]}"}
    except Exception as exc:
        return {"ok": False, "provider": prov, "text": "", "error": f"STT request failed: {exc}"}


def synthesize_cloud(
    *,
    provider: str,
    text: str,
    api_key: str = "",
    voice: str = "",
    model: str = "",
    speed: float = 1.0,
    base_url: str = "",
    local_only: bool = False,
    timeout_s: float = 30.0,
) -> dict[str, Any]:
    """Synthesize speech audio through an authorized cloud TTS provider."""
    prov = (provider or "system").strip().lower()
    clean_text = (text or "").strip()
    if not clean_text:
        return {"ok": False, "provider": prov, "error": "Text to synthesize cannot be empty."}
    if local_only and prov in CLOUD_TTS_PROVIDERS:
        return {
            "ok": False,
            "provider": prov,
            "error": f"Blocked by local-only privacy mode: cloud TTS provider '{prov}' is not allowed.",
        }
    if prov not in CLOUD_TTS_PROVIDERS:
        return {"ok": False, "provider": prov, "error": f"Provider '{prov}' is not a cloud TTS provider."}
    if not (api_key or "").strip():
        return {"ok": False, "provider": prov, "error": f"Missing API key for TTS provider '{prov}'."}

    ssl_ctx = ssl.create_default_context()
    try:
        if prov == "elevenlabs":
            voice_id = voice or "21m00Tcm4TlvDq8ikWAM"
            url = f"{(base_url or 'https://api.elevenlabs.io/v1').rstrip('/')}/text-to-speech/{urllib.parse.quote(voice_id)}"
            payload = json.dumps({"text": clean_text, "model_id": model or "eleven_multilingual_v2"}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"xi-api-key": api_key.strip(), "Content-Type": "application/json", "Accept": "audio/mpeg"},
                method="POST",
            )
            media_type = "audio/mpeg"
        elif prov == "gemini":
            gem_model = model or "gemini-2.5-flash-preview-tts"
            url = (
                f"{(base_url or 'https://generativelanguage.googleapis.com/v1beta').rstrip('/')}"
                f"/models/{urllib.parse.quote(gem_model)}:generateContent?key={urllib.parse.quote(api_key.strip())}"
            )
            payload = json.dumps({
                "contents": [{"parts": [{"text": clean_text}]}],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice or "Kore"}}},
                },
            }).encode("utf-8")
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx) as resp:
                data = json.loads(resp.read(TTS_RESPONSE_BODY_LIMIT_BYTES).decode("utf-8", errors="replace"))
            inline = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [{}])[0].get("inlineData") or {}
            b64 = inline.get("data") or ""
            if not b64:
                return {"ok": False, "provider": prov, "error": "Gemini TTS returned no audio data."}
            return {
                "ok": True,
                "provider": prov,
                "mediaType": inline.get("mimeType") or "audio/wav",
                "audioBase64": b64,
            }
        else:
            # OpenAI / xAI / Mistral / MiniMax / DeepInfra OpenAI-compatible /audio/speech
            default_urls = {
                "openai": "https://api.openai.com/v1",
                "xai": "https://api.x.ai/v1",
                "mistral": "https://api.mistral.ai/v1",
                "minimax": "https://api.minimax.chat/v1",
                "deepinfra": "https://api.deepinfra.com/v1/openai",
            }
            default_models = {
                "openai": "gpt-4o-mini-tts",
                "xai": "grok-tts",
                "mistral": "mistral-tts",
                "minimax": "speech-02-turbo",
                "deepinfra": "hexgrad/Kokoro-82M",
            }
            url = f"{(base_url or default_urls[prov]).rstrip('/')}/audio/speech"
            payload = json.dumps({
                "model": model or default_models[prov],
                "voice": voice or "alloy",
                "input": clean_text,
                "speed": max(0.5, min(2.0, float(speed))),
                "response_format": "wav",
            }).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"},
                method="POST",
            )
            media_type = "audio/wav"

        with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx if url.startswith("https://") else None) as resp:
            audio = resp.read(TTS_RESPONSE_BODY_LIMIT_BYTES + 1)
        if len(audio) > TTS_RESPONSE_BODY_LIMIT_BYTES:
            return {"ok": False, "provider": prov, "error": "TTS response exceeded 16 MiB safety cap."}
        if not audio:
            return {"ok": False, "provider": prov, "error": "TTS provider returned empty audio."}
        return {
            "ok": True,
            "provider": prov,
            "mediaType": media_type,
            "audioBase64": base64.b64encode(audio).decode("ascii"),
            "bytes": len(audio),
        }
    except urllib.error.HTTPError as exc:
        body = exc.read(2048).decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        return {"ok": False, "provider": prov, "error": f"TTS HTTP {exc.code}: {body[:200]}"}
    except Exception as exc:
        return {"ok": False, "provider": prov, "error": f"TTS request failed: {exc}"}


def exchange_gpt_live_sdp_offer(
    *,
    sdp_offer: str,
    api_key: str,
    model: str = "gpt-realtime",
    voice: str = "marin",
    instructions: str = "",
    base_url: str = "https://api.openai.com/v1",
    local_only: bool = False,
    timeout_s: float = 20.0,
) -> dict[str, Any]:
    """Server-side WebRTC SDP offer negotiation for OpenAI GPT-Live (API key stays out of renderer)."""
    if local_only:
        return {"ok": False, "error": "Blocked by local-only privacy mode: GPT-Live requires cloud OpenAI access."}
    if not (sdp_offer or "").strip().startswith("v=0"):
        return {"ok": False, "error": "Invalid SDP offer (expected SDP starting with 'v=0')."}
    if not (api_key or "").strip():
        return {"ok": False, "error": "OpenAI API key is required for GPT-Live full-duplex voice."}

    url = f"{base_url.rstrip('/')}/realtime?model={urllib.parse.quote(model or 'gpt-realtime')}"
    if voice:
        url += f"&voice={urllib.parse.quote(voice)}"
    req = urllib.request.Request(
        url,
        data=sdp_offer.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/sdp",
            "Accept": "application/sdp",
        },
        method="POST",
    )
    ssl_ctx = ssl.create_default_context() if url.startswith("https://") else None
    try:
        with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx) as resp:
            answer = resp.read(262_144).decode("utf-8", errors="replace")
        return {"ok": True, "sdpAnswer": answer, "model": model, "voice": voice, "instructions": instructions}
    except urllib.error.HTTPError as exc:
        body = exc.read(2048).decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        return {"ok": False, "error": f"GPT-Live SDP HTTP {exc.code}: {body[:200]}"}
    except Exception as exc:
        return {"ok": False, "error": f"GPT-Live SDP negotiation failed: {exc}"}
