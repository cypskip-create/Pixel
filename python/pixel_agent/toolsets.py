"""Phase 4: Full Hermes Toolsets Catalog, Distributions & Argument Coercion.

Adapted from Hermes `toolsets.py`, `toolset_distributions.py`, and `tools/arg_coercion.py`.
"""

from __future__ import annotations

from typing import Any

TOOLSET_CATALOG: dict[str, dict[str, Any]] = {
    "coding": {
        "label": "Coding & Git",
        "prefixes": ("file_", "git_", "github_", "terminal_", "process_", "code_exec", "todo_"),
    },
    "research": {
        "label": "Research & Knowledge",
        "prefixes": ("web_", "documents_", "memory_", "session_search", "skills_", "skill_", "browser_open_search", "browser_inspect"),
    },
    "browser": {
        "label": "Browser Automation",
        "prefixes": ("browser_",),
    },
    "desktop": {
        "label": "Windows Desktop & Vision",
        "prefixes": ("computer_use", "analyze_screen", "screen_", "clipboard_", "get_system_info", "get_current_time"),
    },
    "messaging": {
        "label": "Messaging & Gateway",
        "prefixes": ("gateway_", "send_message", "webhook_"),
    },
    "automation": {
        "label": "Scheduling, Delegation & Plugins",
        "prefixes": ("cronjob_", "routine_", "delegate_", "mcp__", "plugin_", "clarify_"),
    },
    "full": {
        "label": "All Enabled Tools",
        "prefixes": ("*",),
    },
}


def resolve_toolset_tools(toolset_ids: list[str], available_tools: list[str]) -> list[str]:
    selected = [tid.strip().lower() for tid in toolset_ids if tid and tid.strip()]
    if not selected or "full" in selected:
        return list(available_tools)
    prefixes: list[str] = []
    for tid in selected:
        meta = TOOLSET_CATALOG.get(tid)
        if meta:
            prefixes.extend(meta["prefixes"])
    return [t for t in available_tools if any(p == "*" or t == p or t.startswith(p) for p in prefixes)]


def coerce_tool_args(args: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """Safely coerce common LLM JSON stringified primitives according to JSON Schema types."""
    if not isinstance(args, dict):
        return {}
    props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    out = dict(args)
    for key, spec in props.items():
        if key not in out or not isinstance(spec, dict):
            continue
        expected = spec.get("type")
        val = out[key]
        if expected == "boolean" and isinstance(val, str):
            low = val.strip().lower()
            if low in ("true", "1", "yes"):
                out[key] = True
            elif low in ("false", "0", "no"):
                out[key] = False
        elif expected == "integer" and isinstance(val, str):
            try:
                out[key] = int(val.strip())
            except ValueError:
                pass
        elif expected == "number" and isinstance(val, str):
            try:
                out[key] = float(val.strip())
            except ValueError:
                pass
    return out
