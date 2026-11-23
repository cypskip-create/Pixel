# Hermes → Pixel Source-to-Target Integration Map

**Hermes Reference Checkout (Outside Pixel):** `C:\dev\pixel-research\hermes-agent` (`352b249f67fb6a4a7d7904acaca9dd410db229e0`)  
**Policy:** File-by-file functional integration directly into Pixel's existing modules — zero nested Hermes trees, enforced by `scripts/check-no-bulk-import.mjs`.

| Stage | Hermes Source Reference | Pixel Target Module(s) | Status | Verification |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1A — Delegation Limits** | `tools/delegate_tool_config.py` (`max_iterations`, `child_timeout_seconds`, `max_concurrent_children`) | `src/shared/types.ts`, `src/main/agents/coordinator.ts`, `src/renderer/components/SettingsPanel.tsx` | **Implemented and tested** | `tests/hermes-stage1-runtime-display-parity.test.ts`, `tests/phase-g-settings-parity.test.ts` |
| **Stage 1A — Memory Budgets** | `agent/memory_manager.py` (`memory_char_limit`, `user_char_limit`) | `src/shared/types.ts`, `src/main/memory/snapshot.ts`, `src/renderer/components/SettingsPanel.tsx` | **Implemented and tested** | `tests/hermes-stage1-runtime-display-parity.test.ts` |
| **Stage 1A — Compression & Retries** | `agent/context_compressor.py` (`enabled`, `threshold`, `protect_last_n`, `api_max_retries`, `timezone`) | `src/shared/types.ts`, `python/pixel_agent/compressor.py`, `src/renderer/components/SettingsPanel.tsx` | **Implemented and tested** | `tests/hermes-stage1-runtime-display-parity.test.ts`, `python/tests/test_pixel_agent.py` |
| **Stage 1B — Display & Typography** | `apps/desktop/src/app/settings/settings-manifest.ts` (`uiScale`, `chatTextScale`, `sessionDensity`, `reasoningCollapsed`, `hideCodeDiffs`, `muteSounds`) | `src/shared/types.ts`, `src/renderer/Workspace.tsx`, `src/renderer/workspace-design-system.css`, `src/renderer/components/SettingsPanel.tsx` | **Implemented and tested** | `tests/hermes-stage1-runtime-display-parity.test.ts`, `tests/monochrome-theme.test.ts` |
| **Stage 2 — Multi-Provider Hub** | `providers/`, `hermes_cli/fallback_config.py`, `apps/desktop/src/app/settings/custom-endpoints-settings.tsx` | `src/main/providers/`, `python/pixel_agent/providers.py`, `src/renderer/components/SettingsPanel.tsx` | **Missing (Next)** | Planned |
| **Stage 3 — Hermes Workspace Layout** | `apps/desktop/src/app/chat/`, `apps/desktop/src/app/shell/` (tabs, split panes, command palette, file browser) | `src/renderer/Workspace.tsx`, `src/renderer/components/` | **Missing** | Planned |
