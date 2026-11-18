import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, Eye, EyeOff, Gauge, Globe2, Keyboard, ListChecks, Mic, ShieldCheck, X } from 'lucide-react';
import type { AppSettings, ConnectionTestResult, CypsErrorCode, DiagnosticsSnapshot, Mode } from '@shared/types';
import { getModeDescriptor } from '@shared/types';
import { IconButton } from '@/components/IconButton';
import { ModeSwitcher } from '@/components/ModeSwitcher';
import { AutomationPanel } from '@/components/AutomationPanel';
import { MemoryPanel } from '@/components/MemoryPanel';
import { PixelMark } from '@/components/PixelMark';
import { MicrophoneCapture } from '@/lib/audioCapture';

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
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

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
  } = props;
  const [advanced, setAdvanced] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [keyEditorReset, setKeyEditorReset] = useState(0);
  const [pushToTalkStatus, setPushToTalkStatus] = useState<{ accelerator: string; ok: boolean; reason?: string } | null>(null);
  const [speechCapability, setSpeechCapability] = useState<{ speechToText: boolean; reason?: string } | null>(null);
  const [microphones, setMicrophones] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [microphoneTest, setMicrophoneTest] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const microphoneCapture = useRef<MicrophoneCapture | null>(null);
  const microphoneTestTimer = useRef<number | null>(null);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell) return;
    let mounted = true;
    const shortcutStatus = shell.getPushToTalkStatus?.();
    if (shortcutStatus) void shortcutStatus.then((status) => { if (mounted) setPushToTalkStatus(status); }).catch(() => undefined);
    const voiceStatus = shell.voiceCapability?.();
    if (voiceStatus) void voiceStatus.then((status) => { if (mounted) setSpeechCapability(status); }).catch(() => undefined);
    return () => { mounted = false; };
  }, [settings.voice.pushToTalkAccelerator]);

  useEffect(() => () => {
    if (microphoneTestTimer.current !== null) window.clearTimeout(microphoneTestTimer.current);
    microphoneCapture.current?.cancel();
    microphoneCapture.current = null;
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
    return shell.onVoiceCaptureCancel(stopMicrophoneTest);
  }, [stopMicrophoneTest]);

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

  return (
    <section
      aria-label="Pixel settings"
      className={`glass-raised animate-slide-down flex ${workspaceLayout ? 'w-full max-w-[720px]' : 'w-[460px]'} flex-col overflow-hidden rounded-[var(--cyps-radius)]`}
      style={workspaceLayout ? { minHeight: 0, height: '100%' } : { maxHeight: 'min(calc(100vh - 24px), 520px)' }}
    >
      <header className="flex items-center gap-2 border-b border-[var(--color-glass-border)] px-3 py-2">
        <PixelMark size={16} />
        <h2 className="flex-1 text-[12.5px] font-semibold text-[var(--color-ink)]">{workspaceLayout ? 'Pixel Settings' : 'Companion'}</h2>
        {saving ? (
          <span role="status" aria-live="polite" className="text-[10px] text-[var(--color-ink-dim)]">
            Saving…
          </span>
        ) : null}
        <IconButton label="Close settings" onClick={closeSettings}>
          <X size={14} strokeWidth={2.4} aria-hidden="true" />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        {error !== null ? (
          <p
            role="alert"
            className="mb-2.5 rounded-xl border border-rose-400/35 bg-rose-500/12 px-2.5 py-1.5 text-[11px] text-rose-100"
          >
            {error}
          </p>
        ) : null}

        {automationOpen ? (
          <AutomationPanel onBack={() => setAutomationOpen(false)} />
        ) : memoryOpen ? (
          <MemoryPanel onBack={() => setMemoryOpen(false)} />
        ) : <>
        <Group icon={Gauge} title="Behaviour">
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
            <span className="text-[10.5px] font-medium text-emerald-200">Always on</span>
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
                className="no-drag w-24 accent-sky-300"
              />
              {settings.companion.topOffset}px
            </label>
          </Row>
          <Toggle
            label="Show cursor companion"
            hint="A separate click-through orb follows the pointer. It pauses while the bar is open."
            checked={settings.companion.cursorCompanionEnabled}
            onChange={(value) => onPatch({ companion: { cursorCompanionEnabled: value } })}
          />
          {settings.companion.cursorCompanionEnabled ? (
            <>
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
                    className="no-drag w-24 accent-sky-300"
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
                      min={-200}
                      max={200}
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
                      min={-200}
                      max={200}
                      value={settings.companion.cursorOffset.y}
                      onChange={(event) => onPatch({ companion: { cursorOffset: { ...settings.companion.cursorOffset, x: settings.companion.cursorOffset.x, y: Number(event.target.value) } } })}
                      className="no-drag w-12 rounded-md border border-white/10 bg-black/20 px-1 py-0.5"
                    />
                  </label>
                </div>
              </Row>
            </>
          ) : null}

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

        <Group icon={Keyboard} title="Keys">
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
            <p role="status" className="px-1 pb-1 text-[10px] leading-snug text-amber-200">
              Push-to-talk unavailable: {pushToTalkStatus.reason ?? 'Windows could not register this shortcut.'}
            </p>
          ) : pushToTalkStatus?.ok ? (
            <p role="status" className="px-1 pb-1 text-[10px] text-emerald-200">Push-to-talk shortcut is registered.</p>
          ) : null}
          <p className="mt-1 px-1 text-[10px] leading-snug text-[var(--color-ink-dim)]">
            Workspace uses the configured accelerator above. Global shortcuts must be unique;
            the emergency stop always works, even while Pixel is mid-task.
          </p>
        </Group>

        <Group icon={Globe2} title="Browser search">
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

        <Group icon={Mic} title="Voice">
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
          <Row label="Local model">
            <select
              aria-label="Local speech model"
              value={['tiny.en', 'base.en', 'small.en'].includes(settings.voice.sttModel) ? settings.voice.sttModel : 'base.en'}
              onChange={(event) => onPatch({ voice: { sttModel: event.target.value } })}
              className="no-drag max-w-[180px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10.5px] text-[var(--color-ink-soft)]"
            >
              <option value="tiny.en">Tiny English · fastest</option>
              <option value="base.en">Base English · balanced</option>
              <option value="small.en">Small English · more memory</option>
            </select>
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
              <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-100" style={{ width: `${Math.round(microphoneLevel * 100)}%` }} />
            </div>
          </div>
          {microphoneError ? <p role={microphoneError.includes('stopped') ? 'status' : 'alert'} className="px-1 text-[10px] text-[var(--color-ink-dim)]">{microphoneError}</p> : null}
          <p className="px-1 text-[10px] leading-snug text-[var(--color-ink-dim)]">
            {speechCapability === null ? 'Checking local speech recognition…' : speechCapability.speechToText
              ? 'Uses local faster-whisper (CPU int8, only when its model is already cached); otherwise falls back to Windows Speech. Models are never downloaded automatically.'
              : speechCapability.reason ?? 'Local speech recognition is unavailable.'}
          </p>
        </Group>

        <Group icon={ShieldCheck} title="Privacy">
          <Row label="Screenshots need approval">
            <span className="text-[11px] font-medium text-emerald-200">Always on</span>
          </Row>
          <Toggle
            label="Keep conversation history"
            hint="Stored locally on this machine only."
            checked={settings.privacy.persistHistory}
            onChange={(value) => onPatch({ privacy: { persistHistory: value } })}
          />
          <ApiKeyManager
            hasApiKey={hasApiKey}
            onSave={onSaveApiKey}
            onRemove={onRemoveApiKey}
            onTestConnection={onTestConnection}
            resetToken={keyEditorReset}
          />
          <button
            type="button"
            onClick={() => setMemoryOpen(true)}
            className="no-drag mt-1 flex w-full items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-1.5 text-left text-[10.5px] font-medium text-[var(--color-ink-soft)] hover:bg-white/8"
          >
            <Brain size={12} aria-hidden="true" />
            Manage project memory
          </button>
        </Group>

        <button
          type="button"
          onClick={() => setAutomationOpen(true)}
          className="no-drag mt-1 flex w-full items-center gap-1.5 rounded-xl border border-sky-300/20 bg-sky-300/8 px-2.5 py-2 text-left text-[10.5px] font-medium text-sky-100 hover:bg-sky-300/14"
        >
          <ListChecks size={12} aria-hidden="true" />
          Skills and routines
        </button>

        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
          className="no-drag mt-1 w-full rounded-xl px-2 py-1.5 text-left text-[10.5px] font-medium text-[var(--color-ink-dim)] hover:bg-white/6 hover:text-[var(--color-ink-soft)]"
        >
          {advanced ? 'Hide' : 'Show'} advanced
        </button>

        {advanced ? (
          <div className="mt-1 rounded-xl border border-[var(--color-glass-border)] bg-black/15 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--color-ink-dim)]">
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
        </>}
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
                  ? 'text-emerald-200'
                  : 'text-amber-200'
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
              className="no-drag min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-dim)] focus:border-sky-300/50"
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
        <div role="alertdialog" aria-modal="true" aria-labelledby="remove-key-title" className="mt-2 rounded-xl border border-rose-300/25 bg-rose-500/8 p-2">
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
          className={`mt-1.5 text-[10.5px] ${feedback.kind === 'success' ? 'text-emerald-200' : 'text-rose-200'}`}
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
            ? 'border-rose-300/30 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
            : 'border-sky-300/30 bg-sky-400/15 text-sky-100 hover:bg-sky-400/25'
          : tone === 'danger'
            ? 'border-rose-300/20 text-rose-200 hover:bg-rose-500/12'
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

function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5">
      <h3 className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-dim)]">
        <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
        {title}
      </h3>
      <div className="rounded-2xl border border-[var(--color-glass-border)] bg-white/4 p-1.5">
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
    <kbd className="rounded-md border border-[var(--color-glass-border)] bg-white/8 px-1.5 py-0.5 font-sans text-[10px] text-[var(--color-ink-soft)]">
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
      className="no-drag w-[180px] rounded-md border border-[var(--color-glass-border)] bg-black/20 px-2 py-1 font-mono text-[10px] text-[var(--color-ink-soft)] outline-none focus:border-sky-300/60"
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
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full border p-px transition-colors duration-[var(--cyps-duration-fast)] ${
          checked
            ? 'justify-end border-sky-400/50 bg-sky-500/40'
            : 'justify-start border-[var(--color-glass-border)] bg-white/8'
        }`}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-white shadow-sm" />
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
