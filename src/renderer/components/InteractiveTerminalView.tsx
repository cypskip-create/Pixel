import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Play, Plus, RotateCcw, Square, Terminal as TerminalIcon } from 'lucide-react';
import { useBridge } from '@/hooks/useBridge';

interface TerminalLine {
  id: string;
  text: string;
  stream: 'stdout' | 'stderr' | 'command' | 'system';
}

/**
 * Real interactive PTY Terminal view for Pixel.
 * Commands typed here run directly inside the live shell session (`terminal.openShell` /
 * `terminal.write` / `terminal.run`), never routed through the chat workspace.
 */
export function InteractiveTerminalView(): React.JSX.Element {
  const bridgeStatus = useBridge();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string>('');
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: 'init', text: 'Pixel Interactive Terminal — commands run directly in your local shell.', stream: 'system' },
  ]);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [statusLabel, setStatusLabel] = useState<'connecting' | 'live' | 'exited' | 'offline'>('connecting');
  const outputEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const appendLine = useCallback((text: string, stream: TerminalLine['stream'] = 'stdout') => {
    if (!text) return;
    setLines((prev) => [
      ...prev.slice(-400),
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, stream },
    ]);
  }, []);

  const openLiveShell = useCallback(async () => {
    if (bridgeStatus.kind !== 'ready' || !bridgeStatus.bridge.terminal?.openShell) {
      setStatusLabel('offline');
      return;
    }
    setStatusLabel('connecting');
    try {
      const opened = await bridgeStatus.bridge.terminal.openShell('powershell');
      if (opened.ok && opened.session) {
        setSessionId(opened.session.id);
        setCwd(opened.session.cwd || '');
        setStatusLabel('live');
        appendLine(`Connected live shell (${opened.session.id.slice(0, 8)}) in ${opened.session.cwd || 'workspace'}`, 'system');
        if (opened.session.output) appendLine(opened.session.output, 'stdout');
      } else {
        setStatusLabel('exited');
        appendLine(`Shell fallback mode: ${opened.error ?? 'Unable to open PTY shell.'}`, 'stderr');
      }
    } catch (err) {
      setStatusLabel('exited');
      appendLine(`Shell fallback mode: ${err instanceof Error ? err.message : String(err)}`, 'stderr');
    }
  }, [bridgeStatus, appendLine]);

  useEffect(() => {
    void openLiveShell();
  }, [openLiveShell]);

  useEffect(() => {
    if (bridgeStatus.kind !== 'ready' || !bridgeStatus.bridge.terminal) return;
    const unsubOut = bridgeStatus.bridge.terminal.onOutput((evt) => {
      if (sessionId && evt.sessionId !== sessionId) return;
      appendLine(evt.chunk, 'stdout');
    });
    const unsubExit = bridgeStatus.bridge.terminal.onExit((evt) => {
      if (sessionId && evt.sessionId !== sessionId) return;
      setStatusLabel('exited');
      appendLine(`Process exited (code ${evt.exitCode ?? 0}). Click New Shell to restart.`, 'system');
    });
    return () => {
      unsubOut();
      unsubExit();
    };
  }, [bridgeStatus, sessionId, appendLine]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [lines]);

  const executeCommand = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 80));
    setHistoryIndex(-1);
    setCommand('');

    if (trimmed === 'clear' || trimmed === 'cls') {
      setLines([]);
      return;
    }

    appendLine(`${cwd ? `${cwd}> ` : '$ '}${trimmed}`, 'command');

    if (bridgeStatus.kind !== 'ready' || !bridgeStatus.bridge.terminal) {
      appendLine('Desktop terminal bridge is unavailable in browser preview.', 'stderr');
      return;
    }

    // Prefer writing directly into the live interactive PTY shell
    if (sessionId && statusLabel === 'live' && bridgeStatus.bridge.terminal.write) {
      try {
        await bridgeStatus.bridge.terminal.write(sessionId, `${trimmed}\r\n`);
        return;
      } catch {
        // Fall through to one-shot command run if PTY closed
      }
    }

    setRunning(true);
    try {
      const result = await bridgeStatus.bridge.terminal.run(trimmed, cwd || undefined);
      if (result.session?.output) appendLine(result.session.output, result.ok ? 'stdout' : 'stderr');
      if (result.error) appendLine(result.error, 'stderr');
    } catch (err) {
      appendLine(err instanceof Error ? err.message : 'Command failed.', 'stderr');
    } finally {
      setRunning(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void executeCommand(command);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault();
      const next = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(next);
      setCommand(history[next] ?? '');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(next >= 0 ? (history[next] ?? '') : '');
    } else if (event.key === 'c' && event.ctrlKey && sessionId && bridgeStatus.kind === 'ready' && bridgeStatus.bridge.terminal?.write) {
      event.preventDefault();
      void bridgeStatus.bridge.terminal.write(sessionId, '\x03');
      appendLine('^C', 'system');
    }
  };

  return (
    <section
      data-testid="interactive-terminal-view"
      className="flex h-full flex-col bg-[var(--color-canvas)] text-[var(--color-ink)]"
      onClick={() => inputRef.current?.focus()}
    >
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <TerminalIcon size={16} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold">Terminal</span>
          <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-ink-muted)]">
            {statusLabel === 'live' ? 'LIVE PTY' : statusLabel.toUpperCase()}
          </span>
          {cwd ? <span className="max-w-[360px] truncate font-mono text-[11px] text-[var(--color-ink-dim)]">{cwd}</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {sessionId && statusLabel === 'live' ? (
            <button
              type="button"
              onClick={() => {
                if (bridgeStatus.kind === 'ready' && bridgeStatus.bridge.terminal?.write) {
                  void bridgeStatus.bridge.terminal.write(sessionId, '\x03');
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)]"
            >
              <Square size={11} /> Ctrl+C
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setLines([])}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)]"
          >
            <RotateCcw size={12} /> Clear
          </button>
          <button
            type="button"
            onClick={() => void openLiveShell()}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus size={12} /> New Shell
          </button>
        </div>
      </header>

      <div className="selectable flex-1 overflow-y-auto p-4 font-mono text-xs leading-5">
        {lines.map((line) => (
          <pre
            key={line.id}
            className={
              line.stream === 'command'
                ? 'whitespace-pre-wrap break-words font-semibold text-[var(--color-accent)]'
                : line.stream === 'stderr'
                  ? 'whitespace-pre-wrap break-words text-[var(--color-ink)] opacity-90'
                  : line.stream === 'system'
                    ? 'whitespace-pre-wrap break-words text-[var(--color-ink-dim)]'
                    : 'whitespace-pre-wrap break-words text-[var(--color-ink)]'
            }
          >
            {line.text}
          </pre>
        ))}
        <div ref={outputEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5"
      >
        <span className="font-mono text-xs font-semibold text-[var(--color-accent)]">{'>'}</span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Terminal command input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder="Type a shell command (e.g. git status, npm test, python --version) and press Enter…"
          className="flex-1 bg-transparent font-mono text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-dim)]"
          autoFocus
        />
        <button
          type="submit"
          disabled={running || !command.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          <Play size={11} /> Run
        </button>
      </form>
    </section>
  );
}
