# Pixel Wave 3 - architecture

This document records the language-by-component assessment required before Wave 3
implementation, and the contracts that keep the new services subordinate to the
TypeScript orchestrator.

## 1. What actually exists (inspected, not assumed)

Verified by reading the source and running the suite on `main` before branching:

| Area | State |
| --- | --- |
| Electron shell, floating window, tray, shortcuts | implemented (`src/main`) |
| React floating UI, 8-state orb, compact bar | implemented (`src/renderer`) |
| DeepSeek client: SSE, thinking, vision gating, errors | implemented + 36 tests |
| Agent tool loop: policy, approval, execution, stop | implemented + 25 tests |
| Tool registry (12 tools), permission policy | implemented + 21 tests |
| Browser automation (Playwright) | implemented, 14 live-Chromium tests |
| Voice (Windows `System.Speech`) | implemented, capability probe passes |
| Diagnostics, packaging, installer scripts | implemented (repair in progress, isolated) |
| **Memory, documents, workflows, subagents, Ollama** | **absent** - this wave |

The claim "Wave 2 completed" matches what is in the tree: no memory, document,
workflow, subagent or local-model code exists yet. `PROGRESS.md` records waves
1A-1D and the installer work, which is the accurate picture.

## 2. Language responsibility matrix

Each language is used where it has a concrete advantage. Nothing was rewritten
merely to add a language.

| Responsibility | Language | Why |
| --- | --- | --- |
| App lifecycle, windows, avatar, IPC | TypeScript | existing, working Electron app |
| Agent orchestration, tool policy, approvals, emergency stop | TypeScript | single authoritative runtime already exists and is tested |
| Conversation, streaming, provider routing, budgets | TypeScript | shares the existing DeepSeek client |
| Memory store, projects, tasks, workflows, audit, usage | TypeScript + SQLite | one writer, transactional, no cross-process DB writers |
| Document parsing (PDF/DOCX/XLSX/CSV/OCR) | **Python** | PyMuPDF, python-docx, openpyxl, Tesseract have no equivalent-quality JS option installed |
| Embeddings / semantic ranking | **Python** | sentence-transformers / ONNX Runtime ecosystem |
| Speech recognition upgrade (faster-whisper) | **Python**, optional | the current Windows engine works; replacement only if measured better |
| Windows UI Automation, window enumeration, native diagnostics | **C# / .NET** | Electron cannot read accessibility trees or DPI-accurate native bounds |
| Screen-region native capture, low-level input | **C# / .NET** (later) | only if UIA gaps are proven |
| High-performance indexing | **Rust** | **not introduced.** No benchmark justifies the build/deploy cost yet |
| Persistence | **SQLite** (`node:sqlite`, Node 24 built-in) | no native module to compile, FTS5 available, single writer |

### Deliberate exclusions

- **Rust**: deferred. The measured bottleneck so far is network latency to the
  model, not local compute. Revisit only with a benchmark.
- **Separate process per agent**: rejected for the minor agents. They are
  in-process objects with scoped tools and budgets. Isolation is reserved for the
  Python and .NET workers, which are genuinely different runtimes.
- **HTTP microservices**: rejected. Workers speak length-prefixed, versioned JSON
  over stdio. No ports, no loopback listeners, nothing reachable from outside the
  app.

## 3. Process and contract topology

```
User
  -> Electron / React (renderer, sandboxed)
  -> window.cyps / window.cypsShell (preload bridge, the only native door)
  -> TypeScript agent orchestrator (src/main/agent)
       -> central tool gateway: registry + permission policy + audit
            -> in-process tools (browser, screen, memory, documents, workflows)
            -> Python worker (stdio JSON-RPC)  documents, embeddings
            -> C# worker     (stdio JSON-RPC)  UI Automation, native diagnostics
  -> structured results -> verification -> renderer
```

Rules enforced by the implementation:

1. Both worker protocols carry an explicit `protocolVersion`; a mismatch is a
   hard, reported error rather than silent misbehaviour.
2. Only the orchestrator decides permissions. Workers execute a request that has
   already been authorised, and validate their own arguments again.
3. Cancellation propagates: the gateway cancels the request id, the supervisor
   kills the in-flight worker request, and the tool reports `cancelled`.
4. Every worker call has a timeout and a restart budget.
5. No worker receives the API key, the settings file, or a database handle.
6. Document text is untrusted data. It is never interpreted as instructions, and
   the system prompt says so.

## 4. Persistence design

One SQLite database at `%APPDATA%\Pixel\pixel.db`, owned solely by the main
process. `node:sqlite` (`DatabaseSync`) is used because Node 24 bundles it: no
native compilation, so the `--ignore-scripts` install path still works.

- WAL journal, `foreign_keys=ON`, `busy_timeout`.
- Versioned migrations in `src/main/data/migrations.ts`, applied transactionally,
  recorded in `schema_migrations`.
- FTS5 external-content tables for memory and document chunks, with triggers.
- All multi-statement writes inside a transaction; no other process opens the DB.

Tables: `projects`, `memories`, `memory_fts`, `documents`, `document_chunks`,
`chunks_fts`, `tasks`, `workflows`, `workflow_steps`, `audit_events`,
`model_usage`, `agent_runs`, `preferences`.

## 5. Security model additions

Wave 3 keeps every existing guarantee and adds:

| Risk | Control |
| --- | --- |
| Python/C# bypassing permissions | workers only run pre-authorised requests; they hold no policy code |
| Cross-project memory leakage | every memory row carries `project_id`; retrieval is scoped and cross-project reads require an explicit flag |
| Prompt injection in documents | extracted text is wrapped and labelled untrusted; the tool result never contains executable instructions |
| Unbounded indexing | directories must be explicitly added; depth/count/byte limits enforced |
| Runaway spend | per-run token budget, step ceiling, loop detection, usage recorded per model |
| Worker escape | fixed argv, no shell, JSON-only protocol, stderr logged with secret redaction |
| Silent capture | unchanged: capture requires an explicit user action |

## 6. Packaging implications (kept out of the installer work)

- The Python worker ships as source plus a bundled interpreter or PyInstaller
  one-file build; the app detects the interpreter path and reports a capability
  error if absent. Nothing here modifies NSIS, `appId`, or migration logic.
- The C# worker builds to a self-contained executable (`dotnet publish`); the app
  looks for it next to the resources and degrades gracefully if it is missing.
- Both are optional: Pixel starts and works without them, with the affected tools
  reporting a precise capability error instead of failing silently.

## 7. Implementation order

3A memory (+ database) -> 3B Python document worker -> 3C workflows -> 3D
subagents -> 3E Ollama + routing. Each milestone lands with tests and a
`PROGRESS.md` update; `WAVE3_HANDOFF.md` carries state between sessions.
