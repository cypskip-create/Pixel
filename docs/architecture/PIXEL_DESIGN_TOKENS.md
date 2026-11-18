# Pixel monochrome design tokens

Updated: 2026-11-18. Pixel's dark UI uses a black and charcoal grayscale palette
across the floating Island, Workspace, Settings, popovers, task states and
characters. The optional light theme also remains grayscale.

## Dark palette

| Token | Value | Use |
| --- | --- | --- |
| `--color-app-bg` | `#0D0D0D` | Main Workspace canvas |
| `--color-sidebar` | `#141414` | Sidebar and secondary panel |
| `--color-surface` | `#1B1B1B` | Standard/primary panel |
| `--color-surface-raised` | `#222222` | Elevated panels and controls |
| `--color-hover` | `#292929` | Hover surface |
| `--color-selected` | `#303030` | Selected/active surface |
| `--color-border` | `#333333` | Border and divider |
| `--color-border-strong` | `#4A4A4A` | Emphasized border |
| `--color-popover` | `#1B1B1B` | Menus and popovers |
| `--color-ink` | `#F4F4F4` | Primary text |
| `--color-ink-soft` | `#B8B8B8` | Secondary text |
| `--color-ink-dim` | `#888888` | Muted text |
| `--color-brand-foreground` | `#D4D4D4` | Pixel mark and brand foreground; aliases `--color-icon` |
| `--color-focus` | `#D4D4D4` | Keyboard focus outline |
| `--color-disabled` | `#777777` | Disabled controls |
| `--color-approval` | `#D4D4D4` | Approval attention; paired with explicit label/icon |
| `--color-error` | `#F4F4F4` | Error foreground; paired with explicit label/icon |
| `--color-success` | `#D4D4D4` | Success foreground; paired with explicit label/icon |
| `--color-recording` | `#F4F4F4` | Recording and waveform |
| `--color-working` | `#B8B8B8` | Working state |
| `--color-state-idle` | `#B8B8B8` | Idle character state |
| `--color-state-listening` | `#F4F4F4` | Listening character state |
| `--color-state-thinking` | `#D4D4D4` | Thinking character state |
| `--color-state-speaking` | `#D4D4D4` | Speaking character state |
| `--color-state-working` | `#B8B8B8` | Working character state |
| `--color-state-success` | `#D4D4D4` | Completed character state |
| `--color-state-error` | `#F4F4F4` | Error character state |
| `--color-state-paused` | `#888888` | Paused character state |

## Replaced palette

The preceding renderer used the following navy/chromatic tokens. Their
replacement is shown so theme migrations have a single reference:

| Previous token/value | Current token/value |
| --- | --- |
| `--color-glass: rgb(13 17 28 / 0.88)` | `--color-surface: #1B1B1B` |
| `--color-glass-raised: rgb(22 28 43 / 0.95)` | `--color-surface-raised: #222222` |
| `--color-glass-border: rgb(255 255 255 / 0.1)` | `--color-border: #333333` |
| `--color-glass-border-strong: rgb(255 255 255 / 0.18)` | `--color-border-strong: #4A4A4A` |
| `--color-popover-glass: rgb(20 26 40 / 0.97)` | `--color-popover: #1B1B1B` |
| `--color-ink: #e9edf7` | `--color-ink: #F4F4F4` |
| `--color-ink-soft: #b9c2d6` | `--color-ink-soft: #B8B8B8` |
| `--color-ink-dim: #8a94ab` | `--color-ink-dim: #888888` |
| idle `#8ea3c4` | `--color-state-idle: #B8B8B8` |
| listening `#22d3ee` | `--color-state-listening: #F4F4F4` |
| thinking `#a78bfa` | `--color-state-thinking: #D4D4D4` |
| speaking `#38bdf8` | `--color-state-speaking: #D4D4D4` |
| working `#fbbf24` | `--color-state-working: #B8B8B8` |
| success `#34d399` | `--color-state-success: #D4D4D4` |
| error `#fb7185` | `--color-state-error: #F4F4F4` |
| paused `#94a3b8` | `--color-state-paused: #888888` |
| Workspace surface `#151c28` | app canvas `#0D0D0D` |
| Workspace panel `#1c2635` | sidebar `#141414` |
| Workspace panel `#243144` | raised surface `#222222` |
| Workspace hover `#2c3b51` | hover surface `#292929` |
| Workspace accent `#49c5de` | brand foreground `#D4D4D4` |

The old light-theme values (`rgb(248 250 253 / 0.9)`,
`rgb(255 255 255 / 0.97)`, `rgb(15 23 42 / 0.12)`,
`rgb(15 23 42 / 0.22)`, `rgb(255 255 255 / 0.985)`, `#0f172a`, `#334155`,
and `#5b6779`) are replaced by the neutral light overrides in
`src/renderer/index.css`.

Status colors are deliberately grayscale. Approval, errors, success and
recording remain identifiable through their labels, icons, outlines, shape and
motion as well as contrast; color is never their only signal.

## Surfaces and marks

- The native window may keep transparency for its rounded silhouette. Visible
  app panels use opaque fills; there is no Acrylic, Mica, CSS backdrop blur or
  decorative color gradient.
- The P mark uses the unchanged approved geometry and negative-space sparkle
  from `src/shared/pixelMark.json`. `PixelMark.tsx` maps its shapes to semantic
  grayscale foreground tokens for in-app use; native icons keep the master.
- The cursor companion is a 28 DIP grayscale pointer character in a 36 DIP
  transparent, focusless, click-through native window.
- Workspace palette aliases (`--workspace-surface`, `--workspace-panel`,
  `--workspace-panel-solid`, and `--workspace-hover`) reference shared tokens
  instead of maintaining a second set of surface colors.

Theme tests inspect renderer source, semantic token values, actual rendered P
markup, removal of glass/gradient styling and cursor dimensions. These checks
do not replace screenshots or motion review on the target Windows laptop.
