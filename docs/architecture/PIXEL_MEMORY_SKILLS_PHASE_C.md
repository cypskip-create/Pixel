# Pixel Phase C — Memory, SQLite FTS5 Session Search & Procedural `SKILL.md` Playbooks

**Status:** Implemented & verified locally (uncommitted)  
**Base Commit:** `33d3549b8efb58200358bd1283a186f3213d3fcb`  
**Schema Version:** SQLite Migration `14` (`session-search-fts5-and-procedural-skills`)

---

## 1. Architecture Overview

Phase C upgrades Pixel's SQLite-backed memory and skills into a Hermes-inspired long-term knowledge system while preserving all existing tables, conversations, structured skills, routines, and Electron's main-process security boundaries:

```
Conversation Turn (TS AgentExecutor OR Python pixel-agent-v2)
   │
   ├── System Prompt Context (via SessionMemorySnapshotManager + ProceduralSkillStore)
   │     ├── Frozen User Profile (char-capped confirmed preferences; stable prefix)
   │     ├── Frozen Project Knowledge (char-capped project facts & verified outcomes)
   │     ├── Dynamic Turn Retrieval (deduplicated against frozen IDs)
   │     └── Progressive-Disclosure Skill Index (active SKILL.md names + 1-line descriptions)
   │
   ├── Agent-Callable Tools (via Electron ToolRegistry + ToolExecutors)
   │     ├── session_search       ──► SQLite FTS5 (session_messages + session_messages_fts)
   │     ├── memory_search / list ──► SQLite MemoryStore (memory_fts)
   │     ├── skills_list          ──► Active procedural SKILL.md index
   │     ├── skill_view           ──► On-demand full SKILL.md body
   │     └── skill_draft_create   ──► Static-scanned draft (requires user review)
   │
   └── Explicit User Corrections / Edits / Deletions
         └── Immediately invalidate SessionMemorySnapshotManager so superseded facts
             disappear on the very next turn (no stale memory carryover).
```

---

## 2. SQLite Migration 14 (`src/main/data/migrations.ts`)

Append-only, transactional, non-destructive migration adding:
1. **`session_messages`** + **`session_messages_fts`** (`USING fts5(conversation_title, content, content='session_messages', content_rowid='rowid', tokenize='unicode61')`) with `AFTER INSERT`, `AFTER DELETE`, and `AFTER UPDATE` triggers keeping FTS5 synchronized automatically.
2. **`procedural_skills`**: versioned, SHA-256 hash-verified storage for `SKILL.md` playbooks (`status IN ('draft', 'active', 'disabled')`, `pinned`, `scan_status`, `scan_findings_json`).

Existing `HistoryStore` persisted conversations are backfilled cleanly on startup (`sessionSearchIndex.backfillFromHistory(history)`), kept synchronized on `saveConversation`, and purged immediately on `historyDelete` / `historyClear`. Session-only (`persistence === 'session'`) conversations are never indexed.

---

## 3. Selective Memory & Frozen Session Snapshots

- **`src/main/memory/autoExtract.ts`:**
  - Rejects one-off questions, casual greetings, raw CLI commands, short URLs, and credentials (`sk-`, `ghp_`, `github_pat_`, `AKIA`, `Bearer`, `password=`).
  - Supports deterministic slot replacement (`theme` covering accent/color/dark/light/blue/orange, `ui-layout`, `permissions`, `response-style`, `workflow`) and natural explicit user corrections (`"Actually, I prefer blue accents instead of orange"`).
- **`src/main/memory/snapshot.ts` (`SessionMemorySnapshotManager`):**
  - Freezes User Profile (700-char cap) + Project Knowledge (900-char cap) per `(conversationId, projectId)` for stable provider prompt prefixes across turns.
  - Deterministically invalidates cached snapshots on explicit user corrections, `memoryUpdate`, `memoryDelete`, `forgetSlot`, `historyDelete`, or `historyClear`.

---

## 4. Procedural `SKILL.md` Playbooks & Security Guard

- **`src/main/skills/guard.ts` (`scanProceduralSkillMarkdown`):** Static threat scanner blocking prompt-injection overrides, credential-access + network exfiltration, destructive/obfuscated shell commands, `../` path traversal, hidden zero-width/directional Unicode smuggling, and literal secrets. Blocked drafts cannot be activated.
- **`src/main/skills/procedural.ts` (`ProceduralSkillStore` & `ProceduralSkillTools`):**
  - Strict YAML frontmatter parsing + slug validation.
  - Progressive disclosure via `buildSkillIndexPrompt` (active skills only; drafts never injected).
  - User-pinned protection (`pinned: true` blocks automated overwrites and deletion until unpinned).
  - Assisted learning (`draftProceduralSkillFromTask`) synthesizes redacted `draft` playbooks from verified completed tasks for user review.
  - Safe local directory discovery (`discoverFromDirectory`) refusing symlinks and parent-directory escapes.
- **Settings UI (`src/renderer/components/AutomationPanel.tsx`):** Added a flat **Procedural Playbooks (`SKILL.md`)** section under **Settings → Skills & Routines** supporting draft creation, static scan status visibility, activation, disabling, pinning/unpinning, and deletion.

---

## 5. Measured Performance Benchmarks (Windows, Node 24 `node:sqlite`)

| Operation | Measured Result |
| :--- | :--- |
| Full SQLite schema migration (v1 → v14, fresh DB) | **16.17 ms** |
| Indexing 500 synthetic messages (25 conversations × 20 msgs) into FTS5 | **38.42 ms** (~0.077 ms/msg) |
| FTS5 exact phrase search (`"blue charcoal settings"`, 500 msgs) | **2.90 ms** (6 ranked hits) |
| Frozen session memory snapshot build (15 memories) | **4.98 ms** (1,407 chars) |
| Progressive-disclosure skill index build (10 active skills) | **0.64 ms** (525 chars) |

---

## 6. Rollback & Data Recovery

- Migration 14 is strictly additive (`session_messages`, `session_messages_fts`, `procedural_skills`) and modifies no existing tables (`projects`, `memories`, `skills`, `routines`, `tasks`, `plugin_installations`).
- Existing `HistoryStore` JSON files remain the source of truth for conversation transcripts; dropping or rebuilding `session_messages` / `session_messages_fts` loses zero conversation history because `backfillFromHistory()` regenerates the FTS5 index deterministically.
