import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Search } from 'lucide-react';
import {
  PROVIDER_CATALOG,
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
    const list: Array<{
      provider: ProviderId;
      providerLabel: string;
      model: string;
      role: 'fast' | 'reasoning';
      vision: boolean;
    }> = [];
    for (const p of PROVIDER_CATALOG) {
      list.push({
        provider: p.id,
        providerLabel: p.label,
        model: p.defaultModel,
        role: 'fast',
        vision: p.id === 'deepseek' || p.id === 'openai' || p.id === 'anthropic' || p.id === 'gemini' || p.id === 'openrouter',
      });
      if (p.reasoningModel && p.reasoningModel !== p.defaultModel) {
        list.push({
          provider: p.id,
          providerLabel: p.label,
          model: p.reasoningModel,
          role: 'reasoning',
          vision: p.id === 'anthropic',
        });
      }
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.model.toLowerCase().includes(q) ||
        item.providerLabel.toLowerCase().includes(q) ||
        item.provider.toLowerCase().includes(q),
    );
  }, [query]);

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
                providerSettings.primaryModel === item.model;
              return (
                <button
                  key={`${item.provider}:${item.model}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`workspace-model-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    onSelectModel(item.provider, item.model);
                    setOpen(false);
                  }}
                >
                  <span className="workspace-model-option-main">
                    <span className="workspace-model-option-name">{item.model}</span>
                    <span className="workspace-model-option-prov">{item.providerLabel}</span>
                  </span>
                  <span className="workspace-model-option-caps">
                    {item.vision ? <span className="workspace-cap-badge">vision</span> : null}
                    <span className="workspace-cap-badge">{item.role}</span>
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
