import { useEffect, useState, type FormEvent } from 'react';
import { Bot, Clock, Cpu, Monitor, Play, Plus, Trash2 } from 'lucide-react';

export interface CustomBotSpec {
  id: string;
  name: string;
  majorFunction: string;
  minorFunctions: string[];
  model: string;
  schedule: string;
  computerUse: boolean;
  screenDrawing: boolean;
  terminalAccess: boolean;
  browserAccess: boolean;
  mcpAccess: boolean;
  enabled: boolean;
}

const STORAGE_KEY = 'pixel.custom-bots.v1';

const DEFAULT_BOTS: CustomBotSpec[] = [
  {
    id: 'bot-chief-of-staff',
    name: 'Chief of Staff Bot',
    majorFunction: 'Daily morning briefing, email & calendar triage, and proactive reminders',
    minorFunctions: ['Summarize unread threads', 'Draft replies', 'Track daily goals'],
    model: 'deepseek-flash',
    schedule: '0 8 * * 1-5',
    computerUse: true,
    screenDrawing: false,
    terminalAccess: false,
    browserAccess: true,
    mcpAccess: true,
    enabled: true,
  },
  {
    id: 'bot-screen-guide',
    name: 'Screen Guide Bot',
    majorFunction: 'Interactive on-screen drawing, UI guidance, and desktop automation walkthroughs',
    minorFunctions: ['Highlight UI buttons', 'Draw step arrows', 'Verify window state'],
    model: 'deepseek-flash',
    schedule: 'Manual / On-demand',
    computerUse: true,
    screenDrawing: true,
    terminalAccess: false,
    browserAccess: true,
    mcpAccess: false,
    enabled: true,
  },
];

function loadBots(): CustomBotSpec[] {
  if (typeof window === 'undefined') return DEFAULT_BOTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BOTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_BOTS;
  } catch {
    return DEFAULT_BOTS;
  }
}

export interface BotCreatorPanelProps {
  onLaunchBot?: (bot: CustomBotSpec) => void;
}

/**
 * Hermes-inspired Bot Creator & Agent Builder:
 * Create dedicated bots, assign Major & Minor Functions, configure schedules/models,
 * and grant Computer Use, Screen Drawing, Terminal, Browser, and MCP capabilities.
 */
export function BotCreatorPanel({ onLaunchBot }: BotCreatorPanelProps): React.JSX.Element {
  const [bots, setBots] = useState<CustomBotSpec[]>(() => loadBots());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [majorFunction, setMajorFunction] = useState('');
  const [minorFunctionsRaw, setMinorFunctionsRaw] = useState('');
  const [model, setModel] = useState('deepseek-flash');
  const [schedule, setSchedule] = useState('Manual / On-demand');
  const [computerUse, setComputerUse] = useState(true);
  const [screenDrawing, setScreenDrawing] = useState(true);
  const [terminalAccess, setTerminalAccess] = useState(true);
  const [browserAccess, setBrowserAccess] = useState(true);
  const [mcpAccess, setMcpAccess] = useState(true);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bots));
    } catch {
      // Ignore storage write errors
    }
  }, [bots]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !majorFunction.trim()) return;
    const next: CustomBotSpec = {
      id: `bot-${Date.now()}`,
      name: name.trim(),
      majorFunction: majorFunction.trim(),
      minorFunctions: minorFunctionsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      model: model.trim() || 'deepseek-flash',
      schedule: schedule.trim() || 'Manual / On-demand',
      computerUse,
      screenDrawing,
      terminalAccess,
      browserAccess,
      mcpAccess,
      enabled: true,
    };
    setBots((prev) => [next, ...prev]);
    setName('');
    setMajorFunction('');
    setMinorFunctionsRaw('');
    setCreating(false);
  };

  return (
    <section data-testid="bot-creator-panel" className="flex flex-col gap-5 p-6 text-[var(--color-ink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Bots &amp; Custom Agents</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Create specialized bots, assign their major &amp; supporting functions, schedules, and Computer Use permissions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          <Plus size={14} /> {creating ? 'Cancel' : 'Create Bot'}
        </button>
      </div>

      {creating ? (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-[var(--color-ink-muted)]">Bot Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Research & Ops Bot"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-[var(--color-ink-muted)]">Primary Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="deepseek-flash"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--color-ink-muted)]">Major Function (Primary Mission)</span>
            <input
              required
              value={majorFunction}
              onChange={(e) => setMajorFunction(e.target.value)}
              placeholder="What is this bot's core responsibility?"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-[var(--color-ink-muted)]">Other Functions (comma-separated)</span>
              <input
                value={minorFunctionsRaw}
                onChange={(e) => setMinorFunctionsRaw(e.target.value)}
                placeholder="Monitor inbox, capture screen, post report"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-[var(--color-ink-muted)]">Schedule (Cron or Manual)</span>
              <input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 9 * * * or Manual"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3 pt-1 text-xs">
            {[
              ['Computer Use', computerUse, setComputerUse],
              ['Screen Drawing', screenDrawing, setScreenDrawing],
              ['Terminal PTY', terminalAccess, setTerminalAccess],
              ['Browser', browserAccess, setBrowserAccess],
              ['MCP & Plugins', mcpAccess, setMcpAccess],
            ].map(([label, checked, setter]) => (
              <label key={label as string} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={checked as boolean}
                  onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)}
                />
                <span>{label as string}</span>
              </label>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white"
            >
              Save Bot
            </button>
          </div>
        </form>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bots.map((bot) => (
          <article
            key={bot.id}
            className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot size={16} className="text-[var(--color-accent)]" />
                  <h3 className="text-sm font-semibold">{bot.name}</h3>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${bot.name}`}
                  onClick={() => setBots((prev) => prev.filter((item) => item.id !== bot.id))}
                  className="rounded p-1 text-[var(--color-ink-dim)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">{bot.majorFunction}</p>
              {bot.minorFunctions.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5 pt-1">
                  {bot.minorFunctions.map((fn) => (
                    <li key={fn} className="rounded bg-[var(--color-surface-raised)] px-2 py-0.5 text-[11px] text-[var(--color-ink-muted)]">
                      {fn}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-col gap-2.5 border-t border-[var(--color-border)] pt-3">
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {bot.computerUse ? (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[var(--color-accent)]">
                    <Monitor size={11} /> Computer Use
                  </span>
                ) : null}
                {bot.screenDrawing ? (
                  <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[var(--color-ink-muted)]">
                    Screen Drawing
                  </span>
                ) : null}
                {bot.terminalAccess ? (
                  <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[var(--color-ink-muted)]">
                    Terminal
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[var(--color-ink-dim)]">
                  <Cpu size={10} /> {bot.model}
                </span>
                <span className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[var(--color-ink-dim)]">
                  <Clock size={10} /> {bot.schedule}
                </span>
              </div>
              {onLaunchBot ? (
                <button
                  type="button"
                  onClick={() => onLaunchBot(bot)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-hover)]"
                >
                  <Play size={12} /> Run Bot in Chat
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
