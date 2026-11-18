/** Atomically claim the single terminal transition for a PTT session. */
export function claimPushToTalkEnd(session: { released: boolean }): boolean {
  if (session.released) return false;
  session.released = true;
  return true;
}
