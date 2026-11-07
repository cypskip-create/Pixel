import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, ShieldAlert, Square, WifiOff } from 'lucide-react';
import type {
  AssistantState,
  ImageAttachment,
  Mode,
  PermissionDecision,
  PermissionRequest,
  Surface,
  TaskRecord,
} from '@shared/types';
import { deriveAssistantState } from '@shared/companion-state';
import { getModeDescriptor } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { InputBar } from '@/components/InputBar';
import { ModeSwitcher } from '@/components/ModeSwitcher';
import { PermissionCard } from '@/components/PermissionCard';
import { ResponseBubble } from '@/components/ResponseBubble';
import { SettingsPanel } from '@/components/SettingsPanel';
import { TaskStrip } from '@/components/TaskStrip';
import { BridgeContext } from '@/hooks/useBridge';
import { useChat } from '@/hooks/useChat';
import { useDrag } from '@/hooks/useDrag';
import { useMotionPolicy } from '@/hooks/useMotion';
import { useSettings } from '@/hooks/useSettings';
import { readBridge, safeSubscribe } from '@/lib/bridge';
import { resolveSurface } from '@/lib/surface';

/** True when the renderer was opened as the settings window by the shell. */
function isSettingsWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export function App(): React.JSX.Element {
  const bridge = readBridge();
  return (
    <BridgeContext.Provider value={bridge}>
      {isSettingsWindow() ? <SettingsWindow /> : <Companion />}
    </BridgeContext.Provider>
  );
}

/* ------------------------------------------------------------------ *
 * Settings window
 * ------------------------------------------------------------------ */

function SettingsWindow(): React.JSX.Element {
  const { settings, hasApiKey, error, saving, patch, setMode } = useSettings();

  const close = useCallback(() => {
    const bridge = readBridge();
    if (bridge.kind !== 'ready') return;
    void bridge.bridge.window.closeSettings().catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-glass-raised)] text-[var(--color-ink)]">
      <SettingsPanel
        settings={settings}
        onPatch={patch}
        onRequestMode={setMode}
        onClose={close}
        hasApiKey={hasApiKey}
        error={error}
        saving={saving}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The floating companion
 * ------------------------------------------------------------------ */

function Companion(): React.JSX.Element {
  const bridge = readBridge();
  const { settings, hasApiKey, error: settingsError, patch, setMode } = useSettings();
  const chat = useChat();
  const drag = useDrag();
  const reducedMotion = useMotionPolicy(settings.companion.reducedMotion);

  const [surface, setSurface] = useState<Surface>('idle');
  const [inputOpen, setInputOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [permissionPending, setPermissionPending] = useState(false);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const mode = settings.companion.mode;
  const modeDescriptor = getModeDescriptor(mode);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  /* ---------------------------- surface ---------------------------- */

  const bubbleVisible = chat.streaming || chat.content.length > 0 || chat.error !== null;
  const hasActiveTask =
    task !== null && (task.status === 'running' || task.status === 'planning');

  const nextSurface = useMemo(
    () =>
      resolveSurface({
        windowHidden: false,
        hasPermission: permission !== null,
        hasActiveTask,
        bubbleVisible,
        inputOpen,
      }),
    [permission, hasActiveTask, bubbleVisible, inputOpen],
  );

  // Tell the shell to resize for the current surface.
  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.window;
    if (typeof api.setSurface !== 'function') return;
    void api.setSurface(nextSurface).catch(() => undefined);
  }, [bridge, nextSurface]);

  useEffect(() => {
    setSurface(nextSurface);
  }, [nextSurface]);

  /* --------------------------- subscriptions ------------------------ */

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.permissions;
    if (typeof api.onRequest !== 'function') return;
    return safeSubscribe<PermissionRequest>(api.onRequest, (request) => {
      setPermission(request);
      setPermissionPending(false);
    });
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.system;
    if (typeof api.onEmergencyStop !== 'function') return;
    return safeSubscribe(api.onEmergencyStop, () => {
      setStopped(true);
      chat.reset();
      setPermission(null);
      showNotice('Emergency stop: new actions are blocked until you clear it.');
    });
  }, [bridge, chat, showNotice]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.tasks;
    if (typeof api.onUpdate !== 'function') return;
    return safeSubscribe<TaskRecord>(api.onUpdate, (record) => {
      setTask(record);
      if (record.status === 'cancelled' || record.status === 'completed') {
        window.setTimeout(() => setTask(null), 4000);
      }
    });
  }, [bridge]);

  // The tray can change the mode; keep the renderer in step.
  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell || typeof shell.onModeChanged !== 'function') return undefined;
    return safeSubscribe<Mode>(shell.onModeChanged, (next) => {
      if (next === settings.companion.mode) return;
      patch({ companion: { mode: next } });
    });
  }, [patch, settings.companion.mode]);

  /* ----------------------------- actions ---------------------------- */

  const submit = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0 && attachments.length === 0) return;
    if (stopped) {
      showNotice('Pixel is stopped. Clear the emergency stop before asking again.');
      return;
    }
    if (chat.streaming) return;

    setDraft('');
    const images = attachments;
    setAttachments([]);
    void chat.send({ text, images, mode });
  }, [attachments, chat, draft, mode, showNotice, stopped]);

  const collapse = useCallback(() => {
    if (chat.streaming) chat.stop();
    chat.reset();
    setInputOpen(false);
    setModeMenuOpen(false);
    setPendingMode(null);
    setPermission(null);
    setDraft('');
    setAttachments([]);
  }, [chat]);

  const requestMode = useCallback(
    (next: Mode) => {
      setModeMenuOpen(false);
      if (next === mode) return;

      // Escalation is an explicit, informed step. Moving *down* in privilege
      // needs no confirmation because it grants nothing.
      const currentAllows = getModeDescriptor(mode).allowsStateChange;
      const nextAllows = getModeDescriptor(next).allowsStateChange;
      if (nextAllows && !currentAllows) {
        setPendingMode(next);
        return;
      }
      setMode(next);
    },
    [mode, setMode],
  );

  const confirmMode = useCallback(() => {
    if (pendingMode === null) return;
    setMode(pendingMode);
    setPendingMode(null);
  }, [pendingMode, setMode]);

  const decide = useCallback(
    (decision: PermissionDecision) => {
      if (bridge.kind !== 'ready') return;
      setPermissionPending(true);
      const api = bridge.bridge.permissions;
      void api
        .respond(decision)
        .catch(() => showNotice('Pixel could not record that decision.'))
        .finally(() => {
          setPermissionPending(false);
          setPermission(null);
        });
    },
    [bridge, showNotice],
  );

  const attachScreenshot = useCallback(() => {
    if (bridge.kind !== 'ready') {
      showNotice('Screen capture needs the desktop app.');
      return;
    }
    const api = bridge.bridge.screen;
    void api
      .captureDisplay()
      .then((result) => {
        if (!result.ok || !result.image) {
          showNotice(result.error?.message ?? 'Pixel could not capture the screen.');
          return;
        }
        setAttachments((prev) => [...prev, result.image as ImageAttachment]);
      })
      .catch(() => showNotice('Pixel could not capture the screen.'));
  }, [bridge, showNotice]);

  const pickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFilesChosen = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const images = [...files].filter((file) => file.type.startsWith('image/')).slice(0, 4);
      if (images.length === 0) {
        showNotice('Those files are not images. Pixel can look at screenshots and images.');
        return;
      }
      for (const file of images) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : null;
          if (!dataUrl) return;
          setAttachments((prev) => [
            ...prev,
            {
              dataUrl,
              mimeType: file.type as ImageAttachment['mimeType'],
              width: 0,
              height: 0,
              source: 'upload',
              label: file.name,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    },
    [showNotice],
  );

  /**
   * Push-to-talk. Windows speech recognition runs locally; if it is missing we
   * say exactly that rather than pretending to listen.
   */
  const toggleListening = useCallback(() => {
    const shell = window.cypsShell;
    if (!shell || typeof shell.voiceListen !== 'function') {
      setListening(false);
      showNotice('Voice input needs the desktop shell, which is not available here.');
      return;
    }

    if (listening) {
      setListening(false);
      return;
    }

    setListening(true);
    void (async () => {
      try {
        const capability = await shell.voiceCapability();
        if (!capability.speechToText) {
          setListening(false);
          showNotice(capability.reason ?? 'No speech recognizer is installed on this computer.');
          return;
        }

        const result = await shell.voiceListen(8000);
        setListening(false);
        if (result.ok && result.text.length > 0) {
          setDraft((current) => (current.length > 0 ? current + ' ' + result.text : result.text));
          return;
        }
        showNotice(
          result.noSpeech
            ? 'Pixel did not hear anything. Try again, a little closer to the microphone.'
            : (result.error ?? 'Speech recognition failed.'),
        );
      } catch (error) {
        setListening(false);
        showNotice(
          'Speech recognition failed at ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    })();
  }, [listening, showNotice]);

  // Speak replies aloud when the user has asked for it.
  const wasStreaming = useRef(false);
  useEffect(() => {
    const finished = wasStreaming.current && !chat.streaming;
    wasStreaming.current = chat.streaming;
    if (!finished) return;
    if (!settings.companion.speakReplies || !settings.voice.ttsEnabled) return;
    if (chat.content.trim().length === 0) return;

    const shell = window.cypsShell;
    if (!shell || typeof shell.voiceSpeak !== 'function') return;
    setSpeaking(true);
    void shell
      .voiceSpeak(chat.content)
      .then((result) => {
        if (!result.ok && result.error) showNotice(result.error);
      })
      .catch((error: unknown) => {
        showNotice(error instanceof Error ? error.message : 'Speech playback failed.');
      })
      .finally(() => setSpeaking(false));
  }, [chat.streaming, chat.content, settings.companion.speakReplies, settings.voice.ttsEnabled, showNotice]);

  const runTaskAction = useCallback(
    (action: 'pause' | 'resume' | 'cancel', taskId: string) => {
      if (bridge.kind !== 'ready') return;
      void bridge.bridge.tasks[action](taskId).catch(() => undefined);
    },
    [bridge],
  );

  const openSettings = useCallback(() => {
    if (bridge.kind !== 'ready') return;
    void bridge.bridge.window.openSettings().catch(() => undefined);
  }, [bridge]);

  const emergencyStop = useCallback(() => {
    if (bridge.kind !== 'ready') return;
    void bridge.bridge.system.emergencyStop().catch(() => undefined);
  }, [bridge]);

  const clearStop = useCallback(() => {
    setStopped(false);
    showNotice('Emergency stop cleared. Pixel will ask before acting again.');
  }, [showNotice]);

  const collapseRef = useRef(collapse);
  collapseRef.current = collapse;
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        collapseRef.current();
        return;
      }
      if (event.key === ',' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        openSettingsRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ------------------------------ render ---------------------------- */

  const busy = chat.streaming;
  const assistantState: AssistantState = deriveAssistantState({
    stopped,
    permission: permission !== null,
    streaming: chat.streaming,
    hasAnswer: chat.content.length > 0,
    error: chat.error !== null || settingsError !== null,
    listening,
    executing: hasActiveTask,
    speaking,
  });

  const rootClass = reducedMotion ? 'reduce-motion' : 'motion-ok';

  return (
    <div
      className={`${rootClass} flex h-screen w-screen flex-col items-center justify-start overflow-hidden bg-transparent pt-2`}
      data-surface={surface}
    >
      {/* Screen readers hear the answer as it arrives. */}
      <p aria-live="polite" aria-atomic="false" className="sr-only">
        {chat.streaming ? chat.content : chat.error ?? ''}
      </p>

      {bridge.kind === 'missing' ? (
        <div
          role="alert"
          className="mx-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/12 px-3 py-2 text-[12px] text-amber-100"
        >
          <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {bridge.reason} Pixel is running without its desktop shell, so it cannot answer.
          </span>
        </div>
      ) : null}

      {surface === 'idle' ? (
        <button
          type="button"
          onPointerDown={drag.onPointerDown}
          onClick={() => setInputOpen(true)}
          aria-label={`Open Pixel. Mode: ${modeDescriptor.label}. ${modeDescriptor.summary}`}
          aria-haspopup="dialog"
          className="group relative grid size-[76px] cursor-grab place-items-center rounded-full outline-none transition-transform duration-200 hover:scale-[1.04] active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-sky-400/70"
          style={{
            transform:
              drag.dragging && drag.offset
                ? `translate(${drag.offset.x}px, ${drag.offset.y}px)`
                : undefined,
          }}
        >
          <Avatar state={assistantState} size={56} />
        </button>
      ) : (
        <div
          className="animate-slide-down flex w-full flex-col items-center gap-2 px-2"
          data-no-drag
        >
          {stopped ? (
            <div
              role="alert"
              className="flex w-full max-w-[500px] items-center justify-between gap-2 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-[12px] text-rose-100"
            >
              <span className="flex items-center gap-1.5">
                <ShieldAlert aria-hidden="true" className="size-4" />
                Emergency stop is active.
              </span>
              <button
                type="button"
                onClick={clearStop}
                className="rounded-md border border-rose-300/40 px-2 py-0.5 font-medium hover:bg-rose-400/20"
              >
                Clear
              </button>
            </div>
          ) : null}

          {notice !== null ? (
            <div
              role="status"
              className="w-full max-w-[500px] rounded-xl border border-white/12 bg-white/8 px-3 py-2 text-[12px] text-[var(--color-ink-soft)]"
            >
              {notice}
            </div>
          ) : null}

          {permission !== null ? (
            <PermissionCard request={permission} onDecide={decide} pending={permissionPending} />
          ) : null}

          {task !== null ? (
            <TaskStrip
              task={task}
              onPause={() => runTaskAction('pause', task.id)}
              onResume={() => runTaskAction('resume', task.id)}
              onCancel={() => runTaskAction('cancel', task.id)}
            />
          ) : null}

          {pendingMode !== null ? (
            <div
              role="alertdialog"
              aria-label="Confirm mode change"
              className="w-full max-w-[500px] rounded-2xl border border-amber-400/35 bg-[var(--color-glass-raised)] p-3 text-[12px] text-[var(--color-ink)]"
            >
              <p className="mb-1 font-semibold">
                Switch to {getModeDescriptor(pendingMode).label}?
              </p>
              <p className="mb-2 text-[var(--color-ink-soft)]">
                {getModeDescriptor(pendingMode).summary} Pixel will ask for approval before each
                action that changes something on this computer. Nothing is approved in advance.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingMode(null)}
                  className="rounded-md border border-white/15 px-2.5 py-1 hover:bg-white/10"
                >
                  Stay in {modeDescriptor.label}
                </button>
                <button
                  type="button"
                  onClick={confirmMode}
                  className="rounded-md border border-amber-300/40 bg-amber-400/20 px-2.5 py-1 font-medium hover:bg-amber-400/30"
                >
                  Switch to {getModeDescriptor(pendingMode).label}
                </button>
              </div>
            </div>
          ) : null}

          {bubbleVisible ? (
            <ResponseBubble
              content={chat.content}
              reasoning={chat.reasoning}
              streaming={chat.streaming}
              error={chat.error}
              onCollapse={collapse}
              onStop={chat.stop}
              onDismiss={collapse}
            />
          ) : null}

          <div className="relative">
            <InputBar
              mode={mode}
              state={assistantState}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={submit}
              onStop={chat.stop}
              onCollapse={collapse}
              onAttachScreenshot={attachScreenshot}
              onAttachFile={pickFile}
              onToggleListening={toggleListening}
              listening={listening}
              attachments={attachments}
              onRemoveAttachment={(index) =>
                setAttachments((prev) => prev.filter((_, i) => i !== index))
              }
              onRequestMode={requestMode}
              modeMenuOpen={modeMenuOpen}
              onToggleModeMenu={() => setModeMenuOpen((open) => !open)}
              onCloseModeMenu={() => setModeMenuOpen(false)}
              busy={busy}
              disabled={bridge.kind !== 'ready'}
            />

            {modeMenuOpen ? (
              <ModeSwitcher
                current={mode}
                onRequestMode={requestMode}
                disabled={busy}
                variant="popover"
                onDismiss={() => setModeMenuOpen(false)}
              />
            ) : null}

            <div className="mt-1.5 flex items-center justify-center gap-1">
              <button
                type="button"
                onClick={openSettings}
                aria-label="Pixel settings"
                className="grid size-6 place-items-center rounded-md text-[var(--color-ink-dim)] hover:bg-white/10 hover:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-sky-400/70"
              >
                <Settings aria-hidden="true" className="size-3.5" />
              </button>
              {busy ? (
                <button
                  type="button"
                  onClick={chat.stop}
                  aria-label="Stop answering"
                  className="grid size-6 place-items-center rounded-md text-rose-200 hover:bg-rose-500/20 focus-visible:ring-2 focus-visible:ring-rose-400/70"
                >
                  <Square aria-hidden="true" className="size-3" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={emergencyStop}
                aria-label="Emergency stop: block all further actions"
                className="grid size-6 place-items-center rounded-md text-[var(--color-ink-dim)] hover:bg-rose-500/20 hover:text-rose-200 focus-visible:ring-2 focus-visible:ring-rose-400/70"
              >
                <ShieldAlert aria-hidden="true" className="size-3.5" />
              </button>
              <span className="ml-1 text-[10px] text-[var(--color-ink-dim)]">
                {hasApiKey === false ? 'No API key' : modeDescriptor.label}
              </span>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          onFilesChosen(event.target.files);
          event.target.value = '';
        }}
      />


    </div>
  );
}

export { deriveAssistantState };
