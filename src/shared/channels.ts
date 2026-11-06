/**
 * IPC channel names.
 *
 * Kept in `shared` because both the main process and the preload bridge need
 * them. They must never be imported *from* the preload into the main process:
 * importing the preload module would execute `contextBridge` calls in the main
 * process, where they do not exist.
 */
export const CHANNELS = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSetApiKey: 'settings:setApiKey',
  settingsHasApiKey: 'settings:hasApiKey',
  settingsClearApiKey: 'settings:clearApiKey',
  settingsTestConnection: 'settings:testConnection',

  windowSetSurface: 'window:setSurface',
  windowSetExpanded: 'window:setExpanded',
  windowSetPosition: 'window:setPosition',
  windowGetPosition: 'window:getPosition',
  windowGetWorkArea: 'window:getWorkArea',
  windowHide: 'window:hide',
  windowShow: 'window:show',
  windowOpenSettings: 'window:openSettings',
  windowCloseSettings: 'window:closeSettings',
  windowSetIgnoreMouseEvents: 'window:setIgnoreMouseEvents',

  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatStream: 'chat:stream',

  historyList: 'history:list',
  historyClear: 'history:clear',

  screenListDisplays: 'screen:listDisplays',
  screenCaptureActiveWindow: 'screen:captureActiveWindow',
  screenCaptureDisplay: 'screen:captureDisplay',
  screenCaptureRegion: 'screen:captureRegion',

  systemDiagnostics: 'system:diagnostics',
  systemEmergencyStop: 'system:emergencyStop',
  systemEmergencyStopEvent: 'system:emergencyStopEvent',

  permissionsRespond: 'permissions:respond',
  permissionsListActiveGrants: 'permissions:listActiveGrants',
  permissionsRevokeAll: 'permissions:revokeAll',
  permissionsRequest: 'permissions:request',

  tasksPause: 'tasks:pause',
  tasksResume: 'tasks:resume',
  tasksCancel: 'tasks:cancel',
  tasksUpdate: 'tasks:update',

  auditList: 'audit:list',

  appGetVersion: 'app:getVersion',
  appQuit: 'app:quit',

  /** Shell-originated: the tray changed the mode. */
  modeChanged: 'cyps:modeChanged',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
