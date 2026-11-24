import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, Bell, Box, Brain, ChevronDown, ChevronRight, CloudUpload, CreditCard, Download, Globe,
  Info, Key, Keyboard, Lock, MessageSquare, Mic, Monitor, Palette, Puzzle, Radio, RefreshCw,
  Search, Shield, Upload, Wrench, X, Zap,
} from 'lucide-react';
import type {
  AppSettings, ConnectionTestResult, DiagnosticsSnapshot, Mode, PluginView, ProviderId,
  ReasoningEffort, ToolCatalogEntry,
} from '@shared/types';
import { getProviderDescriptor, PROVIDER_CATALOG } from '@shared/types';
import { applyThemePreset, loadSavedThemeId, PIXEL_THEME_PRESETS } from '@/lib/themeEngine';
import { MemoryPanel } from '@/components/MemoryPanel';
import { PermissionsPanel } from '@/components/PermissionsPanel';
import { AutomationPanel } from '@/components/AutomationPanel';
import {
  WorkspacePluginManager,
  type PluginLifecycleAction,
  type PluginProjectAvailability,
  type PluginSettingChange,
} from '@/components/WorkspacePluginManager';
import type { DeepPartial, SettingsPage } from '@/components/SettingsPanel';

export type HermesCategoryId =
  | 'model'
  | 'chat'
  | 'appearance'
  | 'workspace'
  | 'safety'
  | 'browser'
  | 'passwords'
  | 'memory'
  | 'voice'
  | 'advanced'
  | 'notifications'
  | 'billing'
  | 'providers'
  | 'gateways'
  | 'web-access'
  | 'shortcuts'
  | 'tools-keys'
  | 'sessions'
  | 'backup'
  | 'plugins'
  | 'about';

interface HermesCategoryDef {
  id: HermesCategoryId;
  label: string;
  icon: typeof Box;
  group: 1 | 2 | 3;
  subItems?: ReadonlyArray<{ id: string; label: string }>;
}

export const HERMES_SETTINGS_TREE: ReadonlyArray<HermesCategoryDef> = [
  {
    id: 'model',
    label: 'Model',
    icon: Box,
    group: 1,
    subItems: [
      { id: 'main', label: 'Main model' },
      { id: 'fallback', label: 'Fallback model' },
      { id: 'relay', label: 'Relay model' },
      { id: 'subagents', label: 'Subagents' },
      { id: 'moa', label: 'Mixture of Agents' },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    group: 1,
    subItems: [
      { id: 'personality', label: 'Personality' },
      { id: 'behavior', label: 'Behavior' },
      { id: 'attachments', label: 'Attachments' },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    group: 1,
    subItems: [
      { id: 'general', label: 'General' },
      { id: 'theme', label: 'Theme' },
      { id: 'typography', label: 'Typography' },
      { id: 'window-layout', label: 'Window & Layout' },
      { id: 'chat-display', label: 'Chat Display' },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: Monitor,
    group: 1,
    subItems: [
      { id: 'project-discovery', label: 'Project & Discovery' },
      { id: 'shell-env', label: 'Shell Environment' },
      { id: 'file-exec', label: 'File & Execution' },
    ],
  },
  {
    id: 'safety',
    label: 'Safety',
    icon: Lock,
    group: 1,
    subItems: [
      { id: 'approvals', label: 'Approvals' },
      { id: 'privacy-net', label: 'Privacy & Networks' },
      { id: 'checkpoints', label: 'Checkpoints' },
    ],
  },
  {
    id: 'browser',
    label: 'Browser',
    icon: Globe,
    group: 1,
    subItems: [
      { id: 'profile', label: 'Browser Profile' },
      { id: 'local-urls', label: 'Local & Private URLs' },
    ],
  },
  { id: 'passwords', label: 'Passwords & Logins', icon: Shield, group: 1 },
  {
    id: 'memory',
    label: 'Memory & Context',
    icon: Brain,
    group: 1,
    subItems: [
      { id: 'persistent', label: 'Persistent Memory' },
      { id: 'compression', label: 'Context & Compression' },
    ],
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    group: 1,
    subItems: [
      { id: 'conversations', label: 'Voice Conversations' },
      { id: 'stt', label: 'Speech to Text' },
      { id: 'tts', label: 'Text to Speech' },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: Wrench,
    group: 1,
    subItems: [
      { id: 'desktop-startup', label: 'Desktop & Startup' },
      { id: 'agent-limits', label: 'Agent Limits' },
      { id: 'tool-access', label: 'Tool Access' },
      { id: 'terminal-backend', label: 'Terminal Backend' },
      { id: 'output-limits', label: 'Output Limits' },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    group: 1,
    subItems: [
      { id: 'alerts', label: 'Desktop Alerts' },
      { id: 'sound', label: 'Sound' },
    ],
  },
  { id: 'billing', label: 'Billing', icon: CreditCard, group: 1 },
  {
    id: 'providers',
    label: 'Providers',
    icon: Zap,
    group: 2,
    subItems: [
      { id: 'accounts', label: 'Accounts' },
      { id: 'api-keys', label: 'API Keys' },
      { id: 'custom-endpoints', label: 'Custom Endpoints' },
      { id: 'local-models', label: 'Local Models' },
    ],
  },
  {
    id: 'gateways',
    label: 'Gateways',
    icon: Radio,
    group: 2,
    subItems: [
      { id: 'primary', label: 'Primary Gateway' },
      { id: 'server', label: 'Server Connection' },
      { id: 'remote-updates', label: 'Remote Updates' },
    ],
  },
  { id: 'web-access', label: 'Web access', icon: Globe, group: 2 },
  {
    id: 'shortcuts',
    label: 'Keyboard Shortcuts',
    icon: Keyboard,
    group: 2,
    subItems: [
      { id: 'key-bindings', label: 'Key Bindings' },
      { id: 'hud-gesture', label: 'HUD Gesture' },
      { id: 'screen-capture', label: 'Screen Capture' },
    ],
  },
  {
    id: 'tools-keys',
    label: 'Tools & Keys',
    icon: Key,
    group: 2,
    subItems: [
      { id: 'tools', label: 'Tools' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    icon: Archive,
    group: 2,
    subItems: [
      { id: 'archive', label: 'Archive & Retention' },
      { id: 'default-folder', label: 'Default Project Folder' },
    ],
  },
  { id: 'backup', label: 'Backup & Transfer', icon: CloudUpload, group: 2 },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, group: 3 },
  { id: 'about', label: 'About', icon: Info, group: 3 },
];

function mapLegacyPage(initialPage?: SettingsPage): { cat: HermesCategoryId; sub: string } {
  switch (initialPage) {
    case 'ai-models': return { cat: 'model', sub: 'main' };
    case 'appearance': return { cat: 'appearance', sub: 'theme' };
    case 'workspace': return { cat: 'workspace', sub: 'project-discovery' };
    case 'agent-permissions': return { cat: 'safety', sub: 'approvals' };
    case 'memory': return { cat: 'memory', sub: 'persistent' };
    case 'voice': return { cat: 'voice', sub: 'conversations' };
    case 'tools': return { cat: 'tools-keys', sub: 'tools' };
    case 'plugins': return { cat: 'plugins', sub: '' };
    case 'skills': return { cat: 'sessions', sub: 'archive' };
    case 'advanced': return { cat: 'advanced', sub: 'desktop-startup' };
    default: return { cat: 'model', sub: 'main' };
  }
}

export interface HermesSettingsViewProps {
  settings: AppSettings;
  displays: DiagnosticsSnapshot['displays'];
  onPatch: (patch: DeepPartial<AppSettings>) => void;
  onRequestMode: (mode: Mode) => void;
  onClose: () => void;
  hasApiKey: boolean | null;
  onSaveApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  onRemoveApiKey: () => Promise<{ ok: boolean; error?: string }>;
  onTestConnection: () => Promise<ConnectionTestResult>;
  error: string | null;
  saving: boolean;
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

/**
 * Full-bleed Hermes Agent Settings UI (`media_1795545014943_9a561633.png` 1:1 parity).
 */
export function HermesSettingsView(props: HermesSettingsViewProps): React.JSX.Element {
  const {
    settings, onPatch, onRequestMode, onClose, hasApiKey,
    onSaveApiKey, onRemoveApiKey, onTestConnection, error, saving,
    initialPage, tools = [], plugins = [], onPluginChange,
  } = props;

  const initial = useMemo(() => mapLegacyPage(initialPage), [initialPage]);
  const [category, setCategory] = useState<HermesCategoryId>(initial.cat);
  const [subItem, setSubItem] = useState<string>(initial.sub);
  const [expandedCat, setExpandedCat] = useState<HermesCategoryId | null>(initial.cat);
  const [search, setSearch] = useState('');
  const [activeProfilePill, setActiveProfilePill] = useState<'default' | 'chief-of-staff'>('default');
  const [activeThemeId, setActiveThemeId] = useState<string>(() => loadSavedThemeId());

  // Drafts for explicit "Apply" feel on Model & Provider keys
  const [providerDraft, setProviderDraft] = useState<ProviderId>(settings.provider.provider);
  const [modelDraft, setModelDraft] = useState<string>(settings.provider.primaryModel);
  const [relayModel, setRelayModel] = useState<string>(settings.provider.reasoningModel);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [connStatus, setConnStatus] = useState<string | null>(null);
  const [appliedBanner, setAppliedBanner] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setProviderDraft(settings.provider.provider);
    setModelDraft(settings.provider.primaryModel);
    setRelayModel(settings.provider.reasoningModel);
  }, [settings.provider.provider, settings.provider.primaryModel, settings.provider.reasoningModel]);

  useEffect(() => {
    const mapped = mapLegacyPage(initialPage);
    setCategory(mapped.cat);
    setSubItem(mapped.sub);
    setExpandedCat(mapped.cat);
  }, [initialPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement !== searchInputRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currentCatDef = HERMES_SETTINGS_TREE.find((c) => c.id === category) ?? HERMES_SETTINGS_TREE[0]!;
  const currentSubLabel = currentCatDef.subItems?.find((s) => s.id === subItem)?.label ?? currentCatDef.subItems?.[0]?.label ?? '';

  const filteredTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return HERMES_SETTINGS_TREE;
    return HERMES_SETTINGS_TREE.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.subItems?.some((s) => s.label.toLowerCase().includes(q)),
    );
  }, [search]);

  const flashApplied = (msg: string) => {
    setAppliedBanner(msg);
    window.setTimeout(() => setAppliedBanner(null), 2200);
  };

  const selectCategory = (cat: HermesCategoryDef) => {
    setCategory(cat.id);
    const nextSub = cat.subItems?.[0]?.id ?? '';
    setSubItem(nextSub);
    setExpandedCat((prev) => (prev === cat.id && cat.subItems ? null : cat.id));
  };

  const providerDescriptor = getProviderDescriptor(providerDraft);

  return (
    <section
      data-testid="hermes-settings-view"
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-app-bg)] text-[var(--color-ink)]"
    >
      {/* Top Hermes Search Bar + Close X */}
      <header className="flex h-[48px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-sidebar)] px-5">
        <div className="w-24 text-xs font-medium text-[var(--color-ink-dim)]">
          {saving ? 'Saving…' : appliedBanner ?? ''}
        </div>
        <label className="flex h-[30px] w-[240px] items-center justify-between rounded-full border border-[var(--color-border-strong)] bg-[var(--color-app-bg)] px-3 text-xs text-[var(--color-ink-dim)] focus-within:border-[var(--color-accent)]">
          <span className="flex items-center gap-2 flex-1">
            <Search size={12} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="Search settings"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full bg-transparent text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-dim)]"
            />
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-ink-dim)]">
            <kbd className="rounded border border-[var(--color-border)] px-1 py-0.2">Ctrl</kbd>
            <kbd className="rounded border border-[var(--color-border)] px-1 py-0.2">K</kbd>
          </span>
        </label>
        <div className="flex w-24 justify-end">
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Split Left Navigation Rail + Right Content Pane */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[244px] shrink-0 flex-col justify-between border-r border-[var(--color-border)] bg-[var(--color-sidebar)]">
          <nav aria-label="Settings categories" className="flex-1 overflow-y-auto px-2.5 py-3">
            {[1, 2, 3].map((grp) => {
              const items = filteredTree.filter((c) => c.group === grp);
              if (items.length === 0) return null;
              return (
                <div key={grp} className={grp > 1 ? 'mt-2.5 border-t border-[var(--color-border)] pt-2.5' : ''}>
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = category === item.id;
                    const expanded = expandedCat === item.id && Boolean(item.subItems?.length);
                    return (
                      <div key={item.id} className="mb-0.5">
                        <button
                          type="button"
                          aria-current={active ? 'page' : undefined}
                          onClick={() => selectCategory(item)}
                          className={
                            active
                              ? 'flex w-full items-center justify-between rounded-lg bg-[var(--color-surface-raised)] px-3 py-2 text-left text-[13px] font-medium text-[var(--color-ink)]'
                              : 'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                          }
                        >
                          <span className="flex items-center gap-2.5 truncate">
                            <Icon size={15} className={active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-dim)]'} />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.subItems ? (
                            expanded ? <ChevronDown size={13} className="opacity-60" /> : <ChevronRight size={13} className="opacity-60" />
                          ) : null}
                        </button>
                        {expanded && item.subItems ? (
                          <div className="ml-6 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-2.5">
                            {item.subItems.map((sub) => (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => {
                                  setCategory(item.id);
                                  setSubItem(sub.id);
                                }}
                                className={
                                  active && subItem === sub.id
                                    ? 'rounded-md bg-[var(--color-hover)] px-2.5 py-1.5 text-left text-xs font-medium text-[var(--color-ink)]'
                                    : 'rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
                                }
                              >
                                {sub.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Bottom-left Hermes quick actions (Export / Import / Reset view) */}
          <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[var(--color-ink-dim)]">
            <button
              type="button"
              title="Backup & Transfer"
              onClick={() => { setCategory('backup'); setSubItem(''); }}
              className="rounded p-1 hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            >
              <Download size={13} />
            </button>
            <button
              type="button"
              title="Import Settings"
              onClick={() => { setCategory('backup'); setSubItem(''); }}
              className="rounded p-1 hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            >
              <Upload size={13} />
            </button>
            <button
              type="button"
              title="Refresh"
              onClick={() => flashApplied('Settings synced')}
              className="rounded p-1 hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </aside>

        {/* Right Hermes Content Pane */}
        <div className="min-h-0 flex-1 overflow-y-auto px-12 py-8">
          <div className="mx-auto max-w-[920px]">
            {/* Breadcrumb */}
            <div className="mb-4 flex items-center gap-2 text-[13px] text-[var(--color-ink-dim)]">
              <span>Settings</span>
              <span>&gt;</span>
              <span className={currentSubLabel ? '' : 'font-semibold text-[var(--color-ink)]'}>{currentCatDef.label}</span>
              {currentSubLabel ? (
                <>
                  <span>&gt;</span>
                  <span className="font-semibold text-[var(--color-ink)]">{currentSubLabel}</span>
                </>
              ) : null}
            </div>

            {/* Sub-section horizontal pills if category has subItems */}
            {currentCatDef.subItems && currentCatDef.subItems.length > 0 ? (
              <div className="mb-6 flex flex-wrap gap-1.5 border-b border-[var(--color-border)] pb-4">
                {currentCatDef.subItems.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setSubItem(sub.id)}
                    className={
                      subItem === sub.id
                        ? 'rounded-full border border-[var(--color-accent)] bg-[var(--color-surface-raised)] px-3.5 py-1 text-xs font-medium text-[var(--color-ink)]'
                        : 'rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1 text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
                    }
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            ) : null}

            {error ? (
              <div role="alert" className="mb-5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-4 py-2.5 text-xs text-[var(--color-ink)]">
                {error}
              </div>
            ) : null}

            {/* ==================== 1. MODEL ==================== */}
            {category === 'model' && (subItem === 'main' || !subItem) ? (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2.5">
                  <span className="text-xs font-semibold text-[var(--color-ink)]">Applies to</span>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['default', 'default'],
                      ['chief-of-staff', 'chief of staff'],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setActiveProfilePill(id)}
                        className={
                          activeProfilePill === id
                            ? 'rounded-full border border-[var(--color-accent)] bg-[var(--color-surface-raised)] px-4 py-1.5 text-xs font-medium text-[var(--color-ink)]'
                            : 'rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--color-ink-dim)]">
                    Applies to new sessions. Use the model picker in the composer to hot-swap the active chat.
                  </p>
                </div>

                <HermesRow label="Provider">
                  <select
                    aria-label="Provider"
                    value={providerDraft}
                    onChange={(e) => {
                      const next = e.target.value as ProviderId;
                      setProviderDraft(next);
                      const desc = getProviderDescriptor(next);
                      if (desc.defaultModel) setModelDraft(desc.defaultModel);
                    }}
                    className="w-[300px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                  >
                    {PROVIDER_CATALOG.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </HermesRow>

                <HermesRow label="Model">
                  <input
                    aria-label="Primary model"
                    list="hermes-model-suggestions"
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    className="w-[300px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                  />
                  <datalist id="hermes-model-suggestions">
                    {[providerDescriptor.defaultModel, providerDescriptor.reasoningModel].filter(Boolean).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </HermesRow>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onPatch({ provider: { provider: providerDraft, primaryModel: modelDraft } });
                      flashApplied('Applied main model');
                    }}
                    className="rounded-md bg-[#4299F5] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    Apply
                  </button>
                </div>

                <div className="border-t border-[var(--color-border)] pt-5">
                  <span className="mb-4 block text-xs text-[var(--color-ink-dim)]">Defaults</span>
                  <div className="flex flex-col gap-6">
                    <HermesRow label="Reasoning">
                      <select
                        aria-label="Reasoning effort"
                        value={settings.provider.thinking.effort}
                        onChange={(e) => onPatch({
                          provider: {
                            thinking: {
                              enabled: e.target.value !== 'none',
                              effort: e.target.value as ReasoningEffort,
                            },
                          },
                        })}
                        className="w-[150px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                      >
                        <option value="none">None</option>
                        <option value="low">Low</option>
                        <option value="high">Medium</option>
                        <option value="max">High / Max</option>
                      </select>
                    </HermesRow>

                    <HermesRow
                      label="Main model context window (override)"
                      hint="Overrides the detected context window of the MAIN chat model only (tokens). Leave at 0 to use the selected model's detected value. Does not affect auxiliary/MoA models."
                    >
                      <input
                        type="number"
                        min={0}
                        max={2000000}
                        value={settings.provider.contextLength ?? 0}
                        onChange={(e) => {
                          const v = Number.parseInt(e.target.value, 10);
                          onPatch({ provider: { contextLength: Number.isFinite(v) && v >= 4096 ? v : undefined } });
                        }}
                        className="w-[160px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                      />
                    </HermesRow>
                  </div>
                </div>
              </div>
            ) : null}

            {category === 'model' && subItem === 'fallback' ? (
              <div className="flex flex-col gap-5">
                <p className="text-xs text-[var(--color-ink-dim)]">
                  Ordered fallback model chain automatically invoked on rate limits, timeouts, or upstream outages.
                </p>
                {(settings.provider.fallbackProviders ?? []).map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
                    <span>{entry.provider} · <strong>{entry.model}</strong></span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = (settings.provider.fallbackProviders ?? []).filter((_, i) => i !== idx);
                        onPatch({ provider: { fallbackProviders: next } });
                      }}
                      className="text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = [
                        ...(settings.provider.fallbackProviders ?? []),
                        { provider: settings.provider.provider, model: settings.provider.reasoningModel || 'deepseek-chat', enabled: true },
                      ];
                      onPatch({ provider: { fallbackProviders: next } });
                    }}
                    className="rounded-md bg-[#4299F5] px-3.5 py-1.5 text-xs font-semibold text-white"
                  >
                    + Add Fallback Model
                  </button>
                </div>
              </div>
            ) : null}

            {category === 'model' && (subItem === 'relay' || subItem === 'subagents' || subItem === 'moa') ? (
              <div className="flex flex-col gap-6">
                <HermesRow
                  label={subItem === 'relay' ? 'Relay / Auxiliary Model' : subItem === 'subagents' ? 'Default Subagent Model' : 'Mixture of Agents Aggregator Model'}
                  hint="Used for background context compression, memory synthesis, parallel subagent delegation, and MoA aggregation."
                >
                  <input
                    value={relayModel}
                    onChange={(e) => setRelayModel(e.target.value)}
                    className="w-[280px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  />
                </HermesRow>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onPatch({ provider: { reasoningModel: relayModel } });
                      flashApplied('Saved model configuration');
                    }}
                    className="rounded-md bg-[#4299F5] px-4 py-1.5 text-xs font-semibold text-white"
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}

            {/* ==================== 2. CHAT ==================== */}
            {category === 'chat' ? (
              <div className="flex flex-col gap-6">
                <HermesRow label="Default Companion Mode" hint="Choose Guide, Hybrid, or full Agent mode.">
                  <select
                    value={settings.companion.mode}
                    onChange={(e) => onRequestMode(e.target.value as Mode)}
                    className="w-[220px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    <option value="guide">Guide (Explain only)</option>
                    <option value="hybrid">Hybrid (Balanced)</option>
                    <option value="agent">Agent (Full Desktop &amp; Tools)</option>
                  </select>
                </HermesRow>
                <HermesRow label="Temperature" hint="Controls response creativity vs determinism (0.0 – 1.5).">
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={1.5}
                    value={settings.provider.temperature}
                    onChange={(e) => onPatch({ provider: { temperature: Number.parseFloat(e.target.value) || 0.4 } })}
                    className="w-[120px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  />
                </HermesRow>
                <HermesToggle
                  label="Collapse reasoning blocks by default"
                  hint="Keep streaming chain-of-thought tucked inside a collapsible disclosure."
                  checked={settings.display?.reasoningCollapsed !== false}
                  onChange={(v) => onPatch({ display: { reasoningCollapsed: v } })}
                />
                <HermesToggle
                  label="Auto-collapse Dynamic Island after reply"
                  hint="Return the floating top bar to its compact pill when idle."
                  checked={settings.companion.autoCollapse}
                  onChange={(v) => onPatch({ companion: { autoCollapse: v } })}
                />
              </div>
            ) : null}

            {/* ==================== 3. APPEARANCE ==================== */}
            {category === 'appearance' ? (
              <div className="flex flex-col gap-6">
                <HermesRow label="Color Mode" hint="Switch instantly between Dark Mode and Light Mode.">
                  <select
                    aria-label="Color Mode"
                    value={settings.theme === 'light' ? 'light' : 'dark'}
                    onChange={(e) => {
                      const mode = e.target.value as 'dark' | 'light';
                      const targetId = mode === 'light' ? 'paper-light' : 'obsidian-dark';
                      applyThemePreset(targetId);
                      setActiveThemeId(targetId);
                      onPatch({ theme: mode });
                    }}
                    className="w-[220px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    <option value="dark">Dark Mode</option>
                    <option value="light">Light Mode</option>
                  </select>
                </HermesRow>

                <div className="flex flex-col gap-3" data-testid="hermes-theme-picker">
                  <span className="text-sm font-semibold text-[var(--color-ink)]">
                    Hermes Theme Library ({PIXEL_THEME_PRESETS.length} Themes)
                  </span>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {PIXEL_THEME_PRESETS.map((preset) => {
                      const selected = activeThemeId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            applyThemePreset(preset.id);
                            setActiveThemeId(preset.id);
                            onPatch({ theme: preset.mode });
                          }}
                          className={
                            selected
                              ? 'flex flex-col items-start gap-1.5 rounded-xl border-2 border-[#4299F5] bg-[var(--color-surface-raised)] p-3.5 text-left'
                              : 'flex flex-col items-start gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 text-left hover:bg-[var(--color-hover)]'
                          }
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-xs font-semibold text-[var(--color-ink)]">{preset.name}</span>
                            <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--color-ink-dim)]">
                              {preset.mode}
                            </span>
                          </div>
                          <span className="text-[11px] leading-snug text-[var(--color-ink-dim)]">{preset.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <HermesToggle
                  label="Reduce motion"
                  hint="Pause ambient ASCII creatures, horse gallop, and particle core rotation."
                  checked={settings.companion.reducedMotion}
                  onChange={(v) => onPatch({ companion: { reducedMotion: v } })}
                />
                <HermesToggle
                  label="Compact workspace density"
                  hint="Tighter row heights in sidebar and settings tables."
                  checked={settings.companion.compact}
                  onChange={(v) => onPatch({ companion: { compact: v } })}
                />
              </div>
            ) : null}

            {/* ==================== 4. WORKSPACE ==================== */}
            {category === 'workspace' ? (
              <div className="flex flex-col gap-6">
                <HermesRow label="Primary Agent Runtime" hint="Python v2 is Pixel's primary authoritative backend.">
                  <select
                    value={settings.agent?.runtimeEngine ?? 'python'}
                    onChange={(e) => onPatch({ agent: { runtimeEngine: e.target.value as 'python' | 'typescript' } })}
                    className="w-[220px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    <option value="python">Python v2 (Recommended)</option>
                    <option value="typescript">TypeScript Fallback</option>
                  </select>
                </HermesRow>
                <HermesRow label="Interactive Shell" hint="Default shell launched in Pixel's live PTY Terminal.">
                  <select
                    defaultValue="powershell"
                    className="w-[220px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    <option value="powershell">PowerShell (pwsh / powershell.exe)</option>
                    <option value="cmd">Command Prompt (cmd.exe)</option>
                  </select>
                </HermesRow>
              </div>
            ) : null}

            {/* ==================== 5. SAFETY ==================== */}
            {category === 'safety' ? (
              <div className="flex flex-col gap-6">
                <HermesToggle
                  label="Persist conversation history locally"
                  hint="Store encrypted/local SQLite chat transcripts per profile."
                  checked={settings.privacy.persistHistory}
                  onChange={(v) => onPatch({ privacy: { persistHistory: v } })}
                />
                <PermissionsPanel onBack={() => selectCategory(HERMES_SETTINGS_TREE[0]!)} />
              </div>
            ) : null}

            {/* ==================== 6. BROWSER & WEB ACCESS ==================== */}
            {category === 'browser' || category === 'web-access' ? (
              <div className="flex flex-col gap-6">
                <HermesRow label="Default Search Engine" hint="Used for web search & browser research.">
                  <select
                    value={settings.browserSearchProvider}
                    onChange={(e) => onPatch({ browserSearchProvider: e.target.value as AppSettings['browserSearchProvider'] })}
                    className="w-[220px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    <option value="google">Google</option>
                    <option value="bing">Bing</option>
                    <option value="duckduckgo">DuckDuckGo</option>
                  </select>
                </HermesRow>
                <HermesToggle
                  label="Headless browser mode"
                  hint="Run managed Chromium headlessly in the background."
                  checked={settings.browser?.headless !== false}
                  onChange={(v) => onPatch({ browser: { headless: v } })}
                />
                <HermesToggle
                  label="Allow localhost & private LAN URLs"
                  hint="Permit local dev server inspection (cloud metadata IPs remain blocked)."
                  checked={settings.browser?.allowPrivateNetwork === true}
                  onChange={(v) => onPatch({ browser: { allowPrivateNetwork: v } })}
                />
                <HermesRow label="CDP Endpoint (optional)" hint="Attach to an existing Chrome DevTools port.">
                  <input
                    value={settings.browser?.cdpEndpoint ?? ''}
                    onChange={(e) => onPatch({ browser: { cdpEndpoint: e.target.value } })}
                    placeholder="http://127.0.0.1:9222"
                    className="w-[240px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  />
                </HermesRow>
              </div>
            ) : null}

            {/* ==================== 7. PASSWORDS & LOGINS ==================== */}
            {category === 'passwords' ? (
              <div className="flex flex-col gap-4">
                <p className="text-xs text-[var(--color-ink-dim)]">
                  API credentials and OAuth tokens are encrypted via Windows DPAPI (`safeStorage`) and never written in plaintext to settings JSON or logs.
                </p>
                <HermesRow label="Active Provider Credential Vault">
                  <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs">
                    {hasApiKey ? 'Encrypted Key Stored (DPAPI)' : 'No Key Stored'}
                  </span>
                </HermesRow>
              </div>
            ) : null}

            {/* ==================== 8. MEMORY & CONTEXT ==================== */}
            {category === 'memory' ? (
              <div className="flex flex-col gap-6">
                <MemoryPanel onBack={() => selectCategory(HERMES_SETTINGS_TREE[0]!)} />
              </div>
            ) : null}

            {/* ==================== 9. VOICE ==================== */}
            {category === 'voice' ? (
              <div className="flex flex-col gap-6">
                <HermesToggle
                  label="Speak replies aloud (TTS)"
                  hint="Synthesize assistant responses with your configured voice."
                  checked={settings.voice.ttsEnabled}
                  onChange={(v) => onPatch({ voice: { ttsEnabled: v } })}
                />
                <HermesRow label="Voice Chat Mode" hint="Chained local/cloud STT+TTS or real-time WebRTC live voice.">
                  <select
                    value={settings.voice.voiceChatMode ?? 'chained'}
                    onChange={(e) => onPatch({ voice: { voiceChatMode: e.target.value as 'chained' | 'gpt-live' } })}
                    className="w-[220px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    <option value="chained">Chained (STT → Agent → TTS)</option>
                    <option value="gpt-live">Realtime Live Audio</option>
                  </select>
                </HermesRow>
                <HermesToggle
                  label="Allow Barge-In"
                  hint="Interrupt spoken playback automatically when you start speaking."
                  checked={settings.voice.bargeIn !== false}
                  onChange={(v) => onPatch({ voice: { bargeIn: v } })}
                />
              </div>
            ) : null}

            {/* ==================== 10. ADVANCED ==================== */}
            {category === 'advanced' ? (
              <div className="flex flex-col gap-6">
                <HermesRow label="Max Output Tokens" hint="Maximum completion tokens per model response.">
                  <input
                    type="number"
                    min={256}
                    max={65536}
                    value={settings.provider.maxTokens}
                    onChange={(e) => onPatch({ provider: { maxTokens: Number.parseInt(e.target.value, 10) || 4096 } })}
                    className="w-[150px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  />
                </HermesRow>
                <HermesRow label="Request Timeout (ms)" hint="Wall-clock timeout per upstream LLM call.">
                  <input
                    type="number"
                    min={5000}
                    max={600000}
                    value={settings.provider.requestTimeoutMs}
                    onChange={(e) => onPatch({ provider: { requestTimeoutMs: Number.parseInt(e.target.value, 10) || 90000 } })}
                    className="w-[150px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  />
                </HermesRow>
                <HermesRow label="Computer-Use Capture Mode" hint="Set-of-Marks (SoM + UIA), Accessibility Tree, or Vision.">
                  <select
                    value={settings.computerUse?.captureMode ?? 'som'}
                    onChange={(e) => onPatch({ computerUse: { captureMode: e.target.value as 'som' | 'vision' | 'ax' } })}
                    className="w-[240px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    <option value="som">Set-of-Marks (SoM + UIA)</option>
                    <option value="ax">Accessibility Tree Only</option>
                    <option value="vision">Full Vision Screenshot</option>
                  </select>
                </HermesRow>
              </div>
            ) : null}

            {/* ==================== 11. NOTIFICATIONS & BILLING ==================== */}
            {category === 'notifications' ? (
              <div className="flex flex-col gap-6">
                <HermesToggle
                  label="Transient idle auto-hide"
                  hint="Hide the floating Dynamic Island until summoned or notified."
                  checked={settings.companion.transientMode}
                  onChange={(v) => onPatch({ companion: { transientMode: v } })}
                />
                <HermesToggle
                  label="Audible spoken alerts"
                  hint="Play spoken confirmation on background routine completion."
                  checked={settings.companion.speakReplies}
                  onChange={(v) => onPatch({ companion: { speakReplies: v } })}
                />
              </div>
            ) : null}

            {category === 'billing' ? (
              <div className="flex flex-col gap-4">
                <p className="text-xs text-[var(--color-ink-dim)]">
                  Pixel connects directly to your own provider API keys (BYOK) with zero markup. Token usage is tracked locally per session and task.
                </p>
              </div>
            ) : null}

            {/* ==================== 12. PROVIDERS ==================== */}
            {category === 'providers' ? (
              <div className="flex flex-col gap-6">
                <HermesRow label="Active Provider">
                  <select
                    value={settings.provider.provider}
                    onChange={(e) => onPatch({ provider: { provider: e.target.value as ProviderId } })}
                    className="w-[260px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                  >
                    {PROVIDER_CATALOG.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </HermesRow>

                <HermesRow
                  label="API Key"
                  hint={hasApiKey ? 'An encrypted API key is currently stored for this provider.' : 'Enter your API key to enable live model turns.'}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={apiKeyDraft}
                      onChange={(e) => setApiKeyDraft(e.target.value)}
                      placeholder={hasApiKey ? '••••••••••••••••' : 'sk-...'}
                      className="w-[220px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                    />
                    <button
                      type="button"
                      disabled={!apiKeyDraft.trim()}
                      onClick={async () => {
                        const res = await onSaveApiKey(apiKeyDraft.trim());
                        setApiKeyDraft('');
                        setConnStatus(res.ok ? 'Saved API key.' : (res.error ?? 'Failed to save key.'));
                      }}
                      className="rounded-md bg-[#4299F5] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Save Key
                    </button>
                    {hasApiKey ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await onRemoveApiKey();
                          setConnStatus('Removed API key.');
                        }}
                        className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </HermesRow>

                <HermesRow label="Base URL Override" hint="Optional custom OpenAI-compatible or local Ollama/vLLM endpoint.">
                  <div className="flex items-center gap-2">
                    <input
                      value={settings.provider.baseUrl ?? ''}
                      onChange={(e) => onPatch({ provider: { baseUrl: e.target.value || undefined } })}
                      placeholder="https://api.deepseek.com"
                      className="w-[260px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)]"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        setConnStatus('Testing connection…');
                        const res = await onTestConnection();
                        setConnStatus(res.ok ? `Connected (${res.latencyMs ?? 0} ms)` : (res.error?.message ?? 'Connection failed.'));
                      }}
                      className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs font-medium text-[var(--color-ink)]"
                    >
                      Test Connection
                    </button>
                  </div>
                </HermesRow>
                {connStatus ? <p className="text-xs text-[var(--color-accent)]">{connStatus}</p> : null}
              </div>
            ) : null}

            {/* ==================== 13. GATEWAYS ==================== */}
            {category === 'gateways' ? (
              <div className="flex flex-col gap-5">
                <p className="text-xs text-[var(--color-ink-dim)]">
                  Python Gateway manages Telegram, Discord, Slack, WhatsApp, Matrix, Email IMAP/SMTP, signed webhooks, and remote pairing. Open Messaging or Webhooks from the sidebar More menu for live pairing codes and channel logs.
                </p>
                <AutomationPanel onBack={() => selectCategory(HERMES_SETTINGS_TREE[0]!)} />
              </div>
            ) : null}

            {/* ==================== 14. KEYBOARD SHORTCUTS ==================== */}
            {category === 'shortcuts' ? (
              <div className="flex flex-col gap-5">
                <HermesRow label="Summon / Toggle Dynamic Island">
                  <kbd className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs">{settings.globalAccelerator}</kbd>
                </HermesRow>
                <HermesRow label="Emergency Stop (Instant Kill-Switch)">
                  <kbd className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs">{settings.emergencyStopAccelerator}</kbd>
                </HermesRow>
                <HermesRow label="Open Full Workspace">
                  <kbd className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs">{settings.workspaceAccelerator}</kbd>
                </HermesRow>
                <HermesRow label="Push-to-Talk Voice">
                  <kbd className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs">{settings.voice.pushToTalkAccelerator}</kbd>
                </HermesRow>
              </div>
            ) : null}

            {/* ==================== 15. TOOLS & KEYS ==================== */}
            {category === 'tools-keys' ? (
              <div className="flex flex-col gap-3">
                <p className="mb-2 text-xs text-[var(--color-ink-dim)]">
                  {tools.length} registered tools across Python runtime, Computer Use, Screen Drawing, Browser, Terminal PTY, and MCP.
                </p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {tools.map((tool) => (
                    <div key={tool.name} className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-[var(--color-ink)]">{tool.name}</span>
                        <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-ink-dim)]">
                          {tool.risk}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--color-ink-dim)]">{tool.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* ==================== 16. SESSIONS & BACKUP ==================== */}
            {category === 'sessions' || category === 'backup' ? (
              <div className="flex flex-col gap-6">
                <HermesToggle
                  label="Retain session history across restarts"
                  hint="Keep searchable FTS5 transcripts and artifacts per profile."
                  checked={settings.privacy.persistHistory}
                  onChange={(v) => onPatch({ privacy: { persistHistory: v } })}
                />
                <AutomationPanel onBack={() => selectCategory(HERMES_SETTINGS_TREE[0]!)} />
              </div>
            ) : null}

            {/* ==================== 17. PLUGINS ==================== */}
            {category === 'plugins' ? (
              <WorkspacePluginManager
                plugins={plugins}
                onChange={async (action, pluginId, enabled, availability, setting) => {
                  await onPluginChange?.(action, pluginId, enabled, availability, setting);
                }}
              />
            ) : null}

            {/* ==================== 18. ABOUT ==================== */}
            {category === 'about' ? (
              <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-xs">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">Pixel — Windows AI Desktop Companion</h3>
                <p className="text-[var(--color-ink-dim)]">
                  Python-first agent runtime (`pixel-agent-v2`) with Hermes functional parity, live on-screen drawing overlay, Computer Use UIA + Vision, interactive PTY terminal, custom Bot Creator, and multi-channel Gateway.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function HermesRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="max-w-[520px] flex-1">
        <div className="text-[13.5px] font-semibold text-[var(--color-ink)]">{label}</div>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-dim)]">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function HermesToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <HermesRow label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          checked
            ? 'relative inline-flex h-6 w-11 items-center rounded-full bg-[#4299F5] transition-colors'
            : 'relative inline-flex h-6 w-11 items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] transition-colors'
        }
      >
        <span
          className={
            checked
              ? 'inline-block size-4 translate-x-5 rounded-full bg-white transition-transform'
              : 'inline-block size-4 translate-x-1 rounded-full bg-[var(--color-ink-dim)] transition-transform'
          }
        />
      </button>
    </HermesRow>
  );
}
