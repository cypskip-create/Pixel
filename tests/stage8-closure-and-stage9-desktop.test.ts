/**
 * Stage 8 Production Closure + Stage 9 Desktop Acceptance Tests.
 *
 * 1. Spawns the real `python/agent_service.py` subprocess via `PythonAgentBridge`
 *    to verify `gatewayConfigureAgent`, `profiles*`, `artifacts*`, `starmapBuild`,
 *    and `sessionImportPreview/Commit` over real NDJSON IPC.
 * 2. Renders Stage 9 full-page desktop destinations (`CommandCenterPage`,
 *    `ProfilesPage`, `DedicatedMessagingPage`, `DedicatedWebhooksPage`) to verify
 *    wired controls and monochrome UI mounting.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';
import {
  CommandCenterPage,
  ProfilesPage,
  AgentsPage,
  ArtifactsPage,
  CronPage,
  StarmapPage,
  SessionImportPage,
  DedicatedMessagingPage,
  DedicatedWebhooksPage,
} from '../src/renderer/components/Stage9Destinations';

describe('Stage 8 Closure & Stage 9 Python Bridge Integration', () => {
  let tempDir: string | null = null;
  let bridge: PythonAgentBridge | null = null;

  afterEach(async () => {
    if (bridge) {
      await bridge.dispose().catch(() => undefined);
      bridge = null;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('exercises profiles, artifacts, starmap, session import, and gateway agent config over real Python IPC', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pixel-stage9-'));
    bridge = new PythonAgentBridge({
      gatewayDataDir: join(tempDir, 'gateway'),
      workspaceDataDir: join(tempDir, 'workspace'),
    });

    const configured = await bridge.gatewayConfigureAgent({
      provider: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKey: 'test-key',
      },
      tools: [{ name: 'read_file', description: 'Read a file' }],
    });
    expect(configured.configured).toBe(true);
    expect(configured.toolCount).toBe(1);

    // Profiles lifecycle
    const initialProfiles = await bridge.profilesList();
    expect(initialProfiles.ok).toBe(true);
    expect(initialProfiles.activeProfileId).toBe('default');

    const created = await bridge.profilesCreate({
      name: 'Stage 9 Lab',
      description: 'Isolated profile',
    });
    expect(created.ok).toBe(true);
    const createdId = (created.profile as { id: string }).id;

    const switched = await bridge.profilesSwitch(createdId);
    expect(switched.ok).toBe(true);
    expect(switched.activeProfileId).toBe(createdId);

    // Artifacts scoped to active profile
    const registered = await bridge.artifactsRegister({
      name: 'Architecture Notes',
      kind: 'markdown',
      projectId: 'proj-stage9',
      previewText: 'Stage 9 summary',
    });
    expect(registered.ok).toBe(true);
    const artList = await bridge.artifactsList({ projectId: 'proj-stage9' });
    expect(artList.length).toBe(1);

    // Grounded Starmap
    const starmap = await bridge.starmapBuild({
      memories: [{ id: 'm1', content: 'Python default runtime', createdAt: 1000 }],
      skills: [{ id: 'sk1', name: 'Release Audit', createdAt: 1500 }],
      sessions: [{ id: 's1', title: 'Stage 9 Kickoff', updatedAt: 2000 }],
      projectId: 'proj-stage9',
    });
    expect(starmap.ok).toBe(true);
    expect(Array.isArray(starmap.nodes)).toBe(true);
    expect((starmap.nodes as unknown[]).length).toBeGreaterThanOrEqual(4);

    // Session import preview + commit + duplicate rejection
    const md = 'User: Hello\n\nAssistant: World\n';
    const preview = await bridge.sessionImportPreview(md, 'markdown');
    expect(preview.ok).toBe(true);
    expect(preview.messageCount).toBe(2);

    const committed = await bridge.sessionImportCommit(md, 'markdown');
    expect(committed.ok).toBe(true);

    const dup = await bridge.sessionImportCommit(md, 'markdown');
    expect(dup.ok).toBe(false);
    expect(dup.duplicate).toBe(true);

    // Clean delete of non-default profile returns to default
    const deleted = await bridge.profilesDelete(createdId);
    expect(deleted.ok).toBe(true);
    const afterDelete = await bridge.profilesList();
    expect(afterDelete.activeProfileId).toBe('default');
  }, 20000);
});

describe('Stage 9 Full-Page Desktop Destinations Render', () => {
  it('renders all dedicated Stage 9 pages cleanly without runtime errors', () => {
    const pages = [
      { el: createElement(CommandCenterPage), heading: 'Command Center' },
      { el: createElement(ProfilesPage), heading: 'Profiles' },
      { el: createElement(AgentsPage), heading: 'Agents &amp; Delegation' },
      { el: createElement(ArtifactsPage, { projectId: 'default' }), heading: 'Artifacts' },
      { el: createElement(CronPage), heading: 'Cron &amp; Scheduled Jobs' },
      { el: createElement(StarmapPage), heading: 'Starmap' },
      { el: createElement(SessionImportPage), heading: 'Session Import' },
      { el: createElement(DedicatedMessagingPage), heading: 'Messaging' },
      { el: createElement(DedicatedWebhooksPage), heading: 'Webhooks' },
    ];
    for (const page of pages) {
      const html = renderToStaticMarkup(page.el);
      expect(html).toContain(page.heading);
    }
  });
});
