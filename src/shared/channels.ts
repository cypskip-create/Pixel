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
  settingsChanged: 'settings:changed',
  settingsApiKeyStatusChanged: 'settings:apiKeyStatusChanged',

  windowSetSurface: 'window:setSurface',
  windowSetLayout: 'window:setLayout',
  windowFocusLost: 'window:focusLost',
  windowSummon: 'window:summon',
  windowCursorMotion: 'window:cursorMotion',
  windowCursorPlacement: 'window:cursorPlacement',
  windowSetExpanded: 'window:setExpanded',
  windowHide: 'window:hide',
  windowShow: 'window:show',
  windowOpenSettings: 'window:openSettings',
  windowCloseSettings: 'window:closeSettings',
  windowSetIgnoreMouseEvents: 'window:setIgnoreMouseEvents',
  workspaceOpen: 'workspace:open',
  workspaceClose: 'workspace:close',
  workspaceMinimize: 'workspace:minimize',
  workspaceToggleMaximize: 'workspace:toggleMaximize',
  workspaceSetFullscreen: 'workspace:setFullscreen',
  workspaceGetState: 'workspace:getState',
  workspaceState: 'workspace:state',

  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatStream: 'chat:stream',
  browserOpenSearch: 'browser:openSearch',

  historyList: 'history:list',
  historyOpen: 'history:open',
  historyCreate: 'history:create',
  historyRename: 'history:rename',
  historyDelete: 'history:delete',
  historyClear: 'history:clear',
  historyGetActive: 'history:getActive',
  historyActiveChanged: 'history:activeChanged',

  screenListDisplays: 'screen:listDisplays',
  screenListExternalWindows: 'screen:listExternalWindows',
  screenCaptureActiveWindow: 'screen:captureActiveWindow',
  screenCaptureLastExternalWindow: 'screen:captureLastExternalWindow',
  screenCaptureSelectedWindow: 'screen:captureSelectedWindow',
  screenCaptureDisplay: 'screen:captureDisplay',
  screenCaptureRegion: 'screen:captureRegion',
  screenGuidanceUpdate: 'screen:guidanceUpdate',

  systemDiagnostics: 'system:diagnostics',
  systemEmergencyStop: 'system:emergencyStop',
  systemIsEmergencyStopped: 'system:isEmergencyStopped',
  systemEmergencyClear: 'system:emergencyClear',
  systemEmergencyStopEvent: 'system:emergencyStopEvent',

  permissionsRespond: 'permissions:respond',
  permissionsListActiveGrants: 'permissions:listActiveGrants',
  permissionsRevokeAll: 'permissions:revokeAll',
  permissionsRequest: 'permissions:request',
  permissionsListPending: 'permissions:listPending',
  permissionsResolved: 'permissions:resolved',

  tasksPause: 'tasks:pause',
  tasksResume: 'tasks:resume',
  tasksCancel: 'tasks:cancel',
  tasksContinueAfterHandoff: 'tasks:continueAfterHandoff',
  tasksList: 'tasks:list',
  tasksUpdate: 'tasks:update',

  skillsList: 'skills:list',
  skillsCreateDraft: 'skills:createDraft',
  skillsActivate: 'skills:activate',
  skillsDelete: 'skills:delete',

  routinesList: 'routines:list',
  routinesCreate: 'routines:create',
  routinesSetEnabled: 'routines:setEnabled',
  routinesDelete: 'routines:delete',
  routinesHistory: 'routines:history',
  routinesCancel: 'routines:cancel',
  routinesRetry: 'routines:retry',

  memoryList: 'memory:list',
  memoryUpdate: 'memory:update',
  memoryDelete: 'memory:delete',
  memoryExport: 'memory:export',
  memoryProjectsList: 'memory:projectsList',
  memorySetActiveProject: 'memory:setActiveProject',
  memoryProjectChanged: 'memory:projectChanged',

  auditList: 'audit:list',
  toolsList: 'tools:list',

  appGetVersion: 'app:getVersion',
  appQuit: 'app:quit',

  /** Shell-originated: the tray changed the mode. */
  modeChanged: 'cyps:modeChanged',

  /** Voice surface (outside CypsBridge: it is a shell capability, not chat data). */
  voiceCapability: 'voice:capability',
  voiceListen: 'voice:listen',
  voiceCancel: 'voice:cancel',
  voiceSpeak: 'voice:speak',
  voicePttState: 'voice:pttState',
  voicePttSubmit: 'voice:pttSubmit',
  voicePttStopCapture: 'voice:pttStopCapture',
  voicePttCaptureReady: 'voice:pttCaptureReady',
  voicePttTranscribe: 'voice:pttTranscribe',
  voiceTranscribeWav: 'voice:transcribeWav',
  voiceModelsList: 'voice:modelsList',
  voiceVoicesList: 'voice:voicesList',
  voiceModelDownload: 'voice:modelDownload',
  voiceModelCancelDownload: 'voice:modelCancelDownload',
  voiceModelRemove: 'voice:modelRemove',
  voiceModelsProgress: 'voice:modelsProgress',
  voiceCaptureAcquire: 'voice:captureAcquire',
  voiceCaptureRelease: 'voice:captureRelease',
  voiceCaptureCancel: 'voice:captureCancel',
  shortcutsGetStatus: 'shortcuts:getStatus',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
