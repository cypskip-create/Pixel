"""Phase 5: Sandboxed Per-Plugin Persistent Storage (Hermes `plugins/plugin_storage.py`)."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional

PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
MAX_STORAGE_BYTES = 512 * 1024  # 512 KiB per plugin


class PluginStorage:
    """Isolated key-value JSON storage scoped strictly to one validated plugin ID."""

    def __init__(self, plugin_id: str, *, base_dir: Optional[str] = None) -> None:
        if not PLUGIN_ID_RE.match(plugin_id or ""):
            raise ValueError(f"Invalid plugin id '{plugin_id}' for storage.")
        root = Path(base_dir or os.environ.get("PIXEL_PLUGIN_DATA_DIR") or (Path.home() / ".pixel" / "plugins"))
        self._dir = root / "storage"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._path = self._dir / f"{plugin_id}.json"
        self._data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        if self._path.exists():
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    return raw
            except Exception:
                pass
        return {}

    def _save(self) -> None:
        encoded = json.dumps(self._data, indent=2, ensure_ascii=False)
        if len(encoded.encode("utf-8")) > MAX_STORAGE_BYTES:
            raise ValueError(f"Plugin storage exceeded {MAX_STORAGE_BYTES} byte cap.")
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(encoded, encoding="utf-8")
        tmp.replace(self._path)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(str(key), default)

    def set(self, key: str, value: Any) -> dict[str, Any]:
        k = str(key).strip()[:120]
        if not k:
            return {"ok": False, "error": "Storage key cannot be empty."}
        self._data[k] = value
        self._save()
        return {"ok": True, "key": k}

    def delete(self, key: str) -> dict[str, Any]:
        existed = str(key) in self._data
        self._data.pop(str(key), None)
        if existed:
            self._save()
        return {"ok": True, "deleted": existed}

    def list_keys(self) -> list[str]:
        return sorted(self._data.keys())
