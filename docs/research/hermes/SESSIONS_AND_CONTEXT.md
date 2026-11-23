# Sessions, Persistence & Context Compression

Source authority: `hermes_state.py`, `persistence/`, `agent/context_compressor.py`, `agent/context_compressor_*.py`, `agent/micro_compaction.py`, `session_rules/turns.py`.

## 1. Persistence Architecture (`persistence/` & deprecated `hermes_state.py`)
- Hermes migrated away from a monolithic `SessionDB` (`hermes_state.py`, scheduled for removal in v0.27.0) to a layered `persistence/` package opened via `persistence_assembly.open_persistence(profile_scope())`:
  - **SQLite WAL Mode** with `apply_wal_with_fallback`, `WriterMutexTimeout` serialized writer lock, and a bounded **read pool** (`persistence.sqlite._state.readpool`) for concurrent readers.
  - **Corruption & Crash Resilience:** Distinguishes `StoreQuarantined` (corrupt DB moved aside rather than overwritten), `StoreReplaced`, `DeletedWalGeneration`, `CompressionInProgress`, `ResumeTooLarge`, and `ExportTooLarge`.
  - **Rescue Fallback:** `session_rescue.divert_session_transcript_jsonl(...)` diverts transcripts to JSONL if SQLite is temporarily unavailable so conversation turns are never silently dropped.
  - **Profile Isolation:** Every handle is bound to a `profile_scope()` directory; `HERMES_HOME` overrides propagate across worker threads via `ContextVar` (`ctx_bound`).

## 2. Multi-Stage Context Compression (`agent/context_compressor.py`)
When a long conversation approaches the model's context window, Hermes runs a carefully ordered pipeline instead of naive message dropping:
1. **Proactive Tool-Output Pruning (`ProactivePruneMixin`):** Replaces bulky old `terminal`/`delegate` tool outputs with compact stubs (`terminal_stub`, `delegate_stub`) before touching conversational prose.
2. **Micro-Compaction (`MicroCompactionMixin`):** Trims stale tail tool results (`demote_stale_tail_tools`) while preserving skill safety rules (`elide_keeping_skill_safety_rule`) and retiring evicted image attachments (`image_eviction_policy.py`).
3. **Middle-Turn Auxiliary Summarization (`SummaryDispatchMixin`):** Protects the head (system prompt + initial goal) and recent tail (token-budgeted via `lean_tail_budget`), and summarizes the middle span with a cheap auxiliary model (`auxiliary.compression`).
4. **Deterministic Fallback & Redaction:** If the summary model stalls or fails, `context_compressor` either retries once on a `ContextVar`-pinned fallback route or inserts a **deterministic fallback summary** without crashing the turn. All derived summary text passes through `redact_derived_text` / `redact_sensitive_text`.

## 3. Pixel Implications
- Pixel already uses `node:sqlite` in WAL mode (`src/main/data/database.ts`), which is a strong foundation.
- **High-value upgrades for Pixel:**
  1. Add **tool-output pruning** before history trimming (`src/main/providers/deepseek.ts::trimHistory` currently drops whole old messages rather than compacting bulky tool outputs first).
  2. Add **session-level middle-turn summarization** with deterministic fallback and secret redaction.
  3. Add **corrupt-DB quarantine + JSONL rescue** in `src/main/data/database.ts`.
  4. Expose **`session_search`** (FTS5 over Pixel's existing `messages` table) as an agent tool for cross-conversation recall.
