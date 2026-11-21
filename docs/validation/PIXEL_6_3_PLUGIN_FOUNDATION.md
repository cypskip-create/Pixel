# Improvement 6.3 — plugin foundation checkpoint

Updated: 2026-11-21. Status: foundation implemented; first plugin is fixture-tested; live provider call and Windows UI acceptance remain unverified.

## Implemented

- Versioned, bundled-only `PixelPluginManifest` and strict catalog ID checks.
- Migration 10 and global SQLite install/enable/config lifecycle state.
- Migration 12 and project availability overrides. No override follows the
  global setting; a project override cannot enable an uninstalled, globally
  disabled or incompatible plugin.
- Exact manifest version and plugin API compatibility checks.
- Enable/disable registration with the live `ToolRegistry`; disable/uninstall
  removes tool registration and volatile grants.
- Active-project availability is enforced by ToolRegistry listing, lookup,
  schema validation and permission evaluation. Changing scope revokes one-shot,
  session and persisted grants and cancels a pending approval for that tool.
  Global disable, update and uninstall now use the same revocation path before
  removing tool registrations. Workspace plugin/tool state refreshes after
  project switches.
- Renderer-safe typed IPC plus Workspace Browse/Installed manager, capability
  and permission disclosure, connection distinction, health/error state, and
  lifecycle controls.
- The Workspace Plugin Manager is a dedicated component. Permission details
  use keyboard-accessible disclosure controls; install/enable/uninstall actions
  serialize while pending, show errors without claiming success, and display
  stored update timestamps. It now identifies installed-vs-bundled version
  mismatches and offers a local reviewed-manifest update that leaves the plugin
  disabled until the user re-enables it. Fixture-backed UI tests cover catalog
  grouping, permission disclosure, duplicate clicks, failure presentation and
  this update/re-enable explanation.
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

This is a local first-party catalog, not a remote marketplace. The current app
supports explicit updates only from its bundled reviewed manifest; remote
packages are not fetched. Dependency/conflict resolution for third-party
plugins, OAuth/account connections and external MCP
server lifecycle are not implemented. GitHub plugin health is the result of
its latest actual tool call, not a fabricated background connection status.

## Validation

- 2026-11-21 continuation: latest full `npm run verify` **991 passed, 4 skipped, 0 failed**
  (995 total; three native foreground scenarios and the symlink-fixture prerequisite account for skips).
  Focused Workspace and theme suite passed **22/22**; TypeScript check, renderer
  production build, native helper compile and voice worker boundary suite
  (12/12) passed. Pixel Windows System.Speech playback also passed directly;
  Windows has no installed speech recognizer, and offline model inference was
  not run. This does not constitute Windows UI or STT acceptance.
- The production public GitHub adapter and a direct unauthenticated request for
  `octocat/Hello-World` both failed before HTTP because this shell cannot resolve
  `api.github.com` (`ENOTFOUND`). A retry in this checkpoint had the same DNS
  result, so live GitHub integration remains unverified. The adapter now
  rechecks task cancellation after DNS and rejects invalid address families or
  private addresses before opening the TLS socket.

- `tests/plugin-system.test.ts`: **10/10** deterministic tests cover fixture-backed
  lifecycle, approval-to-executor flow, cancellation after DNS, private address
  refusal, unsupported API fail-closed behavior and rejection of install-as-update
  bypass (no live GitHub API call).
- `tests/permission-store.test.ts`: **7/7** tests include persistent permission
  revocation across restart and cancellation of a pending approval when plugin
  access is removed.
- Earlier plugin checkpoint run: **901 passed, 28 skipped, 0 failed** (929
  total; 65 files passed, 1 skipped), with `PIXEL_TEST_HOME` isolated under the
  sandbox temp directory. The current full run is **991 passed, 4 skipped, 0
  failed** (995 total; 74 files passed, 1 skipped); it includes note-document
  storage, renderer bridge, project-scoped Plugin Manager availability, the
  project-scoped indexed-document Library, binary text-write
  refusal, the indexed-document Library, and dynamic dev-port tests. Three
  native foreground scenarios and the symlink-creation test account for skips.
  Typecheck and production build passed.
- Browser suite skips its Chromium-dependent checks when the Playwright browser
  is not installed. Real Workspace display/toggling remains unverified until a
  working Pixel window launches.
- The production GitHub adapter was invoked once for the public
  `octocat/Hello-World` repository. It stopped before HTTPS because this host's
  DNS could not resolve `api.github.com` (`ENOTFOUND`). This is an environment
  blocker, not a successful live provider read. The full permission/executor
  path is verified with the deterministic fixture.

## 6.2 specialist pipeline follow-on

The live agent now exposes `delegate_to_specialist` for bounded research,
browser, systems, and knowledge subtasks. Delegation uses the active model
configuration, empty specialist conversation history, an allowlisted schema
set, bounded turns/time/tokens, no recursive delegation, and the central
executor for every child call. Child mutations still require the ordinary
permission broker; child events do not leak as a second user-facing stream.
Emergency stop cancels the delegated run. Pixel Code and infrastructure
specialists remain unavailable. Integration tests cover deterministic model
tool selection/execution, denied capabilities, approval and a browser
postcondition. This is not Windows GUI acceptance or durable recovery
qualification.

## Next

1. Finish source/type/build/full-test verification and update the exact totals.
2. Run the plugin manager through Pixel on Windows and verify that enabling
   exposes the GitHub tool, disabling removes it, and the permission prompt is
   shown.
3. Run one safe public GitHub request only after DNS/network access is restored;
   do not use account tokens or write actions for this check.
4. The user has now supplied the Workspace direction. The first matte warm
   palette/sidebar/project-browser pass is in progress; see
   `docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md`. Its design changes do not
   establish plugin manager desktop acceptance. Verify the plugin controls in
   the actual Windows application when a targetable project window is available.
