# Pixel Core Tools 6.0 capability audit

> **Snapshot note (2026-11-20):** this matrix records the Core Tools 6.0
> implementation snapshot, not the current 6.1 review. For the latest main
> SHA, Windows Actions failure analysis, Settings navigation repair, local
> validation totals, voice-runtime boundary and open-source/license research,
> see [PROGRESS.md](../../PROGRESS.md), [WAVE_HANDOFF.md](../../WAVE_HANDOFF.md)
> and [Core Tools 6.1 research](../research/PIXEL_CORE_TOOLS_6_1_RESEARCH.md).
> The 6.1 repair is still local and has not been exercised by hosted CI or real
> Pixel GUI acceptance.

Audit date: 2026-11-20. Source base reviewed: `d538c1044c9f6c4a0e7edc8073877436cae8dc4f`.
Local changes are uncommitted. This audit distinguishes code coverage from real Windows acceptance.

## Capability matrix

| Capability | Status | Implemented path and evidence | Remaining gap |
|---|---|---|---|
| Pix placement | Working in code; UI not Windows-tested | Workspace composer owns the single full-size Workspace Pix; transcript, header, and empty state no longer render it. Dynamic Island keeps its independent Pix. Component and transcript tests cover placement. | Confirm actual counts and layout in the running Windows app. |
| Pix idle behavior | Partial; UI not Windows-tested | Event-driven, one-sequence-at-a-time idle scheduler; looking, sitting, lying, sleeping, waking, stretching, walking, exploring, ball play, jump, wave, thought, and rest states; pointer/keyboard/focus wake; visibility and reduced-motion cleanup. | No timing/performance measurements on Windows; no injected clock for end-to-end accelerated sleep/wake lifecycle yet. |
| Pix assistant-state priority | Working in code; UI not Windows-tested | Shared `deriveAssistantState` drives Workspace and Island. Priority now follows emergency stop, error, approval, listening, speaking, execution, pointing, transcription/model response, verified task outcome, then idle. | Confirm real microphone, tool, TTS, approval and stop transitions visually on Windows. |
| Screen observation and UIA | Partial; Windows runtime unverified here | `analyze_screen`, foreground/external-window observation, `find_ui_elements`, `verify_ui_state`, approved UIA invoke/control and passive UIA guidance are registered and dispatched. Native helper validates window/process identity. | No screenshot freshness metadata, arbitrary region capture/tool, full control hierarchy, physical pointer/keyboard fallback, or live Windows acceptance in this run. |
| Browser automation | Working in code; dependency conditional | Playwright-backed navigate, inspect, click, type, scroll, screenshot and verify tools; network guard and bounded operations; capability is checked when browser use starts. | Chromium/runtime not health-probed by the Tools page; no current cross-site submission classification and no Windows browser workflow run here. |
| Pixel Board agent tools | Working in code; Windows/model acceptance unverified | Main-process revisioned Board service; 15 Board schemas share model registry/dispatcher; grouped diagram creation, object editing, undo/redo, open/save and SVG export. Existing service/agent tests exercise the path. | Agent export is limited to `.pixelboard`/SVG; no PDF, screenshot assets, advanced object grouping/layering, or real DeepSeek-generated Board workflow evidence in this run. |
| Files and folders | Working in code; path-scoped | Eight registered operations: list, read, search, metadata, write, create directory, copy, rename/move. User-home containment, symlink and credential-name rejection, overwrite controls and postcondition checks have tests. | No open file/folder action, date/size query, batch preview/operations, duplicate scan, Recycle Bin restore, or multi-folder grants. Rename/move is a single file operation. |
| Document assistance | Partial; runtime conditional | Python-backed indexing and project-scoped document list/search with source paths. The Tools catalog reports missing Python runtime for indexing. | No direct extraction/read tool, document creation/edit/export pipeline, provenance-linked summary workflow, or Windows extraction acceptance in this run. |
| Clipboard | Missing | No clipboard tool is registered. | No explicit read/copy/paste, target validation, clipboard restore or approval flow. |
| System diagnostics | Partial | Read-only CPU, memory, uptime, disk and display diagnostics exist; battery is nullable. | No running-app list, selected-process resource details, network adapter/connectivity, audio devices, startup diagnostics, or bounded settings tools. |
| Workflow/routine automation | Partial | Workflow persistence/replay utilities, skills, routine storage and local scheduling exist. | No explicit live semantic recorder/review flow integrated into normal tasks; no built-in replay pause/resume/human takeover UI; schedules run only while Pixel is running. |
| Specialists | Partial | In-process coordinator enforces allowlists, step/token/time ceilings and structured outcomes. Research/browser/systems/knowledge have bounded tool sets. | Coordinator is not invoked from the live conversation/tool loop; infrastructure and Pixel Code are intentionally unavailable. No model delegation acceptance test. |
| Permissions and modes | Partial | Guide blocks state-changing tools; once/session/eligible persistent grants, scope matching, emergency stop and auditing exist. Screen session grants bind to exact selected window identity. | No complete four-tier risk policy or `critical` risk type; high-risk actions require explicit approval, and persistent grants remain allow-listed. Broader routine Agent auto-approval is not implemented. |
| Desktop annotation | Partial | Passive desktop rectangle/circle/arrow guidance uses verified UIA bounds and click-through overlay. | No freehand/editor interaction mode, save/export, text annotations, screenshot-to-Board transfer, or arbitrary vision-inferred coordinates. |

## Current registered tool families

`get_system_info`, `get_current_time`, `request_human_takeover`; screen/window/UIA tools (`analyze_screen`, `get_foreground_window`, `get_last_external_foreground_window`, `list_external_windows`, `find_ui_elements`, `screen_highlight_control`, `screen_draw_arrow`, `screen_clear_annotations`, `verify_ui_state`); computer control (`invoke_ui_element`, `control_ui_element`, `type_text`, `open_application`); browser tools (`browser_navigate`, `browser_open_search`, `browser_inspect`, `browser_click`, `browser_type`, `browser_scroll`, `browser_screenshot`, `browser_verify`); memory tools; document index/search/list; file tools; and Pixel Board tools.

The Tools page now groups registered tools by user-facing capability and identifies approval/state-change behavior. It reports the UIA helper’s current availability, Python document-index dependency status, and that Chromium is checked when first used. “Registered” is not presented as proof of Windows runtime success.

## Verification boundary

The user-provided Windows Actions run `44603748589` failed while provisioning NSIS after Chocolatey’s package feed returned HTTP 503; `makensis` was consequently absent. The workflow now checks common runner install paths, retries Chocolatey three times with bounded backoff, and uses the official NSIS 3.11 installer only after a pinned SHA-256 check. This fallback has **not** run in GitHub Actions yet. No current local change is CI-verified.

The local test sandbox blocks tests that create their temporary home under the real profile. The full Vitest run must use an isolated `USERPROFILE` under the repository. Windows GUI launch, packaged installer, real UIA actions, microphone/TTS, screenshots, and the end-to-end acceptance cases remain unverified unless separately recorded in the current progress section.
