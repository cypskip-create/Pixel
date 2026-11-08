import { describe, expect, it } from 'vitest';
import {
  COMPANION_ANNOUNCEMENTS,
  COMPANION_STATES,
  INITIAL_CONTEXT,
  canHide,
  deriveCompanionState,
  reduce,
  shouldAutoHide,
  type CompanionContext,
  type CompanionEvent,
} from '../src/shared/companion/stateMachine';
import {
  clampPoint,
  displayContaining,
  ensureVisible,
  fitCaptureSize,
  fromWindowRelative,
  mapGlobalToImagePoint,
  mapImagePointToGlobal,
  nearestDisplay,
  rectContains,
  toWindowRelative,
  type DisplayInfo,
} from '../src/shared/companion/geometry';
import {
  companionTarget,
  createFollower,
  isSettled,
  placeBubble,
  stepFollower,
  DEFAULT_FOLLOW_CONFIG,
} from '../src/shared/companion/cursorFollow';
import {
  confidenceFor,
  flightHeading,
  flightPosition,
  makeTarget,
  parseVisionTargets,
  planFlight,
  reconcileTarget,
} from '../src/shared/companion/pointing';
import { ASSISTANT_STATES } from '../src/shared/types';
import { ORB_VISUALS } from '../src/renderer/lib/orbVisuals';
import { deriveAssistantState } from '../src/shared/companion-state';

/* ================================================================== *
 * State machine
 * ================================================================== */

function run(events: CompanionEvent[], from: CompanionContext = INITIAL_CONTEXT): CompanionContext {
  return events.reduce((ctx, event) => reduce(ctx, event).context, from);
}
const at = (t: number): { at: number } => ({ at: t });

describe('companion state machine', () => {
  it('starts idle', () => {
    expect(deriveCompanionState(INITIAL_CONTEXT)).toBe('idle');
  });

  it('walks a normal spoken request end to end', () => {
    const steps: Array<[CompanionEvent, string]> = [
      [{ type: 'LISTEN_START', ...at(1) }, 'listening'],
      [{ type: 'LISTEN_END', ...at(2), heardSpeech: true }, 'thinking'],
      [{ type: 'STREAM_DELTA', ...at(3) }, 'responding'],
      [{ type: 'SPEECH_START', ...at(4) }, 'speaking'],
      [{ type: 'RUN_COMPLETE', ...at(5) }, 'speaking'],
      [{ type: 'SPEECH_END', ...at(6) }, 'idle'],
    ];
    let ctx = INITIAL_CONTEXT;
    for (const [event, expected] of steps) {
      ctx = reduce(ctx, event).context;
      expect(deriveCompanionState(ctx)).toBe(expected);
    }
  });

  it('returns to idle when nothing was heard', () => {
    const ctx = run([
      { type: 'LISTEN_START', ...at(1) },
      { type: 'LISTEN_END', ...at(2), heardSpeech: false },
    ]);
    expect(deriveCompanionState(ctx)).toBe('idle');
  });

  it('shows executing while a tool runs, and counts overlapping tools', () => {
    let ctx = run([{ type: 'SUBMIT', ...at(1) }, { type: 'TOOL_START', ...at(2) }, { type: 'TOOL_START', ...at(3) }]);
    expect(deriveCompanionState(ctx)).toBe('executing');
    ctx = run([{ type: 'TOOL_END', ...at(4) }], ctx);
    expect(deriveCompanionState(ctx)).toBe('executing');
    ctx = run([{ type: 'TOOL_END', ...at(5) }], ctx);
    expect(deriveCompanionState(ctx)).toBe('thinking');
  });

  it('shows waiting_for_approval, never listening, while an approval is pending', () => {
    const ctx = run([{ type: 'SUBMIT', ...at(1) }, { type: 'APPROVAL_REQUESTED', ...at(2) }]);
    expect(deriveCompanionState(ctx)).toBe('waiting_for_approval');
  });

  it('cannot be talked over while an approval is pending', () => {
    const waiting = run([{ type: 'SUBMIT', ...at(1) }, { type: 'APPROVAL_REQUESTED', ...at(2) }]);
    expect(reduce(waiting, { type: 'LISTEN_START', ...at(3) }).accepted).toBe(false);
    expect(reduce(waiting, { type: 'SUBMIT', ...at(3) }).accepted).toBe(false);
  });

  it('barge-in: talking while Pixel speaks stops the speech and cancels the request', () => {
    const speaking = run([
      { type: 'SUBMIT', ...at(1) },
      { type: 'STREAM_DELTA', ...at(2) },
      { type: 'SPEECH_START', ...at(3) },
    ]);
    const result = reduce(speaking, { type: 'LISTEN_START', ...at(4) });
    expect(result.effects).toEqual(expect.arrayContaining(['cancel_request', 'stop_speech']));
    expect(deriveCompanionState(result.context)).toBe('listening');
    expect(result.context.speaking).toBe(false);
  });

  it('a new request interrupts an old one', () => {
    const busy = run([{ type: 'SUBMIT', ...at(1) }, { type: 'TOOL_START', ...at(2) }]);
    const result = reduce(busy, { type: 'SUBMIT', ...at(3) });
    expect(result.effects).toContain('cancel_request');
    expect(result.context.toolsRunning).toBe(0);
    expect(deriveCompanionState(result.context)).toBe('thinking');
  });

  it('cancels pointing when the user starts talking', () => {
    const pointing = run([{ type: 'POINT_START', ...at(1) }]);
    expect(deriveCompanionState(pointing)).toBe('pointing');
    const result = reduce(pointing, { type: 'LISTEN_START', ...at(2) });
    expect(result.effects).toContain('cancel_pointing');
    expect(result.context.pointing).toBe(false);
  });

  it('emergency stop latches, clears everything and tells the caller to stop work', () => {
    const busy = run([
      { type: 'SUBMIT', ...at(1) },
      { type: 'TOOL_START', ...at(2) },
      { type: 'SPEECH_START', ...at(3) },
      { type: 'POINT_START', ...at(4) },
    ]);
    const stopped = reduce(busy, { type: 'EMERGENCY_STOP', ...at(5) });
    expect(deriveCompanionState(stopped.context)).toBe('stopped');
    expect(stopped.effects).toEqual(['cancel_request', 'stop_speech', 'cancel_pointing']);
    expect(stopped.context).toMatchObject({
      requestActive: false,
      toolsRunning: 0,
      speaking: false,
      pointing: false,
    });
  });

  it('refuses every event except STOP_CLEARED while stopped', () => {
    const stopped = run([{ type: 'EMERGENCY_STOP', ...at(1) }]);
    for (const event of [
      { type: 'LISTEN_START', ...at(2) },
      { type: 'SUBMIT', ...at(2) },
      { type: 'SPEECH_START', ...at(2) },
      { type: 'POINT_START', ...at(2) },
    ] as CompanionEvent[]) {
      expect(reduce(stopped, event).accepted).toBe(false);
    }
    const cleared = reduce(stopped, { type: 'STOP_CLEARED', ...at(3) });
    expect(cleared.accepted).toBe(true);
    expect(deriveCompanionState(cleared.context)).toBe('idle');
  });

  it('records a failure, shows error, and clears it when a new request starts', () => {
    let ctx = run([{ type: 'SUBMIT', ...at(1) }, { type: 'FAILED', ...at(2), reason: 'network down' }]);
    expect(deriveCompanionState(ctx)).toBe('error');
    expect(ctx.error).toBe('network down');
    ctx = run([{ type: 'SUBMIT', ...at(3) }], ctx);
    expect(ctx.error).toBeNull();
    expect(deriveCompanionState(ctx)).toBe('thinking');
  });

  it('CANCELLED returns to idle without an error', () => {
    const ctx = run([{ type: 'SUBMIT', ...at(1) }, { type: 'TOOL_START', ...at(2) }, { type: 'CANCELLED', ...at(3) }]);
    expect(deriveCompanionState(ctx)).toBe('idle');
  });

  it('ignores events that do not make sense instead of corrupting state', () => {
    expect(reduce(INITIAL_CONTEXT, { type: 'TOOL_END', ...at(1) }).accepted).toBe(false);
    expect(reduce(INITIAL_CONTEXT, { type: 'STREAM_DELTA', ...at(1) }).accepted).toBe(false);
    expect(reduce(INITIAL_CONTEXT, { type: 'APPROVAL_RESOLVED', ...at(1) }).accepted).toBe(false);
  });

  it('never lets the tool counter go negative', () => {
    const ctx = run([{ type: 'TOOL_END', ...at(1) }, { type: 'TOOL_END', ...at(2) }]);
    expect(ctx.toolsRunning).toBe(0);
  });

  it('is pure: the input context is never mutated', () => {
    const before = JSON.stringify(INITIAL_CONTEXT);
    reduce(INITIAL_CONTEXT, { type: 'SUBMIT', ...at(1) });
    expect(JSON.stringify(INITIAL_CONTEXT)).toBe(before);
  });

  it('covers every state with an accessible announcement', () => {
    for (const state of COMPANION_STATES) {
      expect(COMPANION_ANNOUNCEMENTS[state].label.length).toBeGreaterThan(0);
    }
    expect(COMPANION_ANNOUNCEMENTS.waiting_for_approval.live).toBe('assertive');
  });
});

describe('transient visibility', () => {
  it('may hide only when completely quiet', () => {
    expect(canHide(INITIAL_CONTEXT)).toBe(true);
  });

  it.each<[string, CompanionEvent[]]>([
    ['a request is running', [{ type: 'SUBMIT', at: 1 }]],
    ['a tool is running', [{ type: 'SUBMIT', at: 1 }, { type: 'TOOL_START', at: 2 }]],
    ['an approval is pending', [{ type: 'SUBMIT', at: 1 }, { type: 'APPROVAL_REQUESTED', at: 2 }]],
    ['speech is playing', [{ type: 'SPEECH_START', at: 1 }]],
    ['listening', [{ type: 'LISTEN_START', at: 1 }]],
    ['pointing', [{ type: 'POINT_START', at: 1 }]],
    ['an error is showing', [{ type: 'FAILED', at: 1, reason: 'x' }]],
    ['stopped', [{ type: 'EMERGENCY_STOP', at: 1 }]],
  ])('must not hide while %s', (_name, events) => {
    expect(canHide(run(events))).toBe(false);
  });

  it('auto-hides only after the idle timeout', () => {
    const ctx = run([{ type: 'SUBMIT', at: 1000 }, { type: 'RUN_COMPLETE', at: 2000 }]);
    expect(shouldAutoHide(ctx, 2500, 1000)).toBe(false);
    expect(shouldAutoHide(ctx, 3000, 1000)).toBe(true);
  });

  it('does not auto-hide mid-task however long it has been', () => {
    const ctx = run([{ type: 'SUBMIT', at: 1 }, { type: 'TOOL_START', at: 2 }]);
    expect(shouldAutoHide(ctx, 10_000_000, 1000)).toBe(false);
  });
});

describe('agreement with the shared orb state function', () => {
  it('every companion state is a real assistant state with a visual', () => {
    for (const state of COMPANION_STATES) {
      expect(ASSISTANT_STATES).toContain(state);
      expect(ORB_VISUALS[state]).toBeDefined();
    }
  });

  it('the machine and deriveAssistantState can never disagree', () => {
    // Drive the machine through many contexts and compare against the shared
    // function fed the equivalent signals. There is one priority definition.
    const flags = [false, true];
    for (const stopped of flags)
      for (const approvalPending of flags)
        for (const listening of flags)
          for (const requestActive of flags)
            for (const streaming of flags)
              for (const speaking of flags)
                for (const pointing of flags)
                  for (const tools of [0, 1])
                    for (const error of [null, 'x']) {
                      const c: CompanionContext = {
                        ...INITIAL_CONTEXT,
                        stopped,
                        approvalPending,
                        listening,
                        requestActive,
                        streaming,
                        speaking,
                        pointing,
                        toolsRunning: tools,
                        error,
                      };
                      expect(deriveCompanionState(c)).toBe(
                        deriveAssistantState({
                          stopped,
                          permission: approvalPending,
                          error: error !== null,
                          listening,
                          streaming: requestActive,
                          hasAnswer: streaming,
                          executing: tools > 0,
                          speaking,
                          pointing,
                        }),
                      );
                    }
  });

  it('draws a pending approval as waiting_for_approval, not listening (regression)', () => {
    const waiting = run([{ type: 'SUBMIT', at: 1 }, { type: 'APPROVAL_REQUESTED', at: 2 }]);
    expect(deriveCompanionState(waiting)).toBe('waiting_for_approval');
  });
});

/* ================================================================== *
 * Geometry: multi-monitor, negative coordinates, mixed DPI
 * ================================================================== */

// Primary 1920x1080 @125%, a 2560x1440 monitor to its LEFT at 100% (negative x),
// and a portrait 1080x1920 monitor ABOVE-RIGHT at 150% (negative y).
const primary: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 824 },
  scaleFactor: 1.25,
};
const leftMonitor: DisplayInfo = {
  id: 2,
  bounds: { x: -2560, y: -200, width: 2560, height: 1440 },
  workArea: { x: -2560, y: -200, width: 2560, height: 1400 },
  scaleFactor: 1,
};
const topRight: DisplayInfo = {
  id: 3,
  bounds: { x: 1536, y: -1100, width: 720, height: 1280 },
  workArea: { x: 1536, y: -1100, width: 720, height: 1240 },
  scaleFactor: 1.5,
};
const displays = [primary, leftMonitor, topRight];

describe('display lookup', () => {
  it('finds a display for a point with negative coordinates', () => {
    expect(displayContaining(displays, { x: -1000, y: 300 })?.id).toBe(2);
    expect(displayContaining(displays, { x: 1700, y: -500 })?.id).toBe(3);
  });

  it('never lets two adjacent displays both claim the shared edge', () => {
    expect(displayContaining(displays, { x: 0, y: 100 })?.id).toBe(1);
    expect(displayContaining(displays, { x: -1, y: 100 })?.id).toBe(2);
    expect(rectContains(leftMonitor.bounds, { x: 0, y: 100 })).toBe(false);
  });

  it('returns null off every display, and finds the nearest one instead', () => {
    expect(displayContaining(displays, { x: -3000, y: 5000 })).toBeNull();
    expect(nearestDisplay(displays, { x: -3000, y: 5000 })?.id).toBe(2);
  });

  it('clamps a point inside an area with a margin', () => {
    expect(clampPoint({ x: 5000, y: -5000 }, primary.workArea, 10)).toEqual({ x: 1526, y: 10 });
  });
});

describe('screenshot coordinate mapping', () => {
  it('maps image pixels to the right global point on a display with a negative origin', () => {
    // 2560x1440 capture, sent at full size, covering the left monitor.
    const mapped = mapImagePointToGlobal({ x: 1280, y: 720 }, { width: 2560, height: 1440 }, leftMonitor.bounds);
    expect(mapped?.point).toEqual({ x: -1280, y: 520 });
  });

  it('is independent of the display scale factor', () => {
    // Same on-screen place, captured at 125% physical size, then downscaled to 1568 wide.
    const physical = { width: 1920, height: 1080 };
    const sent = fitCaptureSize(physical);
    expect(sent.width).toBe(1568);
    const centre = mapImagePointToGlobal({ x: sent.width / 2, y: sent.height / 2 }, sent, primary.bounds);
    expect(centre?.point.x).toBeCloseTo(768, 5);
    expect(centre?.point.y).toBeCloseTo(432, 5);
  });

  it('accounts for the crop offset of an active-window capture', () => {
    const windowRect = { x: -1800, y: 100, width: 800, height: 600 };
    const mapped = mapImagePointToGlobal({ x: 400, y: 300 }, { width: 800, height: 600 }, windowRect);
    expect(mapped?.point).toEqual({ x: -1400, y: 400 });
  });

  it('round-trips through the inverse mapping', () => {
    const image = { width: 1568, height: 882 };
    const global = mapImagePointToGlobal({ x: 321, y: 654 }, image, topRight.bounds)!.point;
    const back = mapGlobalToImagePoint(global, image, topRight.bounds)!;
    expect(back.x).toBeCloseTo(321, 6);
    expect(back.y).toBeCloseTo(654, 6);
  });

  it('refuses non-finite or wildly out-of-image coordinates instead of guessing', () => {
    const image = { width: 1000, height: 500 };
    expect(mapImagePointToGlobal({ x: Number.NaN, y: 10 }, image, primary.bounds)).toBeNull();
    expect(mapImagePointToGlobal({ x: 5000, y: 10 }, image, primary.bounds)).toBeNull();
    expect(mapImagePointToGlobal({ x: 10, y: -400 }, image, primary.bounds)).toBeNull();
    expect(mapImagePointToGlobal({ x: 10, y: 10 }, { width: 0, height: 0 }, primary.bounds)).toBeNull();
  });

  it('pulls a coordinate that is just past the edge back in and says so', () => {
    const mapped = mapImagePointToGlobal({ x: 1004, y: 250 }, { width: 1000, height: 500 }, primary.bounds)!;
    expect(mapped.clamped).toBe(true);
    expect(mapped.point.x).toBeCloseTo(primary.bounds.x + primary.bounds.width, 6);
  });

  it('keeps the aspect ratio when scaling a capture down', () => {
    const size = fitCaptureSize({ width: 3840, height: 2160 });
    expect(size.width / size.height).toBeCloseTo(3840 / 2160, 2);
    expect(Math.max(size.width, size.height)).toBe(1568);
    expect(fitCaptureSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('keeps a target at the same spot inside a window that moves', () => {
    const before = { x: 100, y: 100, width: 800, height: 600 };
    const rel = toWindowRelative({ x: 500, y: 250 }, before);
    expect(fromWindowRelative(rel, { x: 300, y: 50, width: 800, height: 600 })).toEqual({ x: 700, y: 200 });
  });
});

describe('monitor disconnection', () => {
  const small = { x: -2400, y: 0, width: 480, height: 80 };

  it('leaves a window alone when it is still on a connected display', () => {
    const rect = { x: 500, y: 30, width: 480, height: 80 };
    expect(ensureVisible(rect, displays)).toEqual({ rect, moved: false });
  });

  it('moves a window whose monitor was unplugged to the top centre of the nearest one', () => {
    const remaining = [primary];
    const result = ensureVisible(small, remaining);
    expect(result.moved).toBe(true);
    expect(rectContains(primary.workArea, { x: result.rect.x, y: result.rect.y })).toBe(true);
    expect(result.rect.x).toBe(Math.round((primary.workArea.width - small.width) / 2));
  });

  it('nudges a half-off-screen window fully back on', () => {
    const rect = { x: 1400, y: 30, width: 480, height: 80 };
    const result = ensureVisible(rect, [primary]);
    expect(result.moved).toBe(true);
    expect(result.rect.x + result.rect.width).toBeLessThanOrEqual(primary.workArea.width);
  });

  it('does nothing when no displays are reported', () => {
    expect(ensureVisible(small, [])).toEqual({ rect: small, moved: false });
  });
});

/* ================================================================== *
 * Cursor following
 * ================================================================== */

describe('cursor follower', () => {
  const target = { x: 400, y: 300 };

  function simulate(frameSeconds: number, seconds: number) {
    let state = createFollower({ x: 0, y: 0 });
    let t = 0;
    while (t < seconds) {
      state = stepFollower(state, target, frameSeconds);
      t += frameSeconds;
    }
    return state;
  }

  it('converges to the target', () => {
    const state = simulate(1 / 60, 3);
    expect(isSettled(state, target)).toBe(true);
  });

  it('reaches the same place at different frame rates', () => {
    const a = simulate(1 / 30, 3).position;
    const b = simulate(1 / 144, 3).position;
    expect(a.x).toBeCloseTo(b.x, 1);
    expect(a.y).toBeCloseTo(b.y, 1);
  });

  it('stays stable through a long stall instead of exploding', () => {
    let state = createFollower({ x: 0, y: 0 });
    state = stepFollower(state, target, 5);
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Math.abs(state.position.x)).toBeLessThan(2000);
  });

  it('is not settled while still far away', () => {
    expect(isSettled(createFollower({ x: 0, y: 0 }), target)).toBe(false);
  });

  it('makes progress toward the target on the first frame', () => {
    const next = stepFollower(createFollower({ x: 0, y: 0 }), target, 1 / 60);
    expect(next.position.x).toBeGreaterThan(0);
    expect(next.position.x).toBeLessThan(target.x);
  });

  it('follows faster with a higher speed setting', () => {
    const slow = stepFollower(createFollower({ x: 0, y: 0 }), target, 0.1, { ...DEFAULT_FOLLOW_CONFIG, speed: 0.5 });
    const fast = stepFollower(createFollower({ x: 0, y: 0 }), target, 0.1, { ...DEFAULT_FOLLOW_CONFIG, speed: 2 });
    expect(fast.position.x).toBeGreaterThan(slow.position.x);
  });

  it('can overshoot slightly with a springy damping ratio, but not with critical damping', () => {
    const peak = (damping: number): number => {
      let state = createFollower({ x: 0, y: 0 });
      let max = 0;
      for (let i = 0; i < 240; i += 1) {
        state = stepFollower(state, { x: 100, y: 0 }, 1 / 120, { ...DEFAULT_FOLLOW_CONFIG, dampingRatio: damping });
        max = Math.max(max, state.position.x);
      }
      return max;
    };
    expect(peak(0.5)).toBeGreaterThan(100);
    expect(peak(1)).toBeLessThanOrEqual(100.0001);
  });

  it('does nothing for a zero or negative frame time', () => {
    const state = createFollower({ x: 5, y: 5 });
    expect(stepFollower(state, target, 0)).toBe(state);
    expect(stepFollower(state, target, -1)).toBe(state);
  });
});

describe('companion placement', () => {
  const area = primary.workArea;

  it('sits at the offset from the cursor in open space', () => {
    expect(companionTarget({ x: 500, y: 300 }, area)).toEqual({ x: 522, y: 320 });
  });

  it('flips to the left of the cursor near the right edge, so it never covers the pointer', () => {
    const pos = companionTarget({ x: 1520, y: 300 }, area);
    expect(pos.x).toBeLessThan(1520);
  });

  it('flips above the cursor near the bottom edge', () => {
    const pos = companionTarget({ x: 500, y: 815 }, area);
    expect(pos.y).toBeLessThan(815);
  });

  it('always stays inside the work area, even in a corner', () => {
    const pos = companionTarget({ x: 1535, y: 823 }, area);
    expect(pos.x).toBeGreaterThanOrEqual(area.x);
    expect(pos.y).toBeGreaterThanOrEqual(area.y);
    expect(pos.x + 36).toBeLessThanOrEqual(area.x + area.width);
    expect(pos.y + 36).toBeLessThanOrEqual(area.y + area.height);
  });

  it('works on a display with negative coordinates', () => {
    const pos = companionTarget({ x: -1200, y: 400 }, leftMonitor.workArea);
    expect(rectContains(leftMonitor.workArea, pos)).toBe(true);
  });
});

describe('speech bubble placement', () => {
  const area = primary.workArea;
  const bubble = { width: 260, height: 90 };

  it('prefers the right side', () => {
    const result = placeBubble({ x: 200, y: 200, width: 36, height: 36 }, bubble, area);
    expect(result.side).toBe('right');
    expect(result.position.x).toBeGreaterThan(236);
  });

  it('moves left when the right side would overflow', () => {
    const result = placeBubble({ x: 1400, y: 200, width: 36, height: 36 }, bubble, area);
    expect(['below', 'left']).toContain(result.side);
    expect(result.position.x + bubble.width).toBeLessThanOrEqual(area.width);
  });

  it('stays fully on screen in a corner', () => {
    const result = placeBubble({ x: 1500, y: 790, width: 36, height: 36 }, bubble, area);
    expect(result.position.x + bubble.width).toBeLessThanOrEqual(area.x + area.width);
    expect(result.position.y + bubble.height).toBeLessThanOrEqual(area.y + area.height);
    expect(result.position.x).toBeGreaterThanOrEqual(area.x);
    expect(result.position.y).toBeGreaterThanOrEqual(area.y);
  });
});

/* ================================================================== *
 * Pointing
 * ================================================================== */

describe('target confidence', () => {
  it('trusts only the accessibility tree as verified', () => {
    expect(confidenceFor('ui_automation')).toBe('verified');
    expect(confidenceFor('vision')).toBe('unverified');
    expect(confidenceFor('manual')).toBe('unverified');
  });

  it('never marks a model-estimated target as verified', () => {
    const target = makeTarget({ point: { x: 1, y: 2 }, label: 'Save', source: 'vision' });
    expect(target.confidence).toBe('unverified');
  });

  it('trims long labels', () => {
    expect(makeTarget({ point: { x: 0, y: 0 }, label: 'x'.repeat(200), source: 'vision' }).label).toHaveLength(60);
  });
});

describe('parsing vision answers', () => {
  const image = { width: 1000, height: 500 };
  const region = { x: -1000, y: 0, width: 1000, height: 500 };

  it('maps one target into global coordinates, as unverified', () => {
    const result = parseVisionTargets('{"targets":[{"x":500,"y":250,"label":"Wi-Fi"}]}', image, region);
    expect(result.kind).toBe('single');
    if (result.kind === 'single') {
      expect(result.target.point).toEqual({ x: -500, y: 250 });
      expect(result.target.confidence).toBe('unverified');
      expect(result.target.label).toBe('Wi-Fi');
    }
  });

  it('accepts JSON wrapped in a code fence and prose', () => {
    const raw = 'Here you go:\n```json\n{"targets":[{"x":10,"y":10,"label":"OK"}]}\n```';
    expect(parseVisionTargets(raw, image, region).kind).toBe('single');
  });

  it('reports ambiguity with candidates instead of choosing one silently', () => {
    const raw = '{"targets":[{"x":100,"y":100,"label":"A"},{"x":800,"y":400,"label":"B"}]}';
    const result = parseVisionTargets(raw, image, region);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2);
  });

  it('caps the number of candidates', () => {
    const many = JSON.stringify({ targets: Array.from({ length: 12 }, (_, i) => ({ x: i * 10, y: 10, label: `t${i}` })) });
    const result = parseVisionTargets(many, image, region);
    expect(result.kind === 'ambiguous' && result.candidates.length).toBe(4);
  });

  it('treats an empty list as "nothing to point at"', () => {
    expect(parseVisionTargets('{"targets":[]}', image, region).kind).toBe('none');
  });

  it('rejects out-of-image coordinates rather than pointing at an edge', () => {
    expect(parseVisionTargets('{"targets":[{"x":9000,"y":10,"label":"x"}]}', image, region).kind).toBe('invalid');
  });

  it('rejects malformed, non-JSON and wrongly shaped answers', () => {
    expect(parseVisionTargets('I think it is top right', image, region).kind).toBe('invalid');
    expect(parseVisionTargets('{"targets": [', image, region).kind).toBe('invalid');
    expect(parseVisionTargets('{"result":1}', image, region).kind).toBe('invalid');
    expect(parseVisionTargets('{"targets":[{"x":"5","y":"5"}]}', image, region).kind).toBe('invalid');
  });
});

describe('keeping a target honest', () => {
  const windowRect = { x: 100, y: 100, width: 800, height: 600 };
  const vision = makeTarget({ point: { x: 500, y: 250 }, label: 'Save', source: 'vision', windowRect });
  const verified = makeTarget({
    point: { x: 500, y: 250 },
    label: 'Save',
    source: 'ui_automation',
    bounds: { x: 480, y: 240, width: 40, height: 20 },
    windowRect,
  });

  it('continues when nothing changed', () => {
    expect(reconcileTarget(vision, { windowRect }).status).toBe('present');
  });

  it('follows the window when it is dragged', () => {
    const result = reconcileTarget(vision, { windowRect: { ...windowRect, x: 300, y: 150 } });
    expect(result.status).toBe('moved');
    if (result.status === 'moved') expect(result.target.point).toEqual({ x: 700, y: 300 });
  });

  it('stops when the window closes', () => {
    expect(reconcileTarget(vision, { windowRect: null }).status).toBe('gone');
  });

  it('stops when the window is minimised', () => {
    expect(reconcileTarget(vision, { windowRect, windowVisible: false }).status).toBe('gone');
  });

  it('stops when a verified element disappears', () => {
    expect(reconcileTarget(verified, { windowRect, elementBounds: null }).status).toBe('gone');
  });

  it('prefers a verified element’s new bounds over window arithmetic', () => {
    const result = reconcileTarget(verified, {
      windowRect,
      elementBounds: { x: 600, y: 400, width: 40, height: 20 },
    });
    expect(result.status).toBe('moved');
    if (result.status === 'moved') expect(result.target.point).toEqual({ x: 620, y: 410 });
  });
});

describe('flight path', () => {
  const start = { x: 0, y: 500 };
  const end = { x: 900, y: 100 };
  const plan = planFlight(start, end);

  it('starts at the start and lands exactly on the target', () => {
    expect(flightPosition(plan, 0)).toEqual(start);
    const last = flightPosition(plan, plan.durationSeconds);
    expect(last.x).toBeCloseTo(end.x, 6);
    expect(last.y).toBeCloseTo(end.y, 6);
  });

  it('clamps the duration for very short and very long flights', () => {
    expect(planFlight({ x: 0, y: 0 }, { x: 5, y: 5 }).durationSeconds).toBeCloseTo(0.45, 5);
    expect(planFlight({ x: 0, y: 0 }, { x: 9000, y: 0 }).durationSeconds).toBeCloseTo(1.2, 5);
  });

  it('eases: slow at both ends, fastest in the middle', () => {
    const d = plan.durationSeconds;
    const early = Math.hypot(flightPosition(plan, d * 0.05).x - start.x, flightPosition(plan, d * 0.05).y - start.y);
    const middle = Math.hypot(
      flightPosition(plan, d * 0.55).x - flightPosition(plan, d * 0.45).x,
      flightPosition(plan, d * 0.55).y - flightPosition(plan, d * 0.45).y,
    );
    expect(middle).toBeGreaterThan(early);
  });

  it('points roughly toward the target', () => {
    const heading = flightHeading(plan, plan.durationSeconds * 0.5);
    expect(Math.cos(heading)).toBeGreaterThan(0);
  });

  it('does not run past the end if time overshoots', () => {
    const past = flightPosition(plan, plan.durationSeconds * 3);
    expect(past.x).toBeCloseTo(end.x, 6);
  });
});

/* ================================================================== *
 * Persisted companion settings
 * ================================================================== */

import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/types';

describe('companion settings', () => {
  it('defaults to the stationary orb with transient mode off', () => {
    const s = mergeSettings(undefined).companion;
    expect(s.visualMode).toBe('stationary');
    expect(s.transientMode).toBe(false);
    expect(s.animations).toBe('full');
  });

  it('keeps a stored cursor mode across a reload', () => {
    const stored = JSON.parse(JSON.stringify({ companion: { visualMode: 'cursor', followSpeed: 1.5 } }));
    const s = mergeSettings(stored).companion;
    expect(s.visualMode).toBe('cursor');
    expect(s.followSpeed).toBe(1.5);
  });

  it('upgrades an old settings file that has none of the new fields', () => {
    const old = { companion: { mode: 'hybrid', position: { x: 10, y: 20 } } };
    const s = mergeSettings(old).companion;
    expect(s.position).toEqual({ x: 10, y: 20 });
    expect(s.visualMode).toBe(DEFAULT_SETTINGS.companion.visualMode);
    expect(s.cursorOffset).toEqual(DEFAULT_SETTINGS.companion.cursorOffset);
  });

  it('rejects an unknown visual mode and animation level', () => {
    const s = mergeSettings({ companion: { visualMode: 'fullscreen', animations: 'turbo' } }).companion;
    expect(s.visualMode).toBe('stationary');
    expect(s.animations).toBe('full');
  });

  it('clamps numbers that would break the animation maths', () => {
    const s = mergeSettings({
      companion: { followSpeed: 9999, transientIdleMs: 1, cursorOffset: { x: 1e9, y: Number.NaN } },
    }).companion;
    expect(s.followSpeed).toBe(3);
    expect(s.transientIdleMs).toBe(1000);
    expect(s.cursorOffset.x).toBe(200);
    expect(s.cursorOffset.y).toBe(DEFAULT_SETTINGS.companion.cursorOffset.y);
  });

  it('treats a non-boolean transientMode as off', () => {
    expect(mergeSettings({ companion: { transientMode: 'yes' } }).companion.transientMode).toBe(false);
  });
});

/* ================================================================== *
 * Push-to-talk race handling
 * ================================================================== */

import { INITIAL_PTT, pttReduce, type PttEvent, type PttState, type PttEffect } from '../src/shared/companion/pushToTalk';

function ptt(events: PttEvent[], from: PttState = INITIAL_PTT): { state: PttState; effects: PttEffect[] } {
  let state = from;
  const effects: PttEffect[] = [];
  for (const event of events) {
    const t = pttReduce(state, event);
    state = t.state;
    effects.push(...t.effects);
  }
  return { state, effects };
}

describe('push-to-talk', () => {
  it('records on press and delivers the transcript after release', () => {
    const { state, effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'SESSION_READY', session: 1 },
      { type: 'KEY_UP' },
      { type: 'TRANSCRIPT', session: 1, text: ' open settings ' },
    ]);
    expect(state.phase).toBe('idle');
    expect(effects.map((e) => e.type)).toEqual(['start_session', 'stop_recording', 'deliver_transcript']);
    expect(effects.at(-1)).toMatchObject({ type: 'deliver_transcript', text: 'open settings' });
  });

  it('ignores key auto-repeat while the key is held', () => {
    const { effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'KEY_DOWN' },
      { type: 'KEY_DOWN' },
      { type: 'SESSION_READY', session: 1 },
      { type: 'KEY_DOWN' },
    ]);
    expect(effects.filter((e) => e.type === 'start_session')).toHaveLength(1);
  });

  it('never leaves the microphone open when the key is released while arming', () => {
    const { state, effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'KEY_UP' },
      { type: 'SESSION_READY', session: 1 },
    ]);
    expect(state.phase).toBe('idle');
    expect(effects).toContainEqual({ type: 'cancel_session', session: 1 });
    expect(effects.some((e) => e.type === 'deliver_transcript')).toBe(false);
  });

  it('reports a denied microphone and returns to idle', () => {
    const { state, effects } = ptt([{ type: 'KEY_DOWN' }, { type: 'PERMISSION_DENIED', session: 1 }]);
    expect(state.phase).toBe('idle');
    expect(state.lastIssue).toBe('permission_denied');
    expect(effects).toContainEqual({ type: 'notify', issue: 'permission_denied' });
  });

  it('can start again after a denial', () => {
    const { effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'PERMISSION_DENIED', session: 1 },
      { type: 'KEY_UP' },
      { type: 'KEY_DOWN' },
    ]);
    expect(effects.filter((e) => e.type === 'start_session')).toHaveLength(2);
  });

  it('ignores a new press while the last clip is still being transcribed', () => {
    const { effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'SESSION_READY', session: 1 },
      { type: 'KEY_UP' },
      { type: 'KEY_DOWN' },
    ]);
    expect(effects.filter((e) => e.type === 'start_session')).toHaveLength(1);
  });

  it('discards a stale transcript from an older session', () => {
    const afterInterrupt = ptt([
      { type: 'KEY_DOWN' },
      { type: 'SESSION_READY', session: 1 },
      { type: 'KEY_UP' },
      { type: 'INTERRUPT' },
      { type: 'KEY_DOWN' },
      { type: 'SESSION_READY', session: 2 },
    ]);
    const late = pttReduce(afterInterrupt.state, { type: 'TRANSCRIPT', session: 1, text: 'old words' });
    expect(late.effects).toEqual([]);
    expect(late.state.phase).toBe('recording');
  });

  it('shuts down a session that became ready after its press was cancelled', () => {
    const { effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'INTERRUPT' },
      { type: 'SESSION_READY', session: 1 },
    ]);
    expect(effects.filter((e) => e.type === 'cancel_session').length).toBeGreaterThanOrEqual(1);
  });

  it('interrupt (focus loss) while recording cancels the session', () => {
    const { state, effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'SESSION_READY', session: 1 },
      { type: 'INTERRUPT' },
    ]);
    expect(state.phase).toBe('idle');
    expect(effects).toContainEqual({ type: 'cancel_session', session: 1 });
  });

  it('treats an empty transcript as no speech and a one-character one as an accident', () => {
    const empty = ptt([{ type: 'KEY_DOWN' }, { type: 'SESSION_READY', session: 1 }, { type: 'KEY_UP' }, { type: 'TRANSCRIPT', session: 1, text: '   ' }]);
    expect(empty.state.lastIssue).toBe('no_speech');
    const tiny = ptt([{ type: 'KEY_DOWN' }, { type: 'SESSION_READY', session: 1 }, { type: 'KEY_UP' }, { type: 'TRANSCRIPT', session: 1, text: 'a' }]);
    expect(tiny.state.lastIssue).toBe('too_short');
  });

  it('times out a finalize that never completes', () => {
    const { state, effects } = ptt([
      { type: 'KEY_DOWN' },
      { type: 'SESSION_READY', session: 1 },
      { type: 'KEY_UP' },
      { type: 'TIMEOUT', session: 1 },
    ]);
    expect(state.phase).toBe('idle');
    expect(effects).toContainEqual({ type: 'notify', issue: 'timeout' });
  });

  it('a device error mid-recording ends the session and cancels the audio', () => {
    const { state, effects } = ptt([{ type: 'KEY_DOWN' }, { type: 'SESSION_READY', session: 1 }, { type: 'DEVICE_ERROR', session: 1 }]);
    expect(state.phase).toBe('idle');
    expect(effects).toContainEqual({ type: 'cancel_session', session: 1 });
  });

  it('key-up with nothing in progress is harmless', () => {
    expect(ptt([{ type: 'KEY_UP' }]).effects).toEqual([]);
  });
});