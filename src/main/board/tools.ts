import type { ToolDefinition } from '../../shared/types';

const pointSchema = {
  type: 'object',
  properties: {
    x: { type: 'number', minimum: 0, maximum: 1000 },
    y: { type: 'number', minimum: 0, maximum: 650 },
  },
  required: ['x', 'y'],
  additionalProperties: false,
};

export const BOARD_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'board_get_state',
    description: 'Reads the current Pixel Board title, revision, and editable objects. Use this before editing an existing Board. Pixel Board coordinates are 1000 by 650 logical units.',
    category: 'board', risk: 'low', requiresApproval: false, changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_create',
    description: 'Creates a named blank Pixel Board when the active document has no objects. Existing drawings must be saved or cleared first; Pixel never silently replaces drawing content. Use board_create_diagram for an automatically laid out connected-node diagram.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['title'], additionalProperties: false },
  },
  {
    name: 'board_add_text',
    description: 'Adds a wrapped editable text block to the active Pixel Board. If coordinates are omitted, Pixel places it in a reasonable open row. Coordinates use the 1000 by 650 Board space.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 2000 }, x: { type: 'number', minimum: 0, maximum: 1000 }, y: { type: 'number', minimum: 0, maximum: 650 }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }, required: ['text'], additionalProperties: false },
  },
  {
    name: 'board_add_shape',
    description: 'Adds an editable line, arrow, rectangle, or circle to Pixel Board using bounded logical coordinates. Use board_create_diagram when several connected nodes need automatic layout.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { shape: { type: 'string', enum: ['line', 'arrow', 'rectangle', 'circle'] }, x: { type: 'number', minimum: 0, maximum: 1000 }, y: { type: 'number', minimum: 0, maximum: 650 }, width: { type: 'number', minimum: 1, maximum: 1000 }, height: { type: 'number', minimum: 1, maximum: 650 }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }, required: ['shape', 'x', 'y', 'width', 'height'], additionalProperties: false },
  },
  {
    name: 'board_add_stroke',
    description: 'Adds one editable pen or highlighter stroke from a bounded array of Pixel Board coordinate points.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['pen', 'highlighter'] }, points: { type: 'array', items: pointSchema, minItems: 2, maxItems: 500 }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, width: { type: 'number', minimum: 1, maximum: 32 } }, required: ['kind', 'points'], additionalProperties: false },
  },
  {
    name: 'board_add_marker',
    description: 'Adds a numbered editable step marker to the active Pixel Board.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1000 }, y: { type: 'number', minimum: 0, maximum: 650 }, step: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['x', 'y'], additionalProperties: false },
  },
  {
    name: 'board_create_diagram',
    description: 'Creates an editable, automatically laid out diagram on an empty Pixel Board. Provide 2–5 short node labels and zero or more directed connectors by node index. One call creates the title, nodes, labels and arrows as a single undoable group.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, nodes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, minItems: 2, maxItems: 5 }, edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'integer', minimum: 0, maximum: 4 }, to: { type: 'integer', minimum: 0, maximum: 4 }, label: { type: 'string', maxLength: 48 } }, required: ['from', 'to'], additionalProperties: false }, maxItems: 12 } }, required: ['title', 'nodes'], additionalProperties: false },
  },
  {
    name: 'board_update_object',
    description: 'Edits an existing Board object by its ID. Supports replacing text, moving by a bounded delta, changing color, or changing stroke width. Read the Board first to obtain an object ID.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, text: { type: 'string', maxLength: 2000 }, dx: { type: 'number', minimum: -1000, maximum: 1000 }, dy: { type: 'number', minimum: -650, maximum: 650 }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, width: { type: 'number', minimum: 1, maximum: 32 } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'board_delete_object',
    description: 'Removes one object by ID from the active Board. The change is undoable.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'board_clear',
    description: 'Clears all objects from the active Pixel Board as one undoable change. This does not delete saved Board files.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_undo',
    description: 'Undoes the most recent manual or agent Board change. Grouped diagrams are undone in one step.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_redo',
    description: 'Redoes the most recent Board change that was undone.',
    category: 'board', risk: 'medium', requiresApproval: false, changesState: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_open',
    description: 'Opens an editable .pixelboard file using a native file picker. Existing Board content is preserved unless the user confirms replacing it.',
    category: 'board', risk: 'high', requiresApproval: true, changesState: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_save',
    description: 'Saves the active Board as an editable .pixelboard document using a native Save dialog. Pixel verifies the saved document and asks before replacing an existing file.',
    category: 'board', risk: 'high', requiresApproval: true, changesState: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_export',
    description: 'Exports the active Pixel Board as SVG using a native Save dialog, then verifies the file. Existing files require explicit replacement confirmation.',
    category: 'board', risk: 'high', requiresApproval: true, changesState: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export function isBoardTool(name: string): boolean {
  return BOARD_TOOL_DEFINITIONS.some((tool) => tool.name === name);
}
