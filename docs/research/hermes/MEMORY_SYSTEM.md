# Memory Architecture Deep Dive

Source authority: `tools/memory_tool.py`, `tools/memory_tool_store.py`, `agent/memory_manager.py`, `agent/memory_provider.py`, `agent/memory_context.py`, `tools/session_search_tool.py`.

## 1. How Hermes Structures Memory
1. **Declarative vs. Procedural Separation:**
   - **Curated Declarative Memory (`MEMORY.md` + `USER.md`):** Held in `~/.hermes/memories/` with strict character caps (`memory_char_limit=2200`, `user_char_limit=1375`). `MEMORY.md` holds agent operational/project notes; `USER.md` holds stable user preferences/profile facts.
   - **Procedural Memory (`SKILL.md`):** Narrow "how to do X" procedures live in `~/.hermes/skills/`, never bloating `MEMORY.md`.
   - **Episodic Memory (`session_search`):** Past conversations stay in SQLite and are queried on demand via FTS5 + summarization rather than copied into permanent memory.
2. **Frozen Session Snapshot:** Both `MEMORY.md` and `USER.md` enter the system prompt as a **frozen snapshot at session start**. Mid-session writes persist to disk immediately (with `fcntl`/`msvcrt` file locking on Windows) but never mutate the active prompt prefix, keeping prompt-cache hit rates high.
3. **LLM-Driven vs. Deterministic Decisions:**
   - **LLM-driven:** The model calls the single `memory` tool (`add`, `patch`, `remove`, or `batch`) when it decides a fact is durable, OR an optional external memory plugin (`plugins/memory/<name>/`, one active at a time) runs `prefetch` / `sync_turn` / `on_pre_compress` hooks.
   - **Deterministic:** Character caps, threat/injection scanning (`_scan_memory_content`), trivial-prompt prefetch skipping (`is_trivial_prompt`), egress secret scrubbing (`redact_for_egress`), pinned-entry staging for write approval (`_pin_matched_entries` + `_gate_or_stage`), and `_StuckCallGate` circuit breaker (max 4 stuck calls, max 16 in-flight, 60s probe interval).

## 2. Comparison with Pixel's Current Memory (`src/main/memory/`)

| Dimension | Hermes | Pixel Today | Gap & Target Evolution |
| --- | --- | --- | --- |
| **Storage** | Markdown files (`MEMORY.md`, `USER.md`) + optional plugin | SQLite `memories` table scoped by `project_id` + revisions | Keep Pixel's SQLite store (richer metadata, provenance, revisions, export) |
| **User vs. Project Split** | Explicit `USER.md` (user profile) vs `MEMORY.md` (notes) | `kind` column (`preference`, `project`, `fact`, `outcome`) | Add explicit User Profile vs. Project Knowledge char-capped frozen prompt blocks |
| **Write Noise Control** | Strict char limits + trivial-prompt skip + staged write approval | Deterministic `autoExtract.ts` with `relevanceScore`, `isLowValueNoise`, `filterNovelMemoryCandidates` | Add char-budget eviction, periodic contradiction review, and `session_search` tool |
| **Cross-Session Recall** | Dedicated `session_search` tool (FTS5 + summary) | History search UI only (no agent `session_search` tool) | Add `session_search` agent tool over Pixel's existing SQLite conversation history |
| **Prompt-Cache Stability** | Frozen snapshot at session start | Re-queried per turn via `selectMemoryContext` | Freeze memory block per conversation session; refresh on explicit user edit or new chat |
