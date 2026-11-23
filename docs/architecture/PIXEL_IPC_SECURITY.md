# Pixel Phase F — IPC Architecture & Trust Boundaries

**Status:** Implemented & Verified Locally (on top of `40f078b`)  
**Primary Modules:**
- `src/main/ipc/registry.ts` — `IpcHandlerRegistry`
- `src/main/ipc/plugins.ts` — Bundled plugins, GitHub PAT auth, MCP servers, Google Calendar OAuth status/disconnect
- `src/main/ipc/skills.ts` — Procedural `SKILL.md` playbooks & scheduled routines
- `src/main/ipc/audit.ts` — Audit log & tool catalog availability
- `src/main/ipc.ts` — Top-level composition root, chat/agent/voice/window handlers, and lifecycle disposal

---

## 1. Security Trust Model

1. **Unique Handler Ownership (`IpcHandlerRegistry`):**
   - Tracks every registered channel in a `Set<string>` and throws immediately on duplicate registration so no handler can silently shadow another.
   - Wraps every handler with `isTrustedSender(event)` (`windows.isTrustedApplicationSender(event.sender, event.senderFrame)`), refusing untrusted frames before handler code executes.
   - Passive cursor channels (`isCursorIpcChannelAllowed`) remain restricted to the minimal 2-channel allowlist (`window:cursorRendererReady`, `window:cursorSettingsGet`).
2. **Clean Lifecycle Disposal:**
   - `ipcRegistry.dispose()` removes every registered `ipcMain` handler cleanly during `shutdown()`.
3. **Zero Contract Breakage:**
   - Every `CHANNELS` identifier, `CypsBridge` signature, preload binding, and runtime argument validator is preserved identically.
   - Privileged operations (DPAPI secrets, `PermissionBroker`, `McpServerManager`, `PixelBoardService`, `TaskManager`, `LocalRoutineScheduler`, Python `pixel-agent-v2`) remain strictly inside the Electron main process.
