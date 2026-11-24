"""Pixel Python Plugin SDK (`PluginContext`, adapted from Hermes `plugins_context.py`).

Provides a narrow, versioned registration API for third-party and bundled Python
plugins without exposing unrestricted application internals. Every registration
is tracked in a host-owned ledger so disabling or unloading a plugin cleanly
removes all of its tools, hooks, providers, and skills.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .plugin_manifest import PluginManifest

PLUGIN_SDK_VERSION = "1.0"

VALID_HOOK_EVENTS = frozenset({
    "on_load",
    "on_unload",
    "on_session_start",
    "on_session_end",
    "before_agent_run",
    "after_agent_run",
    "before_tool_call",
    "after_tool_call",
    "on_context_process",
    "on_memory_event",
    "on_config_change",
    "on_task_event",
    "on_error",
})

VALID_PROVIDER_KINDS = frozenset({
    "model",
    "browser",
    "web",
    "speech",
    "image",
    "memory",
    "context",
    "delegation",
})


@dataclass
class RegisteredPluginTool:
    plugin_id: str
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], Any]
    risk: str = "medium"
    requires_approval: bool = True
    changes_state: bool = False

    def to_schema(self) -> dict[str, Any]:
        return {
            "pluginId": self.plugin_id,
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "risk": self.risk,
            "requiresApproval": self.requires_approval,
            "changesState": self.changes_state,
        }


@dataclass
class RegisteredPluginHook:
    plugin_id: str
    event: str
    handler: Callable[[dict[str, Any]], Any]
    priority: int = 100


@dataclass
class RegisteredPluginProvider:
    plugin_id: str
    kind: str
    name: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RegisteredPluginSkill:
    plugin_id: str
    name: str
    description: str
    markdown: str


class PluginContext:
    """Versioned `ctx` facade passed to a plugin's `register(ctx)` entry point."""

    def __init__(
        self,
        manifest: PluginManifest,
        config: Optional[dict[str, Any]] = None,
        *,
        active_plugins_probe: Optional[Callable[[str], bool]] = None,
    ) -> None:
        self.manifest = manifest
        self.api_version = PLUGIN_SDK_VERSION
        self._config: dict[str, Any] = dict(config or {})
        self._active_plugins_probe = active_plugins_probe
        self.tools: dict[str, RegisteredPluginTool] = {}
        self.hooks: list[RegisteredPluginHook] = []
        self.providers: list[RegisteredPluginProvider] = []
        self.skills: list[RegisteredPluginSkill] = []
        self._unload_callbacks: list[Callable[[], Any]] = []
        self.notifications: list[dict[str, Any]] = []

    @property
    def plugin_id(self) -> str:
        return self.manifest.id

    def get_config(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    def update_config(self, new_config: dict[str, Any]) -> None:
        self._config = dict(new_config)

    def has_plugin(self, plugin_id: str) -> bool:
        if self._active_plugins_probe:
            return bool(self._active_plugins_probe(plugin_id))
        return False

    def register_tool(
        self,
        *,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: Callable[[dict[str, Any]], Any],
        risk: str = "medium",
        requires_approval: bool = True,
        changes_state: bool = False,
    ) -> str:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Plugin tool name cannot be empty.")
        # Namespace non-prefixed plugin tools cleanly to prevent collisions with core tools
        full_name = clean_name if clean_name.startswith(f"plugin_{self.plugin_id}_") else f"plugin_{self.plugin_id}_{clean_name}"
        full_name = full_name.replace("-", "_").replace(".", "_")
        if not callable(handler):
            raise ValueError(f"Tool '{full_name}' handler must be callable.")
        self.tools[full_name] = RegisteredPluginTool(
            plugin_id=self.plugin_id,
            name=full_name,
            description=description.strip(),
            parameters=parameters if isinstance(parameters, dict) else {"type": "object", "properties": {}},
            handler=handler,
            risk=risk if risk in ("low", "medium", "high") else "medium",
            requires_approval=bool(requires_approval),
            changes_state=bool(changes_state),
        )
        return full_name

    def unregister_tool(self, name: str) -> bool:
        return self.tools.pop(name, None) is not None

    def register_hook(self, event: str, handler: Callable[[dict[str, Any]], Any], *, priority: int = 100) -> None:
        if event not in VALID_HOOK_EVENTS:
            raise ValueError(f"Unsupported hook event '{event}'.")
        if not callable(handler):
            raise ValueError(f"Hook handler for '{event}' must be callable.")
        self.hooks.append(RegisteredPluginHook(plugin_id=self.plugin_id, event=event, handler=handler, priority=int(priority)))

    def register_provider(self, kind: str, name: str, metadata: Optional[dict[str, Any]] = None) -> None:
        if kind not in VALID_PROVIDER_KINDS:
            raise ValueError(f"Unsupported provider kind '{kind}'.")
        self.providers.append(
            RegisteredPluginProvider(plugin_id=self.plugin_id, kind=kind, name=name.strip(), metadata=dict(metadata or {}))
        )

    def register_skill(self, name: str, description: str, markdown: str) -> None:
        self.skills.append(
            RegisteredPluginSkill(plugin_id=self.plugin_id, name=name.strip(), description=description.strip(), markdown=markdown)
        )

    def emit_notification(self, title: str, message: str, level: str = "info") -> None:
        self.notifications.append({"pluginId": self.plugin_id, "title": title, "message": message, "level": level})

    def on_unload(self, callback: Callable[[], Any]) -> None:
        if callable(callback):
            self._unload_callbacks.append(callback)

    def release_all(self) -> None:
        for cb in list(self._unload_callbacks):
            try:
                cb()
            except Exception:
                pass
        self._unload_callbacks.clear()
        self.tools.clear()
        self.hooks.clear()
        self.providers.clear()
        self.skills.clear()
