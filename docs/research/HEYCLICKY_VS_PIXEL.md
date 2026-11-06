# HeyClicky vs Pixel: independent improvements

The comparison is deliberately asymmetric: Pixel's claims are backed by our own
source and artefacts; HeyClicky's are from an installer's structure plus public
behaviour, so the HeyClicky column states what is *known* rather than what is
assumed. Nothing proprietary is copied; every item below is a design decision
Pixel can make on its own.

## 1. What is comparable today

| Dimension | Pixel (verified in-repo) | HeyClicky (verified: installer only) |
| --- | --- | --- |
| Installer framework | electron-builder NSIS, per-user, `asInvoker` | native x86 bootstrapper; elevates via token privileges; verifies certificate chains; network-capable |
| App framework | Electron 45 + React 19 + TS | **unknown** (installer is native; app not installed here) |
| Packaging | installer + portable + unpacked ZIP | single setup executable observed |
| Update path | none yet (manual) | bootstrapper downloads during install (hypothesis from `WS2_32` + `CreateProcessW`) |
| Window model | frameless, transparent, always-on-top `floating`, 96 px orb → 480 px surfaces | hypothesis: floating overlay; unverified |
| Agent runtime | TypeScript tool loop, central policy, 8-step/5-min/30-s caps | unknown |
| Local data | SQLite (`user_data`), project-scoped memory | unknown |
| Permissions | local policy table; approval per action; emergency stop | unknown |

## 2. Improvements Pixel can implement independently

These are gaps visible from Pixel's own code, ordered by user-visible value. None
requires knowledge of HeyClicky's internals.

### 2.1 First-run reliability (highest value)

Pixel's installer produced two misleading failures (a "cannot be closed" dialog
from three unrelated code paths, and a self-inflicted "cannot write to this
folder" preflight). Improvements:

- **Restore maintained installer behaviour** — done in this branch: both custom
  NSIS overrides removed.
- **Ship a diagnostic mode** — `--diagnostic-window` (ordinary window) plus
  `--pixel-selfcheck` (no window) so a broken environment is identified instead
  of guessed at.
- **Never let a false preflight block installation** — a check that runs before
  the directory page has a trustworthy value can only produce false negatives.

### 2.2 Startup observability

Pixel now logs before any dependency is imported and writes an exit marker. What
it still lacks, and should add:

- a **crash-report viewer** in Settings (it has the log; it does not surface it),
- **`--repair`** to reset window bounds and tray state without touching data,
- **startup timing budgets** logged per stage so a slow boot is measurable.

### 2.3 Elevation and updates

HeyClicky's installer performs privileged, signature-checked work. Pixel is
`asInvoker` per-user by design, which is better for trust but means it has no
update channel. Independent improvements:

- **in-app update check** that only *notifies*, never silently installs,
- **signed releases** once a certificate exists; today the honest state is
  "unsigned, SmartScreen may warn",
- **version/identity surfaced in the diagnostics panel** so upgrades are visible.

### 2.4 Overlay quality (where the product lives)

From Pixel's own implementation, three concrete improvements not yet done:

1. **Click-through regions**: the guidance overlay sets ignore-mouse globally;
   per-region hit testing would let the orb stay clickable while annotations pass
   through.
2. **Multi-monitor edge behaviour**: position is clamped to a display, but the
   orb does not remember a *per-monitor* position; moving between monitors and
   back currently loses the previous slot.
3. **Render budget**: the orb animates continuously; pausing animation when the
   window is not visible or the display is occluded would cut idle CPU
   measurably (we have the `useMotion` hook to build on, but no measurement yet).

### 2.5 Capability honesty

Pixel already refuses rather than fakes: no browser without Playwright, no voice
without recognisers, no assistant without a key. The remaining gap is that the
**UI does not show a capability matrix**; a compact "what works right now" panel
would make the same honesty visible instead of discovered through failures.

## 3. What Pixel should not copy

- **Automatic elevation during install.** Per-user `asInvoker` is the safer
  default; requesting admin for a personal companion is unnecessary.
- **Downloading payloads at install time.** Pixel ships its runtime; a network
  fetch during setup is a failure mode we just spent this branch removing.
- **Silent self-update.** For a tool with filesystem and input privileges, updates
  must be user-visible.

## 4. Unverified comparison items

Anything about HeyClicky's window layering, animation, capture pipeline, agent
loop, voice stack, or resource footprint remains **unknown** until the installed
application can be inspected (see `HEYCLICKY_ARCHITECTURE.md` §4 for the exact
read-only probes). This document therefore does not claim parity or superiority in
those areas.
