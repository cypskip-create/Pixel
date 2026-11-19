#!/usr/bin/env python3
"""Pixel's supervised local document and voice worker.

The process serves the typed newline-JSON protocol and performs local document
extraction and optional speech inference/synthesis. It does no network or shell
operations and has no database or policy authority. The TypeScript orchestrator
validates operations, controls paths/models and owns cancellation and approvals.

Protocol: newline-delimited JSON over stdin/stdout.

  request   {"id": "1", "op": "extract", "protocol": 1, "params": {"path": "..."}}
  response  {"id": "1", "ok": true, "result": {...}}
            {"id": "1", "ok": false, "error": {"code": "...", "message": "..."}}

Rules that matter for security and stability:
  * file paths must be absolute and must exist; anything else is a structured error
  * file size is capped before reading
  * optional extractors report a capability error rather than crashing
  * stdout carries protocol frames only; all logging goes to stderr
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import tempfile
import time
import traceback
import wave
from functools import lru_cache
from typing import Any, Callable, Dict

PROTOCOL_VERSION = 1

# Hard limits so a hostile or malformed file cannot exhaust memory.
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000

TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".rst", ".log", ".ini", ".cfg", ".conf",
    ".yaml", ".yml", ".toml", ".json", ".xml", ".html", ".htm",
    ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss",
    ".c", ".h", ".cpp", ".hpp", ".cs", ".java", ".kt", ".go", ".rs", ".rb",
    ".php", ".sh", ".ps1", ".bat", ".sql", ".vue", ".svelte", ".lua",
}


def log(message: str) -> None:
    """stderr only; stdout is reserved for protocol frames."""
    sys.stderr.write(f"[pixel-worker] {message}\n")
    sys.stderr.flush()


class WorkerError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def capabilities() -> Dict[str, Any]:
    """Report what this interpreter can actually do."""
    caps: Dict[str, Any] = {
        "protocol": PROTOCOL_VERSION,
        "python": sys.version.split()[0],
        "formats": ["txt", "md", "json", "csv", "code"],
        "optional": {},
    }

    def probe(module: str) -> bool:
        try:
            __import__(module)
            return True
        except Exception:
            return False

    pymupdf = probe("pymupdf") or probe("fitz")
    caps["optional"]["pdf"] = pymupdf
    caps["optional"]["docx"] = probe("docx")
    caps["optional"]["xlsx"] = probe("openpyxl")
    caps["optional"]["ocr"] = probe("pytesseract") and probe("PIL")
    caps["optional"]["embeddings"] = probe("sentence_transformers") or probe("onnxruntime")
    caps["optional"]["faster_whisper"] = probe("faster_whisper")
    caps["optional"]["kokoro_onnx"] = probe("kokoro_onnx")

    if pymupdf:
        caps["formats"].append("pdf")
    if caps["optional"]["docx"]:
        caps["formats"].append("docx")
    if caps["optional"]["xlsx"]:
        caps["formats"].append("xlsx")
    if caps["optional"]["ocr"]:
        caps["formats"].append("image")
    return caps


def _check_path(raw: Any) -> str:
    if not isinstance(raw, str) or not raw:
        raise WorkerError("BAD_REQUEST", "A file path is required.")
    path = os.path.abspath(raw)
    if not os.path.isabs(path):
        raise WorkerError("BAD_REQUEST", "The path must be absolute.")
    if not os.path.exists(path):
        raise WorkerError("NOT_FOUND", f"No such file: {path}")
    if not os.path.isfile(path):
        raise WorkerError("BAD_REQUEST", "Only files can be extracted.")
    size = os.path.getsize(path)
    if size > MAX_FILE_BYTES:
        raise WorkerError(
            "TOO_LARGE", f"File is {size} bytes; the limit is {MAX_FILE_BYTES}."
        )
    return path


def _read_text(path: str) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            with open(path, "r", encoding=encoding, errors="replace") as handle:
                return handle.read(MAX_TEXT_CHARS)
        except UnicodeError:
            continue
    raise WorkerError("DECODE_ERROR", "The file could not be decoded as text.")


def extract_pdf(path: str) -> Dict[str, Any]:
    try:
        import pymupdf  # type: ignore
    except Exception:
        try:
            import fitz as pymupdf  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise WorkerError(
                "CAPABILITY_MISSING",
                "PDF extraction needs PyMuPDF. Install it with: pip install PyMuPDF",
            ) from exc

    pages: list[str] = []
    metadata: Dict[str, Any] = {}
    with pymupdf.open(path) as document:
        metadata = {k: v for k, v in (document.metadata or {}).items() if v}
        for index, page in enumerate(document):
            if index >= 500:
                break
            pages.append(page.get_text("text"))
    text = "\n".join(pages).strip()
    if not text:
        raise WorkerError(
            "NO_TEXT",
            "The PDF has no extractable text; it is probably a scan and needs OCR.",
        )
    return {"text": text[:MAX_TEXT_CHARS], "metadata": metadata, "pages": len(pages)}


def extract_docx(path: str) -> Dict[str, Any]:
    try:
        import docx  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise WorkerError(
            "CAPABILITY_MISSING",
            "DOCX extraction needs python-docx. Install it with: pip install python-docx",
        ) from exc

    document = docx.Document(path)
    parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return {"text": "\n".join(parts)[:MAX_TEXT_CHARS], "metadata": {}, "pages": None}


def extract_xlsx(path: str) -> Dict[str, Any]:
    try:
        import openpyxl  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise WorkerError(
            "CAPABILITY_MISSING",
            "XLSX extraction needs openpyxl. Install it with: pip install openpyxl",
        ) from exc

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    parts: list[str] = []
    sheet_names: list[str] = []
    try:
        for sheet in workbook.worksheets:
            sheet_names.append(sheet.title)
            parts.append(f"## {sheet.title}")
            for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
                if row_index >= 5000:
                    break
                cells = [str(value) for value in row if value is not None]
                if cells:
                    parts.append(" | ".join(cells))
    finally:
        workbook.close()
    return {
        "text": "\n".join(parts)[:MAX_TEXT_CHARS],
        "metadata": {"sheets": sheet_names},
        "pages": None,
    }


def extract_csv(path: str) -> Dict[str, Any]:
    raw = _read_text(path)
    reader = csv.reader(io.StringIO(raw))
    rows: list[str] = []
    for index, row in enumerate(reader):
        if index >= 5000:
            break
        rows.append(" | ".join(cell.strip() for cell in row))
    return {"text": "\n".join(rows)[:MAX_TEXT_CHARS], "metadata": {}, "pages": None}


def extract_plain(path: str) -> Dict[str, Any]:
    return {"text": _read_text(path)[:MAX_TEXT_CHARS], "metadata": {}, "pages": None}


EXTRACTORS: Dict[str, Callable[[str], Dict[str, Any]]] = {
    ".pdf": extract_pdf,
    ".docx": extract_docx,
    ".xlsx": extract_xlsx,
    ".xlsm": extract_xlsx,
    ".csv": extract_csv,
    ".tsv": extract_csv,
}


def extract(params: Dict[str, Any]) -> Dict[str, Any]:
    path = _check_path(params.get("path"))
    extension = os.path.splitext(path)[1].lower()
    size = os.path.getsize(path)

    extractor = EXTRACTORS.get(extension)
    if extractor is not None:
        result = extractor(path)
        kind = extension.lstrip(".")
    elif extension in TEXT_EXTENSIONS or extension == "":
        result = extract_plain(path)
        kind = extension.lstrip(".") or "text"
    else:
        raise WorkerError(
            "UNSUPPORTED_FORMAT",
            f"No extractor for '{extension or 'unknown'}'. Supported: "
            + ", ".join(sorted({e.lstrip('.') for e in EXTRACTORS} | {e.lstrip('.') for e in TEXT_EXTENSIONS})),
        )

    text = (result.get("text") or "").strip()
    if not text:
        raise WorkerError("NO_TEXT", "No text could be extracted from this file.")

    return {
        "path": path,
        "kind": kind,
        "sizeBytes": size,
        "modifiedAt": int(os.path.getmtime(path) * 1000),
        "text": text,
        "metadata": result.get("metadata") or {},
        "pages": result.get("pages"),
    }


def _controlled_model_path(raw: Any, model_id: str, filename: str | None = None) -> str:
    root = os.environ.get("PIXEL_VOICE_MODEL_ROOT")
    if not root or not isinstance(raw, str) or not raw:
        raise WorkerError("MODEL_UNAVAILABLE", "Download the selected local voice model in Pixel Settings first.")
    root_path = os.path.realpath(root)
    expected_dir = os.path.realpath(os.path.join(root_path, model_id))
    candidate = os.path.realpath(raw)
    try:
        inside_root = os.path.commonpath([root_path, candidate]) == root_path
    except ValueError:
        inside_root = False
    expected = os.path.realpath(os.path.join(expected_dir, filename)) if filename else expected_dir
    if not inside_root or candidate != expected:
        raise WorkerError("BAD_REQUEST", "The requested model path is outside Pixel's voice-model directory.")
    if not os.path.exists(candidate):
        raise WorkerError("MODEL_UNAVAILABLE", "The selected local voice model is missing. Download or reinstall it in Pixel Settings.")
    return candidate


@lru_cache(maxsize=1)
def _load_whisper_model(model_path: str) -> Any:
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise WorkerError("CAPABILITY_MISSING", "The optional faster-whisper package is not installed.") from exc

    # Offline by default: never download a model or transmit audio implicitly.
    os.environ["HF_HUB_OFFLINE"] = "1"
    try:
        return WhisperModel(
            model_path,
            device="cpu",
            compute_type="int8",
            cpu_threads=max(1, min(os.cpu_count() or 1, 4)),
            num_workers=1,
            local_files_only=True,
        )
    except Exception as exc:
        raise WorkerError(
            "CAPABILITY_MISSING",
            "The downloaded local speech model could not be loaded.",
        ) from exc


def transcribe_audio(params: Dict[str, Any]) -> Dict[str, Any]:
    path = _check_path(params.get("path"))
    if os.path.getsize(path) > 44 + 16_000 * 2 * 120:
        raise WorkerError("TOO_LARGE", "The voice recording exceeds the local transcription limit.")
    model_name = params.get("model", "base.en")
    if model_name not in {"tiny.en", "base.en", "small.en"}:
        raise WorkerError("BAD_REQUEST", "Choose tiny.en, base.en, or small.en for local English transcription.")

    model_path = _controlled_model_path(params.get("model_path"), model_name)
    for required in ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt"):
        if not os.path.isfile(os.path.join(model_path, required)):
            raise WorkerError("MODEL_UNAVAILABLE", "The selected local speech model is incomplete. Reinstall it in Pixel Settings.")

    started = time.perf_counter()
    model = _load_whisper_model(model_path)
    try:
        segments, info = model.transcribe(
            path,
            language="en",
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    except Exception as exc:
        raise WorkerError("DECODE_ERROR", "The local speech model could not decode this recording.") from exc
    if not text:
        raise WorkerError("NO_TEXT", "No speech was detected in the recording.")
    return {
        "text": text,
        "language": getattr(info, "language", "en"),
        "audioSeconds": getattr(info, "duration", None),
        "processingMs": round((time.perf_counter() - started) * 1000),
        "backend": "faster-whisper/cpu-int8",
    }


@lru_cache(maxsize=1)
def _load_kokoro(model_path: str, voices_path: str) -> Any:
    try:
        from kokoro_onnx import Kokoro
    except Exception as exc:
        raise WorkerError("CAPABILITY_MISSING", "Pixel's neural speech runtime is not installed.") from exc
    try:
        return Kokoro(model_path, voices_path)
    except Exception as exc:
        raise WorkerError("MODEL_UNAVAILABLE", "The local neural speech model could not be loaded.") from None


def synthesize_kokoro(params: Dict[str, Any]) -> Dict[str, Any]:
    text = params.get("text")
    voice = params.get("voice", "af_heart")
    speed = params.get("speed", 1.0)
    if not isinstance(text, str) or not text.strip() or len(text) > 1800:
        raise WorkerError("BAD_REQUEST", "Each Kokoro speech segment must contain between 1 and 1800 characters.")
    if voice not in {"af_heart", "af_sarah", "am_adam", "am_michael"}:
        raise WorkerError("BAD_REQUEST", "Choose one of Pixel's supported Kokoro voices.")
    if not isinstance(speed, (float, int)) or isinstance(speed, bool) or not 0.7 <= speed <= 1.3:
        raise WorkerError("BAD_REQUEST", "Speech rate must be between 0.7 and 1.3.")

    model_path = _controlled_model_path(params.get("model_path"), "kokoro-v1.0-int8", "kokoro-v1.0.int8.onnx")
    voices_path = _controlled_model_path(params.get("voices_path"), "kokoro-v1.0-int8", "voices-v1.0.bin")
    output_path = params.get("output_path")
    if not isinstance(output_path, str) or os.path.realpath(os.path.dirname(output_path)) != os.path.realpath(tempfile.gettempdir()):
        raise WorkerError("BAD_REQUEST", "Speech output must use Pixel's temporary audio directory.")
    if not os.path.basename(output_path).startswith("pixel-voice-tts-") or not output_path.lower().endswith(".wav"):
        raise WorkerError("BAD_REQUEST", "The temporary speech output name is invalid.")

    started = time.perf_counter()
    engine = _load_kokoro(model_path, voices_path)
    try:
        samples, sample_rate = engine.create(text.strip(), voice=voice, speed=float(speed), lang="en-us")
        import numpy as np
        pcm = (np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        with wave.open(output_path, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(int(sample_rate))
            output.writeframes(pcm)
    except Exception:
        raise WorkerError("TTS_FAILED", "Kokoro could not synthesize this reply. No audio was played.") from None
    duration = len(pcm) / (int(sample_rate) * 2)
    return {"outputPath": output_path, "sampleRate": int(sample_rate), "durationSeconds": duration, "processingMs": round((time.perf_counter() - started) * 1000)}


def unload_voice_models(_params: Dict[str, Any]) -> Dict[str, bool]:
    _load_whisper_model.cache_clear()
    _load_kokoro.cache_clear()
    import gc
    gc.collect()
    return {"unloaded": True}


def runtime_smoke_test(_params: Dict[str, Any]) -> Dict[str, Any]:
    """Import the frozen native speech stack without loading model weights."""
    try:
        import ctranslate2
        import onnxruntime
        from faster_whisper import WhisperModel
        from kokoro_onnx import Kokoro
        from phonemizer.backend import EspeakBackend

        providers = onnxruntime.get_available_providers()
        if "CPUExecutionProvider" not in providers:
            raise RuntimeError("ONNX Runtime CPU provider is missing.")
        phonemes = EspeakBackend(language="en-us").phonemize(["Pixel voice runtime smoke test."])
        if not phonemes or not phonemes[0].strip():
            raise RuntimeError("eSpeak did not produce phonemes.")
    except Exception as exc:
        raise WorkerError(
            "RUNTIME_SMOKE_FAILED",
            f"The packaged voice runtime could not load a native dependency ({type(exc).__name__}).",
        ) from None

    return {
        "protocol": PROTOCOL_VERSION,
        "ctranslate2": getattr(ctranslate2, "__version__", "available"),
        "onnxProviders": providers,
        "onnxCpuProvider": True,
        "fasterWhisper": callable(WhisperModel),
        "kokoro": callable(Kokoro),
        "espeakReady": True,
    }


OPS: Dict[str, Callable[[Dict[str, Any]], Any]] = {
    "capabilities": lambda _params: capabilities(),
    "ping": lambda _params: {"pong": True},
    "extract": extract,
    "transcribe_audio": transcribe_audio,
    "synthesize_kokoro": synthesize_kokoro,
    "unload_voice_models": unload_voice_models,
    "runtime_smoke_test": runtime_smoke_test,
}


def handle(request: Dict[str, Any]) -> Dict[str, Any]:
    request_id = request.get("id")
    protocol = request.get("protocol")

    if protocol is not None and protocol != PROTOCOL_VERSION:
        return {
            "id": request_id,
            "ok": False,
            "error": {
                "code": "PROTOCOL_MISMATCH",
                "message": f"Worker speaks protocol {PROTOCOL_VERSION}, request used {protocol}.",
            },
        }

    op = request.get("op")
    handler = OPS.get(op) if isinstance(op, str) else None
    if handler is None:
        return {
            "id": request_id,
            "ok": False,
            "error": {"code": "UNKNOWN_OP", "message": f"Unknown operation: {op!r}"},
        }

    params = request.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return {
            "id": request_id,
            "ok": False,
            "error": {"code": "BAD_REQUEST", "message": "params must be an object."},
        }

    try:
        return {"id": request_id, "ok": True, "result": handler(params)}
    except WorkerError as error:
        return {
            "id": request_id,
            "ok": False,
            "error": {"code": error.code, "message": error.message},
        }
    except Exception as error:  # noqa: BLE001
        log("unhandled error:\n" + traceback.format_exc())
        return {
            "id": request_id,
            "ok": False,
            "error": {"code": "INTERNAL", "message": f"{type(error).__name__}: {error}"},
        }


def main() -> int:
    log(f"starting, protocol {PROTOCOL_VERSION}, python {sys.version.split()[0]}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            sys.stdout.write(
                json.dumps(
                    {
                        "id": None,
                        "ok": False,
                        "error": {"code": "BAD_JSON", "message": str(error)},
                    }
                )
                + "\n"
            )
            sys.stdout.flush()
            continue

        if isinstance(request, dict) and request.get("op") == "shutdown":
            log("shutdown requested")
            sys.stdout.write(json.dumps({"id": request.get("id"), "ok": True, "result": {"bye": True}}) + "\n")
            sys.stdout.flush()
            return 0

        response = handle(request) if isinstance(request, dict) else {
            "id": None,
            "ok": False,
            "error": {"code": "BAD_REQUEST", "message": "Each request must be a JSON object."},
        }
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()
    log("stdin closed; exiting")
    return 0


if __name__ == "__main__":
    sys.exit(main())
