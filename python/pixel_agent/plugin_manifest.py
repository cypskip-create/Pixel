"""Hermes-compatible Python plugin manifest parser & validator (`plugin.json` / `plugin.yaml`).

Adapted from Hermes `hermes_cli/plugins_manifest.py`:
  - Supports both `plugin.json` and `plugin.yaml` using Python stdlib (no PyYAML required).
  - Validates manifest version (<= 2), plugin ID, semver-like version, kind, capabilities,
    config_schema types, and dependency graphs (including cycle detection).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Optional

SUPPORTED_MANIFEST_VERSION = 2
SUPPORTED_API_VERSION = 1

VALID_PLUGIN_KINDS = frozenset({"standalone", "backend", "exclusive", "platform", "model-provider", "connector"})
VALID_SCHEMA_TYPES = frozenset({
    "str", "string", "int", "integer", "float", "number", "bool", "boolean",
    "list", "array", "dict", "object", "secret", "select", "path",
})
PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


@dataclass
class PluginManifest:
    id: str
    name: str
    version: str
    description: str = ""
    publisher: str = ""
    license: str = ""
    homepage: str = ""
    tags: list[str] = field(default_factory=list)
    manifest_version: int = 2
    api_version: int = 1
    kind: str = "standalone"
    entry: str = "plugin.py"
    platforms: list[str] = field(default_factory=list)
    requires_env: list[str] = field(default_factory=list)
    optional_env: list[str] = field(default_factory=list)
    requires_plugins: list[str] = field(default_factory=list)
    pip_dependencies: list[str] = field(default_factory=list)
    provides_tools: list[str] = field(default_factory=list)
    provides_hooks: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    config_schema: dict[str, dict[str, Any]] = field(default_factory=dict)
    requires_auth: bool = False
    isolation: str = "subprocess"  # "subprocess" | "in_process"
    source_path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "publisher": self.publisher,
            "license": self.license,
            "homepage": self.homepage,
            "tags": list(self.tags),
            "manifestVersion": self.manifest_version,
            "apiVersion": self.api_version,
            "kind": self.kind,
            "entry": self.entry,
            "platforms": list(self.platforms),
            "requiresEnv": list(self.requires_env),
            "optionalEnv": list(self.optional_env),
            "requiresPlugins": list(self.requires_plugins),
            "pipDependencies": list(self.pip_dependencies),
            "providesTools": list(self.provides_tools),
            "providesHooks": list(self.provides_hooks),
            "capabilities": list(self.capabilities),
            "configSchema": dict(self.config_schema),
            "requiresAuth": self.requires_auth,
            "isolation": self.isolation,
            "sourcePath": self.source_path,
        }


def _parse_scalar(raw: str) -> Any:
    val = raw.strip()
    if not val or val in ("null", "None", "~"):
        return None
    if val in ("true", "True"):
        return True
    if val in ("false", "False"):
        return False
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        return val[1:-1]
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(part) for part in inner.split(",")]
    try:
        if "." in val:
            return float(val)
        return int(val)
    except ValueError:
        return val


def parse_simple_yaml(text: str) -> dict[str, Any]:
    """Parse a clean YAML subset (maps, nested maps, lists, scalars) with stdlib only."""
    root: dict[str, Any] = {}
    stack: list[tuple[int, Any]] = [(-1, root)]
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        raw_line = lines[i]
        i += 1
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]

        if stripped.startswith("- "):
            item_val = _parse_scalar(stripped[2:])
            if isinstance(parent, list):
                parent.append(item_val)
            continue

        if ":" not in stripped:
            continue
        key, _, rest = stripped.partition(":")
        key = key.strip()
        rest = rest.strip()
        if rest:
            if isinstance(parent, dict):
                parent[key] = _parse_scalar(rest)
        else:
            # Peek next non-empty line to decide list vs dict
            next_is_list = False
            for j in range(i, len(lines)):
                nxt = lines[j].strip()
                if not nxt or nxt.startswith("#"):
                    continue
                next_is_list = nxt.startswith("- ")
                break
            container: Any = [] if next_is_list else {}
            if isinstance(parent, dict):
                parent[key] = container
                stack.append((indent, container))
    return root


def _as_str_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def parse_manifest_dict(data: Mapping[str, Any], source_path: str = "") -> tuple[Optional[PluginManifest], list[str]]:
    """Validate and construct a `PluginManifest`. Returns `(manifest, errors)`."""
    errors: list[str] = []
    if not isinstance(data, Mapping):
        return None, ["Manifest root must be a mapping/object."]

    raw_id = str(data.get("id") or data.get("name") or "").strip().lower().replace(" ", "-")
    if not raw_id or not PLUGIN_ID_RE.match(raw_id):
        errors.append(f"Invalid plugin id '{raw_id}': must match ^[a-z0-9][a-z0-9._-]{{0,63}}$.")

    name = str(data.get("name") or raw_id).strip()
    version = str(data.get("version") or "").strip()
    if not version:
        errors.append("Manifest must specify a non-empty 'version'.")

    try:
        manifest_version = int(data.get("manifest_version", data.get("manifestVersion", 2)))
    except (TypeError, ValueError):
        manifest_version = 0
    if manifest_version < 1 or manifest_version > SUPPORTED_MANIFEST_VERSION:
        errors.append(f"Unsupported manifest_version {manifest_version} (supported: 1..{SUPPORTED_MANIFEST_VERSION}).")

    try:
        api_version = int(data.get("api_version", data.get("apiVersion", SUPPORTED_API_VERSION)))
    except (TypeError, ValueError):
        api_version = 0
    if api_version < 1 or api_version > SUPPORTED_API_VERSION:
        errors.append(f"Unsupported api_version {api_version} (supported: 1..{SUPPORTED_API_VERSION}).")

    kind = str(data.get("kind") or data.get("plugin_type") or "standalone").strip().lower()
    if kind not in VALID_PLUGIN_KINDS:
        errors.append(f"Unsupported plugin kind '{kind}'.")

    entry = str(data.get("entry") or "plugin.py").strip()
    if ".." in Path(entry).parts or Path(entry).is_absolute():
        errors.append(f"Invalid entry path '{entry}': must be relative within plugin directory.")

    raw_schema = data.get("config_schema", data.get("configSchema", {}))
    config_schema: dict[str, dict[str, Any]] = {}
    if raw_schema is not None:
        if not isinstance(raw_schema, Mapping):
            errors.append("'config_schema' must be an object mapping setting keys to field specs.")
        else:
            for k, spec in raw_schema.items():
                if not isinstance(spec, Mapping):
                    errors.append(f"config_schema.{k} must be an object.")
                    continue
                ftype = str(spec.get("type") or "string").strip().lower()
                if ftype not in VALID_SCHEMA_TYPES:
                    errors.append(f"config_schema.{k} has unsupported type '{ftype}'.")
                    continue
                config_schema[str(k)] = dict(spec)

    if errors:
        return None, errors

    author = data.get("publisher") or data.get("author") or ""
    if isinstance(author, Mapping):
        author = ", ".join(str(author[f]) for f in ("name", "email", "url") if author.get(f))

    manifest = PluginManifest(
        id=raw_id,
        name=name,
        version=version,
        description=str(data.get("description") or "").strip(),
        publisher=str(author).strip(),
        license=str(data.get("license") or "").strip(),
        homepage=str(data.get("homepage") or "").strip(),
        tags=_as_str_list(data.get("tags")),
        manifest_version=manifest_version,
        api_version=api_version,
        kind=kind,
        entry=entry,
        platforms=_as_str_list(data.get("platforms")),
        requires_env=_as_str_list(data.get("requires_env", data.get("requiresEnv"))),
        optional_env=_as_str_list(data.get("optional_env", data.get("optionalEnv"))),
        requires_plugins=_as_str_list(data.get("requires_plugins", data.get("requiresPlugins"))),
        pip_dependencies=_as_str_list(data.get("pip_dependencies", data.get("python_dependencies"))),
        provides_tools=_as_str_list(data.get("provides_tools", data.get("providesTools"))),
        provides_hooks=_as_str_list(data.get("provides_hooks", data.get("providesHooks"))),
        capabilities=_as_str_list(data.get("capabilities")),
        config_schema=config_schema,
        requires_auth=bool(data.get("requires_auth", data.get("requiresAuth", False))),
        isolation=str(data.get("isolation") or "subprocess").strip().lower(),
        source_path=source_path,
    )
    return manifest, []


def load_manifest_from_dir(plugin_dir: str | Path) -> tuple[Optional[PluginManifest], list[str]]:
    """Load `plugin.json` or `plugin.yaml` from a plugin directory."""
    root = Path(plugin_dir)
    if not root.is_dir():
        return None, [f"Plugin directory does not exist: {root}"]

    json_path = root / "plugin.json"
    yaml_path = root / "plugin.yaml"
    if json_path.is_file():
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception as exc:
            return None, [f"Invalid plugin.json: {exc}"]
        return parse_manifest_dict(data, source_path=str(root))
    if yaml_path.is_file():
        try:
            data = parse_simple_yaml(yaml_path.read_text(encoding="utf-8"))
        except Exception as exc:
            return None, [f"Invalid plugin.yaml: {exc}"]
        return parse_manifest_dict(data, source_path=str(root))
    return None, [f"No plugin.json or plugin.yaml found in {root}"]


def validate_settings_against_schema(
    schema: Mapping[str, Mapping[str, Any]],
    values: Mapping[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Validate and coerce plugin settings against `manifest.config_schema`."""
    cleaned: dict[str, Any] = {}
    errors: list[str] = []
    for key, spec in schema.items():
        if key not in values:
            if "default" in spec:
                cleaned[key] = spec["default"]
            elif spec.get("required"):
                errors.append(f"Required setting '{key}' is missing.")
            continue
        raw = values[key]
        ftype = str(spec.get("type") or "string").strip().lower()
        if ftype in ("str", "string", "secret", "path"):
            if not isinstance(raw, str):
                errors.append(f"Setting '{key}' must be a string.")
            else:
                cleaned[key] = raw
        elif ftype == "select":
            opts = spec.get("options") or spec.get("enum") or []
            if opts and raw not in opts:
                errors.append(f"Setting '{key}' must be one of {opts}.")
            else:
                cleaned[key] = str(raw)
        elif ftype in ("int", "integer"):
            if isinstance(raw, bool) or not isinstance(raw, int):
                errors.append(f"Setting '{key}' must be an integer.")
            else:
                cleaned[key] = raw
        elif ftype in ("float", "number"):
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                errors.append(f"Setting '{key}' must be a number.")
            else:
                cleaned[key] = float(raw)
        elif ftype in ("bool", "boolean"):
            if not isinstance(raw, bool):
                errors.append(f"Setting '{key}' must be a boolean.")
            else:
                cleaned[key] = raw
        elif ftype in ("list", "array"):
            if not isinstance(raw, list):
                errors.append(f"Setting '{key}' must be a list.")
            else:
                cleaned[key] = raw
        elif ftype in ("dict", "object"):
            if not isinstance(raw, dict):
                errors.append(f"Setting '{key}' must be an object.")
            else:
                cleaned[key] = raw
    return cleaned, errors


def resolve_dependency_order(manifests: Mapping[str, PluginManifest]) -> tuple[list[str], list[str]]:
    """Topologically order plugins by `requires_plugins`, detecting missing deps & cycles."""
    errors: list[str] = []
    state: dict[str, int] = {}  # 0=unvisited, 1=visiting, 2=visited
    order: list[str] = []

    def _visit(pid: str, trail: list[str]) -> None:
        st = state.get(pid, 0)
        if st == 2:
            return
        if st == 1:
            cycle = " -> ".join(trail + [pid])
            errors.append(f"Plugin dependency cycle detected: {cycle}")
            return
        state[pid] = 1
        m = manifests[pid]
        for dep in m.requires_plugins:
            if dep not in manifests:
                errors.append(f"Plugin '{pid}' requires missing plugin '{dep}'.")
                continue
            _visit(dep, trail + [pid])
        state[pid] = 2
        order.append(pid)

    for pid in sorted(manifests.keys()):
        if state.get(pid, 0) == 0:
            _visit(pid, [])
    return order, errors
