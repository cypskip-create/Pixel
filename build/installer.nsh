; ---------------------------------------------------------------------------
; Pixel NSIS customisations (included by electron-builder).
;
; SCOPE: legacy-cleanup only.
;
; Earlier revisions of this file overrode two maintained electron-builder
; behaviours:
;
;   * customCheckAppRunning - a bespoke process probe
;   * customInit / .onVerifyInstDir - a directory writability preflight
;
; Both are removed. Evidence from the field: the directory preflight rejected
; directories that Windows and PowerShell could both write to, and changing the
; destination did not help. A preflight that runs before the directory page has a
; reliable value can only produce false rejections, and the maintained NSIS flow
; already reports a genuine write failure. electron-builder's own process
; detection is likewise preferred: it is maintained, and our replacement added
; failure modes without removing any.
;
; What remains is deliberately boring: on upgrade and uninstall, remove the
; executable and shortcuts left behind by the pre-rename Cyps build. Nothing here
; touches user data, the registry, or Electron settings.
; ---------------------------------------------------------------------------

!macro customInstall
  ; Only when the new executable is already in place, so a failed extraction can
  ; never leave the user without an app.
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
