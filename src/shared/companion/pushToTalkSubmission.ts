/** Preserve an existing unsent draft when a voice request needs review. */
export function mergeVoiceTranscriptIntoDraft(draft: string, transcript: string): string {
  const cleanTranscript = transcript.trim().replace(/\s+/g, ' ');
  if (!cleanTranscript) return draft;
  if (!draft.trim()) return cleanTranscript;
  return `${draft.trimEnd()}\n${cleanTranscript}`;
}
