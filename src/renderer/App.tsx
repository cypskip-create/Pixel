import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, LayoutDashboard, Settings, ShieldAlert, Square, WifiOff } from 'lucide-react';
import type {
  AssistantState,
  DiagnosticsSnapshot,
  ImageAttachment,
  Mode,
  PermissionDecision,
  PermissionRequest,
  TaskRecord,
} from '@shared/types';
import { deriveAssistantState } from '@shared/companion-state';
import { parseExplicitSearchCommand } from '@shared/browserSearch';
import { getModeDescriptor } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { CursorBuddy } from '@/components/CursorBuddy';
import { InputBar } from '@/components/InputBar';
import { ConversationTranscript } from '@/components/ConversationTranscript';
import { PermissionCard } from '@/components/PermissionCard';
import { PixelMark } from '@/components/PixelMark';
import { RecentChatsPanel } from '@/components/RecentChatsPanel';
import { ResponseBubble } from '@/components/ResponseBubble';
import { SettingsPanel } from '@/components/SettingsPanel';
import { TaskStrip } from '@/components/TaskStrip';
import { BridgeContext } from '@/hooks/useBridge';
import { useChat } from '@/hooks/useChat';
import { useMotionPolicy } from '@/hooks/useMotion';
import { usePresentationLayout } from '@/hooks/usePresentationLayout';
import { useSettings } from '@/hooks/useSettings';
import { readBridge, safeSubscribe } from '@/lib/bridge';
import { resolveSurface } from '@/lib/surface';
import { Workspace } from '@/Workspace';

// The main process selects the native backdrop and passes the matching visual
// token with the trusted window URL. Other Pixel windows keep their own solid
// or Mica surfaces.
const pixelGlassMode = new URLSearchParams(window.location.search).get('pixel-glass');
if (pixelGlassMode === 'acrylic' || pixelGlassMode === 'fallback') {
  document.documentElement.dataset.pixelGlass = pixelGlassMode;
}

/** True when the renderer was opened as the settings window by the shell. */
function isSettingsWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'settings';
}

function isCursorWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'cursor';
}

function isWorkspaceWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'workspace';
}

export function App(): React.JSX.Element {
  const bridge = readBridge();
  return (
    <BridgeContext.Provider value={bridge}>
      {isSettingsWindow() ? <SettingsWindow /> : isCursorWindow() ? <CursorCompanionWindow /> : isWorkspaceWindow() ? <Workspace /> : <Companion />}
    </BridgeContext.Provider>
  );
}

/* ------------------------------------------------------------------ *
 * Settings window
 * ------------------------------------------------------------------ */

function SettingsWindow(): React.JSX.Element {
  const bridge = readBridge();
  const {
    settings,
    hasApiKey,
    error,
    saving,
    patch,
    setMode,
    saveApiKey,
    removeApiKey,
    testApiKeyConnection,
  } = useSettings();
  const [displays, setDisplays] = useState<DiagnosticsSnapshot['displays']>([]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let mounted = true;
    void bridge.bridge.screen.listDisplays().then((available) => {
      if (mounted) setDisplays(available);
    }).catch(() => {
      if (mounted) setDisplays([]);
    });
    return () => { mounted = false; };
  }, [bridge]);

  const close = useCallback(() => {
    const bridge = readBridge();
    if (bridge.kind !== 'ready') return;
    void bridge.bridge.window.closeSettings().catch(() => undefined);
  }, []);

  return (
    <div className="flex min-h-screen w-full justify-center bg-[var(--color-glass-raised)] p-3 text-[var(--color-ink)]">
      <SettingsPanel
        settings={settings}
        displays={displays}
        onPatch={patch}
        onRequestMode={setMode}
        onClose={close}
        hasApiKey={hasApiKey}
        onSaveApiKey={saveApiKey}
        onRemoveApiKey={removeApiKey}
        onTestConnection={testApiKeyConnection}
        error={error}
        saving={saving}
      />
    </div>
  );
}

function CursorCompanionWindow(): React.JSX.Element {
  const bridge = readBridge();
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let mounted = true;
    const unsubscribe = safeSubscribe<boolean>(bridge.bridge.window.onCursorMotion, setReducedMotion);
    void bridge.bridge.settings.get().then((settings) => {
      if (mounted) setReducedMotion(settings.companion.reducedMotion);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  return (
    <div aria-hidden="true" className={`${reducedMotion ? 'reduce-motion' : 'motion-ok'} pointer-events-none grid h-screen w-screen place-items-center bg-transparent`}>
      <CursorBuddy reducedMotion={reducedMotion} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The floating companion
 * ------------------------------------------------------------------ */

function Companion(): React.JSX.Element {
  const bridge = readBridge();
  const { settings, hasApiKey, error: settingsError, patch, setMode } = useSettings();
  const chat = useChat(settings.privacy.persistHistory);
  const reducedMotion = useMotionPolicy(settings.companion.reducedMotion);

  const [inputOpen, setInputOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const [speechConfirmed, setSpeechConfirmed] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);

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

  const bubbleVisible = !historyOpen && (chat.showTranscript || chat.streaming || chat.content.length > 0 || chat.error !== null);
  const hasActiveTask =
    task !== null && ['running', 'planning', 'pause_requested', 'awaiting_approval', 'awaiting_user', 'paused', 'blocked', 'cancelling'].includes(task.status);

  const nextSurface = useMemo(
    () =>
      resolveSurface({
        windowHidden: false,
        hasPermission: permission !== null,
        hasActiveTask,
        bubbleVisible,
        inputOpen: inputOpen || historyOpen,
      }),
    [permission, hasActiveTask, bubbleVisible, inputOpen, historyOpen],
  );

  usePresentationLayout(layoutRef, nextSurface);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    try {
      return bridge.bridge.window.onFocusLost(() => setModeMenuOpen(false));
    } catch {
      return undefined;
    }
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready' || typeof bridge.bridge.window.onSummon !== 'function') return;
    try {
      return bridge.bridge.window.onSummon(() => {
        setInputOpen(true);
        void chat.revealTranscript();
      });
    } catch {
      return undefined;
    }
  }, [bridge, chat.revealTranscript]);

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
    let mounted = true;
    const unsubscribe = safeSubscribe<TaskRecord>(api.onUpdate, (record) => {
      setTask(record);
      if (record.status === 'cancelled' || record.status === 'completed' || record.status === 'failed') {
        window.setTimeout(() => setTask((current) =>
          current?.id === record.id && current.status === record.status ? null : current,
        ), 4000);
      }
    });
    void api.list().then((records) => {
      if (!mounted) return;
      const resumableOrNeedsReview = records.find((record) =>
        ['running', 'planning', 'awaiting_approval', 'awaiting_user', 'pause_requested', 'paused', 'blocked', 'cancelling'].includes(record.status),
      );
      if (resumableOrNeedsReview) {
        setTask((current) =>
          current && (current.updatedAt ?? current.createdAt) > (resumableOrNeedsReview.updatedAt ?? resumableOrNeedsReview.createdAt)
            ? current
            : resumableOrNeedsReview,
        );
      }
    }).catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
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
    if (chat.streaming || searchPending) return;

    const explicitSearch = attachments.length === 0 ? parseExplicitSearchCommand(text) : null;
    if (explicitSearch) {
      if (bridge.kind !== 'ready' || typeof bridge.bridge.browser?.openSearch !== 'function') {
        showNotice('Browser search is unavailable in this build of Pixel.');
        return;
      }
      if (!chat.conversationId || chat.historyLoading) {
        showNotice('Pixel is still restoring the selected conversation.');
        return;
      }
      setDraft('');
      setSearchPending(true);
      void bridge.bridge.browser.openSearch(explicitSearch, text, chat.conversationId)
        .then(async () => {
          await chat.openConversation(chat.conversationId as string);
          showNotice(`Opened search results for ${explicitSearch} in your default browser.`);
        })
        .catch(async (cause: unknown) => {
          await chat.openConversation(chat.conversationId as string);
          setDraft((current) => current || text);
          showNotice(cause instanceof Error ? cause.message : 'Pixel could not open search results in your default browser.');
        })
        .finally(() => setSearchPending(false));
      return;
    }

    setDraft('');
    setSpeechConfirmed(false);
    const images = attachments;
    setAttachments([]);
    void chat.send({ text, images, mode });
  }, [attachments, bridge, chat, draft, mode, searchPending, showNotice, stopped]);

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
      .captureActiveWindow()
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
      void shell.voiceCancel?.();
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
        if (result.error?.toLowerCase().includes('cancelled')) return;
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
    setSpeechConfirmed(false);
    void shell
      .voiceSpeak(chat.content)
      .then((result) => {
        if (result.ok) setSpeechConfirmed(true);
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

  const openHistory = useCallback(() => {
    setInputOpen(true);
    setHistoryOpen(true);
  }, []);

  const openWorkspace = useCallback(() => {
    if (bridge.kind === 'ready') void bridge.bridge.window.openWorkspace().catch(() => showNotice('Pixel Workspace could not be opened.'));
  }, [bridge, showNotice]);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    void chat.revealTranscript();
  }, [chat.revealTranscript]);

  const openConversation = useCallback(async (id: string): Promise<boolean> => {
    const opened = await chat.openConversation(id);
    if (opened) setHistoryOpen(false);
    return opened;
  }, [chat.openConversation]);

  const startNewConversation = useCallback(async (): Promise<boolean> => {
    const created = await chat.newConversation();
    if (created) setHistoryOpen(false);
    return created;
  }, [chat.newConversation]);

  const emergencyStop = useCallback(() => {
    if (bridge.kind !== 'ready') return;
    void bridge.bridge.system.emergencyStop().catch(() => undefined);
  }, [bridge]);

  const clearStop = useCallback(() => {
    if (bridge.kind !== 'ready') return;
    void bridge.bridge.system.emergencyClear().then(() => {
      setStopped(false);
      showNotice('Emergency stop cleared. Pixel will ask before acting again.');
    }).catch(() => showNotice('Pixel could not clear the emergency stop.'));
  }, [bridge, showNotice]);

  const collapseRef = useRef(collapse);
  collapseRef.current = collapse;
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (modeMenuOpen) {
          setModeMenuOpen(false);
          return;
        }
        if (pendingMode !== null) {
          setPendingMode(null);
          return;
        }
        if (notice !== null) {
          setNotice(null);
          return;
        }
        if (permission !== null) return;
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
  }, [modeMenuOpen, pendingMode, notice, permission]);

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
      ref={layoutRef}
      className={`${rootClass} flex h-screen w-screen flex-col items-center justify-start overflow-x-hidden overflow-y-auto bg-transparent pt-2`}
      data-surface={nextSurface}
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

      {nextSurface === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            setInputOpen(true);
            void chat.revealTranscript();
          }}
          aria-label={`Open Pixel. Mode: ${modeDescriptor.label}. ${modeDescriptor.summary}`}
          aria-haspopup="dialog"
          className="glass island-collapsed group relative grid h-[54px] w-[112px] place-items-center rounded-full outline-none transition-transform duration-200 hover:scale-[1.035] focus-visible:ring-2 focus-visible:ring-sky-400/70 cursor-pointer"
        >
          <PixelMark size={31} />
          <span aria-hidden="true" className="absolute bottom-[10px] right-[31px] rounded-full border-2 border-[var(--color-glass)]"><Avatar state={assistantState} size={12} /></span>
        </button>
      ) : (
        <div
          data-layout-panel
          className="animate-slide-down flex w-full flex-col items-center gap-2 px-2"
          data-no-drag
        >
          {stopped ? (
            <div
              role="alert"
              data-layout-panel
              className="flex w-full max-w-[460px] items-center justify-between gap-2 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-[12px] text-rose-100"
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
              data-layout-panel
              className="w-full max-w-[460px] rounded-xl border border-white/12 bg-white/8 px-3 py-2 text-[12px] text-[var(--color-ink-soft)]"
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
              onContinue={() => {
                if (bridge.kind !== 'ready') return;
                void bridge.bridge.tasks.continueAfterHandoff(task.id).then((continued) => {
                  if (!continued) showNotice('Pixel could not continue this handoff. It may already have ended.');
                }).catch(() => showNotice('Pixel could not continue this handoff.'));
              }}
            />
          ) : null}

          {pendingMode !== null ? (
            <div
              role="alertdialog"
              aria-label="Confirm mode change"
              data-layout-panel
              className="w-full max-w-[460px] rounded-2xl border border-amber-400/35 bg-[var(--color-glass-raised)] p-3 text-[12px] text-[var(--color-ink)]"
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

          {historyOpen ? (
            <RecentChatsPanel
              selectedId={chat.conversationId}
              disabled={chat.streaming || chat.historyLoading || hasActiveTask || permission !== null}
              onOpen={openConversation}
              onNew={startNewConversation}
              onClose={closeHistory}
            />
          ) : chat.showTranscript ? (
            <ConversationTranscript
              messages={chat.messages}
              content={chat.content}
              reasoning={chat.reasoning}
              streaming={chat.streaming}
              error={chat.error}
              persistence={chat.persistence}
              onStop={chat.stop}
              onDismiss={collapse}
            />
          ) : bubbleVisible ? (
            <ResponseBubble
              content={chat.content}
              reasoning={chat.reasoning}
              streaming={chat.streaming}
              error={chat.error}
              spoken={speechConfirmed && !chat.streaming}
              onCollapse={collapse}
              onStop={chat.stop}
              onDismiss={collapse}
            />
          ) : null}

          <div className="relative" data-layout-panel>
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
              disabled={bridge.kind !== 'ready' || chat.historyLoading || searchPending || historyOpen}
            />

            <div className="glass-toolbar mt-1.5 flex items-center justify-center gap-1 rounded-full px-1.5 py-1">
              <span className="pixel-brand-lockup" aria-label="Pixel">
                <PixelMark size={16} />
                <span className="pixel-brand-divider" />
                <span className="pixel-wordmark">PIXEL</span>
              </span>
              <button
                type="button"
                onClick={() => historyOpen ? closeHistory() : openHistory()}
                aria-label="Recent chats"
                aria-expanded={historyOpen}
                disabled={chat.streaming || chat.historyLoading || hasActiveTask || permission !== null || bridge.kind !== 'ready'}
                className={`grid size-6 place-items-center rounded-md focus-visible:ring-2 focus-visible:ring-sky-400/70 disabled:opacity-40 ${historyOpen ? 'bg-sky-300/12 text-sky-200' : 'text-[var(--color-ink-dim)] hover:bg-white/10 hover:text-[var(--color-ink)]'}`}
              >
                <History aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={openWorkspace}
                aria-label="Open Pixel Workspace"
                className="grid size-6 place-items-center rounded-md text-[var(--color-ink-dim)] hover:bg-sky-300/12 hover:text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400/70"
              >
                <LayoutDashboard aria-hidden="true" className="size-3.5" />
              </button>
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
