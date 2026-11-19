import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/shared/types';
import { ConversationTranscript } from '../src/renderer/components/ConversationTranscript';

describe('Dynamic Island transcript Pix identity', () => {
  it('keeps historic Pix avatars still and reflects the live assistant state', () => {
    const messages: ChatMessage[] = [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Earlier answer',
      createdAt: 1,
    }];
    const html = renderToStaticMarkup(createElement(ConversationTranscript, {
      messages,
      content: 'Current response',
      reasoning: '',
      streaming: true,
      assistantState: 'executing',
      error: null,
      persistence: 'session',
      onStop: vi.fn(),
      onDismiss: vi.fn(),
    }));

    expect(html).toContain('data-state="idle"');
    expect(html).toContain('data-animated="false"');
    expect(html).toContain('data-state="executing"');
    expect(html).toContain('Pixel · Responding');
  });
});
