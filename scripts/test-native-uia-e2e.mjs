import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { AgentExecutor } = require('../dist/main/main/agent/executor.js');
const { ToolExecutors } = require('../dist/main/main/agent/executors.js');
const { AuditLog, PermissionBroker, TaskManager } = require('../dist/main/main/agent/runtime.js');
const { ToolRegistry } = require('../dist/main/main/agent/tools.js');
const { NativeHelper } = require('../dist/main/main/services/nativeHelper.js');
const { Database } = require('../dist/main/main/data/database.js');
const { TaskStore } = require('../dist/main/main/tasks/store.js');

const fixtureTitle = 'Pixel UIA Harmless Fixture';
const buttonName = 'Run harmless UIA action';
const resultName = 'Pixel harmless action: completed';
const artifactDirectory = resolve('artifacts/windows-acceptance');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const databasePath = resolve(artifactDirectory, `pixel-native-uia-e2e-${stamp}.sqlite`);
const reportPath = resolve(artifactDirectory, `pixel-native-uia-e2e-${stamp}.json`);
const helper = new NativeHelper({
  executablePath: resolve('native/bin/PixelNative.exe'),
});
let database;

function toolOutcome(name, args, index) {
  return {
    content: '',
    reasoning: '',
    toolCalls: [{
      id: `uia_${index}`,
      name,
      argumentsJson: JSON.stringify(args),
      arguments: args,
    }],
    finishReason: 'tool_calls',
    aborted: false,
    failed: false,
  };
}

function answerOutcome(content) {
  return { content, reasoning: '', toolCalls: [], finishReason: 'stop', aborted: false, failed: false };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(process.platform === 'win32', 'This UIA integration check only runs on Windows.');
  assert(helper.available().available, 'PixelNative.exe is not available; build the native helper first.');

  const before = await helper.call('foreground_window', {});
  assert(before?.title === fixtureTitle, 'The harmless fixture must be the foreground window; no task action was run.');
  const buttonSearch = await helper.call('find_elements', {
    text: buttonName,
    roles: ['Button'],
    maxResults: 5,
  });
  assert(buttonSearch.window.title === fixtureTitle, 'The fixture lost foreground before the button search.');
  assert(buttonSearch.elements.length === 1 && buttonSearch.elements[0]?.name === buttonName, 'The fixture button was not uniquely identifiable.');
  const initialState = await helper.call('verify_element_state', {
    selector: resultName,
    expectedWindowTitle: fixtureTitle,
    state: 'present',
    role: 'Text',
  });
  assert(!initialState.matches, 'Reset the fixture to its pending state before running this check.');

  const databaseParent = dirname(databasePath);
  mkdirSync(databaseParent, { recursive: true });
  database = new Database({ path: databasePath });
  database.migrate();
  const taskStore = new TaskStore(database);
  const registry = new ToolRegistry();
  const audit = new AuditLog();
  const approvalRequests = [];
  let permissions;
  permissions = new PermissionBroker(registry, audit, (request) => {
    approvalRequests.push({ toolName: request.toolName, risk: request.risk });
    queueMicrotask(() => permissions.respond({
      requestId: request.id,
      approved: true,
      duration: 'once',
    }));
  });

  const outcomes = [
    toolOutcome('get_foreground_window', {}, 1),
    toolOutcome('find_ui_elements', { text: buttonName, roles: ['Button'], maxResults: 5 }, 2),
    toolOutcome('find_ui_elements', { text: resultName, roles: ['Text'], maxResults: 5 }, 3),
    toolOutcome('invoke_ui_element', {
      selector: buttonName,
      role: 'Button',
      expectedWindowTitle: fixtureTitle,
      expectedResult: { selector: resultName, role: 'Text', state: 'present' },
    }, 4),
    toolOutcome('verify_ui_state', {
      selector: resultName,
      role: 'Text',
      expectedWindowTitle: fixtureTitle,
      state: 'present',
    }, 5),
    answerOutcome('The harmless UIA action completed and its postcondition was verified.'),
  ];
  const engine = {
    async runTurn() { return outcomes.shift() ?? answerOutcome('No further action.'); },
    abort() {},
  };
  const tasks = new TaskManager(() => undefined, taskStore);
  const executors = new ToolExecutors({ nativeHelper: helper });
  const agent = new AgentExecutor({
    engine,
    registry,
    permissions,
    tasks,
    audit,
    executors,
    emit: () => undefined,
    isStopped: () => false,
  });

  const runResult = await agent.run({
    requestId: `uia-e2e-${stamp}`,
    request: {
      text: 'Read the foreground window, find the harmless UIA action, request one-time approval, invoke it, and verify the completion label.',
      mode: 'hybrid',
    },
    model: 'scripted-uia-e2e',
  });

  assert(runResult.task.status === 'completed', `Task ended in ${runResult.task.status}.`);
  for (const name of ['get_foreground_window', 'find_ui_elements', 'invoke_ui_element', 'verify_ui_state']) {
    const execution = runResult.executed.find((step) => step.name === name);
    assert(execution?.ok, `The ${name} task step did not succeed.`);
  }
  assert(runResult.task.pendingVerifications.length === 0, 'Task retained an unverified action.');
  const actionStep = runResult.task.steps.find((step) => step.toolName === 'invoke_ui_element');
  assert(actionStep?.status === 'verified', 'The invocation step was not marked verified.');
  assert(runResult.task.evidence.some((item) => item.kind === 'verification'), 'Task has no persisted verification evidence.');
  assert(approvalRequests.some((item) => item.toolName === 'invoke_ui_element' && item.risk === 'high'), 'No one-time invocation approval was requested.');

  database.close();
  database = new Database({ path: databasePath });
  database.migrate();
  const durableStore = new TaskStore(database);
  const savedTask = durableStore.load().find((task) => task.id === runResult.task.id);
  assert(savedTask?.status === 'completed', 'The completed task was not restored from SQLite.');
  assert(savedTask.steps.find((step) => step.toolName === 'invoke_ui_element')?.status === 'verified', 'The verified UIA result was not durable.');
  assert(durableStore.events(savedTask.id).length > 0, 'No task events were recorded.');

  const report = {
    checkedAt: new Date().toISOString(),
    fixtureTitle,
    foregroundRead: before.title,
    uniqueButtonFound: true,
    initialPostconditionAbsent: true,
    oneTimeApprovalRequests: approvalRequests,
    invoked: true,
    postconditionVerified: true,
    taskStatus: savedTask.status,
    invocationStepStatus: savedTask.steps.find((step) => step.toolName === 'invoke_ui_element')?.status,
    verificationEvidenceCount: savedTask.evidence.filter((item) => item.kind === 'verification').length,
    durableTaskEventCount: durableStore.events(savedTask.id).length,
    taskId: savedTask.id,
    databasePath,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  database?.close();
  helper.dispose();
  await helper.whenStopped();
}
