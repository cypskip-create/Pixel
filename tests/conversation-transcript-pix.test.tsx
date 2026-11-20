import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/shared/types';
import { ConversationTranscript } from '../src/renderer/components/ConversationTranscript';

describe('Dynamic Island transcript identity', () => {
  it('uses clean text identity without duplicate Pix mascots', () => {
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
      error: null,
      persistence: 'session',
      onStop: vi.fn(),
      onDismiss: vi.fn(),
    }));

    expect(html).not.toContain('pix-mascot');
    expect(html).toContain('Pixel · Responding');
  });
});
