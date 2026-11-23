# Pixel Desktop Experience Specification

**Status:** Permanent Product-Quality Contract (Applies to Phases A–G and all future UI work)  
**Design Direction:** Approved Pixel Matte Charcoal + Restrained Blue (`#4299F5`)  
**Quality Benchmark:** Hermes Agent Desktop (`apps/desktop/DESIGN.md`) — materiality, density, tactile feedback, and live agent visibility adapted into Pixel's own design language.

---

## 1. Purpose and Identity Guardrails

Pixel must feel **"thick"** — solid, physically grounded, deliberately proportioned, and immediately responsive like a native Windows desktop application rather than a thin web page.

This specification translates that quality into concrete, repeatable rules while **preserving Pixel's own identity**:

- **Keep Pixel's approved identity:** Near-black matte surfaces (`#0D0E10` canvas, `#111214` sidebar, `#181A1E` surface, `#202328` raised surface), neutral charcoal selection (`#282C33`), restrained blue (`#4299F5`) functional accents, the Pix mascot, subtle ASCII sharks in the conversation canvas, and the flat 11-category Settings architecture.
- **Do not copy Hermes' layout or branding:** No third-party palettes, no neon/glow effects, no orange accents, no colored selection-edge strips, and no card-inside-card nesting.
- **Tokens, never literals:** Every renderer component and stylesheet must reference semantic CSS custom properties (`var(--color-*)`, `var(--shadow-*)`, `var(--control-h-*)`, `var(--duration-*)`). Raw Tailwind chromatic utility classes (`sky-`, `blue-`, `rose-`, etc.) and unapproved hex literals are strictly prohibited (enforced by `tests/monochrome-theme.test.ts`).

---

## 2. Surface Materiality & Elevation Architecture

Visual weight comes from clear, quiet luminance separation paired with crisp 1px hairlines and layered downward-weighted contact-to-ambient shadows — never heavy outer borders or glowing boxes.

| Layer | Purpose | Surface Token | Elevation / Edge Treatment |
| :--- | :--- | :--- | :--- |
| **L0 — Canvas** | Main conversation background & workspace canvas | `--color-app-bg` (`#0D0E10` / `#F5F6F8`) | Matte base, zero shadow |
| **L1 — Structural Chrome** | Titlebar, sidebar, status strip, flat section containers | `--color-sidebar` (`#111214` / `#ECEEF2`) | 1px `--color-border` structural hairline |
| **L2 — Interactive Surface** | Docked composer, input fields, inline activity pill, cards | `--color-surface` (`#181A1E` / `#FFFFFF`) | 1px `--color-border-strong` + `--shadow-composer` + `--highlight-top-edge` |
| **L3 — Raised Control** | Buttons, active badges, table headers, segmented controls | `--color-surface-raised` (`#202328` / `#F8F9FB`) | `--shadow-surface` + crisp hover/press shift |
| **L4 — Floating Overlay** | Context menus, popovers, dropdowns, confirmation dialogs | `--color-popover` (`#16181C` / `#FFFFFF`) | 1px `--color-border-strong` + `--shadow-floating` / `--shadow-popover` |

### Top-Edge Micro-Highlight
In dark mode, raised interactive surfaces (composer, primary buttons, floating popovers) receive a subtle `1px` top-edge inner highlight (`--highlight-top-edge: inset 0 1px 0 rgb(255 255 255 / 0.045)`) to create physical thickness without glare. In light mode, it softens to `inset 0 1px 0 rgb(255 255 255 / 0.7)`.

---

## 3. Spatial Density, Control Heights & Typography

### Control Height Scale
Standardized heights prevent ragged toolbars and give every interactive element predictable physical presence:

- `--control-h-sm: 28px` — compact inline toggles, popover menu items, status strip controls.
- `--control-h-md: 34px` — sidebar navigation rows, primary action buttons, search inputs, selects.
- `--control-h-lg: 40px` — titlebar, composer footer, prominent primary call-to-action controls.

### Typography Scale (`Segoe UI Variable Text`, `Segoe UI`, `system-ui`)
- **Workspace / Chat Title:** `14px`, weight `620`, tight tracking.
- **Conversation Body:** `13px`, line-height `1.65`, max readable width `800px`.
- **Sidebar / Navigation Row:** `12px`, weight `500`, `33px–34px` row height.
- **Metadata / Timestamps / Status Strip:** `10.5px`–`11px`, tabular numerals where counts appear, WCAG AA contrast (`>= 4.5:1`) maintained against raised dark surfaces.
- **Section Eyebrow:** `9.5px`–`10px`, uppercase, `0.09em`–`0.14em` tracking, `--color-ink-dim`.

---

## 4. Tactile Interaction & Motion Rules

Motion must confirm user intent without slowing down fast desktop workflows:

- **Easing:** `--ease-tactile: cubic-bezier(0.2, 0, 0, 1)` (fast deceleration, zero bounce).
- **Press Feedback:** `--duration-press: 90ms` — clickable buttons and controls give immediate physical feedback (`translateY(0.5px)` on `:active:not(:disabled)` when reduced motion is off).
- **UI State Transitions:** `--duration-ui: 150ms` — background, border-color, color, and box-shadow transitions on hover, focus, and selection.
- **Reduced Motion Compliance:** When `.reduce-motion` is active or `prefers-reduced-motion: reduce` is set, `--duration-press`, `--duration-ui`, and `--cyps-duration-*` collapse to `0ms` and active transforms are disabled.

---

## 5. Chat Composer Presence & Ambient Canvas

- **Composer Materiality:** The docked chat composer (`.workspace-composer`) anchors the bottom of the conversation column with `--shadow-composer`, `--highlight-top-edge`, and a crisp focus-within border transition to `--color-accent` paired with a restrained 1px focus halo (`color-mix(in srgb, var(--color-accent) 18%, transparent)`).
- **ASCII Shark Canvas:** Stays subtle and strictly subordinate to conversation text (`z-index: 0`, `pointer-events: none`), softening automatically during active conversation so readability is never compromised.
- **Pix Mascot:** Remains above the composer right edge, reflecting live `AssistantState` without obstructing input or transcript scrolling.

---

## 6. Visible Live Agent Activity & Runtime Status

A desktop AI companion must never look frozen while reasoning, calling tools, or waiting on external services. Every status indicator MUST be derived strictly from real runtime state (`TaskRecord`, `TaskStep`, streaming state, settings) — **never fabricated or simulated**.

### Inline Expandable Activity Pill (`AgentActivityBar`)
Positioned directly above the composer when the agent is streaming, thinking, or executing a real `TaskRecord`:

- **Single-line compact summary** by default: live status indicator dot + honest human-readable activity label + step progress counter (e.g., `2/4 steps`) + expand/collapse chevron.
- **Expandable step disclosure** on click: reveals the real `TaskStep` list with tool names, states (`Waiting`, `Running`, `Action ran`, `Verified`, `Failed`, `Skipped`), and optional details, plus a direct `Task details` action when a `TaskRecord` is active.
- **Honest Tool-to-Activity Mapping:**
  - `session_search`, `memory_*` → **Searching memory**
  - `file_read`, `file_list`, `file_search*` → **Reading files**
  - `file_patch`, `file_write` → **Editing files**
  - `git_*` → **Running Git**
  - `github_*` → **Calling GitHub**
  - `gcal_*` → **Checking Google Calendar**
  - `mcp.*` → **Calling MCP tool**
  - `skills_list`, `skill_view`, `skill_manage` → **Loading playbook**
  - `web_search`, `web_fetch` → **Searching the web**
  - `awaiting_approval` task status → **Awaiting approval**
  - Streaming with no active tool step → **Thinking** (before tokens) / **Writing response** (once tokens arrive)

### Quiet Native-Desktop Status Strip
A compact `26px` footer strip at the bottom of the workspace shell surfacing real operational context at a glance:

- **Runtime Engine:** `Python v2` (`python`) or `TypeScript` (`typescript`) from `settings.agent?.runtimeEngine`.
- **Active Model:** `settings.provider.primaryModel` (or `Model unset`).
- **Active Project:** Current project name when non-default.
- **Live Counts:** Active running tasks count (when `> 0`) and enabled MCP/plugin count when present.

---

## 7. Phase-by-Phase User-Visible Experience Checklist

Every major phase must leave a verifiable, user-visible result in Pixel's desktop experience:

| Phase | User-Visible Desktop Result |
| :--- | :--- |
| **Phase A — Python Agent Engine** | Runtime engine visible in status strip (`Python v2` / `TypeScript`), live streaming tokens, immediate cancel button, graceful fallback notice on crash. |
| **Phase B — Git, Files & GitHub** | Real tool activity labels (`Reading files`, `Editing files`, `Running Git`, `Calling GitHub`), diff/patch transparency, approval prompts before destructive or push actions. |
| **Phase C — Memory, Search & Skills** | `Searching memory` and `Loading playbook` activity labels, inspectable Memory & Procedural Skills management in Settings, immediate correction refresh. |
| **Phase D — Plugins & MCP** | `Calling MCP tool` and `Checking Google Calendar` activity labels, Connections & MCP Servers management in Plugins settings with live status and security preflight feedback. |
| **Phase E–G — Future Phases** | All new desktop panels, voice/vision/browser controls, and automations MUST inherit the elevation, control-height, tactile-motion, and honest-activity contracts above. |
