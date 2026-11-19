import { useEffect, useState } from 'react';

/** Shares the main-process playback state between the Island, Workspace and other Pixel windows. */
export function useVoicePlaybackState(): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell?.onVoicePlaybackState || !shell.voicePlaybackActive) return;

    let eventVersion = 0;
    const unsubscribe = shell.onVoicePlaybackState((active) => {
      eventVersion += 1;
      setSpeaking(active);
    });
    const initialVersion = eventVersion;
    void shell.voicePlaybackActive().then((active) => {
      if (eventVersion === initialVersion) setSpeaking(active);
    }).catch(() => undefined);

    return unsubscribe;
  }, []);

  return speaking;
}
