"""Authoritative Python-First Plugin Manager, Toolsets & Skills Hub (Stage 7).

Adapted from Hermes `hermes_cli/plugins.py`, `plugins_activation.py`,
`plugins_transaction.py`, `plugins_dispatch.py`, `skills_hub.py`, and `toolsets.py`.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Optional

from .plugin_host import PluginHostClient
from .plugin_manifest import (
    PluginManifest,
    load_manifest_from_dir,
    resolve_dependency_order,
    validate_settings_against_schema,
)

DEFAULT_TOOLSETS: tuple[dict[str, Any], ...] = (
    {"id": "terminal", "name": "Terminal & Processes", "category": "system", "description": "Persistent shells, process polling, stdin, and exit monitoring.", "toolPrefixes": ["process_", "terminal_"]},
    {"id": "files", "name": "Files & Documents", "category": "workspace", "description": "Scoped filesystem read/write/search and document indexing.", "toolPrefixes": ["file_", "documents_", "git_"]},
    {"id": "browser", "name": "Browser Automation", "category": "web", "description": "Managed Playwright sessions, persistent profiles, and CDP attach.", "toolPrefixes": ["browser_"]},
    {"id": "computer_use", "name": "Windows Computer Use", "category": "desktop", "description": "UIA accessibility inspection, Set-of-Marks screenshots, and authorized desktop input.", "toolPrefixes": ["computer_use", "analyze_screen", "invoke_ui_", "control_ui_"]},
    {"id": "multimodal", "name": "Vision & Image Generation", "category": "multimodal", "description": "Image generation (OpenAI / FAL.ai) and multimodal screenshot analysis.", "toolPrefixes": ["image_"]},
    {"id": "memory", "name": "Memory & Skills", "category": "intelligence", "description": "Project memory recall, session search, and procedural skills.", "toolPrefixes": ["memory_", "session_", "skill_"]},
    {"id": "connectors", "name": "External Connectors", "category": "integrations", "description": "GitHub, Google Calendar, and connected external APIs.", "toolPrefixes": ["github_", "google_calendar_"]},
    {"id": "mcp", "name": "MCP Servers", "category": "extensions", "description": "Model Context Protocol stdio & Streamable HTTP servers.", "toolPrefixes": ["mcp__"]},
    {"id": "plugins", "name": "Python Plugins", "category": "extensions", "description": "Dynamic tools registered by enabled third-party Python plugins.", "toolPrefixes": ["plugin_"]},
)

CATALOG_SKILLS_HUB: tuple[dict[str, Any], ...] = (
    {
        "id": "code-review-checklist",
        "name": "Code Review Checklist",
        "category": "engineering",
        "publisher": "Pixel Official",
        "trust": "official",
        "version": "1.0.0",
        "description": "Structured security, correctness, and test-coverage review workflow for pull requests.",
        "markdown": "# Code Review Checklist\n1. Verify scope and regression tests.\n2. Check trust boundaries and input validation.\n3. Confirm clean diffs and clear error handling.",
    },
    {
        "id": "release-notes-drafter",
        "name": "Release Notes Drafter",
        "category": "productivity",
        "publisher": "Pixel Official",
        "trust": "official",
        "version": "1.0.0",
        "description": "Summarizes git commits into structured user-facing release notes.",
        "markdown": "# Release Notes Drafter\nGroup commits by Features, Fixes, and Verification; omit internal noise.",
    },
    {
        "id": "windows-triage",
        "name": "Windows Diagnostics Triage",
        "category": "operations",
        "publisher": "Pixel Official",
        "trust": "official",
        "version": "1.0.0",
        "description": "Read-only Windows system health, process, and log triage steps.",
        "markdown": "# Windows Diagnostics Triage\nInspect active windows, running processes, and recent audit entries before proposing changes.",
    },
)


class PluginManager:
    """Authoritative Python manager for installed plugins, hosts, hooks, toolsets, and Skills Hub."""

    def __init__(self, data_dir: Optional[str | Path] = None) -> None:
        default_root = Path(os.environ.get("PIXEL_PLUGIN_DATA_DIR") or (Path.home() / ".pixel" / "plugins"))
        self.data_dir = Path(data_dir) if data_dir else default_root
        self.installed_dir = self.data_dir / "installed"
        self.state_path = self.data_dir / "plugins-state.json"
        self.skills_dir = self.data_dir / "skills-hub"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.installed_dir.mkdir(parents=True, exist_ok=True)
        self.skills_dir.mkdir(parents=True, exist_ok=True)

        self._state: dict[str, Any] = self._load_state()
        self._hosts: dict[str, PluginHostClient] = {}
        self._manifests: dict[str, PluginManifest] = {}
        self._tools: dict[str, dict[str, Any]] = {}  # tool_name -> schema dict (includes pluginId)
        self._hooks: dict[str, list[dict[str, Any]]] = {}  # plugin_id -> list of {event, priority}
        self._providers: dict[str, list[dict[str, Any]]] = {}
        self._plugin_skills: dict[str, list[dict[str, Any]]] = {}

        # Restore persisted enabled plugins on startup
        self._restore_persisted()

    def _load_state(self) -> dict[str, Any]:
        if self.state_path.is_file():
            try:
                parsed = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(parsed, dict):
                    parsed.setdefault("plugins", {})
                    parsed.setdefault("toolsets", {})
                    parsed.setdefault("skillsHub", {})
                    return parsed
            except Exception:
                pass
        return {"version": 1, "plugins": {}, "toolsets": {}, "skillsHub": {}}

    def _save_state(self) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.state_path)

    def _restore_persisted(self) -> None:
        manifests: dict[str, PluginManifest] = {}
        for pid, entry in list(self._state.get("plugins", {}).items()):
            pdir = Path(str(entry.get("installPath") or (self.installed_dir / pid)))
            if not pdir.is_dir():
                continue
            m, errs = load_manifest_from_dir(pdir)
            if m and not errs:
                manifests[m.id] = m
        self._manifests = manifests
        order, _errs = resolve_dependency_order(manifests)
        for pid in order:
            entry = self._state["plugins"].get(pid, {})
            if entry.get("enabled"):
                self._start_and_load(pid)

    # ------------------------------------------------------------------
    # Discovery & Installation
    # ------------------------------------------------------------------

    def discover(self, search_dir: str | Path) -> dict[str, Any]:
        root = Path(search_dir)
        if not root.is_dir():
            return {"ok": False, "plugins": [], "error": f"Directory not found: {root}"}
        found: list[dict[str, Any]] = []
        # Support either a single plugin directory or a parent directory of plugins
        direct_m, direct_errs = load_manifest_from_dir(root)
        if direct_m and not direct_errs:
            found.append(direct_m.to_dict())
            return {"ok": True, "plugins": found}
        for child in sorted(root.iterdir()):
            if child.is_dir():
                m, errs = load_manifest_from_dir(child)
                if m and not errs:
                    found.append(m.to_dict())
        return {"ok": True, "plugins": found}

    def install(self, source_dir: str | Path, *, provenance: str = "local", enable: bool = False) -> dict[str, Any]:
        src = Path(source_dir)
        manifest, errors = load_manifest_from_dir(src)
        if not manifest or errors:
            return {"ok": False, "error": "; ".join(errors) or "Invalid plugin manifest."}

        # Check dependency cycles & missing dependencies before installing
        candidate_manifests = dict(self._manifests)
        candidate_manifests[manifest.id] = manifest
        _order, dep_errors = resolve_dependency_order(candidate_manifests)
        if dep_errors:
            return {"ok": False, "error": "; ".join(dep_errors)}

        target = self.installed_dir / manifest.id
        staging = self.installed_dir / f".{manifest.id}.staging"
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        try:
            shutil.copytree(src, staging)
            if target.exists():
                shutil.rmtree(target)
            staging.replace(target)
        except Exception as exc:
            shutil.rmtree(staging, ignore_errors=True)
            return {"ok": False, "error": f"Transactional install failed: {exc}"}

        manifest.source_path = str(target)
        self._manifests[manifest.id] = manifest
        default_settings, _ = validate_settings_against_schema(manifest.config_schema, {})
        existing = self._state["plugins"].get(manifest.id, {})
        self._state["plugins"][manifest.id] = {
            "id": manifest.id,
            "version": manifest.version,
            "provenance": provenance,
            "installPath": str(target),
            "enabled": bool(enable),
            "settings": {**default_settings, **(existing.get("settings") or {})},
            "installedAt": existing.get("installedAt") or int(time.time() * 1000),
            "updatedAt": int(time.time() * 1000),
        }
        self._save_state()

        if enable:
            en = self.enable(manifest.id)
            if not en.get("ok"):
                return en
        return {"ok": True, "plugin": self._plugin_view(manifest.id)}

    def _start_and_load(self, plugin_id: str) -> dict[str, Any]:
        entry = self._state["plugins"].get(plugin_id)
        manifest = self._manifests.get(plugin_id)
        if not entry or not manifest:
            return {"ok": False, "error": f"Plugin '{plugin_id}' is not installed."}

        # Stop previous host if running
        self._stop_host(plugin_id)
        host = PluginHostClient(plugin_id)
        res = host.request("load", {"pluginDir": entry["installPath"], "config": entry.get("settings") or {}})
        if not res.get("ok"):
            host.stop()
            return {"ok": False, "error": str(res.get("error") or f"Failed to load plugin '{plugin_id}'.")}

        payload = res.get("result") or {}
        self._hosts[plugin_id] = host
        for tool_schema in payload.get("tools") or []:
            tname = str(tool_schema.get("name") or "")
            if tname:
                self._tools[tname] = tool_schema
        self._hooks[plugin_id] = list(payload.get("hooks") or [])
        self._providers[plugin_id] = list(payload.get("providers") or [])
        self._plugin_skills[plugin_id] = list(payload.get("skills") or [])
        return {"ok": True, "result": payload}

    def _stop_host(self, plugin_id: str) -> None:
        host = self._hosts.pop(plugin_id, None)
        if host is not None:
            try:
                host.request("unload", {}, timeout_s=2.0)
            except Exception:
                pass
            host.stop()
        # Clean up all registrations owned by this plugin
        for tname in [k for k, v in self._tools.items() if v.get("pluginId") == plugin_id]:
            self._tools.pop(tname, None)
        self._hooks.pop(plugin_id, None)
        self._providers.pop(plugin_id, None)
        self._plugin_skills.pop(plugin_id, None)

    def enable(self, plugin_id: str) -> dict[str, Any]:
        entry = self._state["plugins"].get(plugin_id)
        if not entry:
            return {"ok": False, "error": f"Plugin '{plugin_id}' is not installed."}
        loaded = self._start_and_load(plugin_id)
        if not loaded.get("ok"):
            entry["enabled"] = False
            self._save_state()
            return loaded
        entry["enabled"] = True
        self._save_state()
        return {"ok": True, "plugin": self._plugin_view(plugin_id)}

    def disable(self, plugin_id: str) -> dict[str, Any]:
        entry = self._state["plugins"].get(plugin_id)
        if not entry:
            return {"ok": False, "error": f"Plugin '{plugin_id}' is not installed."}
        self._stop_host(plugin_id)
        entry["enabled"] = False
        self._save_state()
        return {"ok": True, "plugin": self._plugin_view(plugin_id)}

    def update(self, plugin_id: str, new_source_dir: str | Path) -> dict[str, Any]:
        """Transactional plugin update with automatic rollback if validation or load fails."""
        entry = self._state["plugins"].get(plugin_id)
        if not entry:
            return {"ok": False, "error": f"Plugin '{plugin_id}' is not installed."}
        new_manifest, errors = load_manifest_from_dir(new_source_dir)
        if not new_manifest or errors:
            return {"ok": False, "error": f"Update rejected (kept previous version): {'; '.join(errors)}"}
        if new_manifest.id != plugin_id:
            return {"ok": False, "error": f"Update manifest id '{new_manifest.id}' does not match '{plugin_id}'."}

        was_enabled = bool(entry.get("enabled"))
        old_version = entry.get("version")
        old_manifest = self._manifests.get(plugin_id)
        target = Path(entry["installPath"])
        backup = self.installed_dir / f".{plugin_id}.backup"
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)

        self._stop_host(plugin_id)
        try:
            if target.exists():
                shutil.copytree(target, backup)
                shutil.rmtree(target)
            shutil.copytree(new_source_dir, target)
            new_manifest.source_path = str(target)
            self._manifests[plugin_id] = new_manifest
            entry["version"] = new_manifest.version
            entry["updatedAt"] = int(time.time() * 1000)

            if was_enabled:
                loaded = self._start_and_load(plugin_id)
                if not loaded.get("ok"):
                    raise RuntimeError(str(loaded.get("error") or "Updated plugin failed to load."))
            self._save_state()
            shutil.rmtree(backup, ignore_errors=True)
            return {"ok": True, "plugin": self._plugin_view(plugin_id)}
        except Exception as exc:
            # Roll back atomically to the backup copy
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            if backup.exists():
                backup.replace(target)
            if old_manifest is not None:
                self._manifests[plugin_id] = old_manifest
            entry["version"] = old_version
            if was_enabled:
                self._start_and_load(plugin_id)
            self._save_state()
            return {"ok": False, "rolledBack": True, "error": f"Update failed and rolled back to v{old_version}: {exc}"}

    def uninstall(self, plugin_id: str) -> dict[str, Any]:
        entry = self._state["plugins"].get(plugin_id)
        if not entry:
            return {"ok": False, "error": f"Plugin '{plugin_id}' is not installed."}
        self._stop_host(plugin_id)
        target = Path(entry["installPath"])
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        self._manifests.pop(plugin_id, None)
        self._state["plugins"].pop(plugin_id, None)
        self._save_state()
        return {"ok": True, "uninstalled": plugin_id}

    def configure(self, plugin_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        entry = self._state["plugins"].get(plugin_id)
        manifest = self._manifests.get(plugin_id)
        if not entry or not manifest:
            return {"ok": False, "error": f"Plugin '{plugin_id}' is not installed."}
        merged = {**(entry.get("settings") or {}), **(patch or {})}
        validated, errors = validate_settings_against_schema(manifest.config_schema, merged)
        if errors:
            return {"ok": False, "error": "; ".join(errors)}
        # Preserve extra keys if schema is empty
        final_settings = validated if manifest.config_schema else merged
        entry["settings"] = final_settings
        entry["updatedAt"] = int(time.time() * 1000)
        self._save_state()
        host = self._hosts.get(plugin_id)
        if host and host.is_running():
            host.request("update_config", {"config": final_settings})
        return {"ok": True, "plugin": self._plugin_view(plugin_id)}

    # ------------------------------------------------------------------
    # Tool Execution, Hooks, Toolsets & Skills Hub
    # ------------------------------------------------------------------

    def list_tools(self) -> list[dict[str, Any]]:
        return list(self._tools.values())

    def invoke_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        schema = self._tools.get(tool_name)
        if not schema:
            return {"ok": False, "content": f"No active Python plugin tool named '{tool_name}'."}
        pid = str(schema["pluginId"])
        host = self._hosts.get(pid)
        if host is None or not host.is_running():
            # Attempt single crash recovery restart if plugin is still enabled
            if self._state["plugins"].get(pid, {}).get("enabled"):
                reloaded = self._start_and_load(pid)
                if not reloaded.get("ok"):
                    return {"ok": False, "content": f"Plugin '{pid}' host crashed and could not restart: {reloaded.get('error')}"}
                host = self._hosts.get(pid)
            if host is None:
                return {"ok": False, "content": f"Plugin '{pid}' is not running."}

        res = host.request("invoke_tool", {"name": tool_name, "args": args})
        if not res.get("ok"):
            return {"ok": False, "content": str(res.get("error") or "Plugin tool invocation failed.")}
        inner = res.get("result") or {}
        return {
            "ok": bool(inner.get("ok", True)),
            "content": str(inner.get("content", "")),
            **({"detail": inner["detail"]} if isinstance(inner.get("detail"), dict) else {}),
        }

    def dispatch_hook(self, event: str, payload: dict[str, Any]) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        for pid, hooks in list(self._hooks.items()):
            if not any(h.get("event") == event for h in hooks):
                continue
            host = self._hosts.get(pid)
            if host is None or not host.is_running():
                continue
            res = host.request("dispatch_hook", {"event": event, "payload": payload}, timeout_s=5.0)
            results.append({"pluginId": pid, "ok": bool(res.get("ok")), "result": res.get("result"), "error": res.get("error")})
        return {"ok": True, "event": event, "dispatched": len(results), "results": results}

    def _plugin_view(self, plugin_id: str) -> dict[str, Any]:
        entry = self._state["plugins"].get(plugin_id, {})
        m = self._manifests.get(plugin_id)
        host = self._hosts.get(plugin_id)
        return {
            "id": plugin_id,
            "name": m.name if m else plugin_id,
            "version": entry.get("version") or (m.version if m else "0.0.0"),
            "description": m.description if m else "",
            "publisher": m.publisher if m else "",
            "license": m.license if m else "",
            "provenance": entry.get("provenance") or "local",
            "enabled": bool(entry.get("enabled")),
            "running": bool(host and host.is_running()),
            "settings": dict(entry.get("settings") or {}),
            "configSchema": m.config_schema if m else {},
            "tools": [t for t in self._tools.values() if t.get("pluginId") == plugin_id],
            "hooks": list(self._hooks.get(plugin_id, [])),
            "providers": list(self._providers.get(plugin_id, [])),
            "skills": list(self._plugin_skills.get(plugin_id, [])),
            "manifest": m.to_dict() if m else None,
        }

    def list_plugins(self) -> list[dict[str, Any]]:
        return [self._plugin_view(pid) for pid in sorted(self._state.get("plugins", {}).keys())]

    def list_toolsets(self, active_tool_names: Optional[list[str]] = None) -> list[dict[str, Any]]:
        names = list(active_tool_names or []) + [t["name"] for t in self._tools.values()]
        overrides = self._state.get("toolsets", {})
        out: list[dict[str, Any]] = []
        for ts in DEFAULT_TOOLSETS:
            prefixes = tuple(ts["toolPrefixes"])
            matched = sorted({n for n in names if any(n.startswith(p) or n == p for p in prefixes)})
            enabled = bool(overrides.get(ts["id"], True))
            out.append({
                "id": ts["id"],
                "name": ts["name"],
                "category": ts["category"],
                "description": ts["description"],
                "enabled": enabled,
                "toolCount": len(matched),
                "tools": matched,
            })
        return out

    def set_toolset_enabled(self, toolset_id: str, enabled: bool) -> dict[str, Any]:
        if not any(ts["id"] == toolset_id for ts in DEFAULT_TOOLSETS):
            return {"ok": False, "error": f"Unknown toolset '{toolset_id}'."}
        self._state.setdefault("toolsets", {})[toolset_id] = bool(enabled)
        self._save_state()
        return {"ok": True, "toolsets": self.list_toolsets()}

    def skills_hub_list(self) -> list[dict[str, Any]]:
        installed = self._state.get("skillsHub", {})
        items: list[dict[str, Any]] = []
        for entry in CATALOG_SKILLS_HUB:
            sid = entry["id"]
            items.append({**entry, "installed": sid in installed, "enabled": bool(installed.get(sid, {}).get("enabled", False))})
        for sid, custom in installed.items():
            if not any(c["id"] == sid for c in CATALOG_SKILLS_HUB):
                items.append({**custom, "installed": True})
        return items

    def skills_hub_install(self, skill_id: str, *, markdown: Optional[str] = None, name: Optional[str] = None, description: Optional[str] = None) -> dict[str, Any]:
        catalog_item = next((c for c in CATALOG_SKILLS_HUB if c["id"] == skill_id), None)
        body = markdown if markdown is not None else (catalog_item["markdown"] if catalog_item else "")
        if not body.strip():
            return {"ok": False, "error": f"Skill '{skill_id}' not found in catalog and no markdown supplied."}
        skill_path = self.skills_dir / f"{skill_id}.md"
        skill_path.write_text(body, encoding="utf-8")
        record = {
            "id": skill_id,
            "name": name or (catalog_item["name"] if catalog_item else skill_id),
            "description": description or (catalog_item["description"] if catalog_item else "Installed skill"),
            "category": catalog_item["category"] if catalog_item else "local",
            "publisher": catalog_item["publisher"] if catalog_item else "Local",
            "trust": catalog_item["trust"] if catalog_item else "local",
            "version": catalog_item["version"] if catalog_item else "1.0.0",
            "path": str(skill_path),
            "enabled": True,
            "installedAt": int(time.time() * 1000),
        }
        self._state.setdefault("skillsHub", {})[skill_id] = record
        self._save_state()
        return {"ok": True, "skill": record}

    def skills_hub_remove(self, skill_id: str) -> dict[str, Any]:
        installed = self._state.get("skillsHub", {})
        if skill_id not in installed:
            return {"ok": False, "error": f"Skill '{skill_id}' is not installed."}
        skill_path = self.skills_dir / f"{skill_id}.md"
        if skill_path.is_file():
            skill_path.unlink(missing_ok=True)
        installed.pop(skill_id, None)
        self._save_state()
        return {"ok": True, "removed": skill_id}

    def emergency_stop(self) -> int:
        count = len(self._hosts)
        for pid in list(self._hosts.keys()):
            self._stop_host(pid)
        return count
