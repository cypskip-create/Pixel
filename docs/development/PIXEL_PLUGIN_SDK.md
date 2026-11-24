# Pixel Python Plugin SDK Guide (`v1.0`)

## Manifest Format (`plugin.yaml` or `plugin.json`)
```yaml
id: my-plugin
name: My Plugin
version: 1.0.0
description: Adds a custom tool to Pixel
publisher: Your Name
license: MIT
manifest_version: 2
api_version: 1
kind: standalone
entry: plugin.py
config_schema:
  greeting:
    type: string
    default: Hello
```

## Entry Point (`plugin.py`)
```python
def register(ctx):
    def run_hello(args):
        prefix = ctx.get_config("greeting", "Hello")
        return {"ok": True, "content": f"{prefix}, {args.get('name', 'world')}!"}

    ctx.register_tool(
        name="hello",
        description="Return a greeting",
        parameters={"type": "object", "properties": {"name": {"type": "string"}}},
        handler=run_hello,
        risk="low",
        requires_approval=False,
        changes_state=False,
    )
    ctx.register_hook("on_config_change", lambda payload: {"updated": True})
```

## Security & Isolation Guarantees
- Third-party plugins run in a dedicated Python subprocess (`pixel_agent.plugin_host`) with per-call timeouts and automatic crash recovery.
- All plugin tools are namespaced (`plugin_<id>_<name>`) and subject to Pixel's `PermissionBroker` and Emergency Stop.
- Disabling or uninstalling a plugin terminates its host subprocess, removes its tools from `ToolRegistry`, and revokes active permission grants.
