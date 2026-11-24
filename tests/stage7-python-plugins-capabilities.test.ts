import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';
import { ToolExecutors } from '../src/main/agent/executors';
import { ContinuousVoiceClient, GptLiveWebRtcSession } from '../src/renderer/lib/voiceSession';

describe('Stage 7: Python-First Plugin Platform, Toolsets, Skills Hub & Voice Session Clients', () => {
  it('installs, enables, invokes, configures, disables, and uninstalls a real Python plugin through PythonAgentBridge & ToolExecutors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-s7-'));
    const pluginDataDir = join(root, 'plugin-data');
    const demoDir = join(root, 'demo-plugin');
    mkdirSync(demoDir, { recursive: true });
    writeFileSync(
      join(demoDir, 'plugin.json'),
      JSON.stringify({
        id: 'calc_ext',
        name: 'Calc Extension',
        version: '1.0.0',
        description: 'Adds a dynamic plugin tool',
        publisher: 'Test',
        manifest_version: 2,
        api_version: 1,
        entry: 'plugin.py',
        config_schema: {
          multiplier: { type: 'integer', default: 2 },
        },
      }),
      'utf8',
    );
    writeFileSync(
      join(demoDir, 'plugin.py'),
      [
        'def register(ctx):',
        '    def scale(args):',
        '        mult = int(ctx.get_config("multiplier", 2))',
        '        val = int(args.get("value", 0))',
        '        return {"ok": True, "content": f"scaled={val * mult}"}',
        '    ctx.register_tool(',
        '        name="scale",',
        '        description="Multiply a value by configured multiplier",',
        '        parameters={"type": "object", "properties": {"value": {"type": "integer"}}},',
        '        handler=scale,',
        '        risk="low",',
        '        requires_approval=False,',
        '        changes_state=False,',
        '    )',
      ].join('\n'),
      'utf8',
    );

    const bridge = new PythonAgentBridge({ pluginDataDir });
    const executors = new ToolExecutors({ pythonBridge: bridge });
    try {
      const installed = await bridge.pluginInstall({ sourceDir: demoDir, provenance: 'local', enable: true });
      expect(installed.ok).toBe(true);

      const tools = await bridge.pluginListTools();
      expect(tools.some((t) => t.name === 'plugin_calc_ext_scale')).toBe(true);

      // Invoke dynamic Python plugin tool directly through Pixel's production ToolExecutors
      const res1 = await executors.run('plugin_calc_ext_scale', { value: 7 });
      expect(res1.ok).toBe(true);
      expect(res1.content).toBe('scaled=14');

      // Reconfigure setting live & confirm runtime behavior changes
      const cfg = await bridge.pluginConfigure('calc_ext', { multiplier: 5 });
      expect(cfg.ok).toBe(true);
      const res2 = await executors.run('plugin_calc_ext_scale', { value: 7 });
      expect(res2.ok).toBe(true);
      expect(res2.content).toBe('scaled=35');

      // Toolsets & Skills Hub over real Python NDJSON stdio
      const toolsets = await bridge.toolsetsList(['browser_navigate', 'plugin_calc_ext_scale']);
      expect(toolsets.some((t) => t.id === 'plugins' && t.toolCount >= 1)).toBe(true);

      const hub = await bridge.skillsHubList();
      expect(hub.length).toBeGreaterThanOrEqual(3);
      const skInst = await bridge.skillsHubInstall({ skillId: 'release-notes-drafter' });
      expect(skInst.ok).toBe(true);
      const skRem = await bridge.skillsHubRemove('release-notes-drafter');
      expect(skRem.ok).toBe(true);

      // Disable removes tools; uninstall cleans up
      const dis = await bridge.pluginDisable('calc_ext');
      expect(dis.ok).toBe(true);
      expect(await bridge.pluginListTools()).toEqual([]);

      const un = await bridge.pluginUninstall('calc_ext');
      expect(un.ok).toBe(true);
    } finally {
      await bridge.dispose();
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Best-effort cleanup on Windows.
      }
    }
  });

  it('handles unavailable browser WebRTC and Continuous Voice IPC gracefully in renderer voice controllers', async () => {
    const live = new GptLiveWebRtcSession();
    const conn = await live.connect();
    expect(conn.ok).toBe(false);
    expect(live.getState()).toBe('error');

    const cont = new ContinuousVoiceClient();
    const started = await cont.start();
    expect(started.ok).toBe(false);
  });
});
