# Hermes Agent Source Inventory

- **Repository:** `https://github.com/NousResearch/hermes-agent`
- **Pinned Commit:** `0f602c5f6f18615632535251d62a2db74ce93b69`
- **Total Tracked Files (`git ls-files`):** **27,462**

## Language Breakdown (Tracked Files)

| Language | Tracked Files | Share | Primary Role |
| --- | ---: | ---: | --- |
| **Python** | 12,851 | 46.8% | Core agent runtime, tools, memory, plugins, gateway, cron, CLI, 9,241 tests |
| **TypeScript** | 4,090 | 14.9% | Electron desktop main/preload, shared contracts, TUI (`ui-tui`), e2e tests |
| **TypeScript/React (TSX)** | 1,613 | 5.9% | Desktop React UI (`apps/desktop/src`) & TUI React views |
| **YAML** | 2,871 | 10.5% | `plugin-catalog/` (2,579 manifests), plugin manifests, CI workflows |
| **Markdown** | 1,561 | 5.7% | `website/` docs (703), `optional-skills/` (513), `AGENTS.md`, `DESIGN.md` |
| **JavaScript** | 365 | 1.3% | Build scripts, preload bundlers, config files |
| **JSON** | 350 | 1.3% | Schemas, package manifests, test fixtures |
| **Shell / PowerShell** | 130 | 0.5% | Installers, update harnesses, activation scripts (88 `.sh`, 42 `.ps1`) |
| **CSS / HTML / Nix / TOML** | 76 | 0.3% | Stylesheets (32), Nix flakes (23), HTML (17), `pyproject.toml` (4) |
| **Other** | 3,555 | 12.9% | `contributors/` avatars/assets (3,187), icons, binaries, lockfiles |

## Subsystem Map

| Subsystem | Files | Primary Languages | Responsibility | Coverage |
| --- | ---: | --- | --- | --- |
| `tests/` | 9,389 | Python (9,241) | Unit, integration, security, compat, and regression test suites | Indexed + sampled |
| `apps/` | 5,120 | TS (3,361), TSX (1,374) | Electron + React desktop shell (`apps/desktop`) & shared packages | REA bounded + deep read |
| `plugin-catalog/` | 2,580 | YAML (2,579) | Declarative plugin catalog definitions | Indexed |
| `hermes_cli/` | 909 | Python (901) | CLI entrypoints, config loader, plugin system (`plugins.py`), observability | Deep read (`plugins.py`) |
| `optional-skills/` | 819 | MD (513), Python (101) | Optional procedural skill packages | Indexed |
| `website/` | 781 | MD (703) | Official documentation site | Indexed |
| `ui-tui/` | 667 | TS (512), TSX (134) | Terminal UI client | Indexed |
| `plugins/` | 553 | Python (363), YAML (106) | Bundled plugins (memory, context_engine, browser, computer_use, kanban, platforms) | Deep read + AST |
| `agent/` | 478 | Python (477) | Core conversation loop, turn phases, prompt builder, context compressor, memory manager, provider adapters | Deep read |
| `gateway/` | 421 | Python (417) | Multi-platform messaging gateway & session routing | Inspected |
| `tools/` | 405 | Python (398) | Tool registry, approval engine, terminal, file, browser, memory, skills, delegation, MCP | Deep read + AST |
| `cron/` | 60+ | Python | Scheduled job engine, tick lock, delivery queue, incident & liveness guards | Deep read (`scheduler.py`) |
| `tui_gateway/` | ~45 | Python | Local JSON-RPC/stdio/WS gateway bridging Desktop/TUI to Python `AIAgent` | Deep read (`server.py`) |
| `persistence/` | ~80 | Python | SQLite/WAL storage abstraction, read pool, writer mutex, crash quarantine | Inspected via `hermes_state.py` |
| `<root>` | ~50 | Python, TOML, YAML | `run_agent.py`, `model_tools.py`, `toolsets.py`, `cli.py`, `hermes_state.py`, `pyproject.toml` | Deep read |
