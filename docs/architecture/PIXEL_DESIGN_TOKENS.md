# Pixel Workspace design system

Updated: 2026-11-23. Pixel uses a warm, near-black matte palette with muted
surfaces and Pixel orange (`#F28A43`) for restrained focus and primary actions.

Glassmorphism, frosted panels, large gradients, glowing borders, and decorative
neon are **strictly prohibited**. Orange guides focus rather than filling large
surfaces. Regression tests in `tests/monochrome-theme.test.ts` enforce the warm
palette, matte surfaces, and text contrast.

## Semantic palette

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--color-app-bg` | `#0C0B0A` | `#F6F2ED` | Main conversation canvas |
| `--color-sidebar` | `#11100F` | `#EFE8E0` | Unified navigation and recent chats |
| `--color-surface` | `#1B1816` | `#FFFFFF` | Opaque flat surfaces and composer |
| `--color-surface-raised` | `#211D1A` | `#FBF8F4` | Raised controls and inputs |
| `--color-hover` | `#28221E` | `#EEE5DC` | Hover state |
| `--color-selected` | `#30231B` | `#F6DCC7` | Selected navigation/chat row |
| `--color-border` | `#332B26` | `#D8CBBF` | Fine separators and hairlines |
| `--color-border-strong` | `#51443B` | `#B7A494` | Composer and emphasized boundary |
| `--color-popover` | `#191613` | `#FFFFFF` | Menus and dialogs |
| `--color-ink` | `#E9E4DD` | `#161B1A` | Primary text |
| `--color-ink-soft` | `#C9C1B8` | `#414947` | Secondary text |
| `--color-ink-dim` | `#96908A` | `#68716E` | Metadata and quiet labels (WCAG AA >= 4.5:1) |
| `--color-accent` | `#F28A43` | `#B85B20` | Focus, primary action, active cue |
| `--color-accent-hover` | `#FFA262` | `#964414` | Accent hover |
| `--color-accent-foreground` | `#1A100A` | `#FFFFFF` | Text/icons on accent |
| `--color-success` | `#79B58A` | `#39794C` | Verified success |
| `--color-warning` | `#D96A2B` | `#9A4E24` | Approval and caution |
| `--color-destructive` | `#D56D61` | `#A3443A` | Error and destructive action |

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
- **Pix ambient motion:** `AsciiSharkBackground` uses small abstract glyph
  clusters behind chat. It transitions to lower contrast during conversation,
  does not render shark artwork, is pointer-inert, and honors reduced motion.
