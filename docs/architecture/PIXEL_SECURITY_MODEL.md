# Pixel security model

Updated: 2026-11-19 — Experience Polish 5.0 (adds bounded home-scoped file tools; retains Tools 4.2 controls).

## Trust boundaries

| Boundary | Rule in current code | Remaining limit |
| --- | --- | --- |
| Renderer to OS | Renderer calls an explicit preload API; the main process owns tools, settings, credentials and DB access. | Live Electron window behavior is not part of the automated test result. |
| Model to tool | Model output is a proposal. Zod validates the registered argument contract; main-process mode, stop and approval policy decides whether it can run. | Model reasoning itself is not trusted as policy. Some schema formats outside Pixel's supported subset fail closed. |
| Retrieved content to instruction | System prompt and document/file tool results label website/document/screenshot content as untrusted. | Prompt instructions alone cannot eliminate model influence; every consequential action still needs local policy and approval. |
| Approval response to request | Approval ids must match the pending request. Main-process policy independently validates Always Allow against an explicit tool/scope allow-list. High-risk and unsupported standing grants are rejected. | Real Electron approval-card interaction is not verified in this host. |
| Automatic memory | Deterministic extraction runs in the main process only on direct user text or verified task outcomes. Credentials, injection-like content and copied web/document instructions are filtered. | Extraction intentionally handles a narrow set of phrasing; arbitrary project milestones, source-attributed external facts, and global/cross-project preference features are not complete. |
| Persistent permissions | Always grants use SQLite migration 7 and include tool, canonical app/origin scope, risk, timestamps, revocation, and policy version. Startup revalidates grants; Settings can revoke one or all; emergency stop revokes grants. | Persistent grants are only available for allow-listed app launch and exact HTTPS origin navigation. |
| Browser to network | Only HTTP(S), public DNS destinations and allowed connected addresses are surfaced. Requests are checked, including redirects and subresources. | A DNS rebind can connect before the post-connect check rejects the page; an egress proxy is needed to prevent that network connection entirely. |
| Task state to disk | Zod validates snapshots; common credential patterns and sensitive argument fields are redacted; typed text and file-write bodies are not stored in task args. | SQLite task text is not application-layer encrypted, and redaction is pattern-based. Windows account/file permissions remain important. |
| Provider key | Electron `safeStorage` encrypts the DeepSeek key (DPAPI on Windows); if encryption is unavailable, Pixel refuses to persist it. The renderer never receives the plaintext key. | This is a provider API-key store, not a general-purpose credential vault. |
| Screen capture and guidance | Capture requires the existing explicit screen approval. Window IDs remain opaque in the renderer; native capture revalidates exact window/process identity. The visual overlay accepts a revalidated unique UIA control, remains passive/click-through, expires, and clears on stale target, lock or emergency stop. | Vision output is model interpretation. Native capture and the visible overlay have not passed target-laptop acceptance; current native integration fails before producing a screenshot in this host. |
| New everyday file operations | Experience Polish 5.0 search, metadata, directory creation, copy and rename are main-process tools in the existing registry. New paths are constrained to home scope; search is bounded and skips hidden, sensitive-name and symlink entries. Mutations avoid overwrite and verify destination postconditions. | No new clipboard read/write workflow was added. Real Pixel approval-card interaction and multi-step daily task UI remain unverified. |

## Approval behavior

- **High risk:** each operation asks again. The UI exposes Always Allow, Allow Once and Deny; Always Allow is disabled when policy disallows it, and main-process validation rejects forged/ineligible decisions.
- **Always Allow:** only allow-listed application launches (Notepad, Calculator, Paint) and HTTPS browser navigation to the exact origin can persist. Other tools cannot receive a standing grant. A grant binds exact tool identity and target scope, is versioned, independently revocable, and only restored after current-policy validation.
- **Once:** stored only in the main-process registry and consumed by the action path.
- **Stop:** emergency stop blocks future tool dispatch, revokes stored and active grants, rejects a pending prompt, cancels the current task and terminates controllable workers.

Approval cards identify the proposed action, target, risk and whether a lasting scoped grant is available. Native UIA reads require approval; `invoke_ui_element` is a high-risk state change, shows the exact foreground title, selector and expected accessible UI state, and is single-use. Current tools do not include external messaging, purchase, payment, elevated-command or production-infrastructure actions.

`analyze_screen`, `find_ui_elements` and `screen_highlight_control` use the
existing high-risk, per-request approval behavior. A highlight is observation
guidance only and cannot grant permission to invoke a control. The clear
annotations command only removes Pixel's own temporary marks and does not
require approval. Display and region capture requests are correlated to exact
display IDs; ambiguous or stale identity fails closed. Captured images remain
in memory in the screen service and are not persisted to chat/task history by
default.

## Secret handling

The DeepSeek key is held by the main process and encrypted at rest with Electron `safeStorage`. File tools reject obvious credential/key filenames. Memory save and task persistence reject or redact common credential patterns. The task log does not store text passed to `type_text`/`browser_type` or the body passed to `file_write`.

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
