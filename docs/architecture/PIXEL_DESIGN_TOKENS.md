# Pixel charcoal design tokens

Updated: 2026-11-19. Pixel uses charcoal surfaces across the floating Island,
Workspace, Settings and popovers. Blue is the interactive accent for controls,
focus and selection. Pix retains its approved independent silver-and-mint
character artwork. Status colors remain semantic and do not inherit the blue
interaction accent.

## Dark palette

| Token | Value | Use |
| --- | --- | --- |
| `--color-app-bg` | `#181818` | Main Workspace canvas |
| `--color-sidebar` | `#1B1B1B` | Chat/sidebar surface |
| `--color-surface` | `#343434` | Standard grouped panel |
| `--color-surface-raised` | `#232323` | Raised surfaces |
| `--color-hover` | `#303030` | Hover surface and selected navigation fill |
| `--color-selected` | `#494949` | Neutral selected navigation row with blue icon/edge cue |
| `--color-border` | `#353535` | Border and divider |
| `--color-border-strong` | `#505050` | Emphasized border |
| `--color-popover` | `#252525` | Menus and popovers |
| `--color-ink` | `#F3F3F3` | Primary text |
| `--color-ink-soft` | `#D3D3D3` | Secondary text |
| `--color-ink-dim` | `#ABABAB` | Muted text |
| `--color-icon` / `--color-brand-foreground` | `#D8D8D8` | Pixel mark and general icon foreground |
| `--color-accent` | `#4299F5` | Interactive controls, focus and selected mode |
| `--color-accent-hover` | `#60A9FA` | Interactive accent hover |
| `--color-accent-foreground` | `#FFFFFF` | Foreground on blue controls |
| `--color-warning` / `--color-approval` | `#D5AB72` | Warning/approval cue with label/icon |
| `--color-destructive` / `--color-error` | `#D88B83` | Error, recording and destructive cue |
| `--color-disabled` | `#777E82` | Disabled controls |
| `--color-working` | `#8CB8A5` | Active work indication |
| `--color-state-idle` | `#B8BEC2` | Idle character state |
| `--color-state-listening` | `#8CB8A5` | Listening state |
| `--color-state-thinking` | `#8CB8A5` | Thinking state |
| `--color-state-speaking` | `#8CB8A5` | Speaking state |
| `--color-state-working` | `#8CB8A5` | Working state |
| `--color-state-success` | `#8CB8A5` | Completed state |
| `--color-state-error` | `#D88B83` | Error state |
| `--color-state-paused` | `#D5AB72` | Paused state |

## Workspace conversation accents

| Token | Value | Use |
| --- | --- | --- |
| Workspace user bubble | `#214D90` | Compact, right-aligned user messages |
| Workspace composer surface | `#303030` | Main chat composer |
| Workspace rail | `#202020` | Narrow application-section navigation |

Assistant messages stay unboxed on the near-black canvas. Interactive controls
use `--color-accent`; the blue user-bubble fill is a separate conversation
surface. Pix's mint remains isolated to the mascot SVG.

## Replaced palette

The preceding renderer used the following navy/chromatic tokens. Their
replacement is shown so theme migrations have a single reference:

| Previous token/value | Current token/value |
| --- | --- |
| `--color-glass: rgb(13 17 28 / 0.88)` | Removed; visible surfaces use opaque `--color-surface: #343434` |
| `--color-glass-raised: rgb(22 28 43 / 0.95)` | `--color-surface-raised: #232323` |
| `--color-glass-border: rgb(255 255 255 / 0.1)` | `--color-border: #353535` |
| `--color-glass-border-strong: rgb(255 255 255 / 0.18)` | `--color-border-strong: #505050` |
| `--color-popover-glass: rgb(20 26 40 / 0.97)` | `--color-popover: #252525` |
| `--color-ink: #e9edf7` | `--color-ink: #F3F3F3` |
| `--color-ink-soft: #b9c2d6` | `--color-ink-soft: #D3D3D3` |
| `--color-ink-dim: #8a94ab` | `--color-ink-dim: #ABABAB` |
| idle `#8ea3c4` | `--color-state-idle: #B8BEC2` |
| listening `#22d3ee` | `--color-state-listening: #8CB8A5` |
| thinking `#a78bfa` | `--color-state-thinking: #8CB8A5` |
| speaking `#38bdf8` | `--color-state-speaking: #8CB8A5` |
| working `#fbbf24` | `--color-state-working: #8CB8A5` |
| success `#34d399` | `--color-state-success: #8CB8A5` |
| error `#fb7185` | `--color-state-error: #D88B83` |
| paused `#94a3b8` | `--color-state-paused: #D5AB72` |
| Workspace surface `#151c28` | app canvas `#181818` |
| Workspace panel `#1c2635` | sidebar `#1B1B1B` |
| Workspace panel `#243144` | composer surface `#303030` |
| Workspace hover `#2c3b51` | hover surface `#303030` |
| Workspace accent `#49c5de` | interactive accent `#4299F5` |

The old light-theme values (`rgb(248 250 253 / 0.9)`,
`rgb(255 255 255 / 0.97)`, `rgb(15 23 42 / 0.12)`,
`rgb(15 23 42 / 0.22)`, `rgb(255 255 255 / 0.985)`, `#0f172a`, `#334155`,
and `#5b6779`) are replaced by the neutral light overrides in
`src/renderer/index.css`.

Blue is reserved for interactive controls. Pix's mint remains character art;
success, working and voice-state cues keep their existing semantic treatment.
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
- Cursor Buddy is a 28 DIP grayscale rounded-rectangle character with a small
  cursor nib in a 36 DIP transparent, focusless, click-through native window.
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
small state details. The application interaction accent is blue (`#4299F5` in
the dark theme, `#1D70C9` in light theme); mascot colors are not tied to that
token.

Settings switches use the accent only when enabled. Disabled tracks remain
charcoal with a light thumb; both states expose native checkbox behavior,
`role="switch"`, `aria-checked`, keyboard operation and a visible focus ring.
Automated tests cover semantics and selected theme rules; actual display
contrast and screenshots against the supplied Codex Settings reference at
Windows scaling factors remain pending.
