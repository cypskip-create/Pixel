; ---------------------------------------------------------------------------
; Pixel NSIS customisations (included by electron-builder).
;
; WHY THIS FILE EXISTS
;
; The stock installer shows "App cannot be closed. Please close it manually and
; click Retry to continue." from THREE unrelated code paths in electron-builder
; 26.18.0:
;
;   1. include/allowOnlyOneInstallerInstance.nsh:156 - a process from $INSTDIR
;      could not be terminated (typically an elevated or other-session instance,
;      which taskkill from a normal shell cannot see).
;   2. include/extractAppPackage.nsh:116             - CopyFiles into $INSTDIR
;      failed five times. That is a FILE LOCK / PERMISSION / DISK problem, not a
;      running application, yet it shows the same "cannot be closed" text.
;   3. include/installUtil.nsh:219                   - the previous version's
;      uninstaller failed five times during an upgrade. Same misleading text.
;
; So the message is NOT evidence that the app is running. These customisations
; fix the two causes the installer can control:
;
;   * customCheckAppRunning - replaces the built-in probe with an exact
;     image-name match against Pixel's own executables only. When PowerShell is
;     available the stock probe matches by "$_.Path.StartsWith($INSTDIR)", which
;     cannot see elevated processes yet still asks the user to close them
;     forever. Detection is made precise, not disabled.
;   * .onVerifyInstDir - rejects a directory we cannot write to at the moment it
;     is chosen, with an accurate message, so cause 2 never reaches the
;     misleading retry dialog.
;
; Only Pixel's own executables are ever terminated, and only for the current
; user. No user data is deleted by this script.
; ---------------------------------------------------------------------------

!include "LogicLib.nsh"

; How many automatic close attempts before involving the user.
!define PIXEL_KILL_ATTEMPTS 3

; ---------------------------------------------------------------------------
; Exact-image-name process lookup.
;
; `tasklist` filters by image name and `findstr /B /I /C:"\"name\""` anchors the
; match to the start of the CSV line, so "Pixel Helper.exe" never matches
; "Pixel.exe". Sets $R0 to 0 when at least one matching process exists.
; ---------------------------------------------------------------------------
!macro PIXEL_FIND_PROCESS _EXE
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${_EXE}" /FI "USERNAME eq %USERNAME%" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${_EXE}\""`
  Pop $R0
  ${If} $R0 == 0
    StrCpy $R0 0
  ${Else}
    StrCpy $R0 1
  ${EndIf}
!macroend

; Terminate Pixel's own executables for the current user. Never touches another
; product's processes.
!macro PIXEL_KILL_APP
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%" /FI "PID ne $PID"`
  Pop $R1
  !if "${APP_EXECUTABLE_FILENAME}" != "Cyps.exe"
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "Cyps.exe" /FI "USERNAME eq %USERNAME%" /FI "PID ne $PID"`
    Pop $R1
  !endif
  Sleep 1200
!macroend

; ---------------------------------------------------------------------------
; customCheckAppRunning
;
; electron-builder honours this macro in place of its own check
; (allowOnlyOneInstallerInstance.nsh:37). Written without nested macros because
; NSIS forbids defining a macro inside another macro.
; ---------------------------------------------------------------------------
!macro customCheckAppRunning
  StrCpy $R2 ""   ; names of the processes found, for messages

  !insertmacro PIXEL_FIND_PROCESS "${APP_EXECUTABLE_FILENAME}"
  ${If} $R0 == 0
    StrCpy $R2 "${APP_EXECUTABLE_FILENAME}"
  ${EndIf}

  ; A Cyps installation may still be running while being upgraded to Pixel.
  !if "${APP_EXECUTABLE_FILENAME}" != "Cyps.exe"
    !insertmacro PIXEL_FIND_PROCESS "Cyps.exe"
    ${If} $R0 == 0
      ${If} $R2 == ""
        StrCpy $R2 "Cyps.exe"
      ${Else}
        StrCpy $R2 "$R2, Cyps.exe"
      ${EndIf}
    ${EndIf}
  !endif

  ${If} $R2 == ""
    Goto pixel_not_running
  ${EndIf}

  DetailPrint "Closing: $R2"
  StrCpy $R3 0

  pixel_kill_loop:
    IntOp $R3 $R3 + 1
    DetailPrint "Closing $R2 (attempt $R3)"

    !insertmacro PIXEL_KILL_APP

    ; 1 = still running, 0 = gone.
    StrCpy $R4 1
    !insertmacro PIXEL_FIND_PROCESS "${APP_EXECUTABLE_FILENAME}"
    ${If} $R0 == 0
      StrCpy $R4 0
    ${EndIf}
    !if "${APP_EXECUTABLE_FILENAME}" != "Cyps.exe"
      !insertmacro PIXEL_FIND_PROCESS "Cyps.exe"
      ${If} $R0 == 0
        StrCpy $R4 0
      ${EndIf}
    !endif

    ${If} $R4 != 0
      Goto pixel_not_running
    ${EndIf}

    ${If} $R3 >= ${PIXEL_KILL_ATTEMPTS}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
        "$R2 is still running and could not be closed automatically.$\r$\n$\r$\n\
         This usually means Pixel was started as administrator, or is running in another Windows session.$\r$\n$\r$\n\
         Open Task Manager, switch to the Details tab, end any Pixel.exe or Cyps.exe task, then click Retry.$\r$\n$\r$\n\
         Click Cancel to stop the installation. Nothing has been changed on this computer." \
        /SD IDCANCEL IDRETRY pixel_kill_retry IDCANCEL pixel_abort
      Goto pixel_abort

      pixel_kill_retry:
        StrCpy $R3 0
        Goto pixel_kill_loop
    ${EndIf}

    Sleep 800
    Goto pixel_kill_loop

  pixel_abort:
    Quit

  pixel_not_running:
!macroend

; ---------------------------------------------------------------------------
; Directory validation.
;
; The stock flow accepts any directory and only discovers an unwritable one when
; CopyFiles fails, five retries later, with the unrelated "cannot be closed"
; message. Test writability as soon as the path is entered instead.
; ---------------------------------------------------------------------------
Function .onVerifyInstDir
  ; A silent install has no user to correct the path; do not block it.
  IfSilent pixel_dir_ok

  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors pixel_dir_unwritable

  ClearErrors
  FileOpen $0 "$INSTDIR\.pixel-write-test" w
  IfErrors pixel_dir_unwritable
  FileClose $0
  Delete "$INSTDIR\.pixel-write-test"
  Goto pixel_dir_ok

  pixel_dir_unwritable:
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "Pixel cannot write to:$\r$\n$INSTDIR$\r$\n$\r$\n\
       Windows blocked it, which usually means a protected system folder such as Program Files.$\r$\n$\r$\n\
       Choose a folder you own - for example inside your user folder - and the installation will continue normally."
    ; Abort keeps the user on the directory page with a path we can write to.
    Abort

  pixel_dir_ok:
    ClearErrors
FunctionEnd

; ---------------------------------------------------------------------------
; Upgrade from Cyps: remove only the stale legacy executable and shortcuts.
; Settings, credentials and history live in %APPDATA% and are never touched.
; ---------------------------------------------------------------------------
!macro customInstall
  ${If} ${FileExists} "$INSTDIR\Pixel.exe"
  ${AndIf} ${FileExists} "$INSTDIR\Cyps.exe"
    DetailPrint "Removing the old Cyps executable"
    Delete "$INSTDIR\Cyps.exe"
  ${EndIf}

  Delete "$DESKTOP\Cyps.lnk"
  Delete "$SMPROGRAMS\Cyps.lnk"
!macroend

!macro customUnInstall
  ; Remove anything a previous Cyps installation left behind, so the Start menu
  ; cannot show a shortcut pointing at a deleted executable.
  Delete "$DESKTOP\Cyps.lnk"
  Delete "$SMPROGRAMS\Cyps.lnk"
  Delete "$INSTDIR\Cyps.exe"
!macroend
