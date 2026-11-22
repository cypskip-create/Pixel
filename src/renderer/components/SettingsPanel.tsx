import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Brain, Cpu, Eye, EyeOff, Gauge, Globe2, Keyboard, LayoutDashboard,
  ListChecks, Mic, Palette, Plug, ShieldCheck, Sparkles, Terminal, Wrench, X,
} from 'lucide-react';
import type {
  AppSettings, AssistantState, ConnectionTestResult, CypsErrorCode, DiagnosticsSnapshot,
  Mode, PluginView, ToolCatalogEntry, VoiceModelInfo, VoiceModelProgress,
} from '@shared/types';
import { getModeDescriptor } from '@shared/types';
import { IconButton } from '@/components/IconButton';
import { ModeSwitcher } from '@/components/ModeSwitcher';
import { AutomationPanel } from '@/components/AutomationPanel';
import { MemoryPanel } from '@/components/MemoryPanel';
import { PermissionsPanel } from '@/components/PermissionsPanel';
import { PixelMark } from '@/components/PixelMark';
import { PixMascot } from '@/components/PixMascot';
import { CursorBuddy } from '@/components/CursorBuddy';
import {
  WorkspacePluginManager,
  type PluginLifecycleAction,
  type PluginProjectAvailability,
  type PluginSettingChange,
} from '@/components/WorkspacePluginManager';
import { MicrophoneCapture, type VoiceCaptureDiagnostics } from '@/lib/audioCapture';

export type SettingsPage =
  | 'general'
  | 'ai-models'
  | 'agent-permissions'
  | 'voice'
  | 'memory'
  | 'tools'
  | 'plugins'
  | 'skills'
  | 'appearance'
  | 'workspace'
  | 'advanced';

export const SETTINGS_CATEGORIES: ReadonlyArray<{ id: SettingsPage; label: string; icon: typeof Gauge }> = [
  { id: 'general', label: 'General', icon: Gauge },
  { id: 'ai-models', label: 'AI & Models', icon: Cpu },
  { id: 'agent-permissions', label: 'Agent & Permissions', icon: ShieldCheck },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'plugins', label: 'Plugins & Connections', icon: Plug },
  { id: 'skills', label: 'Skills & Routines', icon: Sparkles },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'workspace', label: 'Workspace', icon: LayoutDashboard },
  { id: 'advanced', label: 'Advanced', icon: Terminal },
];

const VALID_SETTINGS_PAGES = new Set<string>(SETTINGS_CATEGORIES.map((item) => item.id));

interface SettingsPanelProps {
  settings: AppSettings;
  displays: DiagnosticsSnapshot['displays'];
  /** Persist a partial patch. Never throws: failures surface via error. */
  onPatch: (patch: DeepPartial<AppSettings>) => void;
  onRequestMode: (mode: Mode) => void;
  onClose: () => void;
  hasApiKey: boolean | null;
  onSaveApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  onRemoveApiKey: () => Promise<{ ok: boolean; error?: string }>;
  onTestConnection: () => Promise<ConnectionTestResult>;
  /** Latest write failure, if any. */
  error: string | null;
  saving: boolean;
  workspaceLayout?: boolean;
  initialPage?: SettingsPage;
  tools?: ToolCatalogEntry[];
  plugins?: PluginView[];
  onPluginChange?: (
    action: PluginLifecycleAction,
    pluginId: string,
    enabled?: boolean,
    availability?: PluginProjectAvailability,
    setting?: PluginSettingChange,
  ) => Promise<void>;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const SETTINGS_PAGE_KEY = 'pixel.settings.workspace-page.v2';

function initialSettingsPage(override?: SettingsPage): SettingsPage {
  if (override && VALID_SETTINGS_PAGES.has(override)) return override;
  if (typeof window === 'undefined') return 'general';
  try {
    const value = window.localStorage.getItem(SETTINGS_PAGE_KEY);
    if (value && VALID_SETTINGS_PAGES.has(value)) return value as SettingsPage;
  } catch { /* Settings still opens when browser storage is unavailable. */ }
  return 'general';
}

/**
 * Compact settings sheet.
 *
 * Anchored under the bar and capped at ~60vh, because the constraint is that
 * Pixel must never become a dashboard. Only the settings that actually change
 * behaviour of the floating companion are exposed here - not a full preferences
 * application.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const {
    settings,
    displays,
    onPatch,
    onRequestMode,
    onClose,
    hasApiKey,
    onSaveApiKey,
    onRemoveApiKey,
    onTestConnection,
    error,
    saving,
    workspaceLayout = false,
    initialPage,
    tools = [],
    plugins = [],
    onPluginChange,
  } = props;
  const [advanced, setAdvanced] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(() => initialSettingsPage(initialPage));
  useEffect(() => {
    if (initialPage && VALID_SETTINGS_PAGES.has(initialPage)) setSettingsPage(initialPage);
  }, [initialPage]);
  const [cursorPreview, setCursorPreview] = useState(false);
  const [pixPreviewState, setPixPreviewState] = useState<AssistantState>('idle');
  const [automationOpen, setAutomationOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [keyEditorReset, setKeyEditorReset] = useState(0);
  const [pushToTalkStatus, setPushToTalkStatus] = useState<{ accelerator: string; ok: boolean; reason?: string } | null>(null);
  const [speechCapability, setSpeechCapability] = useState<{ speechToText: boolean; reason?: string } | null>(null);
  const [microphones, setMicrophones] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [microphoneTest, setMicrophoneTest] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [voiceTestRecording, setVoiceTestRecording] = useState(false);
  const [voiceTestBusy, setVoiceTestBusy] = useState(false);
  const [voiceTestResult, setVoiceTestResult] = useState<{ text?: string; backend?: string; model?: string; processingMs?: number; error?: string; diagnostics?: VoiceCaptureDiagnostics } | null>(null);
  const [showCaptureDiagnostics, setShowCaptureDiagnostics] = useState(false);
  const [allowDiagnosticAudioSave, setAllowDiagnosticAudioSave] = useState(false);
  const [diagnosticAudio, setDiagnosticAudio] = useState<Uint8Array | null>(null);
  const [voiceModels, setVoiceModels] = useState<VoiceModelInfo[]>([]);
  const [voiceModelProgress, setVoiceModelProgress] = useState<VoiceModelProgress | null>(null);
  const [voiceSystemVoices, setVoiceSystemVoices] = useState<string[]>([]);
  const [voiceAction, setVoiceAction] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const microphoneCapture = useRef<MicrophoneCapture | null>(null);
  const voiceTestCapture = useRef<MicrophoneCapture | null>(null);
  const voiceTestSession = useRef(0);
  const voiceTestTranscribing = useRef(false);
  const voiceTestSpeaking = useRef(false);
  const microphoneTestTimer = useRef<number | null>(null);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell) return;
    let mounted = true;
    const shortcutStatus = shell.getPushToTalkStatus?.();
    if (shortcutStatus) void shortcutStatus.then((status) => { if (mounted) setPushToTalkStatus(status); }).catch(() => undefined);
    const voiceStatus = shell.voiceCapability?.();
    if (voiceStatus) void voiceStatus.then((status) => { if (mounted) setSpeechCapability(status); }).catch(() => undefined);
    const modelList = shell.voiceModelsList?.();
    if (modelList) void modelList.then((models) => { if (mounted) setVoiceModels(models); }).catch(() => {
      if (mounted) setVoiceError('Voice model status is unavailable.');
    });
    const systemVoices = shell.voiceVoicesList?.();
    if (systemVoices) void systemVoices.then((voices) => { if (mounted) setVoiceSystemVoices(voices); }).catch(() => undefined);
    const unsubscribeProgress = shell.onVoiceModelsProgress?.((progress) => {
      if (mounted) setVoiceModelProgress(progress);
    });
    return () => { mounted = false; unsubscribeProgress?.(); };
  }, [settings.voice.pushToTalkAccelerator]);

  useEffect(() => () => {
    if (microphoneTestTimer.current !== null) window.clearTimeout(microphoneTestTimer.current);
    microphoneCapture.current?.cancel();
    microphoneCapture.current = null;
    voiceTestCapture.current?.cancel();
    voiceTestCapture.current = null;
    voiceTestSession.current += 1;
    if (voiceTestTranscribing.current || voiceTestSpeaking.current) void window.cypsShell?.voiceCancel?.();
    voiceTestTranscribing.current = false;
    voiceTestSpeaking.current = false;
    void window.cypsShell?.voiceCaptureRelease?.();
  }, []);

  const stopMicrophoneTest = useCallback(() => {
    if (microphoneTestTimer.current !== null) window.clearTimeout(microphoneTestTimer.current);
    microphoneTestTimer.current = null;
    microphoneCapture.current?.cancel();
    microphoneCapture.current = null;
    void window.cypsShell?.voiceCaptureRelease?.();
    setMicrophoneTest(false);
    setMicrophoneLevel(0);
  }, []);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell?.onVoiceCaptureCancel) return;
    return shell.onVoiceCaptureCancel(() => {
      stopMicrophoneTest();
      voiceTestSession.current += 1;
      voiceTestCapture.current?.cancel();
      voiceTestCapture.current = null;
      setVoiceTestRecording(false);
      setVoiceTestBusy(false);
      voiceTestTranscribing.current = false;
      setDiagnosticAudio(null);
      setVoiceTestResult({ error: 'Voice test cancelled.' });
    });
  }, [stopMicrophoneTest]);

  const finishVoiceTest = useCallback(async (capture: MicrophoneCapture, reachedLimit = false, sessionId = voiceTestSession.current): Promise<void> => {
    if (voiceTestCapture.current !== capture || sessionId !== voiceTestSession.current) return;
    voiceTestCapture.current = null;
    setVoiceTestRecording(false);
    setVoiceTestBusy(true);
    voiceTestTranscribing.current = true;
    const shell = window.cypsShell;
    try {
      const wav = await capture.stop();
      const diagnostics = capture.diagnostics();
      await shell?.voiceCaptureRelease?.();
      if (sessionId !== voiceTestSession.current) return;
      setDiagnosticAudio(allowDiagnosticAudioSave ? wav : null);
      if (!shell?.voiceTranscribeWav) throw new Error('The local transcription bridge is unavailable.');
      const result = await shell.voiceTranscribeWav(wav);
      if (sessionId !== voiceTestSession.current) return;
      setVoiceTestResult(result.ok
        ? {
            text: result.text,
            backend: result.backend,
            model: result.model,
            processingMs: result.processingMs,
            ...(showCaptureDiagnostics && diagnostics ? { diagnostics } : {}),
            ...(reachedLimit ? { error: 'The 30-second voice test limit was reached.' } : {}),
          }
        : { error: result.error ?? 'Pixel could not transcribe this voice test.', ...(showCaptureDiagnostics && diagnostics ? { diagnostics } : {}) });
    } catch (error) {
      await shell?.voiceCaptureRelease?.();
      if (sessionId !== voiceTestSession.current) return;
      const text = error instanceof Error ? error.message : 'Voice test failed.';
      if (!text.toLowerCase().includes('cancelled')) setVoiceTestResult({ error: text });
    } finally {
      if (sessionId === voiceTestSession.current) {
        setVoiceTestBusy(false);
        setMicrophoneLevel(0);
        voiceTestTranscribing.current = false;
      }
    }
  }, [allowDiagnosticAudioSave, showCaptureDiagnostics]);

  const toggleVoiceTest = useCallback(async (): Promise<void> => {
    const shell = window.cypsShell;
    if (voiceTestCapture.current) {
      await finishVoiceTest(voiceTestCapture.current, false, voiceTestSession.current);
      return;
    }
    if (!shell?.voiceCaptureAcquire || !shell.voiceTranscribeWav) {
      setVoiceTestResult({ error: 'The local voice test is unavailable in this Pixel build.' });
      return;
    }
    setVoiceTestResult(null);
    const sessionId = ++voiceTestSession.current;
    const capture = new MicrophoneCapture(setMicrophoneLevel, () => { void finishVoiceTest(capture, true, sessionId); });
    voiceTestCapture.current = capture;
    try {
      const acquired = await shell.voiceCaptureAcquire();
      if (!acquired) throw new Error('Another Pixel window is already using the microphone.');
      if (sessionId !== voiceTestSession.current) { capture.cancel(); return; }
      await capture.start(settings.voice.inputDeviceId, true, 30_000);
      if (sessionId !== voiceTestSession.current || voiceTestCapture.current !== capture) { capture.cancel(); return; }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === 'audioinput').map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      })));
      setVoiceTestRecording(true);
    } catch (error) {
      if (sessionId !== voiceTestSession.current) { capture.cancel(); return; }
      voiceTestCapture.current = null;
      capture.cancel();
      await shell.voiceCaptureRelease?.();
      setVoiceTestRecording(false);
      setVoiceTestResult({ error: error instanceof Error ? error.message : 'Voice test could not start.' });
    }
  }, [finishVoiceTest, settings.voice.inputDeviceId]);

  const toggleMicrophoneTest = useCallback(() => {
    if (microphoneCapture.current) {
      stopMicrophoneTest();
      setMicrophoneError('Microphone test stopped. No audio was saved.');
      return;
    }
    setMicrophoneError(null);
    const capture = new MicrophoneCapture(setMicrophoneLevel);
    microphoneCapture.current = capture;
    void (async () => {
      const shell = window.cypsShell;
      if (!shell?.voiceCaptureAcquire) throw new Error('Microphone testing is unavailable in this build.');
      const acquired = await shell.voiceCaptureAcquire();
      if (!acquired) throw new Error('Another Pixel window is already using the microphone.');
      await capture.start(settings.voice.inputDeviceId, false);
      if (microphoneCapture.current !== capture) { capture.cancel(); return; }
      setMicrophoneTest(true);
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === 'audioinput').map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      })));
      microphoneTestTimer.current = window.setTimeout(() => {
        stopMicrophoneTest();
        setMicrophoneError('Microphone test reached its 20-second limit. No audio was saved.');
      }, 20_000);
    })().catch((error: unknown) => {
      if (microphoneCapture.current === capture) microphoneCapture.current = null;
      capture.cancel();
      void window.cypsShell?.voiceCaptureRelease?.();
      setMicrophoneTest(false);
      setMicrophoneLevel(0);
      setMicrophoneError(error instanceof Error ? error.message : 'Microphone test could not start.');
    });
  }, [settings.voice.inputDeviceId, stopMicrophoneTest]);

  const closeSettings = useCallback(() => {
    setKeyEditorReset((value) => value + 1);
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeSettings();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [closeSettings]);

  const modeDescriptor = getModeDescriptor(settings.companion.mode);
  const selectedSttModel = voiceModels.find((model) => model.id === settings.voice.sttModel && model.kind === 'stt');
  const kokoroModel = voiceModels.find((model) => model.id === 'kokoro-v1.0-int8');

  const downloadVoiceModel = async (id: VoiceModelInfo['id']): Promise<void> => {
    const download = window.cypsShell?.voiceModelDownload;
    if (!download) { setVoiceError('Voice model management is unavailable in this Pixel build.'); return; }
    setVoiceAction(id);
    setVoiceError(null);
    setVoiceNotice(null);
    try {
      const result = await download(id);
      if (!result.ok) setVoiceError(result.error ?? 'Pixel could not download this model.');
      else setVoiceNotice('Model downloaded and integrity checked.');
      const models = await window.cypsShell?.voiceModelsList?.();
      if (models) setVoiceModels(models);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Pixel could not download this model.');
    } finally {
      setVoiceAction(null);
      setVoiceModelProgress(null);
    }
  };

  const removeVoiceModel = async (model: VoiceModelInfo): Promise<void> => {
    if (!window.confirm(`Remove ${model.label} from this PC? Pixel will not delete your conversations or settings.`)) return;
    const remove = window.cypsShell?.voiceModelRemove;
    if (!remove) { setVoiceError('Voice model management is unavailable in this Pixel build.'); return; }
    setVoiceAction(model.id);
    setVoiceError(null);
    setVoiceNotice(null);
    try {
      const result = await remove(model.id);
      if (!result.ok) setVoiceError(result.error ?? 'Pixel could not remove this model.');
      else setVoiceNotice('Voice model removed.');
      const models = await window.cypsShell?.voiceModelsList?.();
      if (models) setVoiceModels(models);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Pixel could not remove this model.');
    } finally {
      setVoiceAction(null);
    }
  };

  const cancelVoiceDownload = async (): Promise<void> => {
    try { await window.cypsShell?.voiceModelCancelDownload?.(); }
    catch { setVoiceError('Pixel could not cancel the model download.'); }
  };

  const testSelectedVoice = async (): Promise<void> => {
    const speak = window.cypsShell?.voiceSpeak;
    if (!speak) { setVoiceError('Voice output is unavailable in this Pixel build.'); return; }
    setVoiceAction('test-voice');
    voiceTestSpeaking.current = true;
    setVoiceError(null);
    setVoiceNotice(null);
    try {
      const result = await speak('Hello, this is a local Pixel voice test.');
      if (result.ok) {
        const details = [result.backend, typeof result.generationMs === 'number' ? `${result.generationMs} ms synthesis` : null, typeof result.playbackMs === 'number' ? `${result.playbackMs} ms playback` : null, result.backend === 'Windows System.Speech' && typeof result.elapsedMs === 'number' ? `${result.elapsedMs} ms total` : null].filter(Boolean).join(' · ');
        setVoiceNotice(details ? `Voice test completed · ${details}` : 'Voice test completed.');
      }
      else setVoiceError(result.error ?? 'Pixel could not play the voice test.');
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Pixel could not play the voice test.');
    } finally { voiceTestSpeaking.current = false; setVoiceAction(null); }
  };

  return (
    <section
      aria-label="Pixel settings"
      className={`pixel-surface-raised animate-slide-down flex ${workspaceLayout ? 'w-full max-w-[1120px]' : 'w-[460px]'} flex-col overflow-hidden rounded-[var(--cyps-radius)]`}
      style={workspaceLayout ? { minHeight: 0, height: '100%' } : { maxHeight: 'min(calc(100vh - 24px), 520px)' }}
    >
      {!workspaceLayout ? <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <PixelMark size={16} />
        <h2 className="flex-1 font-semibold text-[12.5px] text-[var(--color-ink)]">Companion</h2>
        {saving ? (
          <span role="status" aria-live="polite" className="text-[10px] text-[var(--color-ink-dim)]">
            Saving…
          </span>
        ) : null}
        <IconButton label="Close settings" onClick={closeSettings}>
          <X size={14} strokeWidth={2.4} aria-hidden="true" />
        </IconButton>
      </header> : null}

      <div className={workspaceLayout ? 'workspace-settings-layout' : 'flex-1 overflow-y-auto px-3 py-2.5'} data-settings-page={workspaceLayout ? settingsPage : undefined}>
        {workspaceLayout ? (
          <nav className="workspace-settings-nav" aria-label="Settings categories">
            <button type="button" className="workspace-settings-back" onClick={closeSettings}>
              <ArrowLeft size={15} aria-hidden="true" /> <span>Back to Workspace</span>
            </button>
            <h3>Settings</h3>
            {SETTINGS_CATEGORIES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={settingsPage === id ? 'page' : undefined}
                className={settingsPage === id ? 'is-active' : ''}
                onClick={() => {
                  setSettingsPage(id);
                  try { window.localStorage.setItem(SETTINGS_PAGE_KEY, id); } catch { /* Selection is still active for this visit. */ }
                  setAutomationOpen(false);
                  setMemoryOpen(false);
                  setPermissionsOpen(false);
                }}
              >
                <Icon size={15} aria-hidden="true" /> <span>{label}</span>
              </button>
            ))}
          </nav>
        ) : null}
        <div className={workspaceLayout ? 'workspace-settings-content' : ''}>
        {workspaceLayout ? (
          <div className="workspace-settings-page-heading">
            <h1>{SETTINGS_CATEGORIES.find((item) => item.id === settingsPage)?.label ?? 'General'}</h1>
            {saving ? <span role="status" aria-live="polite">Saving…</span> : null}
          </div>
        ) : null}
        {error !== null ? (
          <p
            role="alert"
            className="mb-2.5 rounded-xl border border-neutral-400/35 bg-neutral-500/12 px-2.5 py-1.5 text-[11px] text-neutral-100"
          >
            {error}
          </p>
        ) : null}

        {automationOpen ? (
          <AutomationPanel onBack={() => setAutomationOpen(false)} />
        ) : permissionsOpen ? (
          <PermissionsPanel onBack={() => setPermissionsOpen(false)} />
        ) : memoryOpen ? (
          <MemoryPanel onBack={() => setMemoryOpen(false)} />
        ) : <>
        <Group icon={Gauge} title="Behavior & Companion" category="general">
          <div className="pb-1.5">
            <ModeSwitcher
              current={settings.companion.mode}
              onRequestMode={onRequestMode}
              variant="inline"
            />
            <p className="mt-1.5 px-1 text-[10.5px] leading-snug text-[var(--color-ink-dim)]">
              {modeDescriptor.summary}
            </p>
          </div>

          <Row label="Pinned top bar">
            <span className="text-[10.5px] font-medium text-neutral-200">Always on</span>
          </Row>
          <Row label="Move to display">
            <select
              aria-label="Move Pixel to display"
              value={settings.companion.monitorId ?? ''}
              onChange={(event) => {
                if (event.target.value) onPatch({ companion: { monitorId: event.target.value } });
              }}
              disabled={displays.length === 0}
              className="no-drag max-w-[230px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)] disabled:opacity-60"
            >
              {displays.length === 0 ? <option value="">Displays unavailable</option> : null}
              {displays.map((display, index) => (
                <option key={display.id} value={display.id}>
                  {display.label}{index === 0 ? '' : ` · ${display.width}×${display.height}`}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Top offset">
            <label className="flex items-center gap-2 text-[10px] text-[var(--color-ink-dim)]">
              <input
                aria-label="Top offset"
                type="range"
                min={10}
                max={14}
                step={1}
                value={settings.companion.topOffset}
                onChange={(event) => onPatch({ companion: { topOffset: Number(event.target.value) } })}
                className="no-drag w-24 settings-accent-control"
              />
              {settings.companion.topOffset}px
            </label>
          </Row>
          <Toggle
            label="Show cursor companion"
            hint="A separate pointer-shaped, click-through companion follows your pointer over ordinary apps and the Workspace. It pauses while Settings is open or Windows is locked."
            checked={settings.companion.cursorCompanionEnabled}
            onChange={(value) => {
              onPatch({ companion: { cursorCompanionEnabled: value } });
              if (!value) setCursorPreview(false);
            }}
          />
          {settings.companion.cursorCompanionEnabled ? (
            <>
              <div className="flex min-h-9 items-center justify-between gap-3 px-1">
                <div className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-[var(--color-ink-soft)]">Cursor Buddy preview</span>
                  <span className="block text-[10px] leading-snug text-[var(--color-ink-dim)]">Try the separate pointer companion here.</span>
                </div>
                <button type="button" aria-expanded={cursorPreview} onClick={() => setCursorPreview((value) => !value)} className="min-h-8 rounded-lg border border-[var(--color-border)] px-2.5 text-[10.5px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)]">{cursorPreview ? 'Hide preview' : 'Preview companion'}</button>
              </div>
              {cursorPreview ? <div className="settings-cursor-preview" role="img" aria-label="Cursor Buddy preview; the desktop follower window is not active while Settings is open"><CursorBuddy reducedMotion={settings.companion.reducedMotion} /><span className="text-[10px] text-[var(--color-ink-dim)]">Settings preview only. The desktop window appears after Settings closes.</span></div> : null}
              <Row label="Follow speed">
                <label className="flex items-center gap-2 text-[10px] text-[var(--color-ink-dim)]">
                  <input
                    aria-label="Cursor companion follow speed"
                    type="range"
                    min={0.25}
                    max={3}
                    step={0.25}
                    value={settings.companion.followSpeed}
                    onChange={(event) => onPatch({ companion: { followSpeed: Number(event.target.value) } })}
                    className="no-drag w-24 settings-accent-control"
                  />
                  {settings.companion.followSpeed.toFixed(2)}×
                </label>
              </Row>
              <Row label="Cursor offset">
                <div className="flex items-center gap-1 text-[10px] text-[var(--color-ink-dim)]">
                  <label className="flex items-center gap-1">
                    X
                    <input
                      aria-label="Cursor companion horizontal offset"
                      type="number"
                      min={-12}
                      max={12}
                      value={settings.companion.cursorOffset.x}
                      onChange={(event) => onPatch({ companion: { cursorOffset: { ...settings.companion.cursorOffset, x: Number(event.target.value) } } })}
                      className="no-drag w-12 rounded-md border border-white/10 bg-black/20 px-1 py-0.5"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Y
                    <input
                      aria-label="Cursor companion vertical offset"
                      type="number"
                      min={-12}
                      max={12}
                      value={settings.companion.cursorOffset.y}
                      onChange={(event) => onPatch({ companion: { cursorOffset: { ...settings.companion.cursorOffset, x: settings.companion.cursorOffset.x, y: Number(event.target.value) } } })}
                      className="no-drag w-12 rounded-md border border-white/10 bg-black/20 px-1 py-0.5"
                    />
                  </label>
                </div>
              </Row>
            </>
          ) : null}

          <div className="settings-pix-preview">
            <PixMascot size={48} state={pixPreviewState} reducedMotion={settings.companion.reducedMotion} decorative />
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-[var(--color-ink-soft)]">Pix expression preview</span>
              <span className="block text-[10px] leading-snug text-[var(--color-ink-dim)]">Local preview only; real assistant state controls Pix elsewhere.</span>
            </div>
            <select aria-label="Preview Pix expression" value={pixPreviewState} onChange={(event) => setPixPreviewState(event.target.value as AssistantState)} className="no-drag max-w-[145px] rounded-lg border border-[var(--color-border)] bg-[var(--color-app-bg)] px-2 py-1.5 text-[10.5px] text-[var(--color-ink-soft)]">
              <option value="idle">Idle</option><option value="listening">Listening</option><option value="thinking">Thinking</option><option value="executing">Working</option><option value="speaking">Speaking</option><option value="success">Success</option><option value="waiting_for_approval">Needs approval</option><option value="error">Error</option><option value="stopped">Stopped</option>
            </select>
          </div>

          <Toggle
            label="Collapse after answering"
            hint="Shrink back to the orb once a reply finishes."
            checked={settings.companion.autoCollapse}
            onChange={(value) => onPatch({ companion: { autoCollapse: value } })}
          />
          <Toggle
            label="Speak replies out loud"
            hint="Uses local text-to-speech."
            checked={settings.companion.speakReplies}
            onChange={(value) => onPatch({ companion: { speakReplies: value } })}
          />
          <Toggle
            label="Reduce motion"
            hint="Stops all orb animation. Your OS setting is always respected too."
            checked={settings.companion.reducedMotion}
            onChange={(value) => onPatch({ companion: { reducedMotion: value } })}
          />
        </Group>

        <Group icon={Keyboard} title="Keyboard shortcuts" category="general">
          <Row label="Summon or hide Pixel">
            <Accelerator value={settings.globalAccelerator} />
          </Row>
          <Row label="Emergency stop">
            <Accelerator value={settings.emergencyStopAccelerator} />
          </Row>
          <Row label="Open Workspace">
            <ShortcutEditor value={settings.workspaceAccelerator} onCommit={(value) => onPatch({ workspaceAccelerator: value })} />
          </Row>
          <Row label="Push to talk">
            <ShortcutEditor
              value={settings.voice.pushToTalkAccelerator}
              ariaLabel="Push-to-talk shortcut"
              onCommit={(value) => onPatch({ voice: { pushToTalkAccelerator: value } })}
            />
          </Row>
          {pushToTalkStatus && !pushToTalkStatus.ok ? (
            <p role="status" className="px-1 pb-1 text-[10px] leading-snug text-neutral-200">
              Push-to-talk unavailable: {pushToTalkStatus.reason ?? 'Windows could not register this shortcut.'}
            </p>
          ) : pushToTalkStatus?.ok ? (
            <p role="status" className="px-1 pb-1 text-[10px] text-neutral-200">Push-to-talk shortcut is registered.</p>
          ) : null}
          <p className="mt-1 px-1 text-[10px] leading-snug text-[var(--color-ink-dim)]">
            Workspace uses the configured accelerator above. Global shortcuts must be unique;
            the emergency stop always works, even while Pixel is mid-task.
          </p>
        </Group>

        <Group icon={Globe2} title="Browser search" category="tools">
          <Row label="Default search engine">
            <select
              aria-label="Default search engine"
              value={settings.browserSearchProvider}
              onChange={(event) => onPatch({ browserSearchProvider: event.target.value as AppSettings['browserSearchProvider'] })}
              className="no-drag max-w-[190px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)]"
            >
              <option value="google">Google</option>
              <option value="bing">Bing</option>
              <option value="duckduckgo">DuckDuckGo</option>
            </select>
          </Row>
          <p className="px-1 text-[10px] leading-snug text-[var(--color-ink-dim)]">Explicit search requests open in your default browser.</p>
        </Group>

        <Group icon={Mic} title="Voice" category="voice">
          <Toggle
            label="Voice output"
            hint="Speak answers aloud."
            checked={settings.voice.ttsEnabled}
            onChange={(value) => onPatch({ voice: { ttsEnabled: value } })}
          />
          <Row label="Microphone">
            <select
              aria-label="Microphone input device"
              value={settings.voice.inputDeviceId ?? ''}
              onChange={(event) => onPatch({ voice: { inputDeviceId: event.target.value || null } })}
              className="no-drag max-w-[230px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)]"
            >
              <option value="">System default</option>
              {microphones.map((device) => <option key={device.deviceId || device.label} value={device.deviceId}>{device.label}</option>)}
            </select>
          </Row>
          <Row label="Recognition quality">
            <select
              aria-label="Recognition quality and local speech model"
              value={settings.voice.sttModel}
              onChange={(event) => onPatch({ voice: { sttModel: event.target.value as AppSettings['voice']['sttModel'] } })}
              className="no-drag max-w-[180px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)]"
            >
              {voiceModels.filter((model) => model.kind === 'stt').map((model) => (
                <option key={model.id} value={model.id}>{model.id === 'tiny.en' ? 'Fast · ' : model.id === 'small.en' ? 'High accuracy · ' : 'Balanced · '}{model.label}{model.downloaded ? ' · downloaded' : ' · not downloaded'}</option>
              ))}
            </select>
          </Row>
          {selectedSttModel ? <div className="mx-1 flex items-center gap-2 pb-1">
            {selectedSttModel.downloaded ? <>
              <span role="status" className="flex-1 text-[10px] text-[var(--color-ink-dim)]">Downloaded; actual load and inference are confirmed by Voice Test.</span>
              <button type="button" disabled={voiceAction !== null} onClick={() => void removeVoiceModel(selectedSttModel)} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">Remove</button>
            </> : <>
              <span className="flex-1 text-[10px] text-[var(--color-ink-dim)]">Optional download · about {Math.round(selectedSttModel.sizeBytes / 1_000_000)} MB</span>
              <button type="button" disabled={voiceAction !== null} onClick={() => void downloadVoiceModel(selectedSttModel.id)} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">Download model</button>
            </>}
          </div> : null}
          {voiceModelProgress ? <div className="mx-1 flex items-center gap-2 pb-1" role="status">
            <span className="text-[10px] text-[var(--color-ink-dim)]">Downloading {voiceModelProgress.percent}%</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-neutral-300" style={{ width: `${voiceModelProgress.percent}%` }} /></div>
            <button type="button" onClick={() => void cancelVoiceDownload()} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)] hover:bg-white/8">Cancel</button>
          </div> : null}
          <Row label="Speech engine">
            <select aria-label="Speech output engine" value={settings.voice.ttsEngine} onChange={(event) => onPatch({ voice: { ttsEngine: event.target.value as AppSettings['voice']['ttsEngine'], ttsVoice: null } })} className="no-drag max-w-[205px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)]">
              <option value="system">Windows system voice</option>
              <option value="kokoro">Kokoro neural voice</option>
            </select>
          </Row>
          {settings.voice.ttsEngine === 'kokoro' ? <>
            <Row label="Neural voice">
              <select aria-label="Kokoro voice" value={settings.voice.ttsVoice ?? 'af_heart'} onChange={(event) => onPatch({ voice: { ttsVoice: event.target.value } })} className="no-drag max-w-[205px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)]">
                <option value="af_heart">Heart · US English</option>
                <option value="af_sarah">Sarah · US English</option>
                <option value="am_adam">Adam · US English</option>
                <option value="am_michael">Michael · US English</option>
              </select>
            </Row>
            <div className="mx-1 flex items-center gap-2 pb-1">
              {kokoroModel?.downloaded ? <>
                <span role="status" className="flex-1 text-[10px] text-[var(--color-ink-dim)]">Kokoro assets downloaded; model load is verified by Test voice.</span>
                <button type="button" disabled={voiceAction !== null} onClick={() => void removeVoiceModel(kokoroModel)} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">Remove</button>
              </> : <>
                <span className="flex-1 text-[10px] text-[var(--color-ink-dim)]">Optional download · about 143 MB.</span>
                <button type="button" disabled={voiceAction !== null} onClick={() => void downloadVoiceModel('kokoro-v1.0-int8')} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">Download Kokoro</button>
              </>}
            </div>
          </> : <Row label="System voice">
            <select aria-label="Windows system voice" value={settings.voice.ttsVoice ?? ''} onChange={(event) => onPatch({ voice: { ttsVoice: event.target.value || null } })} className="no-drag max-w-[205px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)]">
              <option value="">System default</option>
              {voiceSystemVoices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
            </select>
          </Row>}
          <Row label="Speech rate">
            <div className="flex items-center gap-2">
              <input aria-label="Speech rate" type="range" min="0.7" max="1.3" step="0.1" value={settings.voice.ttsRate} onChange={(event) => onPatch({ voice: { ttsRate: Number(event.target.value) } })} className="no-drag w-24 settings-accent-control" />
              <span className="w-8 text-right text-[10px] text-[var(--color-ink-dim)]">{settings.voice.ttsRate.toFixed(1)}×</span>
            </div>
          </Row>
          <div className="mx-1 flex items-center gap-2 pb-1">
            <button
              type="button"
              onClick={toggleMicrophoneTest}
              aria-pressed={microphoneTest}
              className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] font-medium text-[var(--color-ink-soft)] hover:bg-white/8"
            >
              {microphoneTest ? 'Stop microphone test' : 'Test microphone'}
            </button>
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-white/10" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(microphoneLevel * 100)}>
              <div className="h-full rounded-full bg-neutral-300 transition-[width] duration-100" style={{ width: `${Math.round(microphoneLevel * 100)}%` }} />
            </div>
          </div>
          {microphoneError ? <p role={microphoneError.includes('stopped') ? 'status' : 'alert'} className="px-1 text-[10px] text-[var(--color-ink-dim)]">{microphoneError}</p> : null}
          <div className="mx-1 flex items-center gap-2 pb-1">
            <button type="button" disabled={voiceTestBusy} onClick={() => void toggleVoiceTest()} aria-pressed={voiceTestRecording} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] font-medium text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">
              {voiceTestBusy ? 'Transcribing locally…' : voiceTestRecording ? 'Stop & transcribe test' : 'Test recognition'}
            </button>
            <span className="text-[10px] text-[var(--color-ink-dim)]">30-second limit · never sent to chat</span>
          </div>
          <label className="mx-1 flex items-center gap-2 pb-1 text-[10px] text-[var(--color-ink-dim)]">
            <input type="checkbox" checked={showCaptureDiagnostics} onChange={(event) => setShowCaptureDiagnostics(event.target.checked)} className="no-drag settings-accent-control" />
            Show capture diagnostics for the next voice test
          </label>
          <label className="mx-1 flex items-center gap-2 pb-1 text-[10px] text-[var(--color-ink-dim)]">
            <input type="checkbox" checked={allowDiagnosticAudioSave} onChange={(event) => { setAllowDiagnosticAudioSave(event.target.checked); if (!event.target.checked) setDiagnosticAudio(null); }} className="no-drag settings-accent-control" />
            Keep the next 30-second test recording in memory so I can save it
          </label>
          {voiceTestResult ? <div className="mx-1 rounded-lg border border-white/10 bg-black/20 p-2 text-[10px]" aria-live="polite">
            {voiceTestResult.text ? <>
              <p className="mb-1 text-[var(--color-ink-dim)]">Transcription result (not submitted)</p>
              <p className="whitespace-pre-wrap break-words text-[var(--color-ink-soft)]">{voiceTestResult.text}</p>
              <p className="mt-1 text-[var(--color-ink-dim)]">
                Backend: {voiceTestResult.backend ?? 'not reported'}{voiceTestResult.model ? ` · model: ${voiceTestResult.model}` : ''}{typeof voiceTestResult.processingMs === 'number' ? ` · ${voiceTestResult.processingMs} ms` : ''}
              </p>
            </> : null}
            {voiceTestResult.error ? <p className="text-[var(--color-ink-soft)]">{voiceTestResult.error}</p> : null}
            {voiceTestResult.diagnostics ? <p className="mt-1 break-words text-[var(--color-ink-dim)]">
              Capture: {voiceTestResult.diagnostics.captureDurationMs} ms · {voiceTestResult.diagnostics.sampleCount} samples · input {voiceTestResult.diagnostics.inputSampleRate ?? 'unknown'} Hz · stream {voiceTestResult.diagnostics.captureSampleRate} Hz → WAV {voiceTestResult.diagnostics.outputSampleRate} Hz · RMS {voiceTestResult.diagnostics.rmsDbfs.toFixed(1)} dBFS · peak {voiceTestResult.diagnostics.peakDbfs.toFixed(1)} dBFS · clipping {voiceTestResult.diagnostics.clippingPercent.toFixed(2)}% · quiet {voiceTestResult.diagnostics.lowEnergyPercent.toFixed(1)}% · {microphones.find((device) => device.deviceId === voiceTestResult.diagnostics?.inputDeviceId)?.label ?? (voiceTestResult.diagnostics.inputDeviceId ? 'Selected microphone' : 'System microphone')}
              {' '}({new Date(voiceTestResult.diagnostics.startedAtUnixMs).toLocaleTimeString()}–{new Date(voiceTestResult.diagnostics.stoppedAtUnixMs).toLocaleTimeString()})
            </p> : null}
          </div> : null}
          {diagnosticAudio ? <div className="mx-1 flex items-center gap-2 pb-1">
            <button type="button" onClick={() => void (async () => {
              try {
                const result = await window.cypsShell?.voiceSaveDiagnosticWav?.(diagnosticAudio);
                if (!result?.ok) setVoiceError(result?.error ?? 'Could not save the diagnostic recording.');
                else if (!result.cancelled) setVoiceNotice('Diagnostic WAV saved to the selected location.');
              } catch { setVoiceError('Could not save the diagnostic recording.'); }
            })()} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)] hover:bg-white/8">Save diagnostic WAV…</button>
            <button type="button" onClick={() => setDiagnosticAudio(null)} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-dim)] hover:bg-white/8">Discard recording</button>
            <span className="text-[10px] text-[var(--color-ink-dim)]">Held in memory only</span>
          </div> : null}
          <div className="mx-1 flex items-center gap-2 pb-1">
            <button type="button" disabled={voiceAction !== null} onClick={() => void testSelectedVoice()} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] font-medium text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">{voiceAction === 'test-voice' ? 'Playing test…' : 'Test voice'}</button>
            <button type="button" onClick={() => void window.cypsShell?.voiceCancel?.()} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)] hover:bg-white/8">Stop voice</button>
          </div>
          {voiceError ? <p role="alert" className="px-1 text-[10px] text-neutral-200">{voiceError}</p> : null}
          {voiceNotice ? <p role="status" className="px-1 text-[10px] text-neutral-200">{voiceNotice}</p> : null}
          <p className="px-1 text-[10px] leading-snug text-[var(--color-ink-dim)]">
            {speechCapability === null ? 'Checking local speech recognition…' : speechCapability.speechToText
              ? `Selected model: ${selectedSttModel?.label ?? settings.voice.sttModel}${selectedSttModel?.downloaded ? ' · downloaded' : ' · not downloaded'}. Runtime availability is a probe; successful loading is confirmed by Voice Test. Pixel reports its actual backend and model after the test. Windows Speech is used when no selected local model is available.`
              : speechCapability.reason ?? 'Local speech recognition is unavailable.'}
          </p>
        </Group>

        <Group icon={Cpu} title="Provider & API key" category="ai-models">
          <Row label="Provider">
            <span className="text-[11px] font-medium text-[var(--color-ink)]">{settings.provider.provider}</span>
          </Row>
          <Row label="Primary model">
            <select
              aria-label="Primary model"
              value={settings.provider.primaryModel}
              onChange={(event) => onPatch({ provider: { primaryModel: event.target.value } })}
              className="no-drag max-w-[205px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-ink-soft)]"
            >
              <option value="deepseek-flash">DeepSeek Flash (default)</option>
              <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
              <option value="deepseek-chat">DeepSeek Chat</option>
              <option value="deepseek-reasoner">DeepSeek Reasoner</option>
            </select>
          </Row>
          <Row label="Reasoning model">
            <span className="text-[11px] text-[var(--color-ink-dim)]">{settings.provider.reasoningModel}</span>
          </Row>
          <ApiKeyManager
            hasApiKey={hasApiKey}
            onSave={onSaveApiKey}
            onRemove={onRemoveApiKey}
            onTestConnection={onTestConnection}
            resetToken={keyEditorReset}
          />
        </Group>

        <Group icon={ShieldCheck} title="Mode & Permissions" category="agent-permissions">
          <div className="pb-1.5">
            <ModeSwitcher
              current={settings.companion.mode}
              onRequestMode={onRequestMode}
              variant="inline"
            />
            <p className="mt-1.5 px-1 text-[10.5px] leading-snug text-[var(--color-ink-dim)]">
              {modeDescriptor.summary}
            </p>
          </div>
          <Row label="Screenshots need approval">
            <span className="text-[11px] font-medium text-[var(--color-ink)]">Always on</span>
          </Row>
          <Row label="Emergency stop shortcut">
            <Accelerator value={settings.emergencyStopAccelerator} />
          </Row>
          {workspaceLayout ? (
            <div className="workspace-settings-embedded mt-3">
              <PermissionsPanel onBack={() => setSettingsPage('general')} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPermissionsOpen(true)}
              className="no-drag mt-1 flex w-full items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-1.5 text-left text-[10.5px] font-medium text-[var(--color-ink-soft)] hover:bg-white/8"
            >
              <ShieldCheck size={12} aria-hidden="true" />
              Manage Always Allow permissions
            </button>
          )}
        </Group>

        <Group icon={Brain} title="Privacy & Memory" category="memory">
          <Toggle
            label="Keep conversation history"
            hint="Stored locally on this machine only."
            checked={settings.privacy.persistHistory}
            onChange={(value) => onPatch({ privacy: { persistHistory: value } })}
          />
          <Toggle
            label="Automatic Memory"
            hint="Save durable user preferences, explicit corrections, and verified project facts. Secrets, one-off questions, and copied webpage instructions are excluded."
            checked={settings.privacy.automaticMemory}
            onChange={(value) => onPatch({ privacy: { automaticMemory: value } })}
          />
          {workspaceLayout ? (
            <div className="workspace-settings-embedded mt-3">
              <MemoryPanel onBack={() => setSettingsPage('general')} returnLabel="Back" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMemoryOpen(true)}
              className="no-drag mt-1 flex w-full items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-1.5 text-left text-[10.5px] font-medium text-[var(--color-ink-soft)] hover:bg-white/8"
            >
              <Brain size={12} aria-hidden="true" />
              Manage project memory
            </button>
          )}
        </Group>

        {workspaceLayout ? (
          <>
            <div className="workspace-settings-group mb-4" data-settings-category="tools">
              <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--color-ink)]">
                <Wrench size={14} aria-hidden="true" />
                Registered Tools ({tools.length})
              </h3>
              <SettingsToolsCatalog tools={tools} />
            </div>

            <div className="workspace-settings-group mb-4 workspace-settings-embedded" data-settings-category="plugins">
              {onPluginChange ? (
                <WorkspacePluginManager plugins={plugins} onChange={onPluginChange} />
              ) : (
                <p className="text-[12px] text-[var(--color-ink-dim)]">Plugin controls are available in Workspace.</p>
              )}
            </div>

            <div className="workspace-settings-group mb-4 workspace-settings-embedded" data-settings-category="skills">
              <AutomationPanel onBack={() => setSettingsPage('general')} returnLabel="Back" />
            </div>

            <Group icon={Palette} title="Theme & Motion" category="appearance">
              <Row label="Theme">
                <select
                  aria-label="Application theme"
                  value={settings.theme}
                  onChange={(event) => onPatch({ theme: event.target.value as AppSettings['theme'] })}
                  className="no-drag max-w-[190px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-ink-soft)]"
                >
                  <option value="system">System default</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </Row>
              <Toggle
                label="Reduce motion"
                hint="Disables companion animations and transitions ambient sharks to a calm static composition."
                checked={settings.companion.reducedMotion}
                onChange={(value) => onPatch({ companion: { reducedMotion: value } })}
              />
            </Group>

            <Group icon={LayoutDashboard} title="Workspace & Layout" category="workspace">
              <Row label="Default interaction mode">
                <span className="text-[11px] text-[var(--color-ink-soft)]">{getModeDescriptor(settings.companion.mode).label}</span>
              </Row>
              <Toggle
                label="Collapse companion bar after answering"
                hint="Return the floating top bar to compact state once a reply finishes."
                checked={settings.companion.autoCollapse}
                onChange={(value) => onPatch({ companion: { autoCollapse: value } })}
              />
              <Row label="Ambient chat background">
                <span className="text-[11px] text-[var(--color-ink-dim)]">ASCII sharks ({settings.companion.reducedMotion ? 'static · reduced motion' : 'active'})</span>
              </Row>
            </Group>

            <Group icon={Terminal} title="Diagnostics & Runtime" category="advanced">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                <p>provider: {settings.provider.provider}</p>
                <p>primary: {settings.provider.primaryModel}</p>
                <p>reasoning: {settings.provider.reasoningModel}</p>
                <p>temperature: {String(settings.provider.temperature)}</p>
                <p>maxTokens: {String(settings.provider.maxTokens)}</p>
                <p>timeout: {String(settings.provider.requestTimeoutMs)}ms</p>
                <p>theme: {settings.theme}</p>
                <p>history: {settings.privacy.historyRetentionDays === 0 ? 'forever' : `${String(settings.privacy.historyRetentionDays)}d`}</p>
              </div>
            </Group>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setAutomationOpen(true)}
              data-settings-category="tools"
              className="no-drag mt-1 flex w-full items-center gap-1.5 rounded-xl border border-neutral-300/20 bg-neutral-300/8 px-2.5 py-2 text-left text-[10.5px] font-medium text-neutral-100 hover:bg-neutral-300/14"
            >
              <ListChecks size={12} aria-hidden="true" />
              Skills and routines
            </button>

            <button
              type="button"
              onClick={() => setAdvanced((value) => !value)}
              data-settings-category="general"
              aria-expanded={advanced}
              className="no-drag mt-1 w-full rounded-xl px-2 py-1.5 text-left text-[10.5px] font-medium text-[var(--color-ink-dim)] hover:bg-white/6 hover:text-[var(--color-ink-soft)]"
            >
              {advanced ? 'Hide' : 'Show'} advanced
            </button>

            {advanced ? (
              <div data-settings-category="general" className="mt-1 rounded-xl border border-[var(--color-border)] bg-black/15 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--color-ink-dim)]">
                <p>provider: {settings.provider.provider}</p>
                <p>primary: {settings.provider.primaryModel}</p>
                <p>reasoning: {settings.provider.reasoningModel}</p>
                <p>temperature: {String(settings.provider.temperature)}</p>
                <p>maxTokens: {String(settings.provider.maxTokens)}</p>
                <p>timeout: {String(settings.provider.requestTimeoutMs)}ms</p>
                <p>theme: {settings.theme}</p>
                <p>history: {settings.privacy.historyRetentionDays === 0 ? 'forever' : `${String(settings.privacy.historyRetentionDays)}d`}</p>
              </div>
            ) : null}
          </>
        )}
        </>}
        </div>
      </div>
    </section>
  );
}

function ApiKeyManager({
  hasApiKey,
  onSave,
  onRemove,
  onTestConnection,
  resetToken,
}: {
  hasApiKey: boolean | null;
  onSave: SettingsPanelProps['onSaveApiKey'];
  onRemove: SettingsPanelProps['onRemoveApiKey'];
  onTestConnection: SettingsPanelProps['onTestConnection'];
  resetToken: number;
}) {
  const [draft, setDraft] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setDraft('');
    setEditorOpen(false);
    setShowKey(false);
    setFeedback(null);
    setConfirmRemoval(false);
  }, [resetToken]);

  const closeEditor = () => {
    setDraft('');
    setShowKey(false);
    setEditorOpen(false);
    setFeedback(null);
  };

  const saveKey = async () => {
    if (!draft.trim() || savingKey || removingKey) return;
    setSavingKey(true);
    setFeedback(null);
    try {
      const result = await onSave(draft);
      if (result.ok) {
        setFeedback({ kind: 'success', message: 'API key saved securely.' });
        setEditorOpen(false);
        setShowKey(false);
      } else {
        setFeedback({ kind: 'error', message: result.error ?? 'Pixel could not save the API key securely.' });
      }
    } catch {
      setFeedback({ kind: 'error', message: 'Pixel could not save the API key securely.' });
    } finally {
      setDraft('');
      setSavingKey(false);
    }
  };

  const removeKey = async () => {
    if (removingKey || savingKey) return;
    setRemovingKey(true);
    setFeedback(null);
    try {
      const result = await onRemove();
      if (result.ok) {
        setDraft('');
        setEditorOpen(false);
        setShowKey(false);
        setConfirmRemoval(false);
        setFeedback({ kind: 'success', message: 'API key removed.' });
      } else {
        setFeedback({ kind: 'error', message: result.error ?? 'Pixel could not remove the saved API key.' });
      }
    } catch {
      setFeedback({ kind: 'error', message: 'Pixel could not remove the saved API key.' });
    } finally {
      setRemovingKey(false);
    }
  };

  const testConnection = async () => {
    if (testing || savingKey || removingKey) return;
    setTesting(true);
    setFeedback(null);
    try {
      const result = await onTestConnection();
      setFeedback(
        result.ok
          ? { kind: 'success', message: 'Connected successfully.' }
          : { kind: 'error', message: connectionFailureMessage(result.error?.code) },
      );
    } catch {
      setFeedback({ kind: 'error', message: 'Provider unavailable.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="px-1.5 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-[var(--color-ink-soft)]">API key</span>
          <span
            className={`text-[11px] font-medium ${
              hasApiKey === null
                ? 'text-[var(--color-ink-dim)]'
                : hasApiKey
                  ? 'text-neutral-200'
                  : 'text-neutral-200'
            }`}
            role="status"
            aria-live="polite"
          >
            {hasApiKey === null ? 'Unknown' : hasApiKey ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasApiKey ? (
            <>
              <SmallButton onClick={() => { setFeedback(null); setEditorOpen(true); }} disabled={savingKey || removingKey}>
                Change Key
              </SmallButton>
              <SmallButton onClick={() => void testConnection()} disabled={testing || savingKey || removingKey}>
                {testing ? 'Testing…' : 'Test Connection'}
              </SmallButton>
              <SmallButton
                onClick={() => { setFeedback(null); setConfirmRemoval(true); }}
                disabled={testing || savingKey || removingKey}
                tone="danger"
              >
                Remove Key
              </SmallButton>
            </>
          ) : !editorOpen ? (
            <SmallButton onClick={() => { setFeedback(null); setEditorOpen(true); }}>
              Add Key
            </SmallButton>
          ) : null}
        </div>
      </div>

      {editorOpen ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/15 p-2">
          <label htmlFor="deepseek-api-key" className="mb-1 block text-[10.5px] text-[var(--color-ink-dim)]">
            DeepSeek API key
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="deepseek-api-key"
              aria-label="DeepSeek API key"
              type={showKey ? 'text' : 'password'}
              autoComplete="new-password"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Enter API key"
              disabled={savingKey || removingKey}
              className="no-drag min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-dim)] focus:border-neutral-300/50"
            />
            <button
              type="button"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              aria-pressed={showKey}
              onClick={() => setShowKey((value) => !value)}
              className="no-drag rounded-lg border border-white/10 p-1.5 text-[var(--color-ink-soft)] hover:bg-white/8"
            >
              {showKey ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <SmallButton onClick={() => void saveKey()} disabled={!draft.trim() || savingKey || removingKey} primary>
              {savingKey ? 'Saving…' : 'Save Key'}
            </SmallButton>
            <SmallButton onClick={closeEditor} disabled={savingKey || removingKey}>Cancel</SmallButton>
            {savingKey ? <span role="status" className="text-[10px] text-[var(--color-ink-dim)]">Saving securely…</span> : null}
          </div>
        </div>
      ) : null}

      {confirmRemoval ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="remove-key-title" className="mt-2 rounded-xl border border-neutral-300/25 bg-neutral-500/8 p-2">
          <p id="remove-key-title" className="text-[11px] font-medium text-[var(--color-ink)]">Remove the saved DeepSeek API key?</p>
          <p className="mt-0.5 text-[10px] text-[var(--color-ink-dim)]">Pixel will no longer be able to connect to DeepSeek until you add a key again.</p>
          <div className="mt-1.5 flex gap-1.5">
            <SmallButton onClick={() => void removeKey()} disabled={removingKey} primary tone="danger">
              {removingKey ? 'Removing…' : 'Confirm Remove'}
            </SmallButton>
            <SmallButton onClick={() => setConfirmRemoval(false)} disabled={removingKey}>Cancel</SmallButton>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <p
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`mt-1.5 text-[10.5px] ${feedback.kind === 'success' ? 'text-neutral-200' : 'text-neutral-200'}`}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  disabled = false,
  primary = false,
  tone = 'normal',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  tone?: 'normal' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`no-drag rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? tone === 'danger'
            ? 'border-neutral-300/30 bg-neutral-500/20 text-neutral-100 hover:bg-neutral-500/30'
            : 'border-neutral-300/30 bg-neutral-400/15 text-neutral-100 hover:bg-neutral-400/25'
          : tone === 'danger'
            ? 'border-neutral-300/20 text-neutral-200 hover:bg-neutral-500/12'
            : 'border-white/10 text-[var(--color-ink-soft)] hover:bg-white/8'
      }`}
    >
      {children}
    </button>
  );
}

function connectionFailureMessage(code?: CypsErrorCode): string {
  switch (code) {
    case 'NO_API_KEY':
      return 'Not configured.';
    case 'UNAUTHORIZED':
      return 'Invalid key.';
    case 'INSUFFICIENT_BALANCE':
      return 'Insufficient balance.';
    case 'RATE_LIMITED':
      return 'Rate limited.';
    case 'NETWORK':
    case 'TIMEOUT':
      return 'Network error.';
    case 'SERVER':
    case 'UNKNOWN':
      return 'Provider unavailable.';
    case 'ABORTED':
      return 'Connection test was canceled.';
    case 'BAD_REQUEST':
    case 'MODEL_CAPABILITY':
      return 'Provider rejected the connection test.';
    default:
      return 'Provider unavailable.';
  }
}

function SettingsToolsCatalog({ tools }: { tools: ToolCatalogEntry[] }): React.JSX.Element {
  const categories: Array<{ id: ToolCatalogEntry['category']; title: string }> = [
    { id: 'screen', title: 'Screen' },
    { id: 'input', title: 'Computer control' },
    { id: 'browser', title: 'Browser' },
    { id: 'files', title: 'Files' },
    { id: 'documents', title: 'Documents' },
    { id: 'productivity', title: 'Notes & tasks' },
    { id: 'board', title: 'Pixel Board' },
    { id: 'system', title: 'System' },
    { id: 'memory', title: 'Memory' },
    { id: 'code', title: 'Code' },
  ];
  if (tools.length === 0) {
    return <p className="text-[12px] text-[var(--color-ink-dim)]">No agent tools are registered in this build.</p>;
  }
  return (
    <div className="space-y-4">
      {categories.map((category) => {
        const members = tools.filter((tool) => tool.category === category.id);
        if (members.length === 0) return null;
        return (
          <section key={category.id} aria-label={`${category.title} tools`}>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">
              {category.title} ({members.length})
            </h4>
            <div className="divide-y divide-[var(--color-border)] border-t border-b border-[var(--color-border)]">
              {members.map((tool) => (
                <div key={tool.name} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[12.5px] font-medium text-[var(--color-ink)]">{tool.name.replaceAll('_', ' ')}</strong>
                    <span className={`risk risk-${tool.risk}`}>{tool.risk}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-dim)]">{tool.description}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10.5px] text-[var(--color-ink-dim)]">
                    <span>{tool.changesState ? 'State-changing' : 'Read-only'}</span>
                    <span>·</span>
                    <span>{tool.requiresApproval ? 'Approval gated' : 'No approval required'}</span>
                    {tool.dependency ? <><span>·</span><span>{tool.dependency} ({tool.availability ?? 'not_checked'})</span></> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Group({
  icon: Icon,
  title,
  category,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  category: SettingsPage;
  children: React.ReactNode;
}) {
  return (
    <div className="workspace-settings-group mb-4" data-settings-category={category}>
      <h3 className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-dim)]">
        <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
        {title}
      </h3>
      <div className="rounded-2xl border border-[var(--color-border)] bg-white/4 p-1.5">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1.5 py-1.5">
      <span className="text-[11.5px] text-[var(--color-ink-soft)]">{label}</span>
      {children}
    </div>
  );
}

function Accelerator({ value }: { value: string }) {
  const pretty = value.replace(/CommandOrControl/gi, 'Ctrl').replace(/\+/g, ' + ');
  return (
    <kbd className="rounded-md border border-[var(--color-border)] bg-white/8 px-1.5 py-0.5 font-sans text-[10px] text-[var(--color-ink-soft)]">
      {pretty}
    </kbd>
  );
}

function ShortcutEditor({ value, onCommit, ariaLabel = 'Open Workspace shortcut' }: { value: string; onCommit: (value: string) => void; ariaLabel?: string }): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={ariaLabel}
      value={draft}
      maxLength={80}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      onBlur={() => { const next = draft.trim(); if (next && next !== value) onCommit(next); else setDraft(value); }}
      placeholder="CommandOrControl+Shift+P"
      className="no-drag w-[180px] rounded-md border border-[var(--color-border)] bg-black/20 px-2 py-1 font-mono text-[10px] text-[var(--color-ink-soft)] outline-none focus:border-neutral-300/60"
    />
  );
}
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="no-drag flex cursor-pointer items-start gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-white/6">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="settings-toggle-input sr-only"
      />
      <span
        aria-hidden="true"
        className={`settings-toggle-track mt-0.5 flex h-[18px] w-[34px] shrink-0 items-center rounded-full border p-[2px] transition-colors duration-[var(--cyps-duration-fast)] ${checked ? 'justify-end' : 'justify-start'}`}
      >
        <span className="h-[11px] w-[11px] rounded-full shadow-sm transition-transform duration-[var(--cyps-duration-fast)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] text-[var(--color-ink-soft)]">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-snug text-[var(--color-ink-dim)]">
          {hint}
        </span>
      </span>
    </label>
  );
}
