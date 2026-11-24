# Pixel Stage 9 Desktop Acceptance & Verification

## Automated Verification Matrix

| Layer | Suite / Command | Verified Scope |
| :--- | :--- | :--- |
| **Scope Guard** | `npm run check:scope` | Zero nested Hermes trees (`SCOPE_GUARD_OK`). |
| **Type Safety** | `npm run typecheck` | Renderer, shared, preload, main, and test TypeScript compile with 0 errors. |
| **Python Unit & Integration** | `python -m unittest discover -s python/tests -v` | Real `GatewayService` → `_dispatch_gateway_turn` → `run_agent_turn` against local HTTP server, Telegram polling worker + offset persistence, honest 26-platform `supportLevel` (`email` = `outbound_only`), HMAC-before-ratelimit & route-scoped replay, `/v1/sessions` device isolation, approval actor+platform binding, `WorkspaceServices` Profiles/Artifacts/Starmap/2-phase Session Import. |
| **Stage 9 Backend & DOM Interaction** | `tests/stage9-functional-completion.test.tsx` | Real profile isolation (`HistoryStore` + `Artifacts` + `resolveProfileContext`), `validateArtifactPath` traversal block, 2-phase `commitSessionImportSafely` failure-retry + duplicate block on real `HistoryStore`, plus `jsdom` React interaction tests for `AgentsPage` (nested `parentTaskId` & `specialistId` + cancel), `StarmapPage` (visible `<line data-edge-relation>` SVG edges + Timeline view), `DedicatedMessagingPage` (6 primary adapter tabs, honest `outbound_only` Email status, one-time token copy & dismiss), `DedicatedWebhooksPage` (one-time secret copy), `CronPage` (`runNow` & `History`), and `ProfilesPage` (`update` & two-step delete confirmation). |
| **Electron Bridge & SSR** | `tests/stage8-closure-and-stage9-desktop.test.ts` | Live `PythonAgentBridge` subprocess NDJSON IPC + SSR mount of all 9 dedicated Stage 9 pages. |
| **Security, Architecture & Theme Contracts** | `tests/architecture.test.ts`, `tests/monochrome-theme.test.ts`, `tests/workspace-components.test.tsx`, `tests/stage8-gateway-security-integration.test.ts` | Process boundaries, IPC channel naming regex, monochrome/blue-accent token compliance, sidebar navigation contract, gateway security. |
| **Windows Packaging & CI** | GitHub Actions `Windows CI` (`windows-latest`) | Full Vitest suite, Python tests, C# native UIA helper compilation, unpacked app, portable executable, and NSIS installer build. |

## Visual Comparison Status (**PENDING**)

- **Interactive 1440×900 Desktop Visual Acceptance: PENDING.** The sandboxed headless build host cannot launch Electron's GPU window (`0x80000003`), so live 1440×900 Electron desktop screenshots comparing Pixel's Stage 9 views against the pinned Hermes reference could not be captured here. Visual acceptance is explicitly left **pending** until run in an interactive Windows desktop environment (do not conflate DOM/theme tests with visual screenshot parity).
- **Verified Automatically:** `tests/stage9-final-corrections.test.tsx` (profile isolation across tasks/history, per-run provider overrides in TS & Python, atomic multi-session import rollback & concurrency lock, real `ToolExecutors.run('file_write')` artifact registration, Cron schedule editing), `tests/stage9-functional-completion.test.tsx`, `tests/monochrome-theme.test.ts`, `python/tests/test_stage8_closure_and_stage9.py`, and full Windows CI packaging.
- **Messaging Capabilities:** Telegram & Slack (`full_adapter`), Discord / WhatsApp Cloud / Matrix (`partial`), Email (`outbound_only`), extended platforms (`outbound_webhook` / `external_dep_required`). Live external delivery requires user-supplied credentials.
