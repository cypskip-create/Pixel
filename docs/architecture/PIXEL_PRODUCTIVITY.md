# Pixel local productivity tools

Pixel's main process owns project-scoped notes, planning tasks and checklists.
Migrations 8 and 9 add these tables alongside, and separately from, durable
agent execution tasks. A project ID is supplied by the trusted
main-process active-project provider; model arguments cannot choose another
project. Notes are plain editable text with bounded title/body lengths. Tasks
have a title, description, optional due timestamp, optional checklist and
`open`, `in_progress` or `completed` status. Migration 9 preserves earlier
tasks as ungrouped.

The current agent tools are `notes_create`, `notes_read`, `notes_search`,
`notes_update`, `notes_delete`, `tasks_create`, `tasks_list`, `tasks_update` and
`tasks_complete`, `checklists_create` and `checklists_list`. Their JSON contracts are registered in the shared
`ToolRegistry` and dispatched by `ToolExecutors` to `ProductivityTools`, which
uses `ProductivityStore` and reads state back after mutation. Ordinary scoped
create/update operations are medium risk and available only in Hybrid/Agent
because they change state; deletion is high risk and requires fresh approval.
Read/search operations are low risk. No operation can target a different
project by passing an ID alone.

The tools persist data in SQLite and can be used by the real model tool-call
pipeline. A dedicated `Notes & Planning` Workspace page browses and edits notes,
creates tasks and marks tasks completed. Automated tests cover tool schema
validation, dispatch, project isolation, CRUD, agent postcondition read-back
and the renderer's note-create/edit/import path. The page exposes task title,
description, due date and completion-state editing. Markdown/text import and
Markdown export use main-process file dialogs; import rejects symlinks and
files over 20 KB, while export confirms replacement and reads the result back.
The page creates and filters checklists and assigns tasks to them; agent tools
can create/list checklists and attach or move tasks only within the active
project. Local document links and Windows GUI acceptance remain open.

## Browser tabs

Pixel's existing `BrowserSession` now gives pages stable session-local tab IDs
and exposes `browser_new_tab`, `browser_list_tabs`, `browser_switch_tab`, and
`browser_close_tab` through the same registry and executor. Initial and
subsequent URLs still pass `NetworkGuard`; a tab is verified by its final URL
and title. Closing the last tab creates a blank replacement so later browser
tools retain a defined page. The always-running tests verify tool registration,
schemas, executor result shape and verification fields. Real tab lifecycle tests
run only when Playwright Chromium is installed. Browser upload/download flows
and full target-browser acceptance remain outstanding.
