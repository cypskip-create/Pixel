import { describe, expect, it } from 'vitest';
import {
  INITIAL_DYNAMIC_ISLAND,
  ISLAND_TIMING,
  isDynamicIslandExpanded,
  reduceDynamicIsland,
} from '../src/shared/dynamicIsland';
import { SURFACE_SIZES } from '../src/shared/surfaces';

function drive(events: Parameters<typeof reduceDynamicIsland>[1][]) {
  return events.reduce(reduceDynamicIsland, INITIAL_DYNAMIC_ISLAND);
}

describe('Dynamic Island presentation', () => {
  it('keeps the compact surface thin and centered geometry bounded', () => {
    expect(SURFACE_SIZES.idle).toEqual({ width: 144, height: 52 });
    expect(ISLAND_TIMING.hoverActivationMs).toBeGreaterThanOrEqual(100);
    expect(ISLAND_TIMING.hoverActivationMs).toBeLessThanOrEqual(180);
    expect(ISLAND_TIMING.pointerLeaveGraceMs).toBeGreaterThanOrEqual(800);
    expect(ISLAND_TIMING.pointerLeaveGraceMs).toBeLessThanOrEqual(1200);
    expect(ISLAND_TIMING.idleCollapseMs).toBeGreaterThanOrEqual(3000);
    expect(ISLAND_TIMING.idleCollapseMs).toBeLessThanOrEqual(6000);
  });

  it('opens a hover preview only after the pointer delay and collapses after grace', () => {
    const entered = reduceDynamicIsland(INITIAL_DYNAMIC_ISLAND, { type: 'POINTER_ENTER' });
    expect(entered.state).toBe('COMPACT_IDLE');
    const preview = reduceDynamicIsland(entered, { type: 'HOVER_DELAY_ELAPSED' });
    expect(preview.state).toBe('HOVER_PREVIEW');
    expect(isDynamicIslandExpanded(preview.state)).toBe(true);
    const leaving = reduceDynamicIsland(preview, { type: 'POINTER_LEAVE' });
    expect(leaving.state).toBe('COLLAPSING');
    expect(reduceDynamicIsland(leaving, { type: 'LEAVE_GRACE_ELAPSED' }).state).toBe('COMPACT_IDLE');
  });

  it('cancels leave when the pointer returns before the grace period ends', () => {
    const preview = drive([
      { type: 'POINTER_ENTER' }, { type: 'HOVER_DELAY_ELAPSED' }, { type: 'POINTER_LEAVE' },
      { type: 'POINTER_ENTER' }, { type: 'HOVER_DELAY_ELAPSED' },
    ]);
    expect(preview.state).toBe('HOVER_PREVIEW');
    expect(reduceDynamicIsland(preview, { type: 'LEAVE_GRACE_ELAPSED' }).state).toBe('HOVER_PREVIEW');
  });

  it('pins on click and will not auto-collapse with an unsent draft', () => {
    const opened = drive([{ type: 'OPEN_CLICK' }, { type: 'DRAFT_CHANGED', hasDraft: true }]);
    expect(opened.state).toBe('CLICK_EXPANDED');
    expect(reduceDynamicIsland(opened, { type: 'IDLE_TIMEOUT' })).toEqual(opened);
    const explicitlyClosed = reduceDynamicIsland(opened, { type: 'CLOSE_CLICK' });
    expect(explicitlyClosed.state).toBe('COMPACT_IDLE');
    expect(explicitlyClosed.hasDraft).toBe(true);
  });

  it('keeps approvals expanded and refuses timeout collapse', () => {
    const approval = drive([
      { type: 'OPEN_CLICK' },
      { type: 'RUNTIME_CHANGED', recording: false, transcribing: false, workActive: false, responseAvailable: false, approvalRequired: true },
      { type: 'POINTER_LEAVE' },
    ]);
    expect(approval.state).toBe('APPROVAL_REQUIRED');
    expect(isDynamicIslandExpanded(approval.state)).toBe(true);
    expect(reduceDynamicIsland(approval, { type: 'IDLE_TIMEOUT' })).toEqual(approval);
    expect(reduceDynamicIsland(approval, { type: 'LEAVE_GRACE_ELAPSED' })).toEqual(approval);
  });

  it('keeps background work compact and preserves completed response availability', () => {
    const working = drive([
      { type: 'OPEN_CLICK' },
      { type: 'RUNTIME_CHANGED', recording: false, transcribing: false, workActive: true, responseAvailable: false, approvalRequired: false },
    ]);
    expect(working.state).toBe('BACKGROUND_WORKING');
    expect(isDynamicIslandExpanded(working.state)).toBe(false);
    const ready = reduceDynamicIsland(working, {
      type: 'RUNTIME_CHANGED', recording: false, transcribing: false, workActive: false,
      responseAvailable: true, approvalRequired: false,
    });
    expect(ready.state).toBe('RESPONSE_AVAILABLE');
    expect(isDynamicIslandExpanded(ready.state)).toBe(false);
    expect(reduceDynamicIsland(ready, { type: 'RESPONSE_NOTICE_ELAPSED' }).state).toBe('COMPACT_IDLE');
  });

  it('shows recording and transcription states without opening chat', () => {
    const recording = reduceDynamicIsland(INITIAL_DYNAMIC_ISLAND, {
      type: 'RUNTIME_CHANGED', recording: true, transcribing: false, workActive: false,
      responseAvailable: false, approvalRequired: false,
    });
    expect(recording.state).toBe('RECORDING');
    expect(isDynamicIslandExpanded(recording.state)).toBe(false);
    expect(reduceDynamicIsland(recording, {
      type: 'RUNTIME_CHANGED', recording: false, transcribing: true, workActive: false,
      responseAvailable: false, approvalRequired: false,
    }).state).toBe('TRANSCRIBING');
  });
});
