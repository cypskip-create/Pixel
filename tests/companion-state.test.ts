import { describe, expect, it } from 'vitest';
import { deriveAssistantState } from '../src/shared/companion-state';
import { ASSISTANT_STATES } from '../src/shared/types';
import { ORB_VISUALS } from '../src/renderer/lib/orbVisuals';

const base = {
  stopped: false,
  permission: false,
  streaming: false,
  hasAnswer: false,
  error: false,
  listening: false,
};

describe('companion state', () => {
  it('has a visual definition for every public assistant state', () => {
    expect(Object.keys(ORB_VISUALS).sort()).toEqual([...ASSISTANT_STATES].sort());
  });

  it('shows the approval wait distinctly instead of reporting listening', () => {
    expect(deriveAssistantState({ ...base, permission: true })).toBe('waiting_for_approval');
  });

  it('gives emergency stop highest priority', () => {
    expect(
      deriveAssistantState({ ...base, stopped: true, permission: true, streaming: true }),
    ).toBe('stopped');
  });

  it('separates model response streaming from voice playback', () => {
    expect(deriveAssistantState({ ...base, streaming: true })).toBe('thinking');
    expect(deriveAssistantState({ ...base, streaming: true, hasAnswer: true })).toBe('responding');
    expect(deriveAssistantState({ ...base, speaking: true })).toBe('speaking');
  });

  it('shows execution, pointing, and errors with explicit states', () => {
    expect(deriveAssistantState({ ...base, executing: true })).toBe('executing');
    expect(deriveAssistantState({ ...base, pointing: true })).toBe('pointing');
    expect(deriveAssistantState({ ...base, error: true, streaming: true })).toBe('error');
  });

  it('returns to idle when no active signal remains', () => {
    expect(deriveAssistantState(base)).toBe('idle');
  });
});
