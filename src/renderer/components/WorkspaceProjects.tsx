import { useMemo, useState, type FormEvent } from 'react';
import { Check, Folder, LayoutGrid, List, Plus, Search } from 'lucide-react';
import type { ProjectView } from '@shared/types';

interface WorkspaceProjectsProps {
  projects: ProjectView[];
  draft: string;
  setDraft: (value: string) => void;
  onSelect: (name: string) => void;
}

/** Project browser backed only by Pixel's current local project records. */
export function WorkspaceProjects({ projects, draft, setDraft, onSelect }: WorkspaceProjectsProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) =>
      project.name.toLocaleLowerCase().includes(normalized)
      || (project.description ?? '').toLocaleLowerCase().includes(normalized),
    );
  }, [projects, query]);

  const openProject = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draft.trim()) onSelect(draft.trim());
  };

  return (
    <section className="workspace-page workspace-projects-page" aria-labelledby="workspace-projects-title">
      <header className="workspace-page-heading">
        <div>
          <p className="workspace-eyebrow">Workspace</p>
          <h1 id="workspace-projects-title">Projects</h1>
          <p>Separate conversations and memory by project.</p>
        </div>
        <div className="workspace-project-view-toggle" role="group" aria-label="Project layout">
          <button type="button" aria-label="Grid view" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={15} /></button>
          <button type="button" aria-label="List view" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={15} /></button>
        </div>
      </header>

      <div className="workspace-project-toolbar">
        <label className="workspace-project-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a project" />
        </label>
        <form className="workspace-create-project" onSubmit={openProject}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Create or open a project" aria-label="Project name" maxLength={80} />
          <button type="submit" disabled={!draft.trim()}><Plus size={15} /> Open project</button>
        </form>
      </div>

      <div className={`workspace-project-grid ${layout === 'list' ? 'is-list' : ''}`} aria-live="polite">
        {filteredProjects.map((project) => (
          <button
            type="button"
            key={project.id}
            onClick={() => onSelect(project.name)}
            className={`workspace-project-card ${project.active ? 'is-active' : ''}`}
            aria-current={project.active ? 'true' : undefined}
            title={`Open ${project.name}`}
          >
            <span className="workspace-folder-art" aria-hidden="true"><Folder size={25} strokeWidth={1.6} /></span>
            <span className="workspace-project-copy">
              <strong>{project.name}</strong>
              <small>{project.description || (project.active ? 'Current project' : 'Project space')}</small>
            </span>
            {project.active ? <span className="workspace-project-current"><Check size={12} /> Current</span> : null}
          </button>
        ))}
        {filteredProjects.length === 0 ? (
          <div className="workspace-project-empty">
            <Folder size={20} aria-hidden="true" />
            <strong>{query ? 'No matching projects' : 'No projects yet'}</strong>
            <span>{query ? 'Try another name or description.' : 'Create a project to give conversations their own memory scope.'}</span>
          </div>
        ) : null}
      </div>

      <p className="workspace-project-footnote">Project names and memory stay in Pixel’s local database. Project deletion is not available in this build.</p>
    </section>
  );
}
