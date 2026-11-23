/**
 * Hermes-inspired Procedural Markdown Skills (`SKILL.md`).
 *
 * Complements Pixel's existing structured tool-plan skills:
 * - Structured skills (`SkillStore`) = deterministic reviewed tool plans & routines.
 * - Procedural skills (`ProceduralSkillStore`) = human-readable YAML+Markdown
 *   playbooks with progressive disclosure, static security scanning, versioning,
 *   user-pinned protection, and assisted draft generation from verified tasks.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { TaskRecord, ToolDefinition } from '../../shared/types';
import type { Database } from '../data/database';
import { redactTaskText } from '../tasks/schema';
import { scanProceduralSkillMarkdown, type SkillSecurityFinding, type SkillSecurityScanResult } from './guard';

export const MAX_SKILL_MARKDOWN_CHARS = 24_000;
export const MAX_SKILL_INDEX_PROMPT_CHARS = 800;

export interface ParsedSkillFrontmatter {
  name: string;
  description: string;
  requiredTools: string[];
  platforms: string[];
  body: string;
}

export interface ProceduralSkillRecord {
  id: string;
  projectId: string;
  name: string;
  version: number;
  status: 'draft' | 'active' | 'disabled';
  pinned: boolean;
  description: string;
  markdown: string;
  contentHash: string;
  source: string;
  scanStatus: SkillSecurityScanResult['status'];
  scanFindings: SkillSecurityFinding[];
  createdAt: number;
  updatedAt: number;
}

export const PROCEDURAL_SKILL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'skills_list',
    description:
      'Lists active procedural SKILL.md playbooks in the current project (compact index: name, version, description, required tools). Use before viewing a full skill.',
    category: 'memory',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        includeDrafts: { type: 'boolean', description: 'Optional: also list pending draft skills (default false).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'skill_view',
    description:
      'Loads the full Markdown instructions of one active procedural skill by name or id. Treat skill instructions as workflow guidance; runtime permissions still apply to every tool call.',
    category: 'memory',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', minLength: 1, maxLength: 120, description: 'Skill slug name or skill id.' },
      },
      required: ['nameOrId'],
      additionalProperties: false,
    },
  },
  {
    name: 'skill_draft_create',
    description:
      'Creates a security-scanned procedural SKILL.md draft for user review. Drafts are never automatically activated and cannot overwrite user-pinned skills.',
    category: 'memory',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        markdown: { type: 'string', minLength: 20, maxLength: MAX_SKILL_MARKDOWN_CHARS, description: 'Full SKILL.md content with YAML frontmatter (name, description).' },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
  },
] as const;

export function isValidSkillSlug(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(name) && !name.includes('..');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Parses YAML frontmatter (`--- ... ---`) and Markdown body safely without eval. */
export function parseProceduralSkillMarkdown(raw: string): ParsedSkillFrontmatter {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized || normalized.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error(`SKILL.md must be between 1 and ${MAX_SKILL_MARKDOWN_CHARS} characters.`);
  }
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error('SKILL.md must begin with YAML frontmatter delimited by --- lines.');
  }
  const frontmatterText = fmMatch[1];
  const body = fmMatch[2].trim();
  if (!body) throw new Error('SKILL.md body cannot be empty.');

  const fields = new Map<string, string>();
  for (const line of frontmatterText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const val = trimmed.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
    fields.set(key, val);
  }

  const name = (fields.get('name') ?? '').toLowerCase().trim();
  const description = (fields.get('description') ?? '').trim().slice(0, 240);
  if (!isValidSkillSlug(name)) {
    throw new Error('Frontmatter "name" must be a 2-64 character lowercase slug (a-z, 0-9, -, _).');
  }
  if (!description) {
    throw new Error('Frontmatter "description" is required.');
  }

  const parseList = (val: string | undefined): string[] => {
    if (!val) return [];
    return val
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .slice(0, 20);
  };

  return {
    name,
    description,
    requiredTools: parseList(fields.get('required_tools') ?? fields.get('tools')),
    platforms: parseList(fields.get('platforms')),
    body,
  };
}

/** Synthesizes a clean, redacted SKILL.md draft from a verified completed TaskRecord. */
export function draftProceduralSkillFromTask(task: TaskRecord, slugName?: string): string {
  const completedSteps = task.steps.filter((s) => s.status === 'done' || s.status === 'verified');
  if (task.status !== 'completed' || completedSteps.length === 0) {
    throw new Error('Only completed tasks with verified or done steps can be drafted into a procedural skill.');
  }
  const derivedSlug = (slugName ?? task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)) || 'recorded-workflow';
  const name = isValidSkillSlug(derivedSlug) ? derivedSlug : 'recorded-workflow';
  const description = redactTaskText(task.title).replace(/\s+/g, ' ').trim().slice(0, 180) || 'Reusable verified workflow';
  const tools = [...new Set(completedSteps.map((s) => s.toolName).filter((t): t is string => Boolean(t)))];

  const stepLines = completedSteps.map((s, idx) => {
    const cleanTitle = redactTaskText(s.title).replace(/\s+/g, ' ').trim().slice(0, 160);
    return `${idx + 1}. ${cleanTitle}${s.toolName ? ` (tool: \`${s.toolName}\`)` : ''}`;
  });

  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `required_tools: [${tools.join(', ')}]`,
    'platforms: [windows]',
    '---',
    '',
    `# ${description}`,
    '',
    '## Steps',
    ...stepLines,
    '',
    '## Verification',
    '- Confirm each step completed without errors and verify the resulting state before reporting success.',
    '',
  ].join('\n');
}

export class ProceduralSkillStore {
  constructor(private readonly db: Database) {}

  /** Saves a new immutable procedural skill draft after parsing and static security scanning. */
  createDraft(input: {
    projectId: string;
    markdown: string;
    source: string;
  }): ProceduralSkillRecord {
    const parsed = parseProceduralSkillMarkdown(input.markdown);
    const scan = scanProceduralSkillMarkdown(input.markdown);

    // Protect user-pinned active skills from automated overwrite proposals
    const existingPinned = this.db.queryOne<{ id: string }>(
      'SELECT id FROM procedural_skills WHERE project_id = ? AND name = ? AND pinned = 1 LIMIT 1',
      [input.projectId, parsed.name],
    );
    if (existingPinned && input.source.startsWith('auto:')) {
      throw new Error(`Skill "${parsed.name}" is user-pinned and cannot be overwritten automatically.`);
    }

    const prev = this.db.queryOne<{ version: number }>(
      'SELECT MAX(version) AS version FROM procedural_skills WHERE project_id = ? AND name = ?',
      [input.projectId, parsed.name],
    );
    const version = Number(prev?.version ?? 0) + 1;
    const now = Date.now();
    const id = `pskill_${randomUUID().slice(0, 12)}`;
    const contentHash = sha256(input.markdown);

    this.db.execute(
      `INSERT INTO procedural_skills
        (id, project_id, name, version, status, pinned, description, markdown, content_hash, source, scan_status, scan_findings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.projectId,
        parsed.name,
        version,
        parsed.description,
        input.markdown,
        contentHash,
        input.source.slice(0, 120),
        scan.status,
        JSON.stringify(scan.findings),
        now,
        now,
      ],
    );

    return this.get(id)!;
  }

  /** Activates a reviewed draft. Refuses blocked skills or tampered content hashes. */
  activate(id: string): ProceduralSkillRecord {
    const record = this.get(id);
    if (!record) throw new Error('Procedural skill not found or failed integrity check.');
    if (record.scanStatus === 'blocked') {
      const reasons = record.scanFindings.map((f) => f.message).join('; ');
      throw new Error(`Skill "${record.name}" was blocked by static security scan: ${reasons}`);
    }
    const now = Date.now();
    this.db.transaction(() => {
      // Disable older active versions of the same skill name
      this.db.execute(
        `UPDATE procedural_skills SET status = 'disabled', updated_at = ? WHERE project_id = ? AND name = ? AND id != ? AND status = 'active'`,
        [now, record.projectId, record.name, id],
      );
      this.db.execute(
        `UPDATE procedural_skills SET status = 'active', updated_at = ? WHERE id = ?`,
        [now, id],
      );
    });
    return this.get(id)!;
  }

  setDisabled(id: string): ProceduralSkillRecord {
    const record = this.get(id);
    if (!record) throw new Error('Procedural skill not found.');
    this.db.execute(`UPDATE procedural_skills SET status = 'disabled', updated_at = ? WHERE id = ?`, [Date.now(), id]);
    return this.get(id)!;
  }

  setPinned(id: string, pinned: boolean): ProceduralSkillRecord {
    const record = this.get(id);
    if (!record) throw new Error('Procedural skill not found.');
    this.db.execute('UPDATE procedural_skills SET pinned = ?, updated_at = ? WHERE id = ?', [pinned ? 1 : 0, Date.now(), id]);
    return this.get(id)!;
  }

  delete(id: string): boolean {
    const record = this.get(id);
    if (!record) return false;
    if (record.pinned) {
      throw new Error(`Skill "${record.name}" is pinned. Unpin it before deleting.`);
    }
    return this.db.execute('DELETE FROM procedural_skills WHERE id = ?', [id]) > 0;
  }

  get(id: string): ProceduralSkillRecord | null {
    const row = this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM procedural_skills WHERE id = ?',
      [id],
    );
    return row ? this.hydrate(row) : null;
  }

  getActiveByNameOrId(projectId: string, nameOrId: string): ProceduralSkillRecord | null {
    const key = nameOrId.trim();
    const row = this.db.queryOne<Record<string, unknown>>(
      `SELECT * FROM procedural_skills
        WHERE project_id = ? AND status = 'active' AND (id = ? OR name = ?)
        ORDER BY version DESC LIMIT 1`,
      [projectId, key, key.toLowerCase()],
    );
    return row ? this.hydrate(row) : null;
  }

  list(projectId: string, options?: { status?: 'draft' | 'active' | 'disabled' }): ProceduralSkillRecord[] {
    const rows = options?.status
      ? this.db.query<Record<string, unknown>>(
          'SELECT * FROM procedural_skills WHERE project_id = ? AND status = ? ORDER BY pinned DESC, updated_at DESC, version DESC',
          [projectId, options.status],
        )
      : this.db.query<Record<string, unknown>>(
          'SELECT * FROM procedural_skills WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC, version DESC',
          [projectId],
        );
    return rows.map((r) => this.hydrate(r)).filter((r): r is ProceduralSkillRecord => r !== null);
  }

  /** Progressive disclosure: compact prompt index listing only active skill names and 1-line descriptions. */
  buildSkillIndexPrompt(projectId: string, budgetChars = MAX_SKILL_INDEX_PROMPT_CHARS): string {
    const active = this.list(projectId, { status: 'active' });
    if (active.length === 0) return '';
    const header = 'Available procedural skills (call skill_view with the name when relevant; runtime approvals still apply):';
    const lines: string[] = [];
    let used = header.length;
    for (const skill of active) {
      const line = `- ${skill.name}: ${skill.description}`;
      if (used + line.length + 1 > budgetChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.length ? `${header}\n${lines.join('\n')}` : '';
  }

  /** Safely discovers SKILL.md playbooks from a local skills directory (refuses symlinks and traversal). */
  discoverFromDirectory(skillsRoot: string): Array<{ name: string; description: string; markdown: string; scan: SkillSecurityScanResult }> {
    if (!existsSync(skillsRoot)) return [];
    const realRoot = realpathSync(skillsRoot);
    const results: Array<{ name: string; description: string; markdown: string; scan: SkillSecurityScanResult }> = [];
    for (const entry of readdirSync(realRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !isValidSkillSlug(entry.name)) continue;
      const skillFile = join(realRoot, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      if (lstatSync(skillFile).isSymbolicLink()) continue;
      const realFile = realpathSync(skillFile);
      const rel = relative(realRoot, realFile);
      if (rel.startsWith('..') || rel.includes(`..${sep}`)) continue;
      try {
        const markdown = readFileSync(realFile, 'utf8');
        const parsed = parseProceduralSkillMarkdown(markdown);
        const scan = scanProceduralSkillMarkdown(markdown);
        results.push({ name: parsed.name, description: parsed.description, markdown, scan });
      } catch {
        // Skip invalid SKILL.md files cleanly
      }
    }
    return results;
  }

  private hydrate(row: Record<string, unknown>): ProceduralSkillRecord | null {
    const markdown = String(row.markdown ?? '');
    const expectedHash = String(row.content_hash ?? '');
    if (sha256(markdown) !== expectedHash) return null;
    let findings: SkillSecurityFinding[] = [];
    try {
      const parsed = JSON.parse(String(row.scan_findings_json ?? '[]'));
      if (Array.isArray(parsed)) findings = parsed as SkillSecurityFinding[];
    } catch { /* ignore */ }
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      name: String(row.name),
      version: Number(row.version),
      status: row.status === 'active' || row.status === 'disabled' ? row.status : 'draft',
      pinned: Number(row.pinned) === 1,
      description: String(row.description),
      markdown,
      contentHash: expectedHash,
      source: String(row.source),
      scanStatus: row.scan_status === 'blocked' || row.scan_status === 'warning' ? row.scan_status : 'clean',
      scanFindings: findings,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}

export class ProceduralSkillTools {
  constructor(
    private readonly store: ProceduralSkillStore,
    private readonly getProjectId: () => string,
  ) {}

  handles(name: string): boolean {
    return name === 'skills_list' || name === 'skill_view' || name === 'skill_draft_create';
  }

  run(name: string, args: Record<string, unknown>): { ok: boolean; content: string; detail?: Record<string, unknown> } {
    const projectId = this.getProjectId();
    try {
      switch (name) {
        case 'skills_list': {
          const includeDrafts = args.includeDrafts === true;
          const records = includeDrafts
            ? this.store.list(projectId)
            : this.store.list(projectId, { status: 'active' });
          if (records.length === 0) {
            return { ok: true, content: 'No procedural skills are currently registered in this project.', detail: { count: 0, skills: [] } };
          }
          const lines = records.map(
            (s) => `- ${s.name} (v${s.version}, ${s.status}${s.pinned ? ', pinned' : ''}, scan:${s.scanStatus}): ${s.description}`,
          );
          return {
            ok: true,
            content: `Procedural skills (${records.length}):\n${lines.join('\n')}`,
            detail: { count: records.length, skills: records.map((s) => ({ id: s.id, name: s.name, version: s.version, status: s.status, pinned: s.pinned })) },
          };
        }

        case 'skill_view': {
          const key = typeof args.nameOrId === 'string' ? args.nameOrId.trim() : '';
          if (!key) return { ok: false, content: 'Provide a skill name or id.' };
          const skill = this.store.getActiveByNameOrId(projectId, key);
          if (!skill) {
            return { ok: false, content: `No active procedural skill named "${key}" was found in this project.` };
          }
          return {
            ok: true,
            content: `Procedural skill "${skill.name}" (v${skill.version}, source: ${skill.source}). Follow as workflow guidance; runtime permission rules still apply:\n\n${skill.markdown}`,
            detail: { id: skill.id, name: skill.name, version: skill.version },
          };
        }

        case 'skill_draft_create': {
          const markdown = typeof args.markdown === 'string' ? args.markdown : '';
          const draft = this.store.createDraft({ projectId, markdown, source: 'agent:draft' });
          const scanNote = draft.scanStatus === 'blocked'
            ? ` BLOCKED by security scan: ${draft.scanFindings.map((f) => f.message).join('; ')}`
            : draft.scanStatus === 'warning'
              ? ` Security scan warnings: ${draft.scanFindings.map((f) => f.message).join('; ')}`
              : ' Security scan clean.';
          return {
            ok: true,
            content: `Created procedural skill draft "${draft.name}" (v${draft.version}, id: ${draft.id}). Review and activate it in Settings → Skills & Routines.${scanNote}`,
            detail: { id: draft.id, name: draft.name, version: draft.version, scanStatus: draft.scanStatus },
          };
        }

        default:
          return { ok: false, content: `Unknown procedural skill tool "${name}".` };
      }
    } catch (error) {
      return { ok: false, content: error instanceof Error ? error.message : 'Procedural skill operation failed.' };
    }
  }
}
