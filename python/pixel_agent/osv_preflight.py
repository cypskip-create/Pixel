"""Supply-chain preflight checks for external MCP server commands and packages.

Inspired by Hermes `tools/osv_check.py`:
- Validates local stdio launch commands (blocks shell interpreters, unpinned
  npx/uvx auto-installs, and suspicious flags).
- Optionally queries OSV (https://api.osv.dev/v1/query) with a strict 12s
  timeout when a pinned package + version + ecosystem is provided.
- A clean preflight NEVER guarantees safety; user trust confirmation and
  Electron PermissionBroker checks remain mandatory.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Optional

OSV_TIMEOUT_SECONDS = 12.0
OSV_QUERY_URL = "https://api.osv.dev/v1/query"

DISALLOWED_SHELL_EXECUTABLES = frozenset({
    "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
    "sh", "bash", "zsh", "wscript", "cscript", "mshta",
})
AUTO_INSTALL_RUNNERS = frozenset({"npx", "npx.cmd", "uvx", "pipx"})


@dataclass
class PreflightResult:
    allowed: bool
    warnings: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    vulnerabilities: list[dict[str, str]] = field(default_factory=list)
    osv_checked: bool = False


def validate_stdio_command(command: list[str]) -> PreflightResult:
    """Static validation of a local MCP stdio command array."""
    res = PreflightResult(allowed=True)
    if not command or not command[0].strip():
        res.allowed = False
        res.blockers.append("Command array must specify an executable.")
        return res

    exe_name = os.path.basename(command[0].strip()).lower()
    if exe_name in DISALLOWED_SHELL_EXECUTABLES:
        res.allowed = False
        res.blockers.append(f"Shell interpreter '{exe_name}' is not allowed as an MCP server entrypoint.")
        return res

    if exe_name in AUTO_INSTALL_RUNNERS:
        res.allowed = False
        res.blockers.append(
            f"Unpinned auto-installer '{exe_name}' is blocked. Install a pinned version explicitly before registering."
        )
        return res

    for arg in command[1:]:
        if any(tok in arg for tok in ("&&", "||", "|", ";", "`", "$(")):
            res.warnings.append(f"Argument contains shell metacharacters (executed without shell): {arg[:60]}")

    res.warnings.append(
        "External local MCP servers run as separate OS processes without full kernel sandboxing; "
        "only enable servers you trust."
    )
    return res


def check_osv_advisories(
    package_name: str,
    version: str,
    ecosystem: str = "PyPI",
    *,
    timeout_s: float = OSV_TIMEOUT_SECONDS,
    opener: Optional[Any] = None,
) -> PreflightResult:
    """Bounded OSV vulnerability lookup for a pinned package and version."""
    res = PreflightResult(allowed=True)
    if not package_name.strip() or not version.strip():
        res.warnings.append("Package name/version not pinned; skipped OSV lookup.")
        return res

    payload = json.dumps({
        "version": version.strip(),
        "package": {"name": package_name.strip(), "ecosystem": ecosystem},
    }).encode("utf-8")
    req = urllib.request.Request(
        OSV_QUERY_URL,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Pixel-Preflight/1.0"},
        method="POST",
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(req, timeout=min(OSV_TIMEOUT_SECONDS, max(1.0, timeout_s))) as resp:
            data = json.loads(resp.read(256 * 1024).decode("utf-8", errors="replace"))
        res.osv_checked = True
        vulns = data.get("vulns") if isinstance(data, dict) else None
        if isinstance(vulns, list) and vulns:
            for v in vulns[:10]:
                if isinstance(v, dict):
                    res.vulnerabilities.append({
                        "id": str(v.get("id", "UNKNOWN")),
                        "summary": str(v.get("summary", ""))[:200],
                    })
            res.allowed = False
            res.blockers.append(
                f"OSV reported {len(vulns)} known advisory(ies) for {package_name}@{version} ({ecosystem})."
            )
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        res.warnings.append(f"OSV advisory check unavailable ({exc}); proceeding requires explicit user trust.")
    return res
