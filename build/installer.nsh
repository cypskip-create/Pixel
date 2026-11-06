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
; So the message is NOT evidence that the app is running.
;
; HISTORY, AND WHY THERE IS NO .onVerifyInstDir ANY MORE
;
; Version 0.2.0 shipped a directory preflight in .onVerifyInstDir. On real
; hardware that callback rejected a directory Windows could demonstrably write
; to. The callback is invoked from inside MUI's directory page - potentially many
; times while the path is being typed, and with the page's own register state
; live. That made it both noisy (a modal dialog mid-typing) and unsafe (it used
; $0, a general-purpose register the page code owns).
;
; The preflight now runs exactly once instead: in customInit, after $INSTDIR has
; been initialised, and it only ever informs the user - it never blocks a
; directory that passes the write test. The authoritative failure path remains
; NSIS's own extraction error, which this cannot make worse.
;
; Process detection is NOT disabled: it is made exact. Only Pixel's own
; executables are ever terminated, and only for the current user.
; ---------------------------------------------------------------------------

!include "LogicLib.nsh"
; electron-builder puts the build-resources directory on the include path; when
; compiled directly (the regression harness) the caller supplies the path.
!ifdef PIXEL_BUILD_DIR
  !include "${PIXEL_BUILD_DIR}\dir-check.nsh"
!else
  !include "dir-check.nsh"
!endif

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
; customInit - one deterministic directory check.
;
; Runs inside .onInit after initMultiUser has set $INSTDIR. It is informational:
; a writable directory always proceeds without a prompt, so it can never produce
; the false rejection that .onVerifyInstDir caused.
; ---------------------------------------------------------------------------
!macro customInit
  Push $0
  Push $1
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $9

  ; One insertion only: NSIS labels inside a macro are global, so a second
  ; insertion would be a duplicate-label error. The retry loops back here.
  pixel_dir_recheck:
    !insertmacro PIXEL_CHECK_DIR_WRITABLE "$INSTDIR" $R8

    ${If} $R8 == 1
      Goto pixel_dir_checked
    ${EndIf}

    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
      "Pixel may not be able to install into:$\r$\n$INSTDIR$\r$\n$\r$\n\
       Windows did not allow a test file to be created there. This is usually a protected folder such as Program Files.$\r$\n$\r$\n\
       Click Retry to check again, or Cancel and restart the installer choosing a folder inside your user profile.$\r$\n$\r$\n\
       Nothing has been changed on this computer." \
      /SD IDCANCEL IDRETRY pixel_dir_retry IDCANCEL pixel_dir_cancel

    Goto pixel_dir_checked

    pixel_dir_retry:
      Goto pixel_dir_recheck

    pixel_dir_cancel:
      Pop $9
      Pop $R8
      Pop $R7
      Pop $R6
      Pop $R5
      Pop $1
      Pop $0
      Quit

  pixel_dir_checked:
  Pop $9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $1
  Pop $0
!macroend

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
