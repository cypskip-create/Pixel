import { describe, expect, it } from 'vitest';
import { claimPushToTalkEnd } from '../src/shared/companion/pushToTalkSession';

describe('push-to-talk session terminal transition', () => {
  it('claims release once so one stop event can finalize the recording', () => {
    const session = { released: false };
    expect(claimPushToTalkEnd(session)).toBe(true);
    expect(session.released).toBe(true);
    expect(claimPushToTalkEnd(session)).toBe(false);
  });

  it('does not restart a session that has already been cancelled', () => {
    const session = { released: true };
    expect(claimPushToTalkEnd(session)).toBe(false);
    expect(session.released).toBe(true);
  });
});
