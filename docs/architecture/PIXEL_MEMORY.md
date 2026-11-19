# Pixel project memory

Updated: 2026-11-19 — Tools 4.2.

## Scope and trust

Memories are stored locally by `MemoryStore` and belong to one active project.
Changing projects changes the context used for retrieval, correction and
forgetting. Automatic extraction does not search other projects or copy one
project's preferences into another. There is no separate global preference
store in this checkpoint.

The main process makes persistence decisions. It uses small deterministic
phrasing rules over direct user-authored messages and successful, verified task
records; it does not make another model request for each chat message. The
model's `memory_save` proposal path is absent from the tool registry. External
page, file and screenshot content cannot set the memory policy or broaden the
project scope.

## Current automatic capture

Settings → Privacy → Automatic Memory defaults to enabled and can be turned
off. The current extractor accepts concise direct preferences, explicit
“remember” requests, a limited set of Pixel project architecture assertions,
and direct corrections for theme, response style and workflow. A completed
task may add an outcome only if it ended completed, has at least one verified
step, has no failed steps, and has no pending verification.
The memory store reads the saved item back and writes a revision when a
preference slot is directly corrected.

Automatic candidates are limited to 500 characters. Conversation input is
bounded, and the extractor rejects common password/token/key patterns,
instruction override phrasing, code-fenced content, and text explicitly
attributed to webpages/documents/screenshots. The task outcome path records
only a redacted task title and short verified step summaries. These filters
are deterministic safeguards, not a general sensitive-data classifier.

When Automatic Memory is disabled, eligible ordinary preferences/assertions
and verified outcomes are not automatically added. Explicit “remember” and
recognized correction instructions still work; the user can edit or delete any
record from the project Memory page. Recognized “forget my theme/response
style/workflow preference” commands delete only the matching automatic slot
inside the active project.

## Deduplication, corrections and limits

Preference slots (such as `theme`, `response-style`, and `workflow`) prevent
repeated equivalent preferences from filling the project store. Direct updates
replace the same slot and retain old content, source, confidence, timestamp and
reason in the revision table. Other records use existing normalized content
deduplication. Automatic entries are bounded to 250 per project. User-created
records are not counted against that automatic cap.

The Memory page shows type, confidence, provenance/source, project context,
created/updated times and revision history. It supports search, correction,
deletion and project export. Automatic records use provenance labels such as
`auto:conversation` and `auto:verified-task:<task id>`.

This is intentionally narrower than a general project journal. Automatic
extraction of arbitrary feature milestones, task plans, reusable procedures,
source-backed external facts and user-confirmed bug reports is not implemented
unless they appear through the verified task outcome path or the user asks
Pixel to remember them explicitly. The phrase “what do you remember?” uses
the existing project-scoped memory retrieval tools; it does not search other
projects.

## Storage and UI

- Memory content and revision history use Pixel's existing local SQLite store.
- Settings hosts the toggle and links to the project Memory page.
- The Memory page can export only the active project's records as JSON.
- A saved memory does not create an approval card or reveal secret material in
  the UI. The local audit record notes a memory ID and category, not candidate
  plaintext.
- There is no automatic upload, cross-project retrieval or model-controlled
  write permission.

## Validation status

The deterministic extraction, duplicate/correction, project-isolation, bounds
and credential/injection-filter cases are covered by `tests/automatic-memory.test.ts`.
The UI is covered by component tests. Final test counts and any remaining
limitations are in `PROGRESS.md` and the Windows acceptance procedure. No real
Pixel GUI restart/read-back acceptance was performed for this checkpoint.
