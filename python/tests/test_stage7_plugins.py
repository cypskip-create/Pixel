"""Production acceptance tests for Pixel's Stage 7 Python-first Plugin Platform."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pixel_agent.plugin_manager import PluginManager
from pixel_agent.plugin_manifest import PluginManifest, parse_manifest_dict, resolve_dependency_order


def _write_demo_plugin(root: Path, *, version: str = "1.0.0", broken: bool = False) -> Path:
    pdir = root / f"demo-{version}"
    pdir.mkdir(parents=True, exist_ok=True)
    (pdir / "plugin.yaml").write_text(
        f"""id: demo
name: Demo Greeter
version: {version}
description: Demonstration Python plugin for Stage 7 acceptance
publisher: Pixel Tests
license: MIT
manifest_version: 2
api_version: 1
kind: standalone
entry: plugin.py
config_schema:
  prefix:
    type: string
    default: Hello
""",
        encoding="utf-8",
    )
    if broken:
        (pdir / "plugin.py").write_text("def register(ctx):\n    raise RuntimeError('broken v2')\n", encoding="utf-8")
    else:
        (pdir / "plugin.py").write_text(
            f"""def register(ctx):
    def greet(args):
        prefix = ctx.get_config("prefix", "Hello")
        who = args.get("name", "world")
        return {{"ok": True, "content": f"{{prefix}}, {{who}}! (v{version})"}}

    ctx.register_tool(
        name="greet",
        description="Return a configurable greeting",
        parameters={{"type": "object", "properties": {{"name": {{"type": "string"}}}}}},
        handler=greet,
        risk="low",
        requires_approval=False,
        changes_state=False,
    )
    ctx.register_hook("on_config_change", lambda payload: {{"seen": payload.get("config")}})
    ctx.register_provider("web", "demo-search", {{"version": "{version}"}})
    ctx.register_skill("demo-skill", "Demo skill", "# Demo Skill\\nSay hello.")
""",
            encoding="utf-8",
        )
    return pdir


class TestStage7PythonPluginPlatform(unittest.TestCase):
    def test_full_plugin_lifecycle_persistence_update_rollback_and_crash_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            data_dir = tmp_path / "data"
            v1_dir = _write_demo_plugin(tmp_path, version="1.0.0")
            v2_dir = _write_demo_plugin(tmp_path, version="1.1.0")
            broken_dir = _write_demo_plugin(tmp_path, version="2.0.0", broken=True)

            mgr = PluginManager(data_dir=data_dir)
            try:
                # 1. Discover local YAML plugin
                disc = mgr.discover(v1_dir)
                self.assertTrue(disc["ok"])
                self.assertEqual(len(disc["plugins"]), 1)
                self.assertEqual(disc["plugins"][0]["id"], "demo")

                # 2. Install & Enable
                inst = mgr.install(v1_dir, provenance="local", enable=True)
                self.assertTrue(inst["ok"])
                tools = mgr.list_tools()
                self.assertTrue(any(t["name"] == "plugin_demo_greet" for t in tools))

                # 3. Invoke real tool inside isolated subprocess plugin host
                out1 = mgr.invoke_tool("plugin_demo_greet", {"name": "Pixel"})
                self.assertTrue(out1["ok"])
                self.assertEqual(out1["content"], "Hello, Pixel! (v1.0.0)")

                # 4. Change plugin setting & verify runtime effect
                cfg = mgr.configure("demo", {"prefix": "Howdy"})
                self.assertTrue(cfg["ok"])
                out2 = mgr.invoke_tool("plugin_demo_greet", {"name": "Pixel"})
                self.assertEqual(out2["content"], "Howdy, Pixel! (v1.0.0)")

                # 5. Crash recovery: kill host process, next invoke_tool auto-restarts
                mgr._hosts["demo"].stop()
                out3 = mgr.invoke_tool("plugin_demo_greet", {"name": "Resilient"})
                self.assertTrue(out3["ok"])
                self.assertEqual(out3["content"], "Howdy, Resilient! (v1.0.0)")

                # 6. Restart PluginManager & verify persisted state & settings
                mgr.emergency_stop()
                mgr2 = PluginManager(data_dir=data_dir)
                try:
                    out4 = mgr2.invoke_tool("plugin_demo_greet", {"name": "Restarted"})
                    self.assertTrue(out4["ok"])
                    self.assertEqual(out4["content"], "Howdy, Restarted! (v1.0.0)")

                    # 7. Successful update v1.0.0 -> v1.1.0
                    upd_ok = mgr2.update("demo", v2_dir)
                    self.assertTrue(upd_ok["ok"])
                    out5 = mgr2.invoke_tool("plugin_demo_greet", {"name": "Upgraded"})
                    self.assertEqual(out5["content"], "Howdy, Upgraded! (v1.1.0)")

                    # 8. Failed update rolls back cleanly to v1.1.0
                    upd_fail = mgr2.update("demo", broken_dir)
                    self.assertFalse(upd_fail["ok"])
                    self.assertTrue(upd_fail.get("rolledBack"))
                    out6 = mgr2.invoke_tool("plugin_demo_greet", {"name": "Safe"})
                    self.assertEqual(out6["content"], "Howdy, Safe! (v1.1.0)")

                    # 9. Disable removes tools from active catalog
                    dis = mgr2.disable("demo")
                    self.assertTrue(dis["ok"])
                    self.assertEqual(mgr2.list_tools(), [])

                    # 10. Uninstall removes plugin completely
                    un = mgr2.uninstall("demo")
                    self.assertTrue(un["ok"])
                    self.assertEqual(mgr2.list_plugins(), [])
                finally:
                    mgr2.emergency_stop()
            finally:
                mgr.emergency_stop()

    def test_manifest_validation_dependency_cycles_toolsets_and_skills_hub(self) -> None:
        # Invalid manifest version rejected
        m, errs = parse_manifest_dict({"id": "bad", "version": "1.0.0", "manifest_version": 99})
        self.assertIsNone(m)
        self.assertTrue(any("Unsupported manifest_version" in e for e in errs))

        # Dependency cycle detected
        a = PluginManifest(id="alpha", name="Alpha", version="1.0.0", requires_plugins=["beta"])
        b = PluginManifest(id="beta", name="Beta", version="1.0.0", requires_plugins=["alpha"])
        _order, cycle_errs = resolve_dependency_order({"alpha": a, "beta": b})
        self.assertTrue(any("cycle" in e.lower() for e in cycle_errs))

        with tempfile.TemporaryDirectory() as tmp:
            mgr = PluginManager(data_dir=tmp)
            ts = mgr.list_toolsets(["browser_navigate", "process_start", "computer_use"])
            self.assertTrue(any(t["id"] == "browser" and t["toolCount"] == 1 for t in ts))
            toggled = mgr.set_toolset_enabled("browser", False)
            self.assertTrue(toggled["ok"])
            self.assertFalse(next(t for t in mgr.list_toolsets() if t["id"] == "browser")["enabled"])

            hub = mgr.skills_hub_list()
            self.assertGreaterEqual(len(hub), 3)
            inst_sk = mgr.skills_hub_install("code-review-checklist")
            self.assertTrue(inst_sk["ok"])
            self.assertTrue(next(s for s in mgr.skills_hub_list() if s["id"] == "code-review-checklist")["installed"])
            rem_sk = mgr.skills_hub_remove("code-review-checklist")
            self.assertTrue(rem_sk["ok"])


if __name__ == "__main__":
    unittest.main()
