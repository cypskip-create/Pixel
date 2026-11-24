"""Phase 1: Lightweight Auxiliary Model Client.

Adapted from Hermes `agent/auxiliary_client.py` and `agent/auxiliary_fallback_recovery.py`.
Runs cheap, bounded non-streaming helper completions (context compression summaries,
conversation titling, memory fact extraction) using an optional auxiliary provider
config with graceful fallback to the primary provider or deterministic local heuristic.
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Optional

from .providers import ProviderConfig, stream_provider


class AuxiliaryClient:
    """Executes bounded background model calls with deterministic fallback."""

    def __init__(
        self,
        primary_config: Optional[ProviderConfig] = None,
        auxiliary_config: Optional[ProviderConfig] = None,
        *,
        completion_fn: Optional[Callable[[list[dict[str, Any]], ProviderConfig], str]] = None,
    ) -> None:
        self._primary = primary_config
        self._auxiliary = auxiliary_config
        self._completion_fn = completion_fn

    def configure(
        self,
        *,
        primary: Optional[ProviderConfig] = None,
        auxiliary: Optional[ProviderConfig] = None,
    ) -> None:
        if primary is not None:
            self._primary = primary
        if auxiliary is not None:
            self._auxiliary = auxiliary

    def _run_config(self, cfg: ProviderConfig, messages: list[dict[str, Any]], max_tokens: int) -> str:
        if self._completion_fn is not None:
            return self._completion_fn(messages, cfg)
        run_cfg = ProviderConfig(
            provider=cfg.provider,
            model=cfg.model,
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            temperature=0.2,
            max_tokens=max(64, min(max_tokens, 1024)),
            timeout_ms=min(cfg.timeout_ms, 20_000),
            thinking=None,
        )
        ev = threading.Event()
        result = stream_provider(
            config=run_cfg,
            messages=messages,
            tools=[],
            cancel_event=ev,
            emit=lambda _: None,
            request_id="aux",
        )
        return str(result.content or "").strip()

    def complete(
        self,
        system_prompt: str,
        user_text: str,
        *,
        max_tokens: int = 320,
        fallback_fn: Optional[Callable[[str], str]] = None,
    ) -> dict[str, Any]:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text[:12_000]},
        ]
        candidates = [c for c in (self._auxiliary, self._primary) if c is not None]
        last_err: Optional[str] = None
        for idx, cfg in enumerate(candidates):
            try:
                text = self._run_config(cfg, messages, max_tokens)
                if text:
                    return {
                        "ok": True,
                        "content": text,
                        "source": "auxiliary" if (idx == 0 and self._auxiliary is not None) else "primary",
                        "model": cfg.model,
                    }
            except Exception as exc:
                last_err = str(exc)
        if fallback_fn is not None:
            return {"ok": True, "content": fallback_fn(user_text), "source": "heuristic", "error": last_err}
        return {"ok": False, "content": "", "source": "none", "error": last_err or "No auxiliary or primary model configured."}

    def summarize_transcript(self, transcript: str, *, max_chars: int = 1200) -> str:
        res = self.complete(
            "Summarize the conversation transcript concisely, preserving key facts, file paths, decisions, and pending tasks.",
            transcript,
            max_tokens=300,
            fallback_fn=lambda txt: txt[:max_chars].strip(),
        )
        return str(res.get("content") or "")[:max_chars]

    def derive_title(self, first_message: str) -> str:
        clean = " ".join((first_message or "").split()).strip()
        if not clean:
            return "New conversation"
        res = self.complete(
            "Return a concise 3 to 6 word title for this user request. Output only the title, no quotes.",
            clean[:500],
            max_tokens=32,
            fallback_fn=lambda txt: txt[:48].strip(),
        )
        title = " ".join(str(res.get("content") or clean[:48]).strip().strip('"\'').split())
        return title[:64] or "New conversation"
