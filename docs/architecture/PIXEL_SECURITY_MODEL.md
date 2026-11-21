# Pixel security model

Updated: 2026-11-21 — Core Tools 6.2 risk-policy follow-up and local 6.3 plugin foundation on reviewed main `e5ee482`.

## Trust boundaries

| Boundary | Rule in current code | Remaining limit |
| --- | --- | --- |
| Renderer to OS | Renderer calls an explicit preload API; the main process owns tools, settings, credentials and DB access. | Live Electron window behavior is not part of the automated test result. |
| Cursor Buddy IPC | Only the current cursor window's trusted main frame can call renderer-ready and `cursorSettingsGet`; the latter returns only `reducedMotion`. The per-channel allow-list is checked before the common IPC listener, and the cursor window denies popups and external navigation. | The renderer still has the shared typed preload object, so handler-side deny-by-default must remain enforced. Post-fix visibility needs a real desktop test. |
| Model to tool | Model output is a proposal. Zod validates the registered argument contract; main-process mode, stop and approval policy decides whether it can run. | Model reasoning itself is not trusted as policy. Some schema formats outside Pixel's supported subset fail closed. |
| Retrieved content to instruction | System prompt and document/file tool results label website/document/screenshot content as untrusted. | Prompt instructions alone cannot eliminate model influence; every consequential action still needs local policy and approval. |
| Approval response to request | Approval ids must match the pending request. Main-process policy independently validates Always Allow against an explicit tool/scope allow-list. High-risk and unsupported standing grants are rejected. | Real Electron approval-card interaction is not verified in this host. |
| Automatic memory | Deterministic extraction runs in the main process only on direct user text or verified task outcomes. Credentials, injection-like content and copied web/document instructions are filtered. | Extraction intentionally handles a narrow set of phrasing; arbitrary project milestones, source-attributed external facts, and global/cross-project preference features are not complete. |
| Persistent permissions | Always grants use SQLite migration 7 and include tool, canonical app/origin or exact screen process/title scope, risk, timestamps, revocation, and policy version. Startup revalidates grants; Settings can revoke one or all; emergency stop revokes grants. | Screen observation grants require user approval and an exact verified process name plus exact title; they do not cover clicks or typing. |
| Screen-observation session | A volatile main-process grant can cover observation and passive guidance for one exact window identity (opaque ref, PID, process and title); it can be revoked and expires within eight hours. | It is limited to the running Pixel session and grants no clicking, typing or application switching. |
| Browser to network | Only HTTP(S), public DNS destinations and allowed connected addresses are surfaced. Requests are checked, including redirects and subresources. | A DNS rebind can connect before the post-connect check rejects the page; an egress proxy is needed to prevent that network connection entirely. |
| Task state to disk | Zod validates snapshots; common credential patterns and sensitive argument fields are redacted; typed text and file-write bodies are not stored in task args. | SQLite task text is not application-layer encrypted, and redaction is pattern-based. Windows account/file permissions remain important. |
| Provider key | Electron `safeStorage` encrypts the DeepSeek key (DPAPI on Windows); if encryption is unavailable, Pixel refuses to persist it. The renderer never receives the plaintext key. | This is a provider API-key store, not a general-purpose credential vault. |
| Screen capture and guidance | Capture requires explicit approval or a matching volatile session / persistent exact-process-and-title observation grant. Window IDs remain opaque in the renderer; native capture revalidates exact window/process identity. The visual overlay accepts a revalidated unique UIA control, remains passive/click-through, expires, and clears on stale target, lock or emergency stop. | Vision output is model interpretation. Native capture and the visible overlay have not passed target-laptop acceptance; current native integration fails before producing a screenshot in this host. |
| Clipboard tools | `clipboard_read`, `clipboard_copy`, `clipboard_restore`, and `clipboard_paste` are main-process registered tools. Reads/writes require fresh approval. Read/copy values are not stored in task arguments or audit summaries; a chat turn that reads clipboard content is session-only, and task result is a fixed privacy note. Copy keeps only a bounded five-minute volatile plain-text snapshot and restore is conditional on Pixel's last clipboard write still being present. | Credential matching is pattern-based and cannot detect every secret. `clipboard_paste` uses ValuePattern replacement semantics, not insertion at the caret. Windows installed-app/approval UX is not verified. |
| New everyday file operations | Experience Polish 5.0 search, metadata, directory creation, copy and rename are main-process tools in the existing registry. Core 6.2 adds fresh-approved batch copy/move with 20-operation and total-size ceilings, no-overwrite destinations, staged SHA-256 verification, a bounded duplicate scan, size/modified-time search filters, approved opening for home-scoped folders and a fixed set of document/image formats, and approved single-file `shell.trashItem` calls. Paths stay in home scope; hidden, sensitive-name and symlink entries are skipped/refused. | `shell.openPath` acceptance plus path existence does not prove a visible application window. Recycle Bin restoration and actual Windows open/trash behavior remain unverified. Batch movement is staged and reports partial source removals; it is not a filesystem-wide atomic transaction. |
| Pixel Board | Main-process `PixelBoardService` validates and persists the active scene with revision checks; typed IPC synchronizes renderer and agent edits. Agent tools use the same schema/permission/executor path, and the tool result includes a read-back snapshot. File dialogs and overwrite confirmation are main-owned. | Agent export currently supports editable `.pixelboard` and SVG. PNG export remains renderer-only; PDF and screenshot import are unavailable. Windows dialog and GUI acceptance remain unverified here. |

## Approval behavior

`CONSEQUENCE_POLICY` in `src/main/agent/tools.ts` defines risk floors for
safe/low/medium/high/critical actions. Safe, low and medium retain the declared
tool approval and narrow-grant behavior. High actions cannot receive session or
persistent grants. Critical actions are one-call-only and cannot receive either
kind of reusable grant. `browser_type` becomes critical when `submit: true`; the
renderer receives that computed risk and the main-process registry and broker
revalidate grant duration. This does not replace tool-specific scope checks.

- **High risk:** an operation asks unless an existing eligible once/session grant matches it. The UI exposes Always Allow, Allow Once and Deny; Always Allow is disabled when policy disallows it, and main-process validation rejects forged/ineligible decisions.
- **Always Allow:** allow-listed application launches (Notepad, Calculator, Paint), HTTPS navigation to the exact origin, and selected-window observation/passive guidance may persist. Screen grants are represented as a shared read-only grant scoped to exact process name and exact window title; HWND/PID are revalidated for every operation but are intentionally not persisted. UI invocation, typing, pointer input and application switching are excluded. All grants are versioned, independently revocable, and restored only after current-policy validation.
- **Once:** stored only in the main-process registry and consumed by the action path.
- **Stop:** emergency stop blocks future tool dispatch, revokes stored and active grants, rejects a pending prompt, cancels the current task and terminates controllable workers.

Approval cards identify the proposed action, target, risk and whether a lasting scoped grant is available. Selected-window observation/UIA discovery and passive guidance are medium-risk and require an initial user decision; `invoke_ui_element` is a high-risk state change, shows the exact foreground title, selector and expected accessible UI state, and is single-use. Current tools do not include external messaging, purchase, payment, elevated-command or production-infrastructure actions.

`analyze_screen`, `find_ui_elements`, `verify_ui_state`,
`screen_highlight_control` and `screen_draw_arrow` may reuse a user-approved
session grant for the same exact selected window. The grant is volatile and
does not include clicks, typing, UI invocation or application switching. A
highlight/arrow is guidance only. Read-only foreground window metadata is
low-risk and does not take a screenshot. The clear-annotations command only
removes Pixel's own temporary marks. Display and region capture requests are
correlated to exact display IDs; ambiguous or stale identity fails closed.
Captured images remain in memory in the screen service and are not persisted
to chat/task history by default.

Agent/Hybrid Board edits are registered medium-risk tools that run without a
prompt; Guide mode filters them because they change the Board. Board opening,
saving and exporting are approval-gated and require user-selected paths. This
does not implement a generalized four-tier decision engine: each tool still
uses its explicit risk, `changesState`, mode and approval settings. The desktop
guidance renderer remains passive/click-through; freehand desktop drawing and
coordinate-based pointer fallback are not exposed.

## Secret handling

The DeepSeek key is held by the main process and encrypted at rest with Electron `safeStorage`. File tools reject obvious credential/key filenames. Memory save and task persistence reject or redact common credential patterns. The task log does not store text passed to `type_text`/`browser_type`/`clipboard_copy` or the body passed to `file_write`. Clipboard reads are explicit and approval-gated; when used, the assistant answer is retained only in the current session rather than persistent conversation history. The task result contains a fixed non-content note.

There is no isolated secret broker for site logins. Pixel must not claim to fill a password without exposing it to model context. Skills reject common secret patterns, but this is not a credential vault. MFA, CAPTCHA, passkey and payment confirmation remain human tasks; there is no bypass flow.

## Desktop-control limit

`type_text` now uses `ValuePattern` on one unique, exact accessible control in a selected window. It rejects password and read-only controls, revalidates window/process identity immediately before the state change, and reads the value back inside the helper. The value itself is not returned to the renderer/model or task history. `invoke_ui_element` uses `InvokePattern`; `control_ui_element` supports SelectionItem, Toggle, Scroll and ExpandCollapse patterns. Each requires a selected window identity, checks that the control is enabled and visible, revalidates the same window/process before and after acting, and reads back the expected pattern state. These actions use the serialized `DesktopInputLease`; the lease is held while an interrupted helper is being killed and remains quarantined if process termination cannot be confirmed. There is no coordinate click, key injection or automatic window activation in this path.

**Verification limit:** the disposable WinForms fixture was enumerated and
The latest real fixture run passed ValuePattern read-back, InvokePattern,
postcondition verification and TogglePattern state read-back; the completed
task and evidence survived SQLite reload. Earlier runs had provider failures,
and the direct test runner exited zero only after a bounded cleanup fix
confirmed the helper and fixture had stopped. Pixel's visible approval flow
remains unverified. The tracked fixture result is in
[`PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md`](../validation/PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md).
Unit tests and native-helper compilation alone are not evidence of successful
desktop interaction. See the Windows acceptance procedure.

Cursor-follow mode moves the existing transparent companion window while collapsed. It is opt-in and uses global DIP coordinates plus display work-area clamping; passive click-through behavior and mixed-DPI transitions remain unverified until a normal desktop acceptance run.

## Security references

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Microsoft UI Automation overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview)
- Pixel implementation: `src/main/agent/tools.ts`, `runtime.ts`, `scope.ts`, `browser.ts`, `netGuard.ts`, `tasks/store.ts`, `services/nativeHelper.ts`, `native/PixelNative/PixelNative.cs`, `settings.ts`, `files/toolset.ts`, and `memory/toolset.ts`.
