# REA integration

## Current Codex setup (2026-11-21)

The setup-owned Codex configuration was added after the user approved the
reviewed plan from `rea-agents@6.10.1 setup --client codex --dry-run --json`.
Node `26.13.0` and npm `11.20.0` are compatible with this REA release. The
installer added one stdio server to `C:\Users\cypri\.codex\config.toml`,
retaining the existing `codex_app`, `cua_repl`, and `node_repl` entries, and
updated the shared skill at
`C:\Users\cypri\.agents\skills\reverse-engineer-anything` (identity 63).
The command points to the exact cached Node/REA entry; do not delete or move
that cache entry without updating/reapplying the registration. The setup did
not install a provider or modify the Pixel package.

Verification recorded so far:

- `codex mcp list` shows `rea` enabled with the pinned executable and script.
- Direct `rea doctor --client codex --skill --json` reports the Codex
  registration and installed skill identity aligned (`rea` 6.10.1, skill 63).
  Its overall `environment_healthy` value is false. Optional analysis engines
  (Hopper, Ghidra, IDA, JADX and Kuna) are not configured, and the diagnostic
  also reports registrations for unrelated Codex clients as missing/stale.
  The requested Codex registration/skill checks are healthy; no other client
  configuration was changed. These optional tools are unnecessary for static
  JavaScript analysis.
- A `rea doctor` attempt via `npx` was blocked because this sandbox's npm
  registry DNS returned `ENOTFOUND`; direct invocation of the pinned installed
  entry succeeds without contacting the registry.
- `node scripts/probe-rea-mcp.mjs --entry <installed-rea.mjs>` completed an MCP
  `initialize` handshake; the server identifies itself as REA 6.10.1 and
  advertises MCP tool capabilities.
- Safe static analysis completed on a two-file disposable Electron fixture in
  the Codex sandbox temp directory. Evidence `ev_b3e45b438b7ae1140294fdfcb2049c979b76eed98b054263901a3a5346b89e99`
  (parent analysis `ev_8fc0cd822be90fcadd1930d60d9550e7af8a880bb6055362f82d77e1f6b5a47e`)
  was written outside the repository. REA parsed JavaScript and package
  metadata without executing the fixture. The analysis reported static unknowns
  and limitations; it is not a runtime safety verdict.
- `codex mcp list` reports `rea` enabled, but the current session's tool catalog
  does not expose REA. `list_mcp_resources({server:"rea"})` reports `unknown
  MCP server`, and doctor reports `live_server: unknown`. Restart/reconnect
  Codex and verify a real tool call before claiming current-session
  connectivity. An independent stdio handshake proves server startup only.
- Rechecked through Codex CLI on 2026-11-21: `codex mcp list` continues to label
  `rea` as **enabled / Unsupported**. `rea doctor --client codex --skill --json`
  reports the Codex registration and skill identity healthy, despite unrelated
  missing provider/client diagnostics.
- CLI fallback protocol test: a standalone stdio MCP client negotiated
  `2024-11-05`, listed 263 tools, then called
  `analyze_javascript_application` on a temporary Electron fixture. REA returned
  Evidence `ev_8dab99644a9753790a6514321e92cb0d50d076cc4439cc51005c98dbc163759f`
  and parent analysis `ev_b3a355351bb565e3642c5153f41a00f7a748379891fa199030f4b093923c83f7`.
  The fixture was removed after analysis. This proves a direct MCP stdio tool
  call works, but does not make REA tools available inside this Codex session.
- An additional bounded `analyze_javascript_application` call against the
  existing packaged Pixel `app.asar` did not return before the client timeout;
  it produced no usable Evidence. Do not treat that as analysis of the current
  source tree or as success.
- A read-only `capture_browser_scenario` attempt for the public Inspora Folders
  page used the installed Chrome executable and a temporary profile. Chrome
  exited during startup (`crashpad ... TransactNamedPipe ... pipe has been
  ended`); REA returned `execution_failure` and `cleanup_incomplete` with no
  retained resources. The reported Chrome PID was absent on a follow-up process
  check. A CIM check was denied by the host. The suggested no-sandbox override
  was not applied. No page Evidence was produced.
- 2026-11-21 follow-up: direct invocation of the pinned CLI again returned
  version `6.10.1`; doctor confirmed the Codex registration is aligned. This
  session still could not call REA. A local REA download/analysis attempt for
  the public ASCII Sharks source failed because DNS could not resolve
  `codeload.github.com`. The public raw `engine.ts` and `renderer.ts` were
  inspected with the browser reader instead; see
  `docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md`.
- 2026-11-21 current-session recheck: `codex mcp list` still reports `rea`
  **enabled / Unsupported**. The live tool catalog contains no REA namespace,
  and `list_mcp_resources({server:"rea"})` returns `unknown MCP server`. This
  confirms that Codex restart/reconnect is still required before an in-session
  REA call can be tested; no such call is claimed for this session. The
  approved Electron permission prompt was accepted by the user, but Windows
  app inventory still exposed no Pixel window, so no live Workspace screenshot
  was available either.

The earlier DeepSeek client configuration and REA 6.8.0 history below remain
as historical records. That registration was not changed by the Codex setup.

## What was done

1. Environment: Node v24.16.0 / npm 11.13.0. REA (`rea-agents@6.8.0`) refuses to
   configure unless the Node on **PATH** satisfies `>=22.23.4 / >=24.22.1`.
   A compliant interpreter was installed side-by-side, without touching the
   system Node:

   `%LOCALAPPDATA%\PixelTooling\node-v24.22.1-win-x64` (official zip, SHA-verified
   by size; `scripts\fetch-node.mjs` reproduces the download).

2. Plan shown before applying (`npx -y rea-agents@6.8.0 setup --dry-run --client dsh
   --format json`): two actions, both local, both reversible.

   | Action | Target |
   | --- | --- |
   | `configure_client:dsh` | `C:\Users\cypri\.dsh\cordis.patch.yml` (was absent) |
   | `install_skill` | `C:\Users\cypri\.agents\skills\reverse-engineer-anything` |

3. Applied after explicit approval: `setup --client dsh --yes`. Result
   `status: ready`, `appliedActions: configured_dsh, installed_skill`. The written
   entry is a standard stdio MCP server:

   ```yaml
   - insert:
       - id: rea-mcp
         name: "@deepseek-ai/dsh-mcp-client"
         config:
           serverName: rea
           transport: stdio
           command: cmd.exe
           args: [/d, /c, npx, -y, rea-agents@6.8.0, mcp]
   ```

   No existing configuration was overwritten: the file did not exist before, and
   the setup tool is instructed to preserve unrelated entries.

## Verification (not merely "npm succeeded")

- **Handshake proven independently** (`scripts\probe-rea-mcp.mjs`): a JSON-RPC
  `initialize` over stdio returns
  `serverInfo: {name: "rea", version: "6.8.0"}`, `protocolVersion 2024-11-05`.
  Verified both through `npx` and through the pinned Node.
- **In-harness connection**: the `rea` MCP server is registered for this session
  and its tools are callable. After the harness reloaded, `list_mcp_resources`
  initially reported `server is disconnected`; the stdio probe showed the server
  itself healthy, so the cause was the client not having spawned the newly written
  registration. After the connection was established, real calls succeeded.
- **Real inspections performed** (evidence IDs):
  - `inspect_electron_fuses` on `release\win-unpacked\Pixel.exe` → `ev_1d1ce82f…`
    (produced the RunAsNode root cause).
  - `open_binary` on `HeyClicky-Setup.exe` → SHA-256 `34d8050a…b39293`.
  - `inspect_pe_imports` on the same file → `ev_576f994b…` (297 imports).

## Deep-analysis providers

`rea doctor` reports Ghidra, IDA, JADX and Kuna as not configured. That is fine for
this work: JavaScript/Electron inspection, PE imports, PE resources, Electron fuses
and archive inventory are all target-free and need no native engine. If native
decompilation is needed later, set `GHIDRA_INSTALL_DIR` to an extracted Ghidra
12.1.x directory; REA never installs it.

## CLI fallback

Every inspection above has a CLI equivalent, which is what to use if the MCP server
is ever unavailable:

```powershell
npx -y rea-agents@6.8.0 inspect-electron-fuses <path-to-exe> --json
npx -y rea-agents@6.8.0 inspect-pe-imports <path-to-exe> --json
npx -y rea-agents@6.8.0 analyze-javascript-application <path> --json
```

## Reproducing / removing

- Re-apply: `npx -y rea-agents@6.8.0 setup --client dsh --yes` (with Node ≥24.22.1
  on PATH).
- Remove: delete the `rea-mcp` insert from `~/.dsh/cordis.patch.yml` and restart
  the harness. The skill copy can be deleted independently; neither action touches
  Pixel.

## Known limitation

REA's setup writes its own skill copy under `~/.agents/skills/…`. Pixel's
repository is unaffected, and no REA artefact is packaged into Pixel.
