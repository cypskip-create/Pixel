# Pixel security model

## Trust boundaries

| Boundary | Rule in current code | Remaining limit |
| --- | --- | --- |
| Renderer to OS | Renderer calls an explicit preload API; the main process owns tools, settings, credentials and DB access. | Live Electron window behavior is not part of the automated test result. |
| Model to tool | Model output is a proposal. Zod validates the registered argument contract; main-process mode, stop and approval policy decides whether it can run. | Model reasoning itself is not trusted as policy. Some schema formats outside Pixel's supported subset fail closed. |
| Retrieved content to instruction | System prompt and document/file tool results label website/document/screenshot content as untrusted. | Prompt instructions alone cannot eliminate model influence; every consequential action still needs local policy and approval. |
| Approval response to request | Approval ids must match the pending request. High-risk standing grants are downgraded to single use. Medium-or-lower persistent grants need a narrow target. | Grants are in-memory and expire on restart; there is no central permission review page. |
| Browser to network | Only HTTP(S), public DNS destinations and allowed connected addresses are surfaced. Requests are checked, including redirects and subresources. | A DNS rebind can connect before the post-connect check rejects the page; an egress proxy is needed to prevent that network connection entirely. |
| Task state to disk | Zod validates snapshots; common credential patterns and sensitive argument fields are redacted; typed text and file-write bodies are not stored in task args. | SQLite task text is not application-layer encrypted, and redaction is pattern-based. Windows account/file permissions remain important. |
| Provider key | Electron `safeStorage` encrypts the DeepSeek key (DPAPI on Windows); if encryption is unavailable, Pixel refuses to persist it. The renderer never receives the plaintext key. | This is a provider API-key store, not a general-purpose credential vault. |

## Approval behavior

- **High risk:** each operation asks again; the current registry downgrades non-once grants.
- **Medium or lower:** a session/always grant is retained only when the operation derives a supported narrow scope. Current scopes are browser navigation origin, application name and document-index directory. Untargeted standing permissions become one-shot.
- **Once:** stored only in the main-process registry and consumed by the action path.
- **Stop:** emergency stop blocks future tool dispatch, revokes grants, rejects a pending prompt, cancels the current task and terminates controllable workers.

Approval cards identify the proposed action, target, risk and whether a lasting scoped grant is available. Native UIA reads require approval; `invoke_ui_element` is a high-risk state change, shows the exact foreground title, selector and expected accessible UI state, and is single-use. Current tools do not include external messaging, purchase, payment, elevated-command or production-infrastructure actions.

## Secret handling

The DeepSeek key is held by the main process and encrypted at rest with Electron `safeStorage`. File tools reject obvious credential/key filenames. Memory save and task persistence reject or redact common credential patterns. The task log does not store text passed to `type_text`/`browser_type` or the body passed to `file_write`.

There is no isolated secret broker for site logins. Pixel must not claim to fill a password without exposing it to model context. Skills reject common secret patterns, but this is not a credential vault. MFA, CAPTCHA, passkey and payment confirmation remain human tasks; there is no bypass flow.

## Desktop-control limit

`type_text` sends approved text to the Windows foreground application using `SendKeys`. The approval request names an exact expected window title, and the child process rechecks that title immediately before sending keys; user focus may still race after that final check. The main-process `DesktopInputLease` serializes text entry and native UIA invocation. `invoke_ui_element` uses the C# helper to search the foreground accessibility tree, requires a unique exact name/AutomationId match, checks that the control is enabled and visible, confirms the requested present/absent postcondition was false before activation, rechecks the approved window title, and calls only `InvokePattern`. `verify_ui_state` later checks the exact visible-control state in that same titled foreground window; incomplete trees and mismatched titles do not count as verification. This does not verify values, newly titled windows or inaccessible controls. No raw coordinate action or accessible form-value setter is exposed. No real application control was invoked here.

Cursor-follow mode moves the existing transparent companion window while collapsed. It is opt-in and uses global DIP coordinates plus display work-area clamping; passive click-through behavior and mixed-DPI transitions remain unverified until a normal desktop acceptance run.

## Security references

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Microsoft UI Automation overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview)
- Pixel implementation: `src/main/agent/tools.ts`, `runtime.ts`, `scope.ts`, `browser.ts`, `netGuard.ts`, `tasks/store.ts`, `services/nativeHelper.ts`, `native/PixelNative/PixelNative.cs`, `settings.ts`, `files/toolset.ts`, and `memory/toolset.ts`.
