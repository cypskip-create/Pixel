import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Search } from 'lucide-react';
import {
  PROVIDER_MODEL_CATALOG,
  getProviderDescriptor,
  type ProviderId,
  type ProviderSettings,
  type ReasoningEffort,
} from '@shared/types';

export interface ModelPickerPopoverProps {
  providerSettings: ProviderSettings;
  hasApiKey: boolean;
  onSelectModel: (provider: ProviderId, model: string) => void;
  onSelectEffort: (effort: ReasoningEffort) => void;
}

const EFFORT_LEVELS: readonly ReasoningEffort[] = ['none', 'low', 'high', 'max'] as const;

export function ModelPickerPopover({
  providerSettings,
  hasApiKey,
  onSelectModel,
  onSelectEffort,
}: ModelPickerPopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeDescriptor = getProviderDescriptor(providerSettings.provider);
  const enabledFallbacks = (providerSettings.fallbackProviders ?? []).filter((f) => f.enabled).length;

  const entries = useMemo(() => {
    const customEntries = (providerSettings.customEndpoints ?? [])
      .filter((ep) => ep.enabled && ep.model)
      .map((ep) => ({
        provider: 'custom' as ProviderId,
        providerLabel: ep.name,
        id: ep.model,
        label: ep.model,
        role: 'fast' as const,
        vision: false,
        toolCalls: true,
        thinking: false,
        contextTokens: providerSettings.contextLength ?? 128_000,
      }));

    const combined = [
      ...PROVIDER_MODEL_CATALOG.map((m) => ({
        ...m,
        providerLabel: getProviderDescriptor(m.provider).label,
      })),
      ...customEntries,
    ];

    const q = query.trim().toLowerCase();
    if (!q) return combined;
    return combined.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.providerLabel.toLowerCase().includes(q) ||
        item.provider.toLowerCase().includes(q),
    );
  }, [providerSettings.contextLength, providerSettings.customEndpoints, query]);

  return (
    <div className="workspace-model-picker" ref={containerRef}>
      <button
        type="button"
        className="workspace-model-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`Active model: ${activeDescriptor.label} / ${providerSettings.primaryModel}`}
      >
        <span
          className={`workspace-model-dot ${hasApiKey || !activeDescriptor.requiresApiKey ? 'is-ready' : 'is-missing'}`}
          aria-hidden="true"
        />
        <Cpu size={11} aria-hidden="true" />
        <span className="truncate">{providerSettings.primaryModel}</span>
        <span className="workspace-model-meta">
          {providerSettings.provider}
          {enabledFallbacks > 0 ? ` +${enabledFallbacks}` : ''}
        </span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>

      {open ? (
        <div className="workspace-model-menu" role="dialog" aria-label="Select model and reasoning effort">
          <div className="workspace-model-search">
            <Search size={12} aria-hidden="true" />
            <input
              type="text"
              aria-label="Filter models"
              placeholder="Search providers or models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div className="workspace-model-effort-row" aria-label="Reasoning effort">
            <span className="workspace-model-effort-label">Reasoning</span>
            <div className="workspace-model-effort-pills">
              {EFFORT_LEVELS.map((level) => {
                const active = (providerSettings.thinking?.enabled ? providerSettings.thinking.effort : 'none') === level;
                return (
                  <button
                    key={level}
                    type="button"
                    className={`workspace-effort-pill ${active ? 'is-active' : ''}`}
                    onClick={() => onSelectEffort(level)}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="workspace-model-list" role="listbox" aria-label="Models">
            {entries.map((item) => {
              const isSelected =
                providerSettings.provider === item.provider &&
                providerSettings.primaryModel === item.id;
              return (
                <button
                  key={`${item.provider}:${item.id}:${item.providerLabel}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`workspace-model-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    onSelectModel(item.provider, item.id);
                    setOpen(false);
                  }}
                >
                  <span className="workspace-model-option-main">
                    <span className="workspace-model-option-name">{item.id}</span>
                    <span className="workspace-model-option-prov">
                      {item.providerLabel} · {Math.round(item.contextTokens / 1000)}k
                    </span>
                  </span>
                  <span className="workspace-model-option-caps">
                    {item.vision ? <span className="workspace-cap-badge">vision</span> : null}
                    {item.thinking ? <span className="workspace-cap-badge">reason</span> : null}
                    {isSelected ? <Check size={12} aria-hidden="true" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
