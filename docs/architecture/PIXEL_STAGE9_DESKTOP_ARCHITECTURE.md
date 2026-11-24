# Pixel Stage 9 Full Desktop Architecture

## Architectural Split

- **Python (`python/pixel_agent/workspace_services.py`, `protocol.py`):** Authoritative backend for Profiles, Artifacts, Grounded Starmap graph construction, and Session Import (JSON & Markdown parsing, SHA-256 duplicate detection, and persistent registries under `PIXEL_WORKSPACE_DATA_DIR`).
- **Electron Main + Preload (`src/main/services/pythonAgentBridge.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/channels.ts`, `src/shared/types.ts`):** Typed IPC surface (`profiles:*`, `artifacts:*`, `starmap:build`, `sessionimport:preview`, `sessionimport:commit`) bridged to the Python subprocess.
- **Renderer (`src/renderer/components/Stage9Destinations.tsx`, `WorkspaceSidebar.tsx`, `Workspace.tsx`):** Full-page, strictly monochrome desktop destinations wired into sidebar navigation and the `Ctrl+K` Command Palette.

## Full-Page Desktop Destinations

| Route (`WorkspaceView`) | Component | Backing Service |
| --- | --- | --- |
| `command-center` | `CommandCenterPage` | `history.list`, `system.diagnostics`, `tasks.list`, `gateway.status` |
| `capabilities` | `WorkspacePluginManager` | Python `PluginManager` (Plugins, MCP, Toolsets, Skills Hub) |
| `messaging` | `DedicatedMessagingPage` | Python `GatewayService` (start/stop, Telegram polling, pairing, one-time token reveal) |
| `webhooks` | `DedicatedWebhooksPage` | Python `WebhookRegistry` (routes, one-time HMAC secret reveal, delivery ledger) |
| `artifacts` | `ArtifactsPage` | Python `WorkspaceServices` (`artifacts.list/register/delete`, profile+project scoped) |
| `cron` | `CronPage` | Pixel `routines` IPC (`routines.list`, `routines.runNow`) |
| `profiles` | `ProfilesPage` | Python `WorkspaceServices` (`profiles.list/create/switch/update/delete`) |
| `agents` | `AgentsPage` | Live `tasks.list` + active Python runtime diagnostics |
| `starmap` | `StarmapPage` | Python `WorkspaceServices.build_starmap` (grounded memories, skills, sessions, artifacts) |
| `session-import` | `SessionImportPage` | Python `WorkspaceServices` (`session_import.preview/commit` with SHA-256 deduplication) |

## Design Invariants

- **Monochrome Surface Contract:** All Stage 9 views use CSS custom properties (`--color-surface`, `--color-border`, `--color-ink`, `--color-ink-dim`, `--color-accent`, `--color-danger`) with zero raw chromatic Tailwind classes.
- **No Synthetic Data:** Command Center usage/health, Agents delegation status, and Starmap nodes/edges are derived strictly from live backend records.
- **Default Profile Safety:** The `default` profile cannot be deleted; deleting any active non-default profile safely falls back to `default`.
