"""Phase 4: Deep Shell & Windows Hardline Command Risk Analyzer.

Adapted from Hermes `tools/approval_detection.py`, `tools/approval_shell_tokens.py`,
`tools/approval_windows_hardline.py`, `tools/approval_pipe_launchers.py`,
`tools/approval_quoted_newlines.py`, and `tools/approval_wmic.py`.

Classifies commands into `read_only`, `confirm`, `high_risk`, or `blocked`
with explicit matched rules so Electron's `PermissionBroker` can enforce
informed approval prompts or fail-closed denials.
"""

from __future__ import annotations

import re
from typing import Any

BLOCKED_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("pipe_to_shell", re.compile(r"\b(?:curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression)\b", re.IGNORECASE)),
    ("powershell_encoded", re.compile(r"\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*\s-(?:e|ec|enc|encodedcommand)\b", re.IGNORECASE)),
    ("destructive_root_delete", re.compile(r"\b(?:rm\s+-rf\s+(?:/|~|\*)|Remove-Item\b[^\n]*-Recurse[^\n]*-Force[^\n]*(?:C:\\|\\Users\\))", re.IGNORECASE)),
    ("disk_format_wipe", re.compile(r"\b(?:format\s+[A-Za-z]:|diskpart|dd\s+if=.*of=/dev/|mkfs\.)\b", re.IGNORECASE)),
    ("windows_defender_tamper", re.compile(r"\bSet-MpPreference\b.*(?:DisableRealtimeMonitoring|ExclusionPath)", re.IGNORECASE)),
)

HIGH_RISK_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("wmic_execution", re.compile(r"\bwmic\b.*\b(?:process\s+call\s+create|os\s+where)\b", re.IGNORECASE)),
    ("lolbin_download", re.compile(r"\b(?:certutil|bitsadmin|mshta|regsvr32|rundll32)\b", re.IGNORECASE)),
    ("registry_modify", re.compile(r"\b(?:reg\s+(?:add|delete|import)|Set-ItemProperty\s+HK(?:LM|CU):)\b", re.IGNORECASE)),
    ("credential_env_read", re.compile(r"(?:\$env:|%)(?:OPENAI|DEEPSEEK|ANTHROPIC|GITHUB|AWS|GEMINI|SLACK|TELEGRAM|DISCORD)[A-Z0-9_]*", re.IGNORECASE)),
    ("quoted_newline_smuggling", re.compile(r"['\"][^'\"]*\n[^'\"]*['\"]")),
    ("git_force_push", re.compile(r"\bgit\s+push\b.*(?:--force|-f\b)", re.IGNORECASE)),
)

READ_ONLY_PREFIXES = (
    "git status",
    "git diff",
    "git log",
    "git branch",
    "dir",
    "ls",
    "pwd",
    "whoami",
    "echo ",
    "cat ",
    "type ",
    "python --version",
    "node --version",
    "npm --version",
)


def analyze_command_risk(command: str) -> dict[str, Any]:
    raw = (command or "").strip()
    if not raw:
        return {"risk": "blocked", "requiresApproval": True, "blocked": True, "reasons": ["empty_command"]}

    blocked_hits = [name for name, pat in BLOCKED_RULES if pat.search(raw)]
    if blocked_hits:
        return {
            "risk": "blocked",
            "requiresApproval": True,
            "blocked": True,
            "reasons": blocked_hits,
        }

    high_hits = [name for name, pat in HIGH_RISK_RULES if pat.search(raw)]
    if high_hits:
        return {
            "risk": "high_risk",
            "requiresApproval": True,
            "blocked": False,
            "reasons": high_hits,
        }

    lower = raw.lower()
    has_shell_chaining = any(op in raw for op in ("|", ";", "&&", "||", "`", "$(", ">", "<"))
    if not has_shell_chaining and any(lower == p.strip() or lower.startswith(p) for p in READ_ONLY_PREFIXES):
        return {
            "risk": "read_only",
            "requiresApproval": False,
            "blocked": False,
            "reasons": [],
        }

    return {
        "risk": "confirm",
        "requiresApproval": True,
        "blocked": False,
        "reasons": ["mutating_or_chained_command"],
    }
