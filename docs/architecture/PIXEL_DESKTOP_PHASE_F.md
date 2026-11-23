# Pixel Phase F — Electron Desktop Hardening, Pixel Board & UX Polish

**Status:** Implemented & Verified Locally (on top of `40f078b`)  
**Design Contract:** [PIXEL_DESKTOP_EXPERIENCE.md](../design/PIXEL_DESKTOP_EXPERIENCE.md)  
**Security Companion:** [PIXEL_IPC_SECURITY.md](./PIXEL_IPC_SECURITY.md)

---

## 1. Electron Window Security Hardening (`src/main/windowPolicy.ts`, `window.ts`, `app.ts`)

Every `BrowserWindow` in Pixel now receives a uniform, testable security policy via `attachWindowSecurityPolicy`:

| Window Role | File | External Links | Popups / Webviews / Untrusted Nav | Session Permissions |
| :--- | :--- | :--- | :--- | :--- |
| `main` (Companion) | `src/main/window.ts` | Validated `https:`/`http:` only | Blocked (`deny` / `preventDefault`) | `media` + `clipboard-sanitized-write` on trusted origin only |
| `workspace` | `src/main/window.ts` | Validated `https:`/`http:` only | Blocked | `media` + `clipboard-sanitized-write` on trusted origin only |
| `settings` | `src/main/window.ts` | Validated `https:`/`http:` only | Blocked | `media` + `clipboard-sanitized-write` on trusted origin only |
| `cursor` (Overlay) | `src/main/window.ts` | Denied | Blocked | Denied |
| `guidance` (Overlay) | `src/main/window.ts` | Denied | Blocked | Denied |
| `diagnostic` | `src/main/app.ts` | Denied | Blocked | Denied |

- `validateExternalUrl` rejects `javascript:`, `data:`, `file:`, `vbscript:`, `ms-msdt:`, credentialed URLs, and control characters before `shell.openExternal`.
- `isTrustedRendererUrl` + `isSafeDevServerUrl` restrict dev mode strictly to `http://127.0.0.1` / `http://localhost` / `http://[::1]` and production strictly to the resolved `rendererIndexPath` file URL.
- All 6 windows enforce `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, plus a global `app.on('web-contents-created')` defense-in-depth hook in `src/main/app.ts`.

---

## 2. Pixel Board Expansion (`drawingBoard.ts`, `service.ts`, `PixelBoard.tsx`)

All new Board features flow through the trusted main-process `PixelBoardService` with atomic revisions, undo/redo, and 100% backwards-compatibility with existing v1 `.pixelboard` files:

- **Multi-Selection & Group Move:** Shift-click toggle, click-and-drag marquee selection rectangle (`objectIntersectsRect`), `Ctrl+A` select all, `Escape` clear, and atomic multi-object movement.
- **Alignment & Grid Snapping:** Optional `20px` grid snapping (`snapPointToGrid` + subtle grid overlay, never interfering with freehand pen/highlighter) and atomic alignment/distribution (`left`, `center-x`, `right`, `top`, `center-y`, `bottom`, `distribute-x`, `distribute-y` via `buildAlignmentOperations`).
- **Linked Connectors (`kind: 'connector'`):** Objects store `fromId`, `toId`, and `arrowHead`. Moving any linked object automatically re-anchors connected endpoints inside `PixelBoardService.apply('move')`; deleting a linked object detaches dangling references cleanly; `boardSvg` exports connectors with accurate directional arrowheads.
- **Keyboard Shortcuts & Zoom:** `Ctrl+A`, `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Delete`/`Backspace`, `Ctrl+Z`, `Ctrl+Y`/`Ctrl+Shift+Z`, `Escape`, `Arrow`/`Shift+Arrow` nudge — all guarded by `isEditableElement(...)` so typing in title/inputs never triggers canvas shortcuts. Zoom controls (`75%`–`200%` + reset `100%`).

---

## 3. Workspace, Settings, Accessibility & Tactile Polish

- Added `Escape`-to-close keyboard handling for the Task Details drawer and mode confirmation dialog in `Workspace.tsx`.
- Unified layered elevation (`--shadow-surface`, `--shadow-floating`) and tactile transitions (`--ease-tactile`, `--duration-press`, `--duration-ui`, reduced-motion compliant) across Running Tasks cards, Plugin/Tool cards, confirmation dialogs, and Pixel Board toolbar buttons while preserving Pixel's matte charcoal + `#4299F5` blue palette (`tests/monochrome-theme.test.ts` 7/7 PASS).

---

## 4. Rollback Procedure

- Window hardening is additive in `src/main/windowPolicy.ts` and `window.ts` / `app.ts`.
- IPC domain routers preserve every existing `CHANNELS` identifier and `CypsBridge` contract.
- Pixel Board's new `connector` kind and optional `fromId`/`toId`/`arrowHead` fields are additive to `version: 1` documents; all existing `.pixelboard` files remain readable without migration.
