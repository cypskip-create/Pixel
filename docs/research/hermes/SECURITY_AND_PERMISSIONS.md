# Security, Autonomy & Permission Matrix

Source authority: `tools/approval.py`, `tools/approval_detection.py`, `tools/approval_floors.py`, `tools/approval_smart.py`, `tools/threat_patterns.py`, `agent/prompt_builder.py`, `agent/secret_scope.py`, `tools/osv_check.py`.

## 1. Hermes Security Architecture
- **Multi-Layer Approval Gate (`tools/approval.py`):**
  1. **Hardline & User-Deny Floors (`approval_floors.py`):** Unconditionally blocks catastrophic/hardline commands and user-configured deny rules before any allowlist or YOLO flag.
  2. **Frozen Launch YOLO (`_YOLO_MODE_FROZEN`):** Read once at import time from `HERMES_YOLO_MODE` so a skill or prompt injection cannot flip `os.environ` mid-session to bypass approvals.
  3. **Smart Guardian + Denial Circuit Breaker:** Optional guardian LLM (`approval_smart.py`) evaluates risky commands; after 3 consecutive DENY verdicts in one session (`_denial_tally`), appends a hard-stop instruction to the tool result (prompt-cache-invariant) to stop retry loops.
  4. **Staged Write Approval (`tools/memory_tool.py::_pin_matched_entries`):** Pins the exact matched entry at staging time and refuses execution if the underlying record changed before approval.
- **Prompt-Injection Threat Scanning (`tools/threat_patterns.py`):** Scans repo context files (`AGENTS.md`, `.cursorrules`), memory writes, and agent-created skills (`skills_guard.py`).
- **Secret Scoping & Egress Redaction:** Per-turn `secret_scope` (`agent/secret_scope.py`) + `redact_for_egress` / `redact_sensitive_text` before errors or memory sync leave the process.
- **Supply-Chain Defense:** Exact `==X.Y.Z` pins in `pyproject.toml` + OSV malware preflight before `npx`/`uvx` MCP spawns.

## 2. Recommended Pixel Permission Matrix (Threat-Analyzed)

| Operation Class | Guide Mode | Hybrid Mode | Agent Mode | Rationale / Threat Control |
| --- | --- | --- | --- | --- |
| **Read-only public GitHub / web search / local Git inspect (`git_status`, `git_diff`, `git_log`, `git_branches` list)** | Allowed (read-only) | Prompt (or session grant) | **Autonomous** | No local state mutation, no secret egress, DNS-pinned hosts |
| **Bounded project file read/list/search & indexed document read** | Prompt / read-only | Prompt | **Autonomous** (home/project-scoped; credential files blocked) | Eliminates friction while maintaining path boundary & secret filename blocklist |
| **Safe public HTTPS `git_clone` into validated new folder** | Blocked (`changesState`) | Prompt | **Autonomous** (HTTPS-only, non-existing dest) | Reversible, bounded, no shell interpolation, verified `.git` postcondition |
| **Reversible project file write/patch / `git_commit` / vetted test run** | Blocked | Prompt | **Configurable Autonomy Policy** (auto within active project or prompt once per session) | Reversible via Git; never overwrites uncommitted changes silently |
| **Screen observation (`analyze_screen`, `find_ui_elements`)** | Prompt / window grant | Prompt / window grant | Prompt / standing window grant | Privacy boundary: no silent screen capture |
| **Desktop UI mutation (`invoke_ui_element`, `control_ui_element`)** | Blocked | Prompt (fresh) | Prompt (fresh, exact window/PID/title + postcondition) | High consequence on live desktop apps |
| **Clipboard read/copy/paste & credential access** | Blocked / Fresh prompt | Fresh prompt (session-only chat) | **Always Fresh Prompt** | High secret-exfiltration risk |
| **`git_push`, destructive file delete (`file_trash`), browser form submit/upload, external publication, unbounded shell** | Blocked | **Critical (Each-Call)** | **Critical (Each-Call)** (force-push prohibited) | Irreversible or external-impact boundary; NEVER auto-approved |
| **Emergency Stop active** | **ALL BLOCKED** | **ALL BLOCKED** | **ALL BLOCKED** | Hard runtime override in Electron main `PermissionBroker` |
