import { useMemo, useState } from 'react';
import { ArrowLeft, FileText, FolderOpen, MoreHorizontal, RefreshCw, Search } from 'lucide-react';
import type { DocumentLibraryIndexResult, DocumentLibraryItem, DocumentLibraryOpenResult, DocumentLibraryRead } from '@shared/types';

const OPENABLE_LIBRARY_KINDS = new Set([
  'pdf', 'docx', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'markdown', 'json', 'xml',
  'yaml', 'yml', 'log', 'ini', 'conf', 'rst',
]);

interface WorkspaceLibraryProps {
  documents: DocumentLibraryItem[];
  loading: boolean;
  onRefresh: () => void;
  onIndexFolder: () => Promise<DocumentLibraryIndexResult>;
  onRead: (documentId: string, startChunk: number) => Promise<DocumentLibraryRead | null>;
  onOpen: (documentId: string) => Promise<DocumentLibraryOpenResult>;
  onOpenFolder: (folderId: string) => Promise<DocumentLibraryOpenResult>;
}

function formatBytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function formatDate(value: number): string {
  return Number.isFinite(value) ? new Date(value).toLocaleDateString() : 'Unknown date';
}

export function WorkspaceLibrary({ documents, loading, onRefresh, onIndexFolder, onRead, onOpen, onOpenFolder }: WorkspaceLibraryProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentLibraryRead | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openResult, setOpenResult] = useState<DocumentLibraryOpenResult | null>(null);
  const [folderResult, setFolderResult] = useState<{ folderId: string; result: DocumentLibraryOpenResult } | null>(null);
  const [openingFolderId, setOpeningFolderId] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexMessage, setIndexMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folders = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; documents: DocumentLibraryItem[] }>();
    for (const document of documents) {
      const folder = grouped.get(document.folderId) ?? { id: document.folderId, name: document.folderName, documents: [] };
      folder.documents.push(document);
      grouped.set(folder.id, folder);
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [documents]);
  const kinds = useMemo(() => [...new Set(documents.map((document) => document.kind.toLocaleLowerCase()))].sort(), [documents]);
  const matchingDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return documents.filter((document) =>
      (!needle || `${document.fileName} ${document.title} ${document.folderName} ${document.kind}`.toLocaleLowerCase().includes(needle))
      && (!kindFilter || document.kind.toLocaleLowerCase() === kindFilter),
    );
  }, [documents, kindFilter, query]);
  const matchingDocumentIds = new Set(matchingDocuments.map((document) => document.id));
  const visibleFolders = folders.filter((folder) => folder.documents.some((document) => matchingDocumentIds.has(document.id)));
  const selectedFolder = folders.find((folder) => folder.id === activeFolder) ?? null;
  const visibleFiles = selectedFolder
    ? matchingDocuments.filter((document) => document.folderId === selectedFolder.id)
    : matchingDocuments;

  const openPreview = async (documentId: string, startChunk = 0): Promise<void> => {
    setPreviewLoading(true);
    setError(null);
    setOpenResult(null);
    try {
      const next = await onRead(documentId, startChunk);
      if (!next) {
        setError('That document is no longer available in this project. Refresh the Library.');
        setPreview(null);
        setPreviewId(null);
      } else if (next.state !== 'ready') {
        setError(next.state === 'stale'
          ? 'The source file changed after indexing. Ask Pixel to re-index its approved folder before previewing it.'
          : 'The source file is no longer available as the same regular file. Re-index its approved folder before previewing it.');
        setPreview(next);
        setPreviewId(documentId);
      } else {
        setPreview((current) => startChunk === 0 ? next : current ? { ...next, passages: [...current.passages, ...next.passages] } : next);
        setPreviewId(documentId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pixel could not read this indexed document.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const openOriginal = async (documentId: string): Promise<void> => {
    setOpeningId(documentId);
    setOpenResult(null);
    setError(null);
    try {
      const result = await onOpen(documentId);
      setOpenResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pixel could not open this Library document.');
    } finally {
      setOpeningId(null);
    }
  };

  const openFolderLocation = async (folderId: string): Promise<void> => {
    setOpeningFolderId(folderId);
    setFolderResult(null);
    try {
      setFolderResult({ folderId, result: await onOpenFolder(folderId) });
    } catch (cause) {
      setFolderResult({ folderId, result: { ok: false, content: cause instanceof Error ? cause.message : 'Pixel could not open this indexed folder.' } });
    } finally {
      setOpeningFolderId(null);
    }
  };

  const indexFolder = async (): Promise<void> => {
    setIndexing(true);
    setIndexMessage(null);
    try {
      const result = await onIndexFolder();
      if (!result.cancelled) setIndexMessage(result.content);
    } catch (cause) {
      setIndexMessage(cause instanceof Error ? cause.message : 'Pixel could not index that folder.');
    } finally {
      setIndexing(false);
    }
  };

  return <section className="workspace-page workspace-library-page" aria-label="Project document library">
    <div className="workspace-page-heading">
      <div>
        <div className="workspace-eyebrow">Current project</div>
        <h1>{selectedFolder ? selectedFolder.name : 'Library'}</h1>
        <p>{selectedFolder ? `${visibleFiles.length} indexed file${visibleFiles.length === 1 ? '' : 's'} in this folder.` : 'Browse project documents Pixel has indexed with your approval.'}</p>
      </div>
      <div className="workspace-library-actions">
        <button type="button" className="workspace-library-add" onClick={() => void indexFolder()} disabled={indexing}>
          <FolderOpen size={14} aria-hidden="true" />{indexing ? 'Indexing folder…' : 'Add folder'}
        </button>
        <button type="button" className="workspace-library-refresh" onClick={onRefresh} disabled={loading || indexing} aria-label="Refresh library" title="Refresh library">
          <RefreshCw size={14} aria-hidden="true" />{loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>

    <div className="workspace-library-toolbar">
      {selectedFolder ? <button type="button" className="workspace-library-back" onClick={() => { setActiveFolder(null); setPreview(null); setPreviewId(null); }}><ArrowLeft size={14} aria-hidden="true" />All folders</button> : null}
      <label className="workspace-project-search workspace-library-search">
        <Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search indexed files and folders" aria-label="Search library" />
      </label>
      {documents.length > 0 ? <label className="workspace-library-type-filter">Type<select value={kindFilter} onChange={(event) => setKindFilter(event.currentTarget.value)} aria-label="Filter by file type"><option value="">All types</option>{kinds.map((kind) => <option key={kind} value={kind}>{kind.toUpperCase()}</option>)}</select></label> : null}
    </div>

    {error ? <div className="workspace-library-error" role="status">{error}</div> : null}
    {indexMessage ? <div className="workspace-library-result" role="status">{indexMessage}</div> : null}
    {folderResult ? <div className={`workspace-library-result${folderResult.result.ok ? '' : ' is-error'}`} role="status">{folderResult.result.content}</div> : null}
    {loading && documents.length === 0 ? <div className="workspace-library-empty" role="status">Loading this project's indexed documents…</div> : null}
    {!loading && documents.length === 0 ? <div className="workspace-library-empty">
      <FolderOpen size={22} aria-hidden="true" />
      <strong>No indexed documents yet</strong>
      <span>Choose a folder to index into this project, then browse its supported documents here.</span>
    </div> : null}

    {!selectedFolder && documents.length > 0 ? <div className="workspace-library-folders" aria-label="Indexed folders">
      {visibleFolders.map((folder) => <div key={folder.id} className="workspace-library-folder-item">
        <button type="button" className="workspace-library-folder" onClick={() => { setActiveFolder(folder.id); setPreview(null); setPreviewId(null); setFolderResult(null); }}>
          <span className="workspace-folder-art"><FolderOpen size={23} aria-hidden="true" /></span>
          <span className="workspace-library-folder-copy"><strong>{folder.name}</strong><small>{folder.documents.length} indexed file{folder.documents.length === 1 ? '' : 's'}</small></span>
          <span className="workspace-library-folder-count">{folder.documents.reduce((sum, item) => sum + item.chunks, 0)} passages</span>
        </button>
        <details className="workspace-library-folder-menu">
          <summary aria-label={`Actions for ${folder.name}`} title={`Actions for ${folder.name}`}><MoreHorizontal size={15} aria-hidden="true" /></summary>
          <div className="workspace-library-folder-menu-popover"><button type="button" disabled={openingFolderId !== null} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void openFolderLocation(folder.id); }}>{openingFolderId === folder.id ? 'Opening…' : 'Open in File Explorer'}</button></div>
        </details>
      </div>)}
      {visibleFolders.length === 0 ? <div className="workspace-library-empty"><strong>No matching folders</strong><span>Try a different search.</span></div> : null}
    </div> : null}

    {(selectedFolder || query.trim() || kindFilter) && documents.length > 0 ? <div className="workspace-library-content">
      <div className="workspace-library-table" role="table" aria-label="Indexed documents">
        <div className="workspace-library-table-head" role="row"><span role="columnheader">Name</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Indexed</span><span role="columnheader">Passages</span></div>
        {visibleFiles.map((document) => <button key={document.id} type="button" role="row" className={`workspace-library-row${previewId === document.id ? ' is-selected' : ''}`} onClick={() => void openPreview(document.id)}>
          <span role="cell" className="workspace-library-name"><FileText size={15} aria-hidden="true" /><span><strong>{document.fileName}</strong><small>{selectedFolder ? document.title : document.folderName}</small></span></span>
          <span role="cell">{document.kind.toUpperCase()}</span><span role="cell">{formatBytes(document.sizeBytes)}</span><span role="cell">{formatDate(document.indexedAt)}</span><span role="cell">{document.chunks}</span>
        </button>)}
        {visibleFiles.length === 0 ? <div className="workspace-library-empty"><strong>No matching files</strong><span>Try a different search.</span></div> : null}
      </div>

      {preview ? <section className="workspace-library-preview" aria-label={`Document preview: ${preview.title}`}>
      <div className="workspace-library-preview-head"><div><div className="workspace-eyebrow">Indexed preview · untrusted document content</div><h2>{preview.title}</h2></div><div className="workspace-library-preview-actions"><span>{preview.state === 'ready' ? 'Source verified' : 'Source unavailable'}</span>{preview.state === 'ready' && previewId && OPENABLE_LIBRARY_KINDS.has(preview.kind.toLocaleLowerCase()) ? <button type="button" className="workspace-library-open" disabled={openingId !== null} onClick={() => void openOriginal(previewId)}>{openingId === previewId ? 'Opening…' : 'Open original'}</button> : null}</div></div>
        {openResult ? <div className={`workspace-library-result${openResult.ok ? '' : ' is-error'}`} role="status">{openResult.content}</div> : null}
        {preview.state === 'ready' ? <div className="workspace-library-passages">{preview.passages.map((passage) => <article key={passage.ordinal}><h3>Passage {passage.ordinal + 1}{passage.location ? ` · ${passage.location}` : ''}</h3><pre>{passage.content}</pre></article>)}</div> : null}
        {preview.state === 'ready' && preview.hasMore ? <button type="button" className="workspace-library-load-more" disabled={previewLoading} onClick={() => void openPreview(previewId ?? '', preview.startChunk + preview.passages.length)}>{previewLoading ? 'Loading…' : 'Load next passages'}</button> : null}
      </section> : null}
    </div> : null}
  </section>;
}
