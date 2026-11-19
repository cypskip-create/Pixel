# Tools 4.2 UI Automation fixture result

Checked: 2026-11-19 on a real Windows desktop using the disposable WinForms
fixture, native Pixel helper, deterministic agent harness and SQLite task store.

## Result

- Initial attempts discovered the fixture and unique controls and verified
  ValuePattern entry/read-back, but TogglePattern and InvokePattern were
  rejected by the provider with `Operation is not valid due to the current
  state of the object`. The executor later correctly kept uncertain actions
  pending and left the task blocked when the expected state was absent.
- Subsequent runs from `2026-11-19T11:54:19Z` through `2026-11-19T12:06:33Z`
  repeatedly completed the scripted flow: exact external target enumerated;
  unique button found; ValuePattern input read back; InvokePattern executed;
  a separate `verify_ui_state` confirmed the completion label; TogglePattern
  reached the requested `on` state; and the task finished `completed`.
- Each passing report reopened SQLite and confirmed the completed durable task,
  verified invocation step, 3 verification records, and 61 task events. The
  latest repeated-run report is
  `artifacts/windows-acceptance/pixel-native-uia-e2e-2026-11-19T12-06-30-628Z.json`.
- A test-only cleanup fix bounded termination of the disposable fixture and
  exits only after helper and fixture terminal states are confirmed. A direct
  run at `2026-11-19T12:08:13Z` passed all assertions and exited **0**. Its
  report is
  `artifacts/windows-acceptance/pixel-native-uia-e2e-2026-11-19T12-08-10-748Z.json`.
- The documented `npm run test:native-uia-fixture` path then passed end to end
  and exited **0** at `2026-11-19T12:11:28Z`. Its report is
  `artifacts/windows-acceptance/pixel-native-uia-e2e-2026-11-19T12-11-25-948Z.json`.
  Pixel's actual Electron approval-card interaction, emergency stop and restart
  recovery have not been exercised through the GUI.

An early harness run returned a final answer and recorded `completed` despite
failed actions. The executor correction now keeps uncertain state-changing
failures pending and refuses completion until a fresh observation and verified
outcome. Do not treat failed attempts as task success.

## Next validation

The documented fixture command now passes with exit code 0. Then use Pixel's
Electron UI with the fixture to test exact-window selection, one-time approval,
denial, cancellation, emergency stop and restart recovery. The fixture reports
demonstrate the native semantic actions and durable verification path, but do
not prove the visible Pixel UI workflow.
