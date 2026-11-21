import { useMemo, useState } from 'react';
import { ArrowLeft, FileText, FolderOpen, RefreshCw, Search } from 'lucide-react';
import type { DocumentLibraryItem, DocumentLibraryRead } from '@shared/types';

interface WorkspaceLibraryProps {
  documents: DocumentLibraryItem[];
  loading: boolean;
  onRefresh: () => void;
  onRead: (documentId: string, startChunk: number) => Promise<DocumentLibraryRead | null>;
}

function formatBytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function formatDate(value: number): string {
  return Number.isFinite(value) ? new Date(value).toLocaleDateString() : 'Unknown date';
}

export function WorkspaceLibrary({ documents, loading, onRefresh, onRead }: WorkspaceLibraryProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentLibraryRead | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
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
  const matchingDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return documents.filter((document) => !needle || `${document.fileName} ${document.title} ${document.folderName} ${document.kind}`.toLocaleLowerCase().includes(needle));
  }, [documents, query]);
  const visibleFolders = folders.filter((folder) =>
    !query.trim() || folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      || folder.documents.some((document) => matchingDocuments.includes(document)),
  );
  const selectedFolder = folders.find((folder) => folder.id === activeFolder) ?? null;
  const visibleFiles = selectedFolder
    ? matchingDocuments.filter((document) => document.folderId === selectedFolder.id)
    : matchingDocuments;

  const openPreview = async (documentId: string, startChunk = 0): Promise<void> => {
    setPreviewLoading(true);
    setError(null);
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

  return <section className="workspace-page workspace-library-page" aria-label="Project document library">
    <div className="workspace-page-heading">
      <div>
        <div className="workspace-eyebrow">Current project</div>
        <h1>{selectedFolder ? selectedFolder.name : 'Library'}</h1>
        <p>{selectedFolder ? `${visibleFiles.length} indexed file${visibleFiles.length === 1 ? '' : 's'} in this folder.` : 'Browse project documents Pixel has indexed with your approval.'}</p>
      </div>
      <button type="button" className="workspace-library-refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh library" title="Refresh library">
        <RefreshCw size={14} aria-hidden="true" />{loading ? 'Refreshing' : 'Refresh'}
      </button>
    </div>

    <div className="workspace-library-toolbar">
      {selectedFolder ? <button type="button" className="workspace-library-back" onClick={() => { setActiveFolder(null); setPreview(null); setPreviewId(null); }}><ArrowLeft size={14} aria-hidden="true" />All folders</button> : null}
      <label className="workspace-project-search workspace-library-search">
        <Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search indexed files and folders" aria-label="Search library" />
      </label>
    </div>

    {error ? <div className="workspace-library-error" role="status">{error}</div> : null}
    {loading && documents.length === 0 ? <div className="workspace-library-empty" role="status">Loading this project's indexed documents…</div> : null}
    {!loading && documents.length === 0 ? <div className="workspace-library-empty">
      <FolderOpen size={22} aria-hidden="true" />
      <strong>No indexed documents yet</strong>
      <span>Ask Pixel to index a folder you choose, then refresh this Library to browse its files.</span>
    </div> : null}

    {!selectedFolder && documents.length > 0 ? <div className="workspace-library-folders" aria-label="Indexed folders">
      {visibleFolders.map((folder) => <button key={folder.id} type="button" className="workspace-library-folder" onClick={() => { setActiveFolder(folder.id); setPreview(null); setPreviewId(null); }}>
        <span className="workspace-folder-art"><FolderOpen size={23} aria-hidden="true" /></span>
        <span className="workspace-library-folder-copy"><strong>{folder.name}</strong><small>{folder.documents.length} indexed file{folder.documents.length === 1 ? '' : 's'}</small></span>
        <span className="workspace-library-folder-count">{folder.documents.reduce((sum, item) => sum + item.chunks, 0)} passages</span>
      </button>)}
      {visibleFolders.length === 0 ? <div className="workspace-library-empty"><strong>No matching folders</strong><span>Try a different search.</span></div> : null}
    </div> : null}

    {(selectedFolder || query.trim()) && documents.length > 0 ? <div className="workspace-library-content">
      <div className="workspace-library-table" role="table" aria-label="Indexed documents">
        <div className="workspace-library-table-head" role="row"><span role="columnheader">Name</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Indexed</span><span role="columnheader">Passages</span></div>
        {visibleFiles.map((document) => <button key={document.id} type="button" role="row" className={`workspace-library-row${previewId === document.id ? ' is-selected' : ''}`} onClick={() => void openPreview(document.id)}>
          <span role="cell" className="workspace-library-name"><FileText size={15} aria-hidden="true" /><span><strong>{document.fileName}</strong><small>{selectedFolder ? document.title : document.folderName}</small></span></span>
          <span role="cell">{document.kind.toUpperCase()}</span><span role="cell">{formatBytes(document.sizeBytes)}</span><span role="cell">{formatDate(document.indexedAt)}</span><span role="cell">{document.chunks}</span>
        </button>)}
        {visibleFiles.length === 0 ? <div className="workspace-library-empty"><strong>No matching files</strong><span>Try a different search.</span></div> : null}
      </div>

      {preview ? <section className="workspace-library-preview" aria-label={`Document preview: ${preview.title}`}>
        <div className="workspace-library-preview-head"><div><div className="workspace-eyebrow">Indexed preview · untrusted document content</div><h2>{preview.title}</h2></div><span>{preview.state === 'ready' ? 'Source verified' : 'Source unavailable'}</span></div>
        {preview.state === 'ready' ? <div className="workspace-library-passages">{preview.passages.map((passage) => <article key={passage.ordinal}><h3>Passage {passage.ordinal + 1}{passage.location ? ` · ${passage.location}` : ''}</h3><pre>{passage.content}</pre></article>)}</div> : null}
        {preview.state === 'ready' && preview.hasMore ? <button type="button" className="workspace-library-load-more" disabled={previewLoading} onClick={() => void openPreview(previewId ?? '', preview.startChunk + preview.passages.length)}>{previewLoading ? 'Loading…' : 'Load next passages'}</button> : null}
      </section> : null}
    </div> : null}
  </section>;
}
