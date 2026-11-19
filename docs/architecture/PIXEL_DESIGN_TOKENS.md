# Pixel charcoal design tokens

Updated: 2026-11-19. Pixel's UI uses black and charcoal surfaces across the
floating Island, Workspace, Settings and popovers. Muted sage is reserved for
selected interaction and verified/live states. Pix itself uses the approved
silver-and-mint character palette. The optional light theme remains neutral.

## Dark palette

| Token | Value | Use |
| --- | --- | --- |
| `--color-app-bg` | `#0E1013` | Main Workspace canvas |
| `--color-sidebar` | `#1A1E23` | Sidebar and secondary panel |
| `--color-surface` | `#20252A` | Standard/primary panel |
| `--color-surface-raised` | `#2A3138` | Elevated panels and controls |
| `--color-hover` | `#333A40` | Hover surface |
| `--color-selected` | `#394147` | Selected/active surface |
| `--color-border` | `#3A4147` | Border and divider |
| `--color-border-strong` | `#515A61` | Emphasized border |
| `--color-popover` | `#20252A` | Menus and popovers |
| `--color-ink` | `#E6E9ED` | Primary text |
| `--color-ink-soft` | `#C6CACD` | Secondary text |
| `--color-ink-dim` | `#9AA1A6` | Muted text |
| `--color-icon` / `--color-brand-foreground` | `#D2D7DB` | Pixel mark and general icon foreground |
| `--color-accent` | `#A7D7C2` | Selected controls, focus and live/success details |
| `--color-accent-hover` | `#D6EDE3` | Interactive accent hover |
| `--color-accent-foreground` | `#101113` | Foreground on sage controls |
| `--color-warning` / `--color-approval` | `#D5AB72` | Warning/approval cue with label/icon |
| `--color-destructive` / `--color-error` | `#D88B83` | Error, recording and destructive cue |
| `--color-disabled` | `#777E82` | Disabled controls |
| `--color-working` | `#A7D7C2` | Active work indication |
| `--color-state-idle` | `#B8BEC2` | Idle character state |
| `--color-state-listening` | `#A7D7C2` | Listening state |
| `--color-state-thinking` | `#A7D7C2` | Thinking state |
| `--color-state-speaking` | `#A7D7C2` | Speaking state |
| `--color-state-working` | `#A7D7C2` | Working state |
| `--color-state-success` | `#A7D7C2` | Completed state |
| `--color-state-error` | `#D88B83` | Error state |
| `--color-state-paused` | `#D5AB72` | Paused state |

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

Most status colors remain grayscale. Sage marks selected/live and verified
success states; errors and warnings use their distinct semantic treatment.
Approval, errors, success and recording remain identifiable through labels,
icons, outlines, shape and motion as well as color; color is never their only
signal.

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

## Approved Pix mascot accents

The 2026-11-19 Pix character reference adds character-only silver/mint colors;
it does not change the charcoal application surface palette. In the current
renderer, `--pix-face` is `#0E1013`, `--pix-shell` is `#E6E9ED`,
`--pix-shell-shadow` is `#AEB5BC`, `--pix-fold` is `#A7D7C2`,
`--pix-fold-highlight` and `--pix-eye-highlight` are `#D6EDE3`, and
`--pix-eye` is `#9BE5C7`. These values are scoped to the SVG character and its
small state details. The application interaction accent is `#A7D7C2` in the
dark theme; its hover is `#D6EDE3`, with `#101113` foreground. The light theme
uses a darker sage for contrast.

Settings switches use the accent only when enabled. Disabled tracks remain
charcoal with a light thumb; both states expose native checkbox behavior,
`role="switch"`, `aria-checked`, keyboard operation and a visible focus ring.
Automated tests cover semantics and selected theme rules; actual display
contrast and screenshots at Windows 100% and 125% scaling remain pending.
