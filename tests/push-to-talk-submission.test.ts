import { describe, expect, it } from 'vitest';
import { mergeVoiceTranscriptIntoDraft } from '../src/shared/companion/pushToTalkSubmission';

describe('push-to-talk review fallback', () => {
  it('keeps dictated text in an empty draft', () => {
    expect(mergeVoiceTranscriptIntoDraft('', '  Pixel, tell me the time.  ')).toBe('Pixel, tell me the time.');
  });

  it('appends voice text without discarding existing unsent text', () => {
    expect(mergeVoiceTranscriptIntoDraft('Check my notes  ', 'Summarize the latest entry.'))
      .toBe('Check my notes\nSummarize the latest entry.');
  });

  it('does not change a draft for an empty transcript', () => {
    expect(mergeVoiceTranscriptIntoDraft('Keep this draft', '   ')).toBe('Keep this draft');
  });
});
