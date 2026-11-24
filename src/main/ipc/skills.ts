import { CHANNELS } from '../../shared/channels';
import type {
  ProceduralSkillView,
  RoutineRecord,
  RoutineRunRecord,
} from '../../shared/types';
import type { AuditLog } from '../agent/runtime';
import type { ToolRegistry } from '../agent/tools';
import type { LocalRoutineScheduler, RoutineStore } from '../routines';
import { buildRoutineToolPlan, normalizeSkillInputValues } from '../skills/plan';
import type { ProceduralSkillStore } from '../skills/procedural';
import type { SkillStore } from '../skills/store';
import type { IpcRegistrar } from './registry';

export interface ProceduralSkillsIpcDeps {
  registrar: IpcRegistrar;
  projectId: () => string;
  proceduralSkillStore: ProceduralSkillStore;
  audit: AuditLog;
}

export function registerProceduralSkillsIpc(deps: ProceduralSkillsIpcDeps): void {
  const { registrar, projectId, proceduralSkillStore, audit } = deps;

  registrar.registerHandler(CHANNELS.proceduralSkillsList, (): ProceduralSkillView[] =>
    proceduralSkillStore.list(projectId()),
  );
  registrar.registerHandler(CHANNELS.proceduralSkillsCreateDraft, (_event, markdown: unknown): ProceduralSkillView => {
    if (typeof markdown !== 'string') throw new Error('SKILL.md markdown text is required.');
    const draft = proceduralSkillStore.createDraft({ projectId: projectId(), markdown, source: 'user:settings' });
    audit.record('system', `Created procedural skill draft ${draft.name} v${draft.version}`, 'ok', `scan=${draft.scanStatus}`);
    return draft;
  });
  registrar.registerHandler(CHANNELS.proceduralSkillsActivate, (_event, id: string): ProceduralSkillView => {
    const active = proceduralSkillStore.activate(id);
    audit.record('system', `Activated procedural skill ${active.name} v${active.version}`, 'ok');
    return active;
  });
  registrar.registerHandler(CHANNELS.proceduralSkillsDisable, (_event, id: string): ProceduralSkillView => {
    const disabled = proceduralSkillStore.setDisabled(id);
    audit.record('system', `Disabled procedural skill ${disabled.name} v${disabled.version}`, 'ok');
    return disabled;
  });
  registrar.registerHandler(CHANNELS.proceduralSkillsSetPinned, (_event, id: string, pinned: boolean): ProceduralSkillView => {
    const updated = proceduralSkillStore.setPinned(id, Boolean(pinned));
    audit.record('system', `${updated.pinned ? 'Pinned' : 'Unpinned'} procedural skill ${updated.name}`, 'ok');
    return updated;
  });
  registrar.registerHandler(CHANNELS.proceduralSkillsDelete, (_event, id: string): boolean => {
    const deleted = proceduralSkillStore.delete(id);
    if (deleted) audit.record('system', `Deleted procedural skill ${id}`, 'ok');
    return deleted;
  });
}

export interface RoutinesIpcDeps {
  registrar: IpcRegistrar;
  projectId: () => string;
  routineStore: RoutineStore;
  routines: LocalRoutineScheduler;
  skillStore: SkillStore;
  toolRegistry: ToolRegistry;
}

export function registerRoutinesIpc(deps: RoutinesIpcDeps): void {
  const { registrar, projectId, routineStore, routines, skillStore, toolRegistry } = deps;

  registrar.registerHandler(CHANNELS.routinesList, (): RoutineRecord[] =>
    routineStore.list(projectId()) as RoutineRecord[],
  );
  registrar.registerHandler(
    CHANNELS.routinesCreate,
    (_event, input: {
      skillId: string;
      name: string;
      localTime: string;
      timezone: string;
      scheduleKind?: import('../../shared/types').RoutineScheduleKind;
      cronExpression?: string;
      intervalMs?: number;
      runAt?: number;
      missedRunPolicy?: import('../../shared/types').MissedRunPolicy;
      inputValues?: unknown;
    }): RoutineRecord => {
      if (!input || typeof input !== 'object' || typeof input.skillId !== 'string' ||
          typeof input.name !== 'string' || typeof input.localTime !== 'string' || typeof input.timezone !== 'string') {
        throw new Error('Routine settings are required.');
      }
      const skill = skillStore.getActive(input.skillId);
      if (!skill || skill.projectId !== projectId()) throw new Error('Choose an active skill in the current project.');
      const inputValues = normalizeSkillInputValues(skill.inputs, input.inputValues ?? {});
      buildRoutineToolPlan(skill, 'routine-validation', toolRegistry, inputValues);
      return routineStore.toSummary(routineStore.create({ ...input, inputValues, projectId: projectId() })) as RoutineRecord;
    },
  );
  registrar.registerHandler(
    CHANNELS.routinesUpdate,
    (_event, routineId: string, patch: Record<string, unknown>): RoutineRecord | null => {
      const routine = routineStore.get(routineId);
      if (!routine || routine.projectId !== projectId()) return null;
      const updated = routineStore.update(routineId, (patch && typeof patch === 'object' ? patch : {}) as Parameters<RoutineStore['update']>[1]);
      return updated ? (routineStore.toSummary(updated) as RoutineRecord) : null;
    },
  );
  registrar.registerHandler(CHANNELS.routinesSetEnabled, (_event, routineId: string, enabled: boolean): boolean => {
    if (typeof enabled !== 'boolean') return false;
    const routine = routineStore.get(routineId);
    if (!routine || routine.projectId !== projectId()) return false;
    return routineStore.setEnabled(routineId, enabled);
  });
  registrar.registerHandler(CHANNELS.routinesDelete, (_event, routineId: string): boolean => {
    const routine = routineStore.get(routineId);
    if (!routine || routine.projectId !== projectId()) return false;
    if (routines.cancel(routineId)) return false;
    return routineStore.delete(routineId);
  });
  registrar.registerHandler(CHANNELS.routinesHistory, (_event, routineId: string, limit?: number): RoutineRunRecord[] => {
    const routine = routineStore.get(routineId);
    if (!routine || routine.projectId !== projectId()) return [];
    return routineStore.history(routineId, limit) as RoutineRunRecord[];
  });
  registrar.registerHandler(CHANNELS.routinesCancel, (_event, routineId: string): boolean => {
    const routine = routineStore.get(routineId);
    return routine?.projectId === projectId() && routines.cancel(routineId);
  });
  registrar.registerHandler(CHANNELS.routinesRetry, (_event, routineId: string): boolean => {
    const routine = routineStore.get(routineId);
    return routine?.projectId === projectId() && routines.retry(routineId);
  });
  registrar.registerHandler(CHANNELS.routinesRunNow, (_event, routineId: string): boolean => {
    const routine = routineStore.get(routineId);
    return routine?.projectId === projectId() && routines.runNow(routineId);
  });
}
