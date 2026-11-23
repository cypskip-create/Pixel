import { CHANNELS } from '../../shared/channels';
import type { AuditEntry, ToolCatalogEntry } from '../../shared/types';
import type { AuditLog } from '../agent/runtime';
import type { ToolRegistry } from '../agent/tools';
import type { IpcRegistrar } from './registry';

export interface AuditAndToolsIpcDeps {
  registrar: IpcRegistrar;
  audit: AuditLog;
  toolRegistry: ToolRegistry;
  getNativeAvailability: () => { available: boolean; reason?: string };
  getPythonAvailability: () => { available: boolean; reason?: string };
}

export function registerAuditAndToolsIpc(deps: AuditAndToolsIpcDeps): void {
  const { registrar, audit, toolRegistry, getNativeAvailability, getPythonAvailability } = deps;

  registrar.registerHandler(CHANNELS.auditList, (_event, limit?: number): AuditEntry[] =>
    audit.list(typeof limit === 'number' ? limit : 100),
  );

  registrar.registerHandler(CHANNELS.toolsList, (): ToolCatalogEntry[] => {
    const native = getNativeAvailability();
    const python = getPythonAvailability();
    return toolRegistry.list().map((tool) => {
      const entry: ToolCatalogEntry = {
        name: tool.name,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        requiresApproval: tool.requiresApproval,
        changesState: tool.changesState,
        availability: 'ready',
      };
      if (tool.category === 'screen' || tool.category === 'input') {
        entry.availability = native.available ? 'conditional' : 'unavailable';
        entry.dependency = 'PixelNative executable (health checked when used)';
        if (!native.available) entry.availabilityReason = native.reason;
      } else if (tool.name.startsWith('browser_')) {
        entry.availability = 'not_checked';
        entry.dependency = 'Playwright Chromium (checked when first used)';
      } else if (tool.name === 'documents_index') {
        entry.availability = python.available ? 'conditional' : 'unavailable';
        entry.dependency = 'Python executable and document worker (checked when used)';
        if (!python.available) entry.availabilityReason = python.reason;
      }
      return entry;
    });
  });
}
