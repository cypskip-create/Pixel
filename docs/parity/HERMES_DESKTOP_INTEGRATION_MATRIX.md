# Hermes Desktop UI Integration Matrix

**Reference Commit:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (`C:\dev\pixel-research\hermes-agent\apps\desktop\src\app\`)

| Hermes Desktop Surface | Pixel Target | Status | Test / Visual Evidence |
| :--- | :--- | :--- | :--- |
| **Chat Composer & Streaming** | `src/renderer/components/WorkspaceComposer.tsx`, `Workspace.tsx` | **Implemented, live verification pending** | `tests/workspace-components.test.tsx`, `tests/monochrome-theme.test.ts` |
| **Inline Expandable Tool Activity Pill** | `src/renderer/components/AgentActivityBar.tsx` | **Implemented and tested** | `tests/agent-activity-bar.test.tsx` |
| **Bottom Runtime Status Strip** | `src/renderer/Workspace.tsx` (`.workspace-status-strip`) | **Implemented and tested** | `tests/workspace-components.test.tsx` |
| **Running Tasks & Delegation Hierarchy** | `src/renderer/components/WorkspaceTasks.tsx` | **Implemented and tested** | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` |
| **Display Scale, Chat Scale, Density & Reasoning/Diff Toggles** | `src/renderer/Workspace.tsx`, `SettingsPanel.tsx`, `workspace-design-system.css` | **Implemented and tested** | `tests/hermes-stage1-runtime-display-parity.test.ts` |
| **Plugins, GitHub, MCP & Google Calendar Settings** | `src/renderer/components/WorkspacePluginManager.tsx` | **Implemented and tested** | `tests/phase-d-mcp-plugins.test.ts` |
| **Session Tabs, Interactive Split Panes & Command Palette** | `src/renderer/Workspace.tsx`, `src/renderer/lib/sessionSlices.ts`, `src/renderer/hooks/useSessionManager.ts`, `workspaceTabs.ts`, `workspaceLayout.ts`, `WorkspaceTabBar.tsx`, `CommandPalette.tsx`, `ModelPickerPopover.tsx` | **Implemented and tested** (true per-session stream isolation + interactive Pane B composer; live GUI visual check pending host Electron `0x80000003`) | `tests/hermes-stage3-workspace.test.tsx`, `tests/hermes-stage3-stage4-functional.test.ts`, `tests/monochrome-theme.test.ts` |
| **Right-Side Live Filesystem Browser, Preview & Real Terminal Backend** | `src/main/services/workspaceFs.ts`, `src/main/services/terminalService.ts`, `src/renderer/components/WorkspaceRightRail.tsx`, `src/renderer/Workspace.tsx` | **Implemented and tested** (path-jailed live FS tree + real process stdout/stderr streaming, exit codes, cancel & Emergency Stop; interactive ConPTY resize deferred to Stage 5) | `tests/hermes-stage3-stage4-functional.test.ts`, `tests/hermes-stage3-workspace.test.tsx` |
| **Command Center, Capabilities, Messaging, Artifacts & Profiles Views** | `src/renderer/Workspace.tsx` | **Missing (Stage 9)** | — |
