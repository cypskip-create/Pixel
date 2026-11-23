import { useCallback, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  Square,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import type {
  AuditEntry,
  DocumentLibraryItem,
  DocumentLibraryRead,
  TaskRecord,
} from '@shared/types';
import type { RightRailTab } from '@/lib/workspaceLayout';
import { MarkdownMessage } from '@/components/MarkdownMessage';

export interface TerminalLogEntry {
  id: string;
  command: string;
  output: string;
  status: 'running' | 'done' | 'error';
  timestamp: number;
}

export interface WorkspaceRightRailProps {
  activeTab: RightRailTab;
  width: number;
  projectName: string;
  documents: DocumentLibraryItem[];
  documentsLoading: boolean;
  onSelectTab: (tab: RightRailTab) => void;
  onClose: () => void;
  onRefreshDocuments: () => void;
  onIndexFolder: () => void;
  onReadDocument: (documentId: string) => Promise<DocumentLibraryRead | null>;
  onOpenExternal: (documentId: string) => Promise<void>;
  /** Safe permission-gated terminal command dispatch (runs through Pixel's authorized agent/executor, never direct renderer exec). */
  onRunTerminalCommand: (command: string) => Promise<string>;
  onStopTerminal: () => void;
  terminalBusy: boolean;
  tasks: TaskRecord[];
  audit: AuditEntry[];
}

interface OpenPreviewTab {
  documentId: string;
  title: string;
  path: string;
  content: string;
  chunkCount: number;
  loading: boolean;
  error?: string;
}

function isMarkdownFile(name: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(name);
}

function isCodeFile(name: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|json|css|html|yml|yaml|toml|sh|ps1|cs|rs|go|sql)$/i.test(name);
}

export function groupDocumentsByFolder(
  docs: DocumentLibraryItem[],
  query: string,
): Array<{ folder: string; items: DocumentLibraryItem[] }> {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? docs.filter(
        (d) =>
          d.fileName.toLowerCase().includes(q) ||
          d.title.toLowerCase().includes(q) ||
          d.folderName.toLowerCase().includes(q),
      )
    : docs;

  const byFolder = new Map<string, DocumentLibraryItem[]>();
  for (const item of filtered.slice(0, 250)) {
    const key = item.folderName || 'Workspace';
    const list = byFolder.get(key) ?? [];
    list.push(item);
    byFolder.set(key, list);
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, items]) => ({
      folder,
      items: items.sort((a, b) => a.fileName.localeCompare(b.fileName)),
    }));
}

export function WorkspaceRightRail({
  activeTab,
  width,
  projectName,
  documents,
  documentsLoading,
  onSelectTab,
  onClose,
  onRefreshDocuments,
  onIndexFolder,
  onReadDocument,
  onOpenExternal,
  onRunTerminalCommand,
  onStopTerminal,
  terminalBusy,
  tasks,
  audit,
}: WorkspaceRightRailProps): React.JSX.Element {
  const [fileQuery, setFileQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [previews, setPreviews] = useState<OpenPreviewTab[]>([]);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);

  const [termCommand, setTermCommand] = useState('');
  const [termLogs, setTermLogs] = useState<TerminalLogEntry[]>([]);

  const folderGroups = useMemo(
    () => groupDocumentsByFolder(documents, fileQuery),
    [documents, fileQuery],
  );

  const openFilePreview = useCallback(
    async (doc: DocumentLibraryItem): Promise<void> => {
      setActivePreviewId(doc.id);
      onSelectTab('preview');
      setPreviews((prev) => {
        const exists = prev.some((p) => p.documentId === doc.id);
        if (exists) {
          return prev.map((p) => (p.documentId === doc.id ? { ...p, loading: true, error: undefined } : p));
        }
        return [
          ...prev.slice(-7),
          {
            documentId: doc.id,
            title: doc.title || doc.fileName,
            path: doc.fileName,
            content: '',
            chunkCount: 0,
            loading: true,
          },
        ];
      });
      try {
        const read = await onReadDocument(doc.id);
        if (!read) {
          setPreviews((prev) =>
            prev.map((p) =>
              p.documentId === doc.id ? { ...p, loading: false, error: 'Document could not be loaded.' } : p,
            ),
          );
          return;
        }
        setPreviews((prev) =>
          prev.map((p) =>
            p.documentId === doc.id
              ? {
                  ...p,
                  loading: false,
                  content: read.passages.map((c) => c.content).join('\n\n'),
                  chunkCount: read.chunkCount,
                }
              : p,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Preview failed.';
        setPreviews((prev) =>
          prev.map((p) => (p.documentId === doc.id ? { ...p, loading: false, error: message } : p)),
        );
      }
    },
    [onReadDocument, onSelectTab],
  );

  const closePreviewTab = useCallback(
    (docId: string): void => {
      setPreviews((prev) => {
        const next = prev.filter((p) => p.documentId !== docId);
        if (activePreviewId === docId) {
          setActivePreviewId(next[next.length - 1]?.documentId ?? null);
        }
        return next;
      });
    },
    [activePreviewId],
  );

  const activePreview = previews.find((p) => p.documentId === activePreviewId) ?? previews[0] ?? null;

  const submitTerminal = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const cmd = termCommand.trim();
    if (!cmd || terminalBusy) return;
    const entryId = `term_${Date.now().toString(36)}`;
    setTermCommand('');
    setTermLogs((prev) => [
      ...prev.slice(-24),
      { id: entryId, command: cmd, output: 'Dispatching through Pixel PermissionBroker…', status: 'running', timestamp: Date.now() },
    ]);
    try {
      const output = await onRunTerminalCommand(cmd);
      setTermLogs((prev) =>
        prev.map((item) => (item.id === entryId ? { ...item, output, status: 'done' } : item)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Command failed.';
      setTermLogs((prev) =>
        prev.map((item) => (item.id === entryId ? { ...item, output: msg, status: 'error' } : item)),
      );
    }
  };

  return (
    <aside
      className="workspace-right-rail"
      style={{ width: `${width}px` }}
      aria-label="Workspace tools rail"
    >
      <div className="workspace-right-rail-header">
        <div className="workspace-right-rail-tabs" role="tablist" aria-label="Right rail sections">
          {(['files', 'preview', 'terminal', 'context'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`workspace-rail-tab ${activeTab === tab ? 'is-active' : ''}`}
              onClick={() => onSelectTab(tab)}
            >
              {tab === 'files'
                ? 'Files'
                : tab === 'preview'
                  ? `Preview${previews.length > 0 ? ` (${previews.length})` : ''}`
                  : tab === 'terminal'
                    ? 'Terminal'
                    : 'Context'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="workspace-rail-close"
          onClick={onClose}
          aria-label="Close right panel"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      {activeTab === 'files' ? (
        <div className="workspace-rail-body">
          <div className="workspace-rail-toolbar">
            <div className="workspace-rail-search">
              <Search size={12} aria-hidden="true" />
              <input
                type="text"
                aria-label="Filter project files"
                placeholder={`Filter ${projectName} files…`}
                value={fileQuery}
                onChange={(e) => setFileQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="workspace-rail-icon-btn"
              onClick={onIndexFolder}
              title="Authorize & index folder"
              aria-label="Index folder"
            >
              <FolderPlus size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-rail-icon-btn"
              onClick={onRefreshDocuments}
              title="Refresh file tree"
              aria-label="Refresh files"
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>

          <div className="workspace-file-tree" role="tree" aria-label="Project file tree">
            {documentsLoading ? (
              <p className="workspace-rail-empty">Loading project files…</p>
            ) : folderGroups.length === 0 ? (
              <div className="workspace-rail-empty">
                <p>No authorized project files indexed yet.</p>
                <button type="button" className="workspace-rail-cta" onClick={onIndexFolder}>
                  <FolderPlus size={12} aria-hidden="true" />
                  Index a project folder
                </button>
              </div>
            ) : (
              folderGroups.map((group) => {
                const collapsed = collapsedFolders[group.folder] === true;
                return (
                  <div key={group.folder} className="workspace-file-group">
                    <button
                      type="button"
                      className="workspace-file-folder"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setCollapsedFolders((prev) => ({ ...prev, [group.folder]: !collapsed }))
                      }
                    >
                      {collapsed ? (
                        <ChevronRight size={12} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={12} aria-hidden="true" />
                      )}
                      {collapsed ? (
                        <Folder size={12} aria-hidden="true" />
                      ) : (
                        <FolderOpen size={12} aria-hidden="true" />
                      )}
                      <span className="truncate">{group.folder}</span>
                      <span className="workspace-file-count">{group.items.length}</span>
                    </button>
                    {!collapsed ? (
                      <div className="workspace-file-children">
                        {group.items.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            role="treeitem"
                            className={`workspace-file-row ${activePreviewId === doc.id ? 'is-selected' : ''}`}
                            onClick={() => void openFilePreview(doc)}
                            title={doc.fileName}
                          >
                            {isCodeFile(doc.fileName) ? (
                              <FileCode2 size={12} aria-hidden="true" />
                            ) : (
                              <FileText size={12} aria-hidden="true" />
                            )}
                            <span className="truncate">{doc.fileName}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {activeTab === 'preview' ? (
        <div className="workspace-rail-body">
          {previews.length > 0 ? (
            <div className="workspace-preview-tabs">
              {previews.map((p) => (
                <div
                  key={p.documentId}
                  className={`workspace-preview-tab ${activePreview?.documentId === p.documentId ? 'is-active' : ''}`}
                  onClick={() => setActivePreviewId(p.documentId)}
                >
                  <span className="truncate">{p.title}</span>
                  <button
                    type="button"
                    aria-label={`Close preview ${p.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closePreviewTab(p.documentId);
                    }}
                  >
                    <X size={10} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {!activePreview ? (
            <div className="workspace-rail-empty">
              <p>Select any file from the Files tab to inspect it here.</p>
            </div>
          ) : (
            <div className="workspace-preview-content">
              <div className="workspace-preview-meta">
                <span className="truncate" title={activePreview.path}>
                  {activePreview.path}
                </span>
                <button
                  type="button"
                  className="workspace-rail-icon-btn"
                  onClick={() => void onOpenExternal(activePreview.documentId)}
                  title="Open externally"
                  aria-label="Open file externally"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                </button>
              </div>
              {activePreview.loading ? (
                <p className="workspace-rail-empty">Reading document…</p>
              ) : activePreview.error ? (
                <p className="workspace-rail-empty">{activePreview.error}</p>
              ) : isMarkdownFile(activePreview.title) ? (
                <div className="workspace-preview-md">
                  <MarkdownMessage text={activePreview.content} />
                </div>
              ) : (
                <pre className="workspace-preview-code">
                  <code>{activePreview.content}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'terminal' ? (
        <div className="workspace-rail-body workspace-terminal-pane">
          <div className="workspace-terminal-meta">
            <span className="inline-flex items-center gap-1.5">
              <TerminalIcon size={12} aria-hidden="true" />
              Project: <strong>{projectName}</strong>
            </span>
            <span className="workspace-terminal-badge">Permission-gated</span>
          </div>

          <div className="workspace-terminal-output" role="log" aria-label="Terminal output">
            {termLogs.length === 0 ? (
              <p className="workspace-rail-empty">
                Run project-scoped commands through Pixel&apos;s PermissionBroker. Every shell step is audited and requires approval when state-changing.
              </p>
            ) : (
              termLogs.map((entry) => (
                <div key={entry.id} className="workspace-terminal-entry">
                  <div className="workspace-terminal-cmd">$ {entry.command}</div>
                  <pre className={`workspace-terminal-res is-${entry.status}`}>{entry.output}</pre>
                </div>
              ))
            )}
          </div>

          <form className="workspace-terminal-form" onSubmit={(e) => void submitTerminal(e)}>
            <input
              type="text"
              aria-label="Terminal command"
              placeholder="Enter command (dispatched via PermissionBroker)…"
              value={termCommand}
              onChange={(e) => setTermCommand(e.target.value)}
              disabled={terminalBusy}
            />
            {terminalBusy ? (
              <button
                type="button"
                className="workspace-rail-icon-btn"
                onClick={onStopTerminal}
                aria-label="Stop running command"
                title="Stop"
              >
                <Square size={12} aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className="workspace-rail-cta" disabled={!termCommand.trim()}>
                Run
              </button>
            )}
          </form>
        </div>
      ) : null}

      {activeTab === 'context' ? (
        <div className="workspace-rail-body workspace-context-pane">
          <div className="workspace-context-section">
            <h4>Recent tasks ({tasks.length})</h4>
            {tasks.slice(0, 6).map((t) => (
              <div key={t.id} className="workspace-context-row">
                <span className="truncate">{t.title}</span>
                <span className="workspace-file-count">{t.status}</span>
              </div>
            ))}
          </div>
          <div className="workspace-context-section">
            <h4>Audit trail ({audit.length})</h4>
            {audit.slice(0, 8).map((a) => (
              <div key={a.id} className="workspace-context-row">
                <span className="truncate">{a.summary}</span>
                <span className="workspace-file-count">{a.outcome}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
