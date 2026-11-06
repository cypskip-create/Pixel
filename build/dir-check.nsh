; ---------------------------------------------------------------------------
; Directory writability check shared by the Pixel installer and its tests.
;
; Why this exists twice in one file (old and new) is documented in
; tests/nsis/dir-check.nsi: the old approach rejected directories Windows
; considers writable, and the regression test compiles both so the difference is
; reproducible rather than asserted.
;
; Insert PIXEL_CHECK_DIR_WRITABLE at most once per script: NSIS labels inside a
; macro are global, so a second insertion would be a duplicate-label error.
; ---------------------------------------------------------------------------

!ifndef PIXEL_DIR_CHECK_INCLUDED
!define PIXEL_DIR_CHECK_INCLUDED

!include "LogicLib.nsh"

; Sets ${_RESULT} to 1 when a file can actually be created in ${_DIR}, else 0.
;
; The write attempt is the authoritative test. CreateDirectory is called first so
; a directory that does not exist yet but can be created still passes, but its
; result is deliberately ignored: treating "directory already exists" as an error
; is exactly the bug this replaced.
!macro PIXEL_CHECK_DIR_WRITABLE _DIR _RESULT
  StrCpy ${_RESULT} 0

  ; Normalise a trailing separator so "C:\App\" and "C:\App" behave the same.
  StrCpy $R7 "${_DIR}"
  StrLen $R5 "$R7"
  ${If} $R5 > 1
    StrCpy $R6 "$R7" 1 -1
    ${If} $R6 == "\"
      IntOp $R5 $R5 - 1
      StrCpy $R7 "$R7" $R5
    ${EndIf}
  ${EndIf}

  ClearErrors
  CreateDirectory "$R7"
  ; Result ignored on purpose; see above.

  ClearErrors
  FileOpen $9 "$R7\.pixel-write-test" w
  IfErrors pixel_dir_check_done

  FileClose $9
  Delete "$R7\.pixel-write-test"
  StrCpy ${_RESULT} 1

  pixel_dir_check_done:
!macroend

!endif
