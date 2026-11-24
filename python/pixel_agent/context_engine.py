"""Phase 1: Context Engine — Token Breakdown, Pinned Context & Durable Compression.

Adapted from Hermes `agent/context_engine.py`, `agent/context_pin.py`,
`agent/context_breakdown.py`, and `agent/context_compressor_durable.py`.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Optional

from .compressor import compress_messages, estimate_messages_tokens, estimate_tokens


class ContextEngine:
    """Manages pinned context entries, token breakdown telemetry, and compression."""

    def __init__(self, *, max_pins: int = 12, max_pin_chars: int = 6000) -> None:
        self._pins: dict[str, dict[str, Any]] = {}  # pin_id -> {id, label, content, createdAt}
        self._max_pins = max_pins
        self._max_pin_chars = max_pin_chars
        self._compression_history: list[dict[str, Any]] = []

    def pin(self, pin_id: str, label: str, content: str) -> dict[str, Any]:
        clean_id = (pin_id or "").strip()[:80]
        clean_content = (content or "").strip()[: self._max_pin_chars]
        if not clean_id or not clean_content:
            return {"ok": False, "error": "Pin requires non-empty id and content."}
        if clean_id not in self._pins and len(self._pins) >= self._max_pins:
            return {"ok": False, "error": f"Maximum of {self._max_pins} pinned context items reached."}
        rec = {
            "id": clean_id,
            "label": (label or clean_id).strip()[:120],
            "content": clean_content,
            "tokens": estimate_tokens(clean_content),
            "createdAt": int(time.time() * 1000),
        }
        self._pins[clean_id] = rec
        return {"ok": True, "pin": dict(rec)}

    def unpin(self, pin_id: str) -> dict[str, Any]:
        removed = self._pins.pop((pin_id or "").strip(), None)
        if not removed:
            return {"ok": False, "error": f"Pin '{pin_id}' not found."}
        return {"ok": True, "removed": pin_id}

    def list_pins(self) -> list[dict[str, Any]]:
        return [dict(v) for v in self._pins.values()]

    def pinned_system_block(self) -> str:
        if not self._pins:
            return ""
        blocks = [f"### Pinned: {p['label']}\n{p['content']}" for p in self._pins.values()]
        return "## Pinned Context (Preserved Across Compression)\n\n" + "\n\n".join(blocks)

    def breakdown(self, messages: list[dict[str, Any]], *, max_context_tokens: int = 32_000) -> dict[str, Any]:
        """Measure actual token distribution across system, pins, user, assistant, and tools."""
        buckets = {"system": 0, "user": 0, "assistant": 0, "tool": 0, "pins": 0}
        for p in self._pins.values():
            buckets["pins"] += int(p.get("tokens") or 0)
        for m in messages:
            role = str(m.get("role") or "user")
            tok = estimate_tokens(str(m.get("content") or ""))
            if m.get("tool_calls"):
                tok += estimate_tokens(str(m["tool_calls"]))
            if role in buckets:
                buckets[role] += tok
            else:
                buckets["user"] += tok
        total = sum(buckets.values())
        utilization = round(min(1.0, total / max(1, max_context_tokens)), 4)
        return {
            "ok": True,
            "maxContextTokens": max_context_tokens,
            "totalTokens": total,
            "utilization": utilization,
            "buckets": buckets,
            "pinCount": len(self._pins),
            "compressionCount": len(self._compression_history),
        }

    def prepare_messages(
        self,
        messages: list[dict[str, Any]],
        *,
        max_context_tokens: int = 32_000,
        summarizer: Optional[Callable[[str], str]] = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Inject pinned context into the system prefix and run 2-stage compression if needed."""
        prepared = [dict(m) for m in messages]
        pin_block = self.pinned_system_block()
        if pin_block:
            if prepared and prepared[0].get("role") == "system":
                existing = str(prepared[0].get("content") or "")
                if pin_block not in existing:
                    prepared[0]["content"] = f"{existing}\n\n{pin_block}".strip()
            else:
                prepared.insert(0, {"role": "system", "content": pin_block})

        before_tokens = estimate_messages_tokens(prepared)
        aux_fn = (
            (lambda ms: summarizer("\n".join(str(m.get("content") or "") for m in ms)))
            if summarizer is not None
            else None
        )
        compressed, stats = compress_messages(
            prepared,
            token_budget=max_context_tokens,
            aux_summarizer=aux_fn,
        )
        after_tokens = estimate_messages_tokens(compressed)
        if stats.get("stage1Pruned") or stats.get("stage2Compressed"):
            self._compression_history.append({
                "at": int(time.time() * 1000),
                "beforeTokens": before_tokens,
                "afterTokens": after_tokens,
                **stats,
            })
            if len(self._compression_history) > 50:
                self._compression_history = self._compression_history[-50:]
        return compressed, {"beforeTokens": before_tokens, "afterTokens": after_tokens, **stats}
