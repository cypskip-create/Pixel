import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
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
const fixtureExecutable = resolve('native/bin/PixelNativeUiAutomationFixture.exe');
const buttonName = 'Run harmless UIA action';
const resultName = 'Pixel harmless action: completed';
const harmlessValue = 'Pixel UIA verified harmless input';
const artifactDirectory = resolve('artifacts/windows-acceptance');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const databasePath = resolve(artifactDirectory, `pixel-native-uia-e2e-${stamp}.sqlite`);
const reportPath = resolve(artifactDirectory, `pixel-native-uia-e2e-${stamp}.json`);
const helper = new NativeHelper({
  executablePath: resolve('native/bin/PixelNative.exe'),
});
let database;
let fixtureProcess;

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

async function stopFixtureProcess() {
  if (!fixtureProcess) return;
  if (fixtureProcess.exitCode !== null || fixtureProcess.signalCode !== null) {
    fixtureProcess.unref();
    return;
  }

  const exited = new Promise((resolveExit) => fixtureProcess.once('exit', () => resolveExit(true)));
  fixtureProcess.kill();
  let timer;
  const confirmed = await Promise.race([
    exited,
    new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), 3000); }),
  ]);
  if (timer) clearTimeout(timer);
  if (confirmed) {
    fixtureProcess.unref();
    return;
  }

  process.stderr.write('[uia-e2e] fixture exit was not confirmed within 3 seconds; marking cleanup failed\n');
  process.exitCode = 1;
  // This is the disposable test fixture only. It has no access to files,
  // network or shell. The kill was sent; do not let an unconfirmed fixture
  // child keep the test runner open indefinitely.
  fixtureProcess.unref();
}

async function main() {
  assert(process.platform === 'win32', 'This UIA integration check only runs on Windows.');
  assert(helper.available().available, 'PixelNative.exe is not available; build the native helper first.');

  if (process.argv.includes('--launch-fixture')) {
    fixtureProcess = spawn(fixtureExecutable, [], { windowsHide: false, stdio: 'ignore' });
    await new Promise((resolveSpawn, rejectSpawn) => {
      fixtureProcess.once('spawn', resolveSpawn);
      fixtureProcess.once('error', rejectSpawn);
    });
    let fixtureWindow;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      const observed = await helper.call('list_external_windows', {});
      const matches = observed.windows.filter((window) => window.title === fixtureTitle);
      if (matches.length === 1) { fixtureWindow = matches[0]; break; }
      if (matches.length > 1) throw new Error('More than one harmless UIA fixture window is open.');
    }
    assert(fixtureWindow, 'The harmless UIA fixture did not expose one unique visible window.');
  }

  const windowListing = await helper.call('list_external_windows', {});
  const fixtureMatches = windowListing.windows.filter((window) => window.title === fixtureTitle);
  assert(fixtureMatches.length === 1, 'One visible harmless fixture window must be available; no task action was run.');
  const selected = fixtureMatches[0];
  const selectedWindow = {
    targetWindowId: selected.windowId,
    expectedWindowTitle: selected.title,
    expectedProcessId: selected.pid,
    expectedProcessName: selected.processName,
  };
  const buttonSearch = await helper.call('find_elements', {
    text: buttonName,
    roles: ['Button'],
    maxResults: 5,
    ...selectedWindow,
  });
  assert(buttonSearch.window.title === fixtureTitle, 'The fixture identity changed before the button search.');
  assert(buttonSearch.elements.length === 1 && buttonSearch.elements[0]?.name === buttonName, 'The fixture button was not uniquely identifiable.');
  const initialState = await helper.call('verify_element_state', {
    selector: resultName,
    ...selectedWindow,
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
    toolOutcome('list_external_windows', {}, 1),
    toolOutcome('find_ui_elements', { text: buttonName, roles: ['Button'], maxResults: 5, ...selectedWindow }, 2),
    toolOutcome('find_ui_elements', { text: resultName, roles: ['Text'], maxResults: 5, ...selectedWindow }, 3),
    toolOutcome('type_text', {
      text: harmlessValue,
      selector: 'PixelTestEditor',
      role: 'Edit',
      ...selectedWindow,
    }, 4),
    toolOutcome('invoke_ui_element', {
      selector: buttonName,
      role: 'Button',
      ...selectedWindow,
      expectedResult: { selector: resultName, role: 'Text', state: 'present' },
    }, 5),
    toolOutcome('verify_ui_state', {
      selector: resultName,
      role: 'Text',
      ...selectedWindow,
      state: 'present',
    }, 6),
    toolOutcome('control_ui_element', {
      selector: 'PixelHarmlessSwitch',
      role: 'CheckBox',
      action: 'toggle',
      desiredToggleState: 'on',
      ...selectedWindow,
    }, 7),
    answerOutcome('The harmless UIA action completed and its postcondition was verified.'),
  ];
  const observedToolResults = [];
  const engine = {
    async runTurn(options) {
      observedToolResults.push(...options.messages.filter((message) => message.role === 'tool').map((message) => message.content));
      return outcomes.shift() ?? answerOutcome('No further action.');
    },
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
      text: 'List windows, select the unique harmless UIA fixture, enter harmless test text, toggle its test switch on, invoke the harmless button, and verify the completion label.',
      mode: 'hybrid',
    },
    model: 'scripted-uia-e2e',
  });

  // Save a compact diagnostic artifact before assertions so Windows fixture
  // failures retain the precise step and redacted result summary.
  const diagnostic = {
    checkedAt: new Date().toISOString(),
    fixtureTitle,
    selectedWindowTitle: selected.title,
    passed: false,
    taskStatus: runResult.task.status,
    steps: runResult.task.steps.map((step) => ({
      toolName: step.toolName,
      status: step.status,
      detail: step.detail,
    })),
    executed: runResult.executed.map((step) => ({ name: step.name, ok: step.ok, summary: step.summary })),
    toolErrors: observedToolResults.filter((content) =>
      /The tool "(control_ui_element|invoke_ui_element)" failed:/.test(content)),
    oneTimeApprovalRequests: approvalRequests,
    taskId: runResult.task.id,
    databasePath,
  };
  writeFileSync(reportPath, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');

  const failedSteps = runResult.task.steps
    .filter((step) => step.status === 'failed')
    .map((step) => `${step.toolName ?? step.title}: ${step.detail ?? 'failed without a detail'}`)
    .join(' | ');
  assert(runResult.task.status === 'completed', `Task ended in ${runResult.task.status}.${failedSteps ? ` Failed steps: ${failedSteps}` : ''}`);
  for (const name of ['list_external_windows', 'find_ui_elements', 'type_text', 'control_ui_element', 'invoke_ui_element', 'verify_ui_state']) {
    const execution = runResult.executed.find((step) => step.name === name);
    const lastFailure = observedToolResults.filter((content) => content.startsWith('The tool "') || content.startsWith('Windows refused')).at(-1);
    const savedStep = runResult.task.steps.find((step) => step.toolName === name);
    assert(execution?.ok, `The ${name} task step did not succeed.${savedStep?.detail ? ` Step detail: ${savedStep.detail}` : ''}${lastFailure ? ` Native result: ${lastFailure}` : ''}`);
  }
  assert(runResult.task.pendingVerifications.length === 0, 'Task retained an unverified action.');
  const actionStep = runResult.task.steps.find((step) => step.toolName === 'invoke_ui_element');
  assert(actionStep?.status === 'verified', 'The invocation step was not marked verified.');
  assert(runResult.task.steps.find((step) => step.toolName === 'type_text')?.status === 'verified', 'ValuePattern read-back did not verify text entry.');
  assert(runResult.task.steps.find((step) => step.toolName === 'control_ui_element')?.status === 'verified', 'TogglePattern read-back did not verify the switch.');
  assert(runResult.task.evidence.some((item) => item.kind === 'verification'), 'Task has no persisted verification evidence.');
  for (const name of ['type_text', 'control_ui_element', 'invoke_ui_element']) {
    assert(approvalRequests.some((item) => item.toolName === name && item.risk === 'high'), `No one-time approval was requested for ${name}.`);
  }

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
    passed: true,
    fixtureTitle,
    selectedWindowTitle: selected.title,
    targetEnumerated: true,
    uniqueButtonFound: true,
    initialPostconditionAbsent: true,
    oneTimeApprovalRequests: approvalRequests,
    invoked: true,
    valuePatternVerified: true,
    togglePatternVerified: true,
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
  process.stderr.write('[uia-e2e] cleanup: closing SQLite\n');
  database?.close();
  process.stderr.write('[uia-e2e] cleanup: stopping PixelNative\n');
  helper.dispose();
  const cleanupNotice = setTimeout(() => {
    process.stderr.write(`[uia-e2e] still waiting for confirmed helper exit (running=${helper.running}, terminating=${helper.terminating})\n`);
  }, 5000);
  await helper.whenStopped();
  clearTimeout(cleanupNotice);
  process.stderr.write('[uia-e2e] cleanup: PixelNative exit confirmed\n');
  await stopFixtureProcess();
  const fixtureStopped = !fixtureProcess || fixtureProcess.exitCode !== null || fixtureProcess.signalCode !== null;
  if (!helper.running && !helper.terminating && fixtureStopped) {
    // UIA/Win32 may leave non-process handles referenced after both owned child
    // processes have terminated. Exit only after those process states are
    // confirmed, preserving the test result while preventing a stale runner.
    await new Promise((resolveFlush) => setTimeout(resolveFlush, 10));
    process.exit(process.exitCode ?? 0);
  }
}
