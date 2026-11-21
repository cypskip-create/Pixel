# Improvement 6.3 — plugin foundation checkpoint

Updated: 2026-11-21. Status: foundation implemented; first plugin is fixture-tested; live provider call and Windows UI acceptance remain unverified.

## Implemented

- Versioned, bundled-only `PixelPluginManifest` and strict catalog ID checks.
- Migration 10 and global SQLite install/enable/config lifecycle state.
- Exact manifest version and plugin API compatibility checks.
- Enable/disable registration with the live `ToolRegistry`; disable/uninstall
  removes tool registration and volatile grants.
- Renderer-safe typed IPC plus Workspace Browse/Installed manager, capability
  and permission disclosure, connection distinction, health/error state, and
  lifecycle controls.
- First-party public GitHub repository reader with an explicit manifest
  capability, bounded validated input, HTTPS/TLS, pinned host, checked public
  DNS answer, bounded payload, safe errors, approval and untrusted-content
  labeling.
- Lifecycle changes are recorded in the existing audit history.
- No plugin code is downloaded or executed, no account token is used, and no
  production dependency was added.

## Trust and compatibility policy

Plugin API version is `1`; `version` is exact SemVer of the bundled manifest.
Unknown manifest IDs fail closed. Incompatible or version-mismatched state does
not enable tools. A plugin can request only user-visible data permissions and
provide declarative tool schemas. Privileged operations remain in reviewed
main-process adapters and the existing permission gateway. The plugin config
field is available for future non-secret settings only. Credentials require a
separately reviewed encrypted store; the current DeepSeek safeStorage record is
not treated as a general credential vault.

This is a local first-party catalog, not a remote marketplace. Project-specific
availability, dependency/conflict resolution for third-party plugins, safe
updates, OAuth/account connections and external MCP server lifecycle are not
implemented. GitHub plugin health is the result of its latest actual tool call,
not a fabricated background connection status.

## Validation

- `tests/plugin-system.test.ts`: deterministic fixture-backed lifecycle and
  approval-to-executor flow (no live GitHub API call).
- Latest full automated run: **901 passed, 28 skipped, 0 failed** (929 total;
  65 files passed, 1 skipped), with `PIXEL_TEST_HOME` isolated under the
  sandbox temp directory. The 28 skips require Chromium, NSIS/makensis, or an
  opt-in native foreground fixture. This full run includes the forged critical
  session-grant rejection test. `npm run typecheck` and `npm run build` passed
  after the final health-persistence error guard.
- Browser suite skips its Chromium-dependent checks when the Playwright browser
  is not installed. Real Workspace display/toggling remains unverified until a
  working Pixel window launches.
- The production GitHub adapter was invoked once for the public
  `octocat/Hello-World` repository. It stopped before HTTPS because this host's
  DNS could not resolve `api.github.com` (`ENOTFOUND`). This is an environment
  blocker, not a successful live provider read. The full permission/executor
  path is verified with the deterministic fixture.

## Next

1. Finish source/type/build/full-test verification and update the exact totals.
2. Run the plugin manager through Pixel on Windows and verify that enabling
   exposes the GitHub tool, disabling removes it, and the permission prompt is
   shown.
3. Run one safe public GitHub request only after DNS/network access is restored;
   do not use account tokens or write actions for this check.
4. Use the user's forthcoming Workspace reference before any visual redesign.
