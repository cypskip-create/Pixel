import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { InteractiveTerminalView } from '@/components/InteractiveTerminalView';

export interface WorkspaceFsNode {
  name: string;
  relativePath: string;
  kind: 'dir' | 'file';
  sizeBytes: number;
  modifiedAt: number;
}

export interface LiveTerminalSession {
  id: string;
  command: string;
  cwd: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  pid: number | null;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  output: string;
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
  /** Real path-jailed project filesystem listing & reading. */
  onListFsDir?: (relativePath?: string) => Promise<{ ok: boolean; entries: WorkspaceFsNode[]; error?: string }>;
  onReadFsFile?: (relativePath: string) => Promise<{ ok: boolean; relativePath: string; content?: string; truncated?: boolean; binary?: boolean; error?: string }>;
  /** Real backend terminal execution (stdout/stderr streaming, exit codes, cancel). */
  terminalSessions?: LiveTerminalSession[];
  onRunTerminalCommand: (command: string) => Promise<string | void>;
  onCancelTerminalSession?: (sessionId: string) => void;
  onStopTerminal: () => void;
  terminalBusy: boolean;
  tasks: TaskRecord[];
  audit: AuditEntry[];
}

interface OpenPreviewTab {
  key: string;
  documentId?: string;
  title: string;
  path: string;
  content: string;
  truncated?: boolean;
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
  onListFsDir,
  onReadFsFile,
  terminalSessions = [],
  tasks,
  audit,
}: WorkspaceRightRailProps): React.JSX.Element {
  const [fileQuery, setFileQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [fsChildren, setFsChildren] = useState<Record<string, WorkspaceFsNode[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [fsError, setFsError] = useState<string | null>(null);
  const [fsLoading, setFsLoading] = useState(false);

  const [previews, setPreviews] = useState<OpenPreviewTab[]>([]);
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);

  const loadFsDirectory = useCallback(
    async (relPath = ''): Promise<void> => {
      if (!onListFsDir) return;
      if (!relPath) setFsLoading(true);
      try {
        const res = await onListFsDir(relPath);
        if (res.ok) {
          setFsError(null);
          setFsChildren((prev) => ({ ...prev, [relPath]: res.entries }));
        } else {
          setFsError(res.error ?? 'Could not list workspace directory.');
        }
      } catch (err) {
        setFsError(err instanceof Error ? err.message : 'Could not list workspace directory.');
      } finally {
        if (!relPath) setFsLoading(false);
      }
    },
    [onListFsDir],
  );

  useEffect(() => {
    if (activeTab === 'files' && onListFsDir && !fsChildren['']) {
      void loadFsDirectory('');
    }
  }, [activeTab, fsChildren, loadFsDirectory, onListFsDir]);

  const toggleFsDir = useCallback(
    (relPath: string): void => {
      setExpandedDirs((prev) => {
        const nextOpen = !prev[relPath];
        if (nextOpen && !fsChildren[relPath]) {
          void loadFsDirectory(relPath);
        }
        return { ...prev, [relPath]: nextOpen };
      });
    },
    [fsChildren, loadFsDirectory],
  );

  const openFsFilePreview = useCallback(
    async (node: WorkspaceFsNode): Promise<void> => {
      if (!onReadFsFile) return;
      const key = `fs:${node.relativePath}`;
      setActivePreviewKey(key);
      onSelectTab('preview');
      setPreviews((prev) => {
        if (prev.some((p) => p.key === key)) {
          return prev.map((p) => (p.key === key ? { ...p, loading: true, error: undefined } : p));
        }
        return [
          ...prev.slice(-7),
          { key, title: node.name, path: node.relativePath, content: '', loading: true },
        ];
      });
      try {
        const res = await onReadFsFile(node.relativePath);
        setPreviews((prev) =>
          prev.map((p) =>
            p.key === key
              ? {
                  ...p,
                  loading: false,
                  content: res.ok ? (res.content ?? '') : '',
                  truncated: res.truncated,
                  error: res.ok ? undefined : (res.error ?? 'Could not preview file.'),
                }
              : p,
          ),
        );
      } catch (err) {
        setPreviews((prev) =>
          prev.map((p) =>
            p.key === key
              ? { ...p, loading: false, error: err instanceof Error ? err.message : 'Preview failed.' }
              : p,
          ),
        );
      }
    },
    [onReadFsFile, onSelectTab],
  );

  const folderGroups = useMemo(
    () => groupDocumentsByFolder(documents, fileQuery),
    [documents, fileQuery],
  );

  const openDocumentPreview = useCallback(
    async (doc: DocumentLibraryItem): Promise<void> => {
      const key = `doc:${doc.id}`;
      setActivePreviewKey(key);
      onSelectTab('preview');
      setPreviews((prev) => {
        if (prev.some((p) => p.key === key)) {
          return prev.map((p) => (p.key === key ? { ...p, loading: true, error: undefined } : p));
        }
        return [
          ...prev.slice(-7),
          { key, documentId: doc.id, title: doc.title || doc.fileName, path: doc.fileName, content: '', loading: true },
        ];
      });
      try {
        const read = await onReadDocument(doc.id);
        setPreviews((prev) =>
          prev.map((p) =>
            p.key === key
              ? read
                ? { ...p, loading: false, content: read.passages.map((c) => c.content).join('\n\n') }
                : { ...p, loading: false, error: 'Document could not be loaded.' }
              : p,
          ),
        );
      } catch (err) {
        setPreviews((prev) =>
          prev.map((p) =>
            p.key === key
              ? { ...p, loading: false, error: err instanceof Error ? err.message : 'Preview failed.' }
              : p,
          ),
        );
      }
    },
    [onReadDocument, onSelectTab],
  );

  const closePreviewTab = useCallback(
    (key: string): void => {
      setPreviews((prev) => {
        const next = prev.filter((p) => p.key !== key);
        if (activePreviewKey === key) {
          setActivePreviewKey(next[next.length - 1]?.key ?? null);
        }
        return next;
      });
    },
    [activePreviewKey],
  );

  const activePreview = previews.find((p) => p.key === activePreviewKey) ?? previews[0] ?? null;

  const renderFsNodes = (relPath: string, depth: number): React.JSX.Element[] => {
    const nodes = fsChildren[relPath] ?? [];
    const q = fileQuery.trim().toLowerCase();
    const visible = q ? nodes.filter((n) => n.name.toLowerCase().includes(q) || n.relativePath.toLowerCase().includes(q)) : nodes;
    const rows: React.JSX.Element[] = [];
    for (const node of visible) {
      const pad = { paddingLeft: `${8 + depth * 14}px` };
      if (node.kind === 'dir') {
        const open = expandedDirs[node.relativePath] === true;
        rows.push(
          <button
            key={node.relativePath}
            type="button"
            className="workspace-file-folder"
            style={pad}
            aria-expanded={open}
            onClick={() => toggleFsDir(node.relativePath)}
          >
            {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            {open ? <FolderOpen size={12} aria-hidden="true" /> : <Folder size={12} aria-hidden="true" />}
            <span className="truncate">{node.name}</span>
          </button>,
        );
        if (open) rows.push(...renderFsNodes(node.relativePath, depth + 1));
      } else {
        rows.push(
          <button
            key={node.relativePath}
            type="button"
            role="treeitem"
            className={`workspace-file-row ${activePreviewKey === `fs:${node.relativePath}` ? 'is-selected' : ''}`}
            style={pad}
            onClick={() => void openFsFilePreview(node)}
            title={node.relativePath}
          >
            {isCodeFile(node.name) ? <FileCode2 size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
            <span className="truncate">{node.name}</span>
          </button>,
        );
      }
    }
    return rows;
  };

  const runningTermSession = terminalSessions.find((s) => s.status === 'running') ?? null;

  return (
    <aside className="workspace-right-rail" style={{ width: `${width}px` }} aria-label="Workspace tools rail">
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
                    ? `Terminal${runningTermSession ? ' ●' : ''}`
                    : 'Context'}
            </button>
          ))}
        </div>
        <button type="button" className="workspace-rail-close" onClick={onClose} aria-label="Close right panel">
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
            <button type="button" className="workspace-rail-icon-btn" onClick={onIndexFolder} title="Index folder into Library" aria-label="Index folder">
              <FolderPlus size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-rail-icon-btn"
              onClick={() => {
                void loadFsDirectory('');
                onRefreshDocuments();
              }}
              title="Refresh file tree"
              aria-label="Refresh files"
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>

          <div className="workspace-file-tree" role="tree" aria-label="Project file tree">
            {onListFsDir ? (
              <div className="workspace-file-group">
                <div className="workspace-palette-group-title">Workspace Filesystem</div>
                {fsLoading ? (
                  <p className="workspace-rail-empty">Scanning workspace root…</p>
                ) : fsError ? (
                  <p className="workspace-rail-empty">{fsError}</p>
                ) : (fsChildren['']?.length ?? 0) === 0 ? (
                  <p className="workspace-rail-empty">Workspace root is empty.</p>
                ) : (
                  renderFsNodes('', 0)
                )}
              </div>
            ) : null}

            {documentsLoading ? (
              <p className="workspace-rail-empty">Loading indexed documents…</p>
            ) : folderGroups.length > 0 ? (
              <div className="workspace-file-group">
                <div className="workspace-palette-group-title">Indexed Library</div>
                {folderGroups.map((group) => {
                  const collapsed = collapsedFolders[group.folder] === true;
                  return (
                    <div key={group.folder}>
                      <button
                        type="button"
                        className="workspace-file-folder"
                        aria-expanded={!collapsed}
                        onClick={() => setCollapsedFolders((prev) => ({ ...prev, [group.folder]: !collapsed }))}
                      >
                        {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                        {collapsed ? <Folder size={12} aria-hidden="true" /> : <FolderOpen size={12} aria-hidden="true" />}
                        <span className="truncate">{group.folder}</span>
                        <span className="workspace-file-count">{group.items.length}</span>
                      </button>
                      {!collapsed
                        ? group.items.map((doc) => (
                            <button
                              key={doc.id}
                              type="button"
                              role="treeitem"
                              className={`workspace-file-row ${activePreviewKey === `doc:${doc.id}` ? 'is-selected' : ''}`}
                              onClick={() => void openDocumentPreview(doc)}
                              title={doc.fileName}
                            >
                              {isCodeFile(doc.fileName) ? <FileCode2 size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
                              <span className="truncate">{doc.fileName}</span>
                            </button>
                          ))
                        : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'preview' ? (
        <div className="workspace-rail-body">
          {previews.length > 0 ? (
            <div className="workspace-preview-tabs">
              {previews.map((p) => (
                <div
                  key={p.key}
                  className={`workspace-preview-tab ${activePreview?.key === p.key ? 'is-active' : ''}`}
                  onClick={() => setActivePreviewKey(p.key)}
                >
                  <span className="truncate">{p.title}</span>
                  <button
                    type="button"
                    aria-label={`Close preview ${p.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closePreviewTab(p.key);
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
              <p>Select any project file from the Files tab to inspect it here.</p>
            </div>
          ) : (
            <div className="workspace-preview-content">
              <div className="workspace-preview-meta">
                <span className="truncate" title={activePreview.path}>
                  {activePreview.path}
                  {activePreview.truncated ? ' (truncated at 128 KB)' : ''}
                </span>
                {activePreview.documentId ? (
                  <button
                    type="button"
                    className="workspace-rail-icon-btn"
                    onClick={() => void onOpenExternal(activePreview.documentId!)}
                    title="Open externally"
                    aria-label="Open file externally"
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {activePreview.loading ? (
                <p className="workspace-rail-empty">Reading file…</p>
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
        <div className="workspace-rail-body flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <InteractiveTerminalView />
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
