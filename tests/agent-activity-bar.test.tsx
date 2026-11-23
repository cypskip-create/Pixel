import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '@shared/types';
import {
  AgentActivityBar,
  deriveAgentActivity,
  describeToolActivity,
} from '../src/renderer/components/AgentActivityBar';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = Date.now();
  return {
    id: 'task-1',
    title: 'Inspect repository status',
    request: 'Inspect repository status',
    status: 'running',
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: 'step-1',
        title: 'Check git status',
        status: 'running',
        toolName: 'git_status',
      },
    ],
    ...overrides,
  };
}

describe('AgentActivityBar', () => {
  it('returns null when idle with no active task, streaming, or pending approval', () => {
    expect(
      deriveAgentActivity({ activeTask: null, streaming: false, hasStreamingText: false, hasPermissionRequest: false }),
    ).toBeNull();
    const html = renderToStaticMarkup(
      createElement(AgentActivityBar, { activeTask: null, streaming: false }),
    );
    expect(html).toBe('');
  });

  it('maps real tool names to honest activity labels', () => {
    expect(describeToolActivity('session_search')).toBe('Searching memory');
    expect(describeToolActivity('memory_recall')).toBe('Searching memory');
    expect(describeToolActivity('file_read')).toBe('Reading files');
    expect(describeToolActivity('file_search_content')).toBe('Reading files');
    expect(describeToolActivity('file_patch')).toBe('Editing files');
    expect(describeToolActivity('git_commit')).toBe('Running Git');
    expect(describeToolActivity('github_list_prs')).toBe('Calling GitHub');
    expect(describeToolActivity('gcal_list_events')).toBe('Checking Google Calendar');
    expect(describeToolActivity('mcp.github.create_issue')).toBe('Calling MCP tool');
    expect(describeToolActivity('skill_view')).toBe('Loading playbook');
    expect(describeToolActivity('web_search')).toBe('Searching the web');
  });

  it('surfaces Thinking and Writing response during real streaming without a TaskRecord', () => {
    expect(
      deriveAgentActivity({ activeTask: null, streaming: true, hasStreamingText: false }),
    )?.toMatchObject({ label: 'Thinking', visualState: 'working' });
    expect(
      deriveAgentActivity({ activeTask: null, streaming: true, hasStreamingText: true }),
    )?.toMatchObject({ label: 'Writing response', visualState: 'working' });
  });

  it('surfaces Awaiting approval when a permission request or approval-gated task is active', () => {
    const task = makeTask({ status: 'awaiting_approval' });
    const activity = deriveAgentActivity({ activeTask: task, streaming: false, hasPermissionRequest: true });
    expect(activity).toMatchObject({ label: 'Awaiting approval', visualState: 'approval' });

    const html = renderToStaticMarkup(
      createElement(AgentActivityBar, { activeTask: task, streaming: false, hasPermissionRequest: true }),
    );
    expect(html).toContain('data-state="approval"');
    expect(html).toContain('Awaiting approval');
  });

  it('renders real active step title and step progress count', () => {
    const task = makeTask({
      steps: [
        { id: 's1', title: 'Read config', status: 'done', toolName: 'file_read' },
        { id: 's2', title: 'Query MCP server', status: 'running', toolName: 'mcp.docs.search' },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(AgentActivityBar, { activeTask: task, streaming: false }),
    );
    expect(html).toContain('Calling MCP tool');
    expect(html).toContain('Query MCP server');
    expect(html).toContain('1/2 steps');
  });
});
