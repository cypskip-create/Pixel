# Pixel Workspace design system

Updated: 2026-11-21. The renderer uses a warm matte dark palette informed by
the supplied Ostrand dashboard screenshot. Pixel adapts its hierarchy and
surface discipline to its own conversations, projects, tools and Pix identity.
This is an initial implementation specification; colors are estimated from the
image, not sampled from the original application source.

## Semantic palette

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--color-app-bg` | `#0B0A09` | `#F6F2ED` | Main conversation canvas |
| `--color-sidebar` | `#0D0B0C` | `#EFE8E0` | Navigation and list panels |
| `--color-surface` | `#171410` | `#FFFFFF` | Opaque grouped surfaces |
| `--color-surface-raised` | `#211D1A` | `#FBF8F4` | Raised cards and controls |
| `--color-hover` | `#28221E` | `#EEE5DC` | Hover surface |
| `--color-selected` | `#30231B` | `#F6DCC7` | Selected navigation and mode |
| `--color-border` | `#332B26` | `#D8CBBF` | Dividers and quiet outlines |
| `--color-border-strong` | `#51443B` | `#B7A494` | Composer and emphasized boundary |
| `--color-popover` | `#191613` | `#FFFFFF` | Menus and dialogs |
| `--color-ink` | `#E9E4DD` | `#161B1A` | Primary text |
| `--color-ink-soft` | `#C9C1B8` | `#414947` | Secondary text |
| `--color-ink-dim` | `#96908A` | `#68716E` | Metadata and quiet labels |
| `--color-accent` | `#F18A4F` | `#B85B20` | Focus, primary action, active cue |
| `--color-accent-hover` | `#FFA262` | `#964414` | Accent hover |
| `--color-accent-foreground` | `#1A100A` | `#FFFFFF` | Text/icons on accent |
| `--color-success` | `#79B58A` | `#39794C` | Verified success |
| `--color-warning` | `#D96A2B` | `#9A4E24` | Approval and caution |
| `--color-destructive` | `#D56D61` | `#A3443A` | Error and destructive action |

Pix keeps its approved silver-and-mint character artwork (`--pix-*` tokens).
Mint remains scoped to Pix; it is not the Workspace interaction accent.

## Type, spacing and shape

- Use the existing Segoe UI Variable / Segoe UI system stack; keep headings
  compact, body text readable, and metadata visibly subordinate.
- Existing spacing is based on 4 px increments. Workspace navigation rows are
  about 33 px high, the title bar 44 px, and compact controls 32–38 px.
- Use 7–10 px radii for dense rows and cards, 13–15 px for the conversation
  composer, and reserve the app shell’s large radius for the native window.
- Prefer hairline warm-gray borders and small elevation. Visible panels are
  opaque matte fills. Do not add backdrop blur, frosted surfaces or large glows.
- Orange guides the eye to the active view and important action; avoid using it
  as a general fill color.

## Workspace composition

- Keep conversation as the main canvas. The navigation rail and recent-chat
  list are distinct panes, with one collapse control for the history pane.
- Use a compact context header and center the transcript/composer in a bounded
  readable column. Keep Pix beside the composer and non-interactive.
- Projects use real local project records, with searchable grid/list views and
  matte folder illustrations. No sample project records are injected.
- The Library groups only the active project's indexed documents into folder
  cards and compact file rows. Search, refresh and passage preview use the
  project-scoped document index; renderer metadata omits absolute paths, and
  preview reads recheck source freshness.
- Contextual secondary panels remain on demand. Do not duplicate the main
  navigation in individual screens.
- At narrower window widths, reduce the rail to icons and constrain or collapse
  the conversation list; allow content panels to scroll without horizontal
  overflow.

## Interaction and accessibility

- Controls use consistent minimum hit areas, clear hover/pressed/disabled
  states, `:focus-visible` rings, labels and keyboard operation.
- Selection is conveyed through fill plus icon/edge/state text, not color alone.
- Success, approval, error and working states retain semantic status tokens
  and explanatory text/icons.
- Honor the application and OS reduced-motion settings. Ambient Pix particles
  are aria-hidden, pointer-inert, visibility-paused and disabled for reduced
  motion or non-idle assistant states.
- Automated component and theme tests do not replace target-Windows contrast,
  scaling, keyboard, screenshot or motion review.

## Reference adaptation and evidence limits

The Ostrand reference image supplied on 2026-11-21 is 1170×789. Raster samples
from the app canvas at (60,104) and a representative card at (800,450) were
`#0C0B09` and `#191410`; a saturated chart bar at (845,536) was `#F18A4F`.
Because the source is a JPEG, the selected tokens use nearby rounded values
(`--color-app-bg #0B0A09`, `--color-surface #171410`) to avoid encoding local
compression noise as a design rule. Its visible
content area has three columns: approximately 188 px navigation, 302 px
matching-results list and 586 px primary panel, plus a 49 px toolbar. Those are
image measurements and visual observations, not CSS values extracted from the
original product. Pixel maps this density to its own navigation, chat history
and conversation.

The Inspora Folders page informs folder depth, grouped browsing and hierarchy.
Its transparent/glass materials are explicitly excluded. The Pixel folder card
uses a solid fill, thin warm boundary and restrained shadow. These choices are
design adaptation rather than copied assets.

The ASCII Sharks source is MIT licensed. Pixel's tiny ambient `·+·` accent is
an original CSS treatment and does not reuse its source or shark identity. The
source-engine notes and inspection limitations are in
`docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md`.

## Historical palette

Before 2026-11-21, the renderer used charcoal neutrals and blue interactive
accents (`#4299F5`). Older references to `#181818`, blue interaction tokens,
and the old light palette describe that superseded theme. The native window
may still be transparent at its silhouette; visible renderer panels remain
opaque.
