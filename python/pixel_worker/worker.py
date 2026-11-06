#!/usr/bin/env python3
"""Pixel document worker.

A supervised, single-purpose process. It extracts text from documents and does
nothing else: no network, no shell, no database, no policy decisions. The
TypeScript orchestrator decides what may be read and passes an absolute path.

Protocol: newline-delimited JSON over stdin/stdout.

  request   {"id": "1", "op": "extract", "protocol": 1, "params": {"path": "..."}}
  response  {"id": "1", "ok": true, "result": {...}}
            {"id": "1", "ok": false, "error": {"code": "...", "message": "..."}}

Rules that matter for security and stability:
  * paths must be absolute and must exist; anything else is a structured error
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
import traceback
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


OPS: Dict[str, Callable[[Dict[str, Any]], Any]] = {
    "capabilities": lambda _params: capabilities(),
    "ping": lambda _params: {"pong": True},
    "extract": extract,
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
