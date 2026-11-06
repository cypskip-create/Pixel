import { useEffect, useState } from 'react';
import { Gauge, Keyboard, Mic, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { AppSettings, Mode } from '@shared/types';
import { getModeDescriptor } from '@shared/types';
import { IconButton } from '@/components/IconButton';
import { ModeSwitcher } from '@/components/ModeSwitcher';

interface SettingsPanelProps {
  settings: AppSettings;
  /** Persist a partial patch. Never throws: failures surface via error. */
  onPatch: (patch: DeepPartial<AppSettings>) => void;
  onRequestMode: (mode: Mode) => void;
  onClose: () => void;
  hasApiKey: boolean | null;
  /** Latest write failure, if any. */
  error: string | null;
  saving: boolean;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Compact settings sheet.
 *
 * Anchored under the bar and capped at ~60vh, because the constraint is that
 * Cyps must never become a dashboard. Only the settings that actually change
 * behaviour of the floating companion are exposed here - not a full preferences
 * application.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const { settings, onPatch, onRequestMode, onClose, hasApiKey, error, saving } = props;
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const modeDescriptor = getModeDescriptor(settings.companion.mode);

  return (
    <section
      aria-label="Cyps settings"
      className="glass-raised animate-slide-down flex w-[460px] flex-col overflow-hidden rounded-[var(--cyps-radius)]"
      style={{ maxHeight: 'min(62vh, 440px)' }}
    >
      <header className="flex items-center gap-2 border-b border-[var(--color-glass-border)] px-3 py-2">
        <Sparkles size={14} strokeWidth={2.3} aria-hidden="true" className="text-sky-300" />
        <h2 className="flex-1 text-[12.5px] font-semibold text-[var(--color-ink)]">Companion</h2>
        {saving ? (
          <span role="status" aria-live="polite" className="text-[10px] text-[var(--color-ink-dim)]">
            Saving…
          </span>
        ) : null}
        <IconButton label="Close settings" onClick={onClose}>
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
          <Row label="Summon or hide Cyps">
            <Accelerator value={settings.globalAccelerator} />
          </Row>
          <Row label="Emergency stop">
            <Accelerator value={settings.emergencyStopAccelerator} />
          </Row>
          <Row label="Push to talk">
            <Accelerator value={settings.voice.pushToTalkAccelerator} />
          </Row>
          <p className="mt-1 px-1 text-[10px] leading-snug text-[var(--color-ink-dim)]">
            Change these in your system settings file. The emergency stop always works, even
            while Cyps is mid-task.
          </p>
        </Group>

        <Group icon={Mic} title="Voice">
          <Toggle
            label="Voice output"
            hint="Speak answers aloud."
            checked={settings.voice.ttsEnabled}
            onChange={(value) => onPatch({ voice: { ttsEnabled: value } })}
          />
          <Row label="Speech model">
            <span className="text-[11px] text-[var(--color-ink-soft)]">{settings.voice.sttModel}</span>
          </Row>
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
          <Row label="API key">
            <span
              className={`text-[11px] font-medium ${
                hasApiKey === null
                  ? 'text-[var(--color-ink-dim)]'
                  : hasApiKey
                    ? 'text-emerald-200'
                    : 'text-amber-200'
              }`}
            >
              {hasApiKey === null ? 'Unknown' : hasApiKey ? 'Configured' : 'Not set'}
            </span>
          </Row>
        </Group>

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
      </div>
    </section>
  );
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
