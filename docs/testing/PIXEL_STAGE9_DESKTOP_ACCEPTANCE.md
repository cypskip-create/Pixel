# Pixel Stage 8 Closure & Stage 9 Desktop Acceptance

## Verification Matrix

| Layer | Suite | What Is Verified |
| --- | --- | --- |
| Scope Guard | `npm run check:scope` | No wholesale Hermes import; targeted integration only (`SCOPE_GUARD_OK`). |
| Type Safety | `npm run typecheck` | Main, preload, shared, and renderer TypeScript compile cleanly. |
| Python Unit & Integration | `python -m unittest discover -s python/tests -v` | Real `GatewayService` → `_dispatch_gateway_turn` → `run_agent_turn` against local HTTP OpenAI server, Telegram background polling + offset persistence, `EmailAdapter`, 26-platform honest `supportLevel`, HMAC-before-rate-limit & route-scoped replay, `/v1/sessions` device isolation, `resolve_approval` platform+actor binding, `WorkspaceServices` (Profiles, Artifacts, Starmap, Session Import). |
| Electron Bridge & Renderer | `tests/stage8-closure-and-stage9-desktop.test.ts` | Live `PythonAgentBridge` subprocess NDJSON IPC for `gatewayConfigureAgent`, `profiles*`, `artifacts*`, `starmapBuild`, `sessionImport*`, plus SSR render verification of all 9 dedicated Stage 9 pages. |
| Security & Theme Contracts | `tests/stage8-gateway-security-integration.test.ts`, `tests/architecture.test.ts`, `tests/monochrome-theme.test.ts` | IPC channel naming regex, monochrome token compliance, gateway pairing & webhook security. |
| Production Build | `npm run build` & Windows CI | `dist/main`, `dist/renderer`, native C# helper, portable & NSIS packaging. |

## Known Operational Limits

- Live third-party messaging delivery (Telegram, Discord, Slack, WhatsApp Cloud, Matrix, SMTP) requires user-supplied credentials and network reachability; automated tests verify protocol contracts, polling loops, retry/ledger logic, and validation offline.
- Sandboxed headless hosts cannot launch Electron's GPU window (`0x80000003`); full Windows desktop packaging and test verification run on GitHub Actions `windows-latest`.
