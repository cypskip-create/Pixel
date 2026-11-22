# Pixel Plugin System

Updated: 2026-11-22. Improvement 6.3 foundation; first provider is public, read-only GitHub repository metadata.

## Concepts and boundaries

Pixel keeps these separate:

| Concept | Meaning in Pixel | Current support |
| --- | --- | --- |
| Core tool | First-party capability compiled into the app and gated by `ToolRegistry` | Existing tools |
| Plugin | Versioned manifest that contributes reviewed tools through Pixel's registry | Bundled catalog and lifecycle for one plugin |
| Connected account | External identity/authorization held for a provider | No account is needed for this first plugin; OAuth/account storage is not implemented |
| MCP server | Separate process or remote tool server using MCP protocol | Not dynamically installed or executed by Pixel |
| Skill / routine | Reusable instructions or a scheduled local workflow | Existing separate systems |
| Specialist agent | Orchestration role for bounded task delegation | Not a plugin and not part of this foundation |

Pixel executes no downloaded JavaScript plugin code. The current manifest is
compiled into the app; the database stores only lifecycle state and settings
JSON. A plugin can register declared `ToolDefinition`s, but execution still
passes through argument-schema validation, mode, emergency stop, approval,
executor dispatch, postcondition reporting and the existing audit/task flow.
The renderer receives a small typed IPC API and never receives a Node or
Electron object.

This matches Electron's guidance to keep Node integration out of remote content,
keep context isolation and sandboxing, and expose narrow preload capabilities.
It also avoids treating an MCP server's presence as a permission grant.
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security)

`CONSEQUENCE_POLICY` in `src/main/agent/tools.ts` defines minimum approval
and grant-duration consequences for safe, low, medium, high and critical risk.
Tool metadata can require extra approval but cannot reduce a risk floor. The
main registry, request builder and permission broker apply the same duration
rules. Explicit browser submission (`browser_type` with `submit: true`) is
critical and receives only a one-action grant.

## Manifest specification, API version 1

`src/main/plugins/manifest.ts` defines `PixelPluginManifest`:

```ts
interface PixelPluginManifest {
  id: string;                   // stable reverse-domain identifier
  name: string;
  description: string;
  version: string;              // exact SemVer string bundled with this app
  pixelApiVersion: 1;           // executor/IPC compatibility contract
  publisher: string;
  capabilities: string[];       // user-readable declarations
  permissions: string[];        // user-readable, enforced by adapter policy
  connection: 'not_required' | 'oauth' | 'api_key';
  settings?: Array<{ key: string; label: string; description: string; defaultValue: string; options: Array<{ value: string; label: string }> }>;
  tools: ToolDefinition[];      // strict JSON Schema subset; no executable callbacks
  source: 'bundled';
}
```

Manifest IDs are looked up only in `BUNDLED_PLUGINS`; unknown IDs fail closed.
Tool names must not collide with an existing registry entry. Plugin tool
schemas are validated by the existing `ToolRegistry`. Stored installs are
enabled only when both the plugin API version and exact bundled manifest version
match. An installed version mismatch must go through the explicit reviewed
bundled-update action, which disables the plugin until re-enabled; there is no
remote package update mechanism.

## Lifecycle and UI

Migration 10 creates the global `plugin_installations` table. Install starts
disabled. Enable registers the manifest's tools in the live model-facing
registry; disable unregisters the tools. Disable, update, uninstall and
project-scope changes cancel pending approvals and revoke volatile and
persistent grants before changing registration. Uninstall removes installation
state and registration. Migration 12 adds
`plugin_project_availability`, a cascading per-project enabled/disabled
override; no row means inherit the global setting. A project override can
narrow availability but cannot turn on a globally disabled, incompatible, or
uninstalled plugin. The ToolRegistry checks the active project at model-schema
construction, lookup, argument validation and permission evaluation, so an old
model call cannot bypass a project switch. Changing an override revokes the
plugin tool's pending approval, session/one-shot grants and persistent grants.
Lifecycle and scope changes go to Pixel's existing audit store. The Workspace
Plugins view separates Browse from Installed, displays version, capabilities,
permissions, connection state and last execution health, and provides Install,
Enable/Disable, per-project availability and Uninstall. If
the installed manifest version differs from the currently bundled manifest
while the Pixel API version is supported, the manager reports both versions
and offers Update through the same reviewed bundled catalog. Updating replaces
the recorded manifest version but leaves the plugin disabled; the user must
explicitly enable it again. Install is idempotent for the current manifest and
refuses an installed version mismatch, so it cannot bypass the distinct update
operation or its audit record. The manager renders only manifest-declared
settings for installed plugins; values are exact allowed choices validated by
the main process and recorded through existing audit history. An unsupported Pixel API version remains
disabled and is not offered this update action. No remote package is fetched.

Installed does not mean connected. The GitHub plugin reads public metadata and
does not use a token or account. For a future account-backed provider, Pixel
must show connection separately, use OAuth scopes that match the manifest, and
keep credentials in a protected main-process store; do not place secrets in the
renderer, manifest, task history or plugin configuration JSON. Pixel's existing
DeepSeek safeStorage entry is provider-specific and is not a generic credential
vault. The current GitHub `descriptionDetail` select controls how much
untrusted repository description text is included in the model-facing tool
result: hidden, compact (160 characters), or full (up to 500 characters).
Values remain local and contain no credentials.

## Trust and permissions

- No third-party executable, arbitrary package URL, script path, filesystem
  capability, shell capability, native helper access, or credential access can
  be declared by an installed manifest.
- Network destinations are implemented in a reviewed adapter. The GitHub
  adapter accepts only validated owner/repository names, pins the host to
  `api.github.com`, requires TLS, checks all DNS answers against the private
  address classifier, connects to one checked address and caps response size.
- Every provider call is represented by a declared tool. The current GitHub
  read requires per-call approval; returned repository text is marked as
  untrusted external data.
- The adapter rechecks cancellation immediately after DNS resolution before it
  opens a TLS socket, and refuses any non-IP-family or private address result.
- The adapter records latest execution error/success in plugin state. This is
  operational status from the latest call, not a background availability
  probe.
- Dependency conflict resolution across third-party plugins, remote/community
  updates, OAuth/account lifecycle, encrypted generic credentials, and dynamic
  third-party MCP connections are future work. There is no marketplace downloader
  or unreviewed package installer.

## First integration: GitHub public repository reader

Manifest: `pixel.github-public` version `1.1.0`, API version 1. Tool:
`github_repo_summary(owner, repository)`. It performs one bounded unauthenticated
GET to GitHub's documented repository endpoint, and returns public name,
description, URL, stars, forks, issue count, default branch and update time.
GitHub documents this endpoint and its unauthenticated rate limits; 403/429 are
reported as rate limits, never as success.
[Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)
[REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

The automated integration test injects a deterministic public-repository
fixture and exercises manifest install/enable, registry schema validation,
approval, executor dispatch, result verification and one-time grant consumption.
It does not prove live GitHub connectivity. A live API call still needs to be
made in an environment with working DNS/network access before the integration
can be called externally verified.

## Expansion policy

Add providers one at a time. For each, review current official API/auth docs,
scopes, quotas, pricing, terms and any hosted MCP implementation; record the
source and policy. Prefer a narrow first-party adapter or declarative MCP tool
contract. Do not run untrusted local plugin JavaScript in Electron main. If
future community executable plugins are required, specify and test an OS-level
isolation boundary before enabling them.

## Workspace design handoff

The current Plugins view is functional scaffolding, not the final Workspace
redesign. Keep the present Pixel branding and Pix behavior. When the user
provides a reference, use `docs/research/REA_REFERENCE_WORKFLOW.md`, capture
matching viewport states, and compare the sidebar, plugin card, details,
permission disclosure, connection state, loading, error and disabled states.
