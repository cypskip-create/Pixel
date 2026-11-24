"""Phase 7: Agent-Callable Cron Tools, Prompt Security Scan, Delivery Routing & Blueprints.

Adapted from Hermes `tools/cronjob_tools.py`, `cron/prompt_scan.py`,
`cron/delivery_queue.py`, and `cron/blueprint_catalog.py`.
Does NOT duplicate Pixel's canonical SQLite `RoutineStore`/`LocalRoutineScheduler`;
instead provides the Python intelligence, prompt scan, blueprints, and Gateway delivery router.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Optional

CRON_INJECTION_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("prompt_override", re.compile(r"ignore\s+(?:all\s+)?previous\s+instructions", re.IGNORECASE)),
    ("secret_exfiltration", re.compile(r"\b(?:send|post|curl|email)\b.*\b(?:api[_\s-]?key|token|password|secret|\.env)\b", re.IGNORECASE)),
    ("destructive_wipe", re.compile(r"\b(?:rm\s+-rf|format\s+c:|Remove-Item\s+.*-Recurse\s+-Force)\b", re.IGNORECASE)),
)

AUTOMATION_BLUEPRINTS: tuple[dict[str, Any], ...] = (
    {
        "id": "bp_morning_briefing",
        "name": "Morning Workspace Briefing",
        "scheduleKind": "daily",
        "localTime": "08:30",
        "missedRunPolicy": "skip",
        "description": "Summarize open tasks, recent memory notes, and pending calendar items each morning.",
    },
    {
        "id": "bp_ci_watch",
        "name": "Weekday CI Health Check",
        "scheduleKind": "cron",
        "cronExpression": "0 9 * * 1-5",
        "missedRunPolicy": "notify_only",
        "description": "Inspect repository status and report any failing CI checks on weekday mornings.",
    },
    {
        "id": "bp_hourly_inbox",
        "name": "Hourly Research Digest",
        "scheduleKind": "interval",
        "intervalMs": 3_600_000,
        "missedRunPolicy": "run_once",
        "description": "Collect and summarize updates on tracked topics every hour.",
    },
)


def scan_scheduled_prompt(prompt: str) -> dict[str, Any]:
    findings = [name for name, pat in CRON_INJECTION_RULES if pat.search(prompt or "")]
    return {
        "safe": len(findings) == 0,
        "findings": findings,
    }


def list_automation_blueprints() -> list[dict[str, Any]]:
    return [dict(bp) for bp in AUTOMATION_BLUEPRINTS]


class CronDeliveryRouter:
    """Routes completed routine summaries to Desktop or configured Gateway messaging targets."""

    def __init__(self, *, send_gateway_fn: Optional[Callable[[str, str, str], dict[str, Any]]] = None) -> None:
        self._send_gateway = send_gateway_fn

    def deliver(self, *, target_platform: str, chat_id: str, routine_name: str, summary: str) -> dict[str, Any]:
        plat = (target_platform or "desktop").strip().lower()
        body = f"[Scheduled Routine: {routine_name}]\n{(summary or '').strip()}"
        if plat == "desktop" or not chat_id:
            return {"ok": True, "platform": "desktop", "delivered": True, "body": body}
        if self._send_gateway is None:
            return {"ok": False, "platform": plat, "error": "Gateway delivery router is not attached."}
        return self._send_gateway(plat, chat_id, body)
