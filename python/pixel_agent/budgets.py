"""Hermes-inspired execution budgets and repetition protection."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any

RUN_BUDGET_WRAPUP_NOTICE = (
    "[SYSTEM NOTICE — execution budget nearly reached] "
    "Stop new discovery work now. Summarize your verified progress and clearly state any unfinished work."
)


@dataclass
class IterationBudget:
    max_iterations: int = 8
    max_tool_calls: int = 16
    max_wall_ms: int = 300_000
    max_context_tokens: int = 32_000
    started_at_ms: float = field(default_factory=lambda: time.monotonic() * 1000.0)
    iterations_used: int = 0
    tool_calls_used: int = 0
    wrapup_injected: bool = False

    def elapsed_ms(self) -> float:
        return max(0.0, (time.monotonic() * 1000.0) - self.started_at_ms)

    def can_continue_iteration(self) -> tuple[bool, str | None]:
        if self.iterations_used >= self.max_iterations:
            return False, f"Reached maximum model iterations ({self.max_iterations})."
        if self.elapsed_ms() >= self.max_wall_ms:
            return False, f"Reached wall-clock turn timeout ({self.max_wall_ms} ms)."
        return True, None

    def record_iteration(self) -> None:
        self.iterations_used += 1

    def can_run_tool(self) -> tuple[bool, str | None]:
        if self.tool_calls_used >= self.max_tool_calls:
            return False, f"Reached maximum tool calls ({self.max_tool_calls})."
        if self.elapsed_ms() >= self.max_wall_ms:
            return False, f"Reached wall-clock turn timeout ({self.max_wall_ms} ms)."
        return True, None

    def record_tool_call(self) -> None:
        self.tool_calls_used += 1

    def should_inject_wrapup(self) -> bool:
        if self.wrapup_injected:
            return False
        iter_ratio = self.iterations_used / max(1, self.max_iterations)
        time_ratio = self.elapsed_ms() / max(1, self.max_wall_ms)
        tool_ratio = self.tool_calls_used / max(1, self.max_tool_calls)
        if max(iter_ratio, time_ratio, tool_ratio) >= 0.8:
            self.wrapup_injected = True
            return True
        return False


class RepetitionGuard:
    """Detects identical repeated tool calls or runaway repetitive text."""

    def __init__(self, max_identical_tool_calls: int = 3) -> None:
        self.max_identical_tool_calls = max(2, max_identical_tool_calls)
        self._tool_counts: dict[str, int] = {}

    def record_and_check_tool(self, name: str, args: dict[str, Any]) -> bool:
        """Returns True if this tool invocation exceeds the repetition threshold."""
        canonical = json.dumps({"n": name, "a": args}, sort_keys=True, ensure_ascii=False, default=str)
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
        count = self._tool_counts.get(digest, 0) + 1
        self._tool_counts[digest] = count
        return count >= self.max_identical_tool_calls

    @staticmethod
    def is_runaway_text(text: str) -> bool:
        """Detect degenerate 60+ char block repeated 4+ times consecutively."""
        if len(text) < 280:
            return False
        tail = text[-400:]
        for chunk_len in (40, 60, 80):
            sample = tail[-chunk_len:]
            if sample.strip() and tail.count(sample) >= 4:
                return True
        return False
