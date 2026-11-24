import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';

describe('Stage 8: Python-First Gateway, Pairing, Webhooks & Authenticated Remote API', () => {
  it('runs real Python GatewayService over NDJSON stdio with HTTP remote API, HMAC webhooks, Telegram pairing, and Emergency Stop', async () => {
    const gatewayDataDir = mkdtempSync(join(tmpdir(), 'pixel-s8-gw-'));
    const bridge = new PythonAgentBridge({ gatewayDataDir });
    try {
      const started = await bridge.gatewayStart({ host: '127.0.0.1', port: 0 });
      expect(started.ok).toBe(true);
      const port = started.http?.port ?? 0;
      expect(port).toBeGreaterThan(0);

      // 1. Health check on loopback HTTP
      const healthRes = await fetch(`http://127.0.0.1:${port}/v1/health`);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as { ok: boolean; service: string };
      expect(health.ok).toBe(true);
      expect(health.service).toBe('pixel-gateway');

      // 2. Unauthenticated remote API request -> 401
      const unauth = await fetch(`http://127.0.0.1:${port}/v1/sessions`);
      expect(unauth.status).toBe(401);

      // 3. Pair device & authenticate /v1/chat/completions
      const paired = await bridge.gatewayDevicePair({ deviceName: 'Pixel Remote', projectId: 'proj-remote' });
      expect(paired.ok).toBe(true);
      const token = paired.token ?? '';
      expect(token.startsWith('pxd_')).toBe(true);

      const chatRes = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'ping remote' }] }),
      });
      expect(chatRes.status).toBe(200);
      const chatJson = (await chatRes.json()) as { ok: boolean; choices: Array<{ message: { content: string } }> };
      expect(chatJson.ok).toBe(true);
      expect(chatJson.choices[0]?.message.content).toContain('proj-remote');

      // 4. Create HMAC-SHA256 webhook, reject bad signature (401), accept valid (200), reject replay (409)
      const wh = await bridge.gatewayWebhookCreate({ name: 'CI Hook', projectId: 'proj-ci', eventFilters: ['workflow_run'] });
      expect(wh.ok).toBe(true);
      const whPath = String((wh.route as { path?: string })?.path ?? '');
      const secret = wh.signingSecret ?? '';
      const body = JSON.stringify({ action: 'completed' });
      const sig = createHmac('sha256', secret).update(body).digest('hex');

      const badWh = await fetch(`http://127.0.0.1:${port}${whPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pixel-Signature-256': 'sha256=0000', 'X-Pixel-Event': 'workflow_run' },
        body,
      });
      expect(badWh.status).toBe(401);

      const okWh = await fetch(`http://127.0.0.1:${port}${whPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pixel-Signature-256': `sha256=${sig}`, 'X-Pixel-Delivery': 'd-100', 'X-Pixel-Event': 'workflow_run' },
        body,
      });
      expect(okWh.status).toBe(200);

      const replayWh = await fetch(`http://127.0.0.1:${port}${whPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pixel-Signature-256': `sha256=${sig}`, 'X-Pixel-Delivery': 'd-100', 'X-Pixel-Event': 'workflow_run' },
        body,
      });
      expect(replayWh.status).toBe(409);

      // 5. Telegram inbound default-deny -> approve pairing -> authorized reply
      const tg1 = await bridge.gatewayInbound('telegram', {
        update_id: 1,
        message: { message_id: 1, from: { id: 555, username: 'bob' }, chat: { id: 555, type: 'private' }, text: 'hello' },
      });
      expect(tg1.ok).toBe(false);
      expect(tg1.unauthorized).toBe(true);

      const apr = await bridge.gatewayPairingApprove({ code: String(tg1.pairingCode ?? ''), projectId: 'proj-tg' });
      expect(apr.ok).toBe(true);

      const tg2 = await bridge.gatewayInbound('telegram', {
        update_id: 2,
        message: { message_id: 2, from: { id: 555, username: 'bob' }, chat: { id: 555, type: 'private' }, text: 'status' },
      });
      expect(tg2.ok).toBe(true);
      expect(String(tg2.reply ?? '')).toContain('proj-tg');

      // 6. Emergency stop shuts down gateway cleanly
      const estop = await bridge.gatewayEmergencyStop();
      expect(estop.emergencyStopped).toBe(true);
    } finally {
      await bridge.dispose();
      try {
        rmSync(gatewayDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Best-effort temp cleanup.
      }
    }
  });
});
