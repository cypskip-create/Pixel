# REA Verification & Evidence Index

- **Installed REA Version:** `rea-agents@6.10.1`
- **Antigravity MCP Config:** `C:\Users\cypri\.gemini\config\mcp_config.json` (server `rea`, stdio via `node.exe ... rea.mjs mcp`)
- **Installed Skill:** `C:\Users\cypri\.gemini\config\skills\reverse-engineer-anything` (identity v63, 263 tools)
- **Available Capabilities:** Static JS/TS/Electron/ASAR graph analysis (`analyze_javascript_application`), analysis views, artifact inspection, web/Playwright capture, release exposure auditing.
- **Missing Optional Native Providers:** Ghidra, IDA, Hopper, JADX, Kuna (not required for Python/TypeScript/Electron analysis).

## Verified REA MCP Invocations (Phase H1)

| Target | Operation | Scope (`source_paths`) | Parent Evidence ID | View Evidence ID | Artifact SHA-256 | Result Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `C:\dev\pixel-research\hermes-agent\apps\desktop\electron` | `analyze_javascript_application` | `api-transport.ts`, `backend-child.ts`, `backend-health.ts`, `backend-ownership.ts`, `window-open-policy.ts`, `window-controls.ts` | `ev_845b4b88b06113608ed413514591952f5137e8f2658c76e58331b87405e534de` | `ev_a1dd461517ef623229ab5ea3a60355fd5ea98c94a3f490cf28cfb6858bfdd939` | `131e5c1793d615bd696531fff663caa15ee79764c821db6b8ea86c8fabff6ad3` | **Success** (6/6 parsed, 0 failures, 3,809 AST nodes, 61 findings, 1,477 data-flow relations, 23 boundary relations, 22 promise relations; 744 unselected files out of 750). |
| `C:\dev\pixel-research\hermes-agent\apps\desktop\src` | `analyze_javascript_application` | `hermes.ts`, `entry.ts`, `main.tsx` | `ev_07250be5667d16cb33969a3a7bb250b5968018183af58c8bd73a6b246ced4d05` | `ev_9a9c678827f3b621ee945a9bf9eafb7b453a7d0676e92ec52e1e81ecca4cc904` | `f18b40d1a096f548d7cb20ed9a692279b00b6500edc47ff80840da523238058d` | **Success** (3/3 parsed, 0 failures, 751 AST nodes, 206 findings, 71 data-flow relations; 3,796 unselected files out of 3,799). |
| `C:\dev\pixel-research\hermes-agent\apps\desktop\electron` (unbounded) | `analyze_javascript_application` | *(all 750 files)* | *(none)* | *(none)* | — | **Timed out at 180s** — replaced by bounded `source_paths` invocations above. |

### Prior Session REA Evidence (Companion References)
- `C:\dev\pixel-research\ascii-sharks` (`fff1af0`): parent `ev_6e6b60bdb2b2a0de7a903a816e3c31d0921d23777fa4a4b9e198275d5e14af3a`, view `ev_6eba8a04f9cc1df50877f4c6c1ced5b12a406145e996d293052d10ef5c189502` (15 parsed files, 17,683 AST nodes).
- `C:\dev\pixel-research\clicky\worker` (`e71105c`): parent `ev_1b0267163a169bff50b61b0e7c8cf27d5860adef4cd70cd8697f928288476652`, view `ev_3a0d31ae88f5895cdf48e66476c3395577cbb054ad101e0f99ed53f00e89b553` (1 parsed file, 502 AST nodes).

## Scope & Fallback Distinction
- **REA-analyzed:** JavaScript/TypeScript Desktop Electron & Renderer modules listed above (inert static AST/data-flow parsing, no code execution).
- **Direct Python AST + Source Inspection (fallback for Python):** All Python subsystems (`run_agent.py`, `agent/`, `tools/`, `plugins/`, `cron/`, `tui_gateway/`, `persistence/`) were inspected directly because REA's `analyze_javascript_application` targets JS/TS/Electron bundles rather than Python source trees.
