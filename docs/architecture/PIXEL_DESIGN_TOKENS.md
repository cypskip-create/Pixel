# Pixel Workspace design system

Updated: 2026-11-23. Pixel uses a restrained, near-black matte dark palette with
neutral charcoal selection states and Pixel's restored blue (`#4299F5`) for
functional control states (toggles, radios, checkboxes, focus rings, and active
primary actions).

Orange primary accents, glowing selection strips, colored borders on selected
items, heavy card nesting, neon outlines, glassmorphism, and large gradients are
**strictly prohibited** and guarded by automated regression tests in
`tests/monochrome-theme.test.ts`.

## Semantic palette

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--color-app-bg` | `#0D0E10` | `#F5F6F8` | Main conversation canvas |
| `--color-sidebar` | `#111214` | `#ECEEF2` | Unified navigation & recent chats sidebar |
| `--color-surface` | `#181A1E` | `#FFFFFF` | Opaque flat surfaces & composer |
| `--color-surface-raised` | `#202328` | `#F8F9FB` | Raised controls and inputs |
| `--color-hover` | `#24272D` | `#E4E7EE` | Hover state |
| `--color-selected` | `#282C33` | `#DCE1EB` | Subtle charcoal selected nav/chat row (no edge strip) |
| `--color-border` | `#25282E` | `#D4D8E1` | Fine separators and hairlines |
| `--color-border-strong` | `#373C45` | `#AEB6C4` | Composer and emphasized boundary |
| `--color-popover` | `#16181C` | `#FFFFFF` | Menus and dialogs |
| `--color-ink` | `#ECEEF2` | `#16181D` | Primary text |
| `--color-ink-soft` | `#C2C7D0` | `#3D434F` | Secondary text |
| `--color-ink-dim` | `#9299A6` | `#636B7A` | Metadata and quiet labels (WCAG AA >= 4.5:1) |
| `--color-accent` | `#4299F5` | `#1D70C9` | Functional controls, focus rings, send action |
| `--color-accent-hover` | `#60A9FA` | `#185EA9` | Accent hover |
| `--color-accent-foreground` | `#09131F` | `#FFFFFF` | Text/icons on accent |
| `--color-success` | `#5FB382` | `#2F7D52` | Verified success |
| `--color-warning` | `#D5A353` | `#9A6B1E` | Approval and caution |
| `--color-destructive` | `#E06C65` | `#B8423C` | Error and destructive action |

Pix keeps its approved silver-and-mint character artwork (`--pix-*` tokens).

## Workspace & Settings hierarchy

- **Title bar:** Pixel blue mark + `PIXEL` wordmark on left; Windows controls on
  right in exact native order: **Minimize → Maximize/Restore → Close**.
- **Single consolidated sidebar (`240px`, collapsible to `58px`):**
  `+ New Chat`, `Projects`, `Library`, `Pixel Board`, `Running Tasks`,
  `Recent Chats` (with search, rename, delete confirmation, scrollable history),
  and bottom-pinned `Settings`.
- **Flat 11-category Settings:** General, AI & Models, Agent & Permissions,
  Voice, Memory, Tools, Plugins & Connections, Skills & Routines, Appearance,
  Workspace, and Advanced. Active Settings nav uses subtle charcoal fill only.
- **Ambient ASCII Sharks:** `AsciiSharkBackground` renders subdued blue-gray
  anatomical ASCII sharks behind empty chats and smoothly transitions to a
  quieter background mode behind active conversations without interfering with
  text readability or pointer events.
