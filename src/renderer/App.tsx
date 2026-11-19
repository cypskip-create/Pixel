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
import {
  INITIAL_DYNAMIC_ISLAND,
  ISLAND_TIMING,
  isDynamicIslandExpanded,
  reduceDynamicIsland,
  type DynamicIslandEvent,
} from '@shared/dynamicIsland';
import { mergeVoiceTranscriptIntoDraft } from '@shared/companion/pushToTalkSubmission';
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
import { VisualGuidanceOverlay } from '@/components/VisualGuidanceOverlay';
import { BridgeContext } from '@/hooks/useBridge';
import { useChat } from '@/hooks/useChat';
import { useMotionPolicy } from '@/hooks/useMotion';
import { usePresentationLayout } from '@/hooks/usePresentationLayout';
import { useSettings } from '@/hooks/useSettings';
import { readBridge, safeSubscribe } from '@/lib/bridge';
import { resolveSurface } from '@/lib/surface';
import { MicrophoneCapture } from '@/lib/audioCapture';
import { Workspace } from '@/Workspace';

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

function isGuidanceWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'guidance';
}

interface PushToTalkCaptureRecord {
  sessionId: number;
  capture: MicrophoneCapture;
  phase: 'starting' | 'recording' | 'stopping';
  stopAction?: 'submit' | 'cancel';
}

export function App(): React.JSX.Element {
  const bridge = readBridge();
  return (
    <BridgeContext.Provider value={bridge}>
      {isGuidanceWindow() ? <VisualGuidanceOverlay /> : isSettingsWindow() ? <SettingsWindow /> : isCursorWindow() ? <CursorCompanionWindow /> : isWorkspaceWindow() ? <Workspace /> : <Companion />}
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
    <div className="flex min-h-screen w-full justify-center bg-[var(--color-surface-raised)] p-3 text-[var(--color-ink)]">
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
  const [orientation, setOrientation] = useState({ flipX: false, flipY: false });

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let mounted = true;
    const unsubscribe = safeSubscribe<boolean>(bridge.bridge.window.onCursorMotion, setReducedMotion);
    const unsubscribePlacement = safeSubscribe<{ flipX: boolean; flipY: boolean }>(bridge.bridge.window.onCursorPlacement, setOrientation);
    void bridge.bridge.settings.get().then((settings) => {
      if (mounted) setReducedMotion(settings.companion.reducedMotion);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribePlacement();
    };
  }, [bridge]);

  return (
    <div aria-hidden="true" className={`${reducedMotion ? 'reduce-motion' : 'motion-ok'} pointer-events-none grid h-screen w-screen place-items-center bg-transparent`}>
      <CursorBuddy reducedMotion={reducedMotion} {...orientation} />
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

  const [island, setIsland] = useState(INITIAL_DYNAMIC_ISLAND);
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
  const [pushToTalkState, setPushToTalkState] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing' | 'submitting'>('idle');
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [speechConfirmed, setSpeechConfirmed] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);

  const dispatchIsland = useCallback((event: DynamicIslandEvent) => {
    setIsland((current) => reduceDynamicIsland(current, event));
  }, []);

  const openIsland = useCallback(() => {
    dispatchIsland({ type: 'OPEN_CLICK' });
  }, [dispatchIsland]);

  const onIslandPointerEnter = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    hoverTimer.current = null;
    leaveTimer.current = null;
    dispatchIsland({ type: 'POINTER_ENTER' });
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      dispatchIsland({ type: 'HOVER_DELAY_ELAPSED' });
    }, ISLAND_TIMING.hoverActivationMs);
  }, [dispatchIsland]);

  const onIslandPointerLeave = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    dispatchIsland({ type: 'POINTER_LEAVE' });
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      dispatchIsland({ type: 'LEAVE_GRACE_ELAPSED' });
    }, ISLAND_TIMING.pointerLeaveGraceMs);
  }, [dispatchIsland]);

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
  }, []);

  const mode = settings.companion.mode;
  const modeDescriptor = getModeDescriptor(mode);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const handledPushToTalkSessions = useRef(new Set<number>());
  const pushToTalkCapture = useRef<PushToTalkCaptureRecord | null>(null);
  const manualCapture = useRef<MicrophoneCapture | null>(null);

  useEffect(() => {
    dispatchIsland({
      type: 'DRAFT_CHANGED',
      hasDraft: draft.trim().length > 0 || attachments.length > 0,
    });
  }, [attachments.length, dispatchIsland, draft]);

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

  const islandExpanded = isDynamicIslandExpanded(island.state);
  const bubbleVisible = islandExpanded && !historyOpen && (chat.showTranscript || chat.streaming || chat.content.length > 0 || chat.error !== null);
  const hasActiveTask =
    task !== null && ['running', 'planning', 'pause_requested', 'awaiting_approval', 'awaiting_user', 'paused', 'blocked', 'cancelling'].includes(task.status);

  useEffect(() => {
    dispatchIsland({
      type: 'RUNTIME_CHANGED',
      recording: listening || pushToTalkState === 'recording',
      transcribing: pushToTalkState === 'stopping' || pushToTalkState === 'transcribing',
      workActive: chat.streaming || (hasActiveTask && permission === null),
      responseAvailable: !chat.streaming && chat.content.trim().length > 0,
      approvalRequired: permission !== null,
    });
  }, [chat.content, chat.streaming, dispatchIsland, hasActiveTask, listening, permission, pushToTalkState]);

  useEffect(() => {
    if (island.state !== 'CLICK_EXPANDED' || island.pointerInside || island.hasDraft ||
        island.workActive || island.recording || island.transcribing || island.approvalRequired) return;
    const timer = window.setTimeout(
      () => dispatchIsland({ type: 'IDLE_TIMEOUT' }),
      ISLAND_TIMING.idleCollapseMs,
    );
    return () => window.clearTimeout(timer);
  }, [dispatchIsland, island]);

  useEffect(() => {
    if (island.state !== 'RESPONSE_AVAILABLE') return;
    const timer = window.setTimeout(
      () => dispatchIsland({ type: 'RESPONSE_NOTICE_ELAPSED' }),
      ISLAND_TIMING.responseNoticeMs,
    );
    return () => window.clearTimeout(timer);
  }, [dispatchIsland, island.state]);

  const nextSurface = useMemo(
    () =>
      resolveSurface({
        windowHidden: false,
        hasPermission: permission !== null,
        hasActiveTask: hasActiveTask && islandExpanded,
        bubbleVisible,
        inputOpen: islandExpanded || historyOpen,
      }),
    [permission, hasActiveTask, bubbleVisible, islandExpanded, historyOpen],
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
        openIsland();
        void chat.revealTranscript();
      });
    } catch {
      return undefined;
    }
  }, [bridge, chat.revealTranscript, openIsland]);

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
      manualCapture.current?.cancel();
      manualCapture.current = null;
      setListening(false);
      void window.cypsShell?.voiceCaptureRelease?.();
      showNotice('Emergency stop: new actions are blocked until you clear it.');
    });
  }, [bridge, chat, showNotice]);

  const finishPushToTalkCapture = useCallback(async (current: PushToTalkCaptureRecord) => {
    if (pushToTalkCapture.current !== current) return;
    current.phase = 'stopping';
    try {
      const wav = await current.capture.stop();
      if (pushToTalkCapture.current !== current) return;
      pushToTalkCapture.current = null;
      const shell = window.cypsShell;
      if (!shell?.voicePttTranscribe) throw new Error('Pixel cannot send this recording to its local speech recognizer.');
      const result = await shell.voicePttTranscribe(current.sessionId, wav);
      if (!result.ok && !result.error?.toLowerCase().includes('cancelled')) {
        showNotice(result.error ?? 'Pixel could not transcribe that recording. Nothing was submitted.');
      }
    } catch (error) {
      if (pushToTalkCapture.current === current) pushToTalkCapture.current = null;
      const message = error instanceof Error ? error.message : 'Pixel could not finish microphone capture.';
      if (!message.toLowerCase().includes('cancelled')) showNotice(message);
      void window.cypsShell?.voicePttCaptureReady(current.sessionId, message);
    } finally {
      setMicrophoneLevel(0);
    }
  }, [showNotice]);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell?.onPushToTalkState || !shell.onPushToTalkStopCapture) return;
    const unsubscribeState = safeSubscribe(shell.onPushToTalkState, (event) => {
      if (event.state === 'failed' || event.state === 'cancelled') {
        const current = pushToTalkCapture.current;
        if (current && (event.sessionId === undefined || current.sessionId === event.sessionId)) {
          current.capture.cancel();
          pushToTalkCapture.current = null;
        }
        setPushToTalkState('idle');
        setMicrophoneLevel(0);
        if (event.state === 'failed' && event.error) showNotice(event.error);
        return;
      }

      setPushToTalkState(event.state);
      if (event.state !== 'starting' || !Number.isSafeInteger(event.sessionId)) return;
      const sessionId = event.sessionId as number;
      if (manualCapture.current || pushToTalkCapture.current) {
        void shell.voicePttCaptureReady(sessionId, 'Another microphone capture is already active.');
        return;
      }

      const capture = new MicrophoneCapture(setMicrophoneLevel);
      const current: PushToTalkCaptureRecord = { sessionId, capture, phase: 'starting' };
      pushToTalkCapture.current = current;
      void capture.start(settings.voice.inputDeviceId).then(async () => {
        if (pushToTalkCapture.current !== current) {
          capture.cancel();
          return;
        }
        if (current.stopAction === 'cancel') {
          capture.cancel();
          pushToTalkCapture.current = null;
          setMicrophoneLevel(0);
          return;
        }
        if (current.stopAction === 'submit') {
          await finishPushToTalkCapture(current);
          return;
        }
        current.phase = 'recording';
        const accepted = await shell.voicePttCaptureReady(sessionId);
        if (!accepted && pushToTalkCapture.current === current) {
          capture.cancel();
          pushToTalkCapture.current = null;
          setMicrophoneLevel(0);
        }
      }).catch((error: unknown) => {
        if (pushToTalkCapture.current !== current) return;
        pushToTalkCapture.current = null;
        capture.cancel();
        setMicrophoneLevel(0);
        const message = error instanceof Error ? error.message : 'Microphone capture could not start.';
        void shell.voicePttCaptureReady(sessionId, message);
      });
    });
    const unsubscribeStop = safeSubscribe(shell.onPushToTalkStopCapture, (event) => {
      const current = pushToTalkCapture.current;
      if (!current || current.sessionId !== event.sessionId) return;
      if (current.phase === 'starting') {
        current.stopAction = event.action;
        if (event.action === 'cancel') {
          current.capture.cancel();
          pushToTalkCapture.current = null;
          setMicrophoneLevel(0);
        }
        return;
      }
      if (event.action === 'cancel') {
        current.capture.cancel();
        pushToTalkCapture.current = null;
        setMicrophoneLevel(0);
        return;
      }
      void finishPushToTalkCapture(current);
    });
    return () => {
      unsubscribeState();
      unsubscribeStop();
      pushToTalkCapture.current?.capture.cancel();
      pushToTalkCapture.current = null;
    };
  }, [finishPushToTalkCapture, settings.voice.inputDeviceId, showNotice]);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell?.onVoiceCaptureCancel) return;
    return shell.onVoiceCaptureCancel(() => {
      manualCapture.current?.cancel();
      manualCapture.current = null;
      setListening(false);
      setMicrophoneLevel(0);
      void shell.voiceCaptureRelease?.();
    });
  }, []);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell?.onPushToTalkSubmit) return;
    return safeSubscribe(shell.onPushToTalkSubmit, (request) => {
      if (!Number.isSafeInteger(request.sessionId) || typeof request.text !== 'string') return;
      if (handledPushToTalkSessions.current.has(request.sessionId)) return;
      handledPushToTalkSessions.current.add(request.sessionId);
      if (handledPushToTalkSessions.current.size > 32) {
        const oldest = handledPushToTalkSessions.current.values().next().value;
        if (oldest !== undefined) handledPushToTalkSessions.current.delete(oldest);
      }

      const text = request.text.trim().slice(0, 20_000);
      if (!text) {
        setPushToTalkState('idle');
        return;
      }
      if (stopped || chat.streaming || hasActiveTask || permission !== null) {
        setDraft((current) => mergeVoiceTranscriptIntoDraft(current, text));
        openIsland();
        setPushToTalkState('idle');
        showNotice('Your voice instruction is saved in the draft because Pixel is busy. Review it before sending.');
        return;
      }

      void chat.send({ text, images: [], mode }).then((sent) => {
        if (sent) {
          setPushToTalkState('idle');
          return;
        }
        setDraft((current) => mergeVoiceTranscriptIntoDraft(current, text));
        openIsland();
        setPushToTalkState('idle');
        showNotice('Your voice instruction is saved in the draft. Review it and try again.');
      }).catch(() => {
        setDraft((current) => mergeVoiceTranscriptIntoDraft(current, text));
        openIsland();
        setPushToTalkState('idle');
        showNotice('Pixel could not submit the voice instruction. It is saved in the draft for review.');
      });
    });
  }, [chat.send, chat.streaming, hasActiveTask, mode, openIsland, permission, showNotice, stopped]);

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
    dispatchIsland({ type: 'CLOSE_CLICK' });
    setHistoryOpen(false);
    setModeMenuOpen(false);
    setPendingMode(null);
  }, [dispatchIsland]);

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
      .captureLastExternalWindow()
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

  const finishManualVoiceCapture = useCallback((capture: MicrophoneCapture, reachedLimit = false) => {
    if (manualCapture.current !== capture) return;
    manualCapture.current = null;
    setListening(false);
    const shell = window.cypsShell;
    if (!shell?.voiceTranscribeWav) {
      capture.cancel();
      void shell?.voiceCaptureRelease?.();
      showNotice('Pixel cannot send this recording to its local speech recognizer.');
      return;
    }
    void capture.stop().then(async (wav) => {
      await shell.voiceCaptureRelease?.();
      const result = await shell.voiceTranscribeWav(wav);
      if (result.ok && result.text.trim().length > 0) {
        setDraft((current) => current.length > 0 ? `${current} ${result.text.trim()}` : result.text.trim());
        if (reachedLimit) showNotice('The 120-second dictation limit was reached. The transcription was added to the draft.');
        return;
      }
      showNotice(result.error ?? 'Pixel did not hear anything.');
    }).catch((error: unknown) => {
      void shell.voiceCaptureRelease?.();
      const message = error instanceof Error ? error.message : 'Speech recognition failed.';
      if (!message.toLowerCase().includes('cancelled')) showNotice(message);
    }).finally(() => setMicrophoneLevel(0));
  }, [showNotice]);

  /** Manual microphone mode: recording stays in the composer until submitted. */
  const toggleListening = useCallback(() => {
    const shell = window.cypsShell;
    if (!shell || typeof shell.voiceTranscribeWav !== 'function') {
      setListening(false);
      showNotice('Voice input needs the desktop shell, which is not available here.');
      return;
    }

    if (listening) {
      const capture = manualCapture.current;
      if (capture) finishManualVoiceCapture(capture);
      return;
    }

    if (manualCapture.current || pushToTalkCapture.current) {
      showNotice('Pixel is already using the microphone for another voice interaction.');
      return;
    }
    let capture: MicrophoneCapture;
    capture = new MicrophoneCapture(setMicrophoneLevel, () => finishManualVoiceCapture(capture, true));
    manualCapture.current = capture;
    void shell.voiceCapability().then(async (capability) => {
      if (!capability.speechToText) throw new Error(capability.reason ?? 'Local speech recognition is unavailable.');
      const acquired = await shell.voiceCaptureAcquire();
      if (!acquired) throw new Error('Another Pixel window is already using the microphone.');
      await capture.start(settings.voice.inputDeviceId);
      if (manualCapture.current === capture) setListening(true);
      else {
        capture.cancel();
        await shell.voiceCaptureRelease();
      }
    }).catch((error: unknown) => {
      if (manualCapture.current === capture) manualCapture.current = null;
      setListening(false);
      setMicrophoneLevel(0);
      void shell.voiceCaptureRelease();
      showNotice(error instanceof Error ? error.message : 'Microphone capture could not start.');
    });
  }, [finishManualVoiceCapture, listening, settings.voice.inputDeviceId, showNotice]);

  useEffect(() => () => {
    manualCapture.current?.cancel();
    void window.cypsShell?.voiceCaptureRelease?.();
    pushToTalkCapture.current?.capture.cancel();
  }, []);

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
    openIsland();
    setHistoryOpen(true);
  }, [openIsland]);

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
    transcribing: pushToTalkState === 'stopping' || pushToTalkState === 'transcribing',
    executing: hasActiveTask,
    speaking,
  });
  const compactAssistantState: AssistantState = island.state === 'RESPONSE_AVAILABLE'
    ? 'success'
    : island.state === 'BACKGROUND_WORKING'
      ? 'thinking'
      : assistantState;

  const rootClass = reducedMotion ? 'reduce-motion' : 'motion-ok';
  const pushToTalkLabel = pushToTalkState === 'recording'
    ? `Pixel is listening. Release ${settings.voice.pushToTalkAccelerator.replace(/CommandOrControl/gi, 'Ctrl').replace(/\+/g, ' plus ')} to submit.`
    : pushToTalkState === 'starting'
      ? 'Pixel is requesting microphone access.'
      : pushToTalkState === 'stopping'
        ? 'Pixel is stopping microphone capture.'
        : pushToTalkState === 'transcribing'
          ? 'Pixel is transcribing the recording.'
          : pushToTalkState === 'submitting'
            ? 'Pixel is submitting the voice instruction.'
            : '';

  return (
    <div
      ref={layoutRef}
      className={`${rootClass} flex h-screen w-screen flex-col items-center justify-start overflow-x-hidden overflow-y-auto bg-transparent pt-2`}
      data-surface={nextSurface}
      onPointerEnter={onIslandPointerEnter}
      onPointerLeave={onIslandPointerLeave}
    >
      {/* Screen readers hear the answer as it arrives. */}
      <p aria-live="polite" aria-atomic="false" className="sr-only">
        {chat.streaming ? chat.content : chat.error ?? ''}
      </p>
      <p aria-live="polite" aria-atomic="true" className="sr-only">{pushToTalkLabel}</p>

      {bridge.kind === 'missing' ? (
        <div
          role="alert"
          className="mx-3 flex items-start gap-2 rounded-xl border border-neutral-400/30 bg-neutral-500/12 px-3 py-2 text-[12px] text-neutral-100"
        >
          <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {bridge.reason} Pixel is running without its desktop shell, so it cannot answer.
          </span>
        </div>
      ) : null}

      {!islandExpanded && nextSurface === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            openIsland();
            void chat.revealTranscript();
          }}
          aria-label={pushToTalkState !== 'idle' ? pushToTalkLabel
            : `Open Pixel. ${island.state === 'RESPONSE_AVAILABLE' ? 'A response is ready. ' : ''}Mode: ${modeDescriptor.label}. ${modeDescriptor.summary}`}
          aria-haspopup="dialog"
          className="pixel-surface group relative grid h-[38px] w-[138px] place-items-center rounded-full outline-none transition-transform duration-200 hover:scale-[1.025] focus-visible:ring-2 focus-visible:ring-neutral-400/70 cursor-pointer"
        >
          {pushToTalkState === 'recording' ? (
            <span className="island-ptt-indicator" aria-hidden="true">
              <PixelMark size={17} />
              <span className="island-ptt-wave">{[3, 6, 4, 8, 5, 7, 3].map((height, index) => {
                const amplitude = Math.max(0.12, microphoneLevel);
                return <i key={index} style={{ height: `${Math.max(2, Math.round((height + 2) * amplitude))}px` }} />;
              })}</span>
            </span>
          ) : (
            <>
              <PixelMark size={19} />
              <span aria-hidden="true" className="absolute bottom-[7px] right-[48px] rounded-full border-2 border-[var(--color-surface)]"><Avatar state={compactAssistantState} size={9} /></span>
            </>
          )}
        </button>
      ) : islandExpanded || nextSurface !== 'idle' ? (
        <div
          data-layout-panel
          className="animate-slide-down flex w-full flex-col items-center gap-2 px-2"
          data-no-drag
        >
          {stopped ? (
            <div
              role="alert"
              data-layout-panel
              className="flex w-full max-w-[460px] items-center justify-between gap-2 rounded-xl border border-neutral-400/35 bg-neutral-500/15 px-3 py-2 text-[12px] text-neutral-100"
            >
              <span className="flex items-center gap-1.5">
                <ShieldAlert aria-hidden="true" className="size-4" />
                Emergency stop is active.
              </span>
              <button
                type="button"
                onClick={clearStop}
                className="rounded-md border border-neutral-300/40 px-2 py-0.5 font-medium hover:bg-neutral-400/20"
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
              className="w-full max-w-[460px] rounded-2xl border border-neutral-400/35 bg-[var(--color-surface-raised)] p-3 text-[12px] text-[var(--color-ink)]"
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
                  className="rounded-md border border-neutral-300/40 bg-neutral-400/20 px-2.5 py-1 font-medium hover:bg-neutral-400/30"
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
              autoFocus={island.state === 'CLICK_EXPANDED' && !historyOpen}
            />

            <div className="mt-1.5 flex items-center justify-center gap-1">
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
                className={`grid size-6 place-items-center rounded-md focus-visible:ring-2 focus-visible:ring-neutral-400/70 disabled:opacity-40 ${historyOpen ? 'bg-neutral-300/12 text-neutral-200' : 'text-[var(--color-ink-dim)] hover:bg-white/10 hover:text-[var(--color-ink)]'}`}
              >
                <History aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={openWorkspace}
                aria-label="Open Pixel Workspace"
                className="grid size-6 place-items-center rounded-md text-[var(--color-ink-dim)] hover:bg-neutral-300/12 hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-400/70"
              >
                <LayoutDashboard aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={openSettings}
                aria-label="Pixel settings"
                className="grid size-6 place-items-center rounded-md text-[var(--color-ink-dim)] hover:bg-white/10 hover:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-neutral-400/70"
              >
                <Settings aria-hidden="true" className="size-3.5" />
              </button>
              {busy ? (
                <button
                  type="button"
                  onClick={chat.stop}
                  aria-label="Stop answering"
                  className="grid size-6 place-items-center rounded-md text-neutral-200 hover:bg-neutral-500/20 focus-visible:ring-2 focus-visible:ring-neutral-400/70"
                >
                  <Square aria-hidden="true" className="size-3" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={emergencyStop}
                aria-label="Emergency stop: block all further actions"
                className="grid size-6 place-items-center rounded-md text-[var(--color-ink-dim)] hover:bg-neutral-500/20 hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-400/70"
              >
                <ShieldAlert aria-hidden="true" className="size-3.5" />
              </button>
              <span className="ml-1 text-[10px] text-[var(--color-ink-dim)]">
                {hasApiKey === false ? 'No API key' : modeDescriptor.label}
              </span>
            </div>
          </div>
        </div>
      ) : null}

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
