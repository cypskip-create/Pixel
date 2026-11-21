import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Download, ExternalLink, FileText, Link2, Plus, Save, Trash2, Unlink, Upload } from 'lucide-react';
import type { ProductivityChecklistView, ProductivityDocumentLinkView, ProductivityNoteView, ProductivityTaskView } from '@shared/types';
import { useBridge } from '@/hooks/useBridge';

export function ProductivityPanel(): React.JSX.Element {
  const bridge = useBridge();
  const [notes, setNotes] = useState<ProductivityNoteView[]>([]);
  const [documentLinks, setDocumentLinks] = useState<ProductivityDocumentLinkView[]>([]);
  const [tasks, setTasks] = useState<ProductivityTaskView[]>([]);
  const [checklists, setChecklists] = useState<ProductivityChecklistView[]>([]);
  const [checklistTitle, setChecklistTitle] = useState('');
  const [selectedChecklistId, setSelectedChecklistId] = useState('');
  const [checklistFilter, setChecklistFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [editingTaskDescription, setEditingTaskDescription] = useState('');
  const [editingTaskDueAt, setEditingTaskDueAt] = useState('');
  const [editingTaskChecklistId, setEditingTaskChecklistId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  const refresh = useCallback(async (): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    try {
      const [nextNotes, nextTasks, nextChecklists] = await Promise.all([bridge.bridge.productivity.listNotes(), bridge.bridge.productivity.listTasks(), bridge.bridge.productivity.listChecklists()]);
      setNotes(nextNotes); setTasks(nextTasks); setChecklists(nextChecklists);
      if (selectedId && !nextNotes.some((note) => note.id === selectedId)) { setSelectedId(null); setTitle(''); setBody(''); }
    } catch { setError('Pixel could not load this project’s notes and tasks.'); }
  }, [bridge, selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (bridge.kind !== 'ready' || !selectedId) { setDocumentLinks([]); return; }
    let current = true;
    void bridge.bridge.productivity.listNoteDocuments(selectedId).then((links) => { if (current) setDocumentLinks(links); }).catch(() => { if (current) setError('Pixel could not load the documents linked to this note.'); });
    return () => { current = false; };
  }, [bridge, selectedId]);

  const openNote = (note: ProductivityNoteView): void => { setSelectedId(note.id); setTitle(note.title); setBody(note.body); setError(null); };
  const createNote = async (): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try {
      const note = await bridge.bridge.productivity.createNote('Untitled note', '');
      await refresh(); openNote(note);
    } catch { setError('Pixel could not create the note.'); } finally { setBusy(false); }
  };
  const saveNote = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); if (!selected || bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try { const saved = await bridge.bridge.productivity.updateNote(selected.id, { title, body }); if (!saved) throw new Error('missing'); await refresh(); }
    catch { setError('Pixel could not save this note.'); } finally { setBusy(false); }
  };
  const deleteNote = async (): Promise<void> => {
    if (!selected || bridge.kind !== 'ready' || !window.confirm(`Delete “${selected.title}” from this project? This cannot be undone.`)) return;
    setBusy(true);
    try { await bridge.bridge.productivity.deleteNote(selected.id); setSelectedId(null); setTitle(''); setBody(''); await refresh(); }
    catch { setError('Pixel could not delete this note.'); } finally { setBusy(false); }
  };
  const importMarkdown = async (): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try {
      const imported = await bridge.bridge.productivity.importMarkdown();
      if (imported) { await refresh(); openNote(imported); }
    } catch { setError('Pixel could not import that Markdown file. Choose a readable .md or .txt file up to 20 KB.'); }
    finally { setBusy(false); }
  };
  const exportMarkdown = async (): Promise<void> => {
    if (!selected || bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try {
      const result = await bridge.bridge.productivity.exportMarkdown(selected.id);
      if (!result.ok && !result.cancelled) setError('Pixel could not verify the Markdown export.');
    } catch { setError('Pixel could not export this note.'); }
    finally { setBusy(false); }
  };
  const linkDocument = async (): Promise<void> => {
    if (!selected || bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try {
      const linked = await bridge.bridge.productivity.linkNoteDocument(selected.id);
      if (linked) setDocumentLinks(await bridge.bridge.productivity.listNoteDocuments(selected.id));
    } catch { setError('Pixel could not link that file. Choose a supported document file, not a folder or symbolic link.'); }
    finally { setBusy(false); }
  };
  const openDocument = async (link: ProductivityDocumentLinkView): Promise<void> => {
    if (!selected || bridge.kind !== 'ready') return;
    setError(null);
    try { const result = await bridge.bridge.productivity.openNoteDocument(selected.id, link.id); if (!result.ok) setError(`Pixel could not open “${link.displayName}”. It may have moved or been removed.`); }
    catch { setError(`Pixel could not open “${link.displayName}”.`); }
  };
  const unlinkDocument = async (link: ProductivityDocumentLinkView): Promise<void> => {
    if (!selected || bridge.kind !== 'ready') return;
    setError(null);
    try { const removed = await bridge.bridge.productivity.unlinkNoteDocument(selected.id, link.id); if (removed) setDocumentLinks(await bridge.bridge.productivity.listNoteDocuments(selected.id)); }
    catch { setError('Pixel could not remove this document link.'); }
  };
  const createTask = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); const clean = taskTitle.trim();
    if (!clean || bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try { await bridge.bridge.productivity.createTask(clean, taskDescription, taskDueAt ? new Date(taskDueAt).toISOString() : undefined, selectedChecklistId || undefined); setTaskTitle(''); setTaskDescription(''); setTaskDueAt(''); await refresh(); }
    catch { setError('Pixel could not create this task.'); } finally { setBusy(false); }
  };
  const toggleTask = async (task: ProductivityTaskView): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    try { await bridge.bridge.productivity.updateTask(task.id, { status: task.status === 'completed' ? 'open' : 'completed' }); await refresh(); }
    catch { setError('Pixel could not update this task.'); }
  };
  const beginEditTask = (task: ProductivityTaskView): void => {
    setEditingTaskId(task.id); setEditingTaskTitle(task.title); setEditingTaskDescription(task.description);
    setEditingTaskDueAt(task.dueAt ? toLocalDateTimeInput(task.dueAt) : ''); setEditingTaskChecklistId(task.checklistId ?? '');
  };
  const saveTask = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!editingTaskId || !editingTaskTitle.trim() || bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try {
      const saved = await bridge.bridge.productivity.updateTask(editingTaskId, {
        title: editingTaskTitle.trim(), description: editingTaskDescription,
        dueAt: editingTaskDueAt ? new Date(editingTaskDueAt).toISOString() : null,
        checklistId: editingTaskChecklistId || null,
      });
      if (!saved) throw new Error('missing');
      setEditingTaskId(null); await refresh();
    } catch { setError('Pixel could not save this task.'); }
    finally { setBusy(false); }
  };
  const createChecklist = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); const clean = checklistTitle.trim();
    if (!clean || bridge.kind !== 'ready') return;
    setBusy(true); setError(null);
    try { const checklist = await bridge.bridge.productivity.createChecklist(clean); setChecklistTitle(''); setSelectedChecklistId(checklist.id); await refresh(); }
    catch { setError('Pixel could not create this checklist.'); }
    finally { setBusy(false); }
  };
  const visibleTasks = checklistFilter === 'all' ? tasks
    : checklistFilter === 'ungrouped' ? tasks.filter((task) => task.checklistId === null)
      : tasks.filter((task) => task.checklistId === checklistFilter);

  return <section className="workspace-page productivity-page">
    <div className="workspace-page-heading"><h1>Notes & tasks</h1><p>Saved locally in the active project. Pixel can create and update these through its agent tools.</p></div>
    {error ? <p role="alert" className="workspace-form-error">{error}</p> : null}
    <div className="productivity-columns">
      <section className="productivity-section" aria-label="Project notes">
        <header><h2><FileText size={16} /> Notes <span>{notes.length}</span></h2><div className="productivity-actions"><button type="button" onClick={() => void importMarkdown()} disabled={busy} className="workspace-secondary-button"><Upload size={14} /> Import .md</button><button type="button" onClick={() => void createNote()} disabled={busy} className="workspace-primary-button"><Plus size={14} /> New note</button></div></header>
        <div className="productivity-note-list">{notes.length ? notes.map((note) => <button type="button" key={note.id} onClick={() => openNote(note)} className={`productivity-note-row${selectedId === note.id ? ' is-active' : ''}`}><strong>{note.title}</strong><span>{note.body.slice(0, 110) || 'No content yet'}</span><small>Updated {new Date(note.updatedAt).toLocaleDateString()}</small></button>) : <p className="workspace-sidebar-empty">No notes in this project yet.</p>}</div>
      </section>
      <section className="productivity-section" aria-label="Project tasks">
        <header><h2><Check size={16} /> Tasks <span>{visibleTasks.filter((task) => task.status !== 'completed').length} open</span></h2><select aria-label="Filter tasks by checklist" value={checklistFilter} onChange={(event) => setChecklistFilter(event.target.value)}><option value="all">All tasks</option><option value="ungrouped">Ungrouped</option>{checklists.map((checklist) => <option key={checklist.id} value={checklist.id}>{checklist.title}</option>)}</select></header>
        <form className="productivity-checklist-form" onSubmit={(event) => void createChecklist(event)}><input aria-label="New checklist name" value={checklistTitle} maxLength={180} onChange={(event) => setChecklistTitle(event.target.value)} placeholder="New checklist name" /><button type="submit" disabled={busy || !checklistTitle.trim()}><Plus size={14} /> Checklist</button></form>
        <form className="productivity-task-form" onSubmit={(event) => void createTask(event)}><input aria-label="New project task" value={taskTitle} maxLength={180} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Add a task to this project" /><button type="submit" disabled={busy || !taskTitle.trim()} aria-label="Create task"><Plus size={15} /></button><select aria-label="Task checklist" value={selectedChecklistId} onChange={(event) => setSelectedChecklistId(event.target.value)}><option value="">No checklist</option>{checklists.map((checklist) => <option key={checklist.id} value={checklist.id}>{checklist.title}</option>)}</select><input aria-label="New task description" value={taskDescription} maxLength={4000} onChange={(event) => setTaskDescription(event.target.value)} placeholder="Description (optional)" /><input aria-label="New task due date" type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} /></form>
        <div className="productivity-task-list">{visibleTasks.length ? visibleTasks.map((task) => <div key={task.id} className={`productivity-task-row${task.status === 'completed' ? ' is-completed' : ''}`}><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.status === 'completed'} onChange={() => void toggleTask(task)} /><button type="button" className="productivity-task-edit" onClick={() => beginEditTask(task)}>{task.title}{task.checklistId ? <small> · {checklists.find((item) => item.id === task.checklistId)?.title}</small> : null}{task.dueAt ? <small> · due {new Date(task.dueAt).toLocaleString()}</small> : null}</button></div>) : <p className="workspace-sidebar-empty">No project tasks yet.</p>}</div>
        {editingTaskId ? <form className="productivity-task-editor" onSubmit={(event) => void saveTask(event)}><input aria-label="Task title" maxLength={180} value={editingTaskTitle} onChange={(event) => setEditingTaskTitle(event.target.value)} /><textarea aria-label="Task description" maxLength={4000} value={editingTaskDescription} onChange={(event) => setEditingTaskDescription(event.target.value)} rows={3} /><input aria-label="Task due date" type="datetime-local" value={editingTaskDueAt} onChange={(event) => setEditingTaskDueAt(event.target.value)} /><select aria-label="Edit task checklist" value={editingTaskChecklistId} onChange={(event) => setEditingTaskChecklistId(event.target.value)}><option value="">No checklist</option>{checklists.map((checklist) => <option key={checklist.id} value={checklist.id}>{checklist.title}</option>)}</select><div><button className="workspace-primary-button" type="submit" disabled={busy || !editingTaskTitle.trim()}><Save size={14} /> Save task</button><button className="workspace-secondary-button" type="button" onClick={() => setEditingTaskId(null)}>Cancel</button></div></form> : null}
      </section>
    </div>
    {selected ? <form className="productivity-editor" onSubmit={(event) => void saveNote(event)}>
      <header><div><h2>Edit note</h2><p>Project note · last updated {new Date(selected.updatedAt).toLocaleString()}</p></div><div className="productivity-actions"><button type="button" disabled={busy} onClick={() => void exportMarkdown()} className="workspace-secondary-button"><Download size={14} /> Export .md</button><button type="submit" disabled={busy || !title.trim()} className="workspace-primary-button"><Save size={14} /> Save</button><button type="button" disabled={busy} onClick={() => void deleteNote()} className="workspace-danger-button"><Trash2 size={14} /> Delete</button></div></header>
      <input aria-label="Note title" value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} />
      <textarea aria-label="Note content" value={body} maxLength={20_000} onChange={(event) => setBody(event.target.value)} rows={9} placeholder="Write a note…" />
      <section className="productivity-linked-documents" aria-label="Linked documents">
        <header><h3><Link2 size={14} /> Linked documents <span>{documentLinks.length}</span></h3><button type="button" className="workspace-secondary-button" disabled={busy} onClick={() => void linkDocument()}><Plus size={13} /> Link document</button></header>
        {documentLinks.length ? <ul>{documentLinks.map((link) => <li key={link.id}><span><strong>{link.displayName}</strong><small>{formatBytes(link.byteSize)}</small></span><button type="button" aria-label={`Open ${link.displayName}`} onClick={() => void openDocument(link)}><ExternalLink size={14} /></button><button type="button" aria-label={`Unlink ${link.displayName}`} onClick={() => void unlinkDocument(link)}><Unlink size={14} /></button></li>)}</ul> : <p>No local documents linked to this note.</p>}
      </section>
    </form> : null}
  </section>;
}

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
