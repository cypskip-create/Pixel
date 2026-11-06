# Wave 3 handoff

State of the Wave 3 work, for picking up without re-deriving anything.

## Status

| Milestone | State | Tests |
| --- | --- | --- |
| 3A architecture + memory | **complete** | 39 |
| 3B documents + Python worker | **complete** | 28 |
| 3C workflows | **complete (engine + store)** | in `wave3.test.ts` |
| 3D subagents | **complete (coordinator + specialists)** | in `wave3.test.ts` |
| 3E Ollama + routing + budgets | **complete (provider + router)** | in `wave3.test.ts` |
| Compact UI panels for the above | **not built** | - |
| Windows GUI validation | **not possible here** | - |

Totals at handoff: **392 tests across 17 files**, both TypeScript programs
typecheck, four database migrations apply cleanly, real Python extraction runs.

## What exists, by file

```
src/main/data/database.ts        SQLite wrapper: WAL, statement cache, transactions
src/main/data/migrations.ts      4 versioned migrations (memory, documents, workflows, agents)
src/main/memory/types.ts         memory kinds, confidence, retention, ranking weights
src/main/memory/store.ts         CRUD, project isolation, dedupe, FTS + substring fallback, ranking
src/main/memory/context.ts       budgeted context block with provenance labels
src/main/memory/toolset.ts       memory_save/search/list/forget tool definitions + executor
src/main/services/python-worker.ts  supervised stdio JSON-RPC worker
python/pixel_worker/worker.py    extraction: txt/md/csv/code + PDF/DOCX/XLSX/OCR when installed
src/main/documents/indexer.ts    discovery, chunking, incremental indexing, FTS search
src/main/documents/toolset.ts    documents_index/search/list tools
src/main/workflows/index.ts      workflow store, replay engine, redaction, policy bridge
src/main/agents/coordinator.ts   6 specialists, scoped plans, budgets, coordinator
src/main/providers/ollama.ts     detection, capabilities, streaming generation
src/main/agent/budget.ts         cost tracking, loop detection, truncation, provider routing
docs/WAVE3-ARCHITECTURE.md       language matrix and contracts
```

The memory and document tool sets are wired into the live agent: `ipc.ts` opens the
database, composes `ToolRegistry([...BUILTIN_TOOLS, ...MEMORY, ...DOCUMENT])`, and
`ToolExecutors` dispatches to them. The agent loop therefore really can remember and
search documents today.

## Verified in this environment

- 392 tests pass; `tsc` clean for main and renderer.
- Migrations 1-4 apply to a fresh database; FTS5 available through `node:sqlite`.
- Real Python worker: capability probe, text/markdown/CSV extraction, structured
  errors for missing files and unsupported formats.
- Live document indexing: index a folder, search it, re-index incrementally, remove
  deleted files, keep projects isolated, cancel a run.
- Workflow record/replay including denial, approval, verification failure and
  cancellation; tamper detection via definition hash.
- Subagent scoping: guide mode withholds state-changing tools; coordinator enforces
  step, token and time budgets and the emergency stop; ungranted tools are refused.
- Ollama provider against a fake server: unavailable, model list, fail-closed
  capabilities, streaming, "no model installed" message.
- Budget arithmetic, loop detection, truncation, history summarisation, routing
  (vision/tools/offline/complexity).

## Not verified / not built

- **The floating UI has no Wave 3 panels yet.** Required next: memory save/search,
  current project indicator, document search results, active-specialist indicator,
  workflow record/replay buttons, model/offline status. The IPC surface for these
  is not exposed; only the internal tool paths exist.
- **Conversation injection is not wired.** `selectMemoryContext` and the context
  builder are implemented and tested, but `ConversationEngine` does not yet call
  them, so memories are retrieved by tools rather than injected into prompts.
- **Workflows, subagents and Ollama are not reachable from the app.** They are
  complete modules with tests; no IPC handler or tool exposes them yet.
- C#/.NET UI Automation service: **not written**. Planned contract described in
  `docs/WAVE3-ARCHITECTURE.md`; the Systems specialist currently uses the existing
  TypeScript diagnostics.
- VirtualBox/SSH adapters: **not written**; the Infrastructure specialist is
  deliberately granted no tools so it cannot claim capabilities it lacks.
- Rust: not introduced (no benchmark justifies it).
- Windows GUI, installer and launch behaviour: still unverified; the installer
  repair is isolated on `main` and was not touched here.

## Decisions worth remembering

1. `node:sqlite` over `better-sqlite3`: no native module, so `--ignore-scripts`
   installs keep working.
2. One database writer (main process only). Workers never receive a handle.
3. Memory writes are state-changing tools requiring approval; reads are safe.
   Nothing the model inferred is stored as verified fact.
4. Worker protocol is newline-delimited JSON over stdio with a `protocol` field;
   no HTTP, no ports.
5. Specialists are in-process; only Python/.NET are separate processes.
6. Workflow replay re-checks permissions per step and refuses a changed definition.

## Next steps, in order

1. Expose memory/documents/workflows/models over `cypsShell` (keeps `CypsBridge`
   frozen) and add the compact panels.
2. Inject retrieved memory into the system prompt in `ConversationEngine`.
3. Tool-expose workflows (`workflow_record`, `workflow_replay`) through the same
   gateway, behind approval.
4. Write the C# UI Automation worker; grant it to the Systems specialist only.
5. Bundle Python for packaging, then re-run the installer work on top.

## Commands used

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.main.json --noEmit
node node_modules/vitest/vitest.mjs run --config vitest.config.ts
```

Branch: `wave3`. Nothing pushed; commits stay local until authorised.
