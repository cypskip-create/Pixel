; ---------------------------------------------------------------------------
; Reproducible regression harness for the installer's directory preflight.
;
; Compiled by tests/nsis.test.ts with makensis, then executed. It runs two
; implementations against the same directory and writes both verdicts to a file:
;
;   OLD - the shipped 0.2.0 logic: CreateDirectory, then treat the error flag as
;         "unwritable", then a write test.
;   NEW - build/dir-check.nsh: the write attempt is the only authority.
;
; The test asserts the two agree on genuinely bad paths and that NEW accepts a
; writable one. It also asserts OLD rejects an *existing* writable directory,
; which is the failure reported on real hardware; if that assertion ever stops
; holding, the bug is gone and this file is documenting history.
;
; Parameters come from makensis /D, so each case is fully deterministic:
;   /DTEST_DIR="C:\some\dir"
;   /DRESULT_FILE="C:\out\result.txt"
;   /DOUTFILE="C:\out\dircheck.exe"
; ---------------------------------------------------------------------------

!ifndef TEST_DIR
  !error "TEST_DIR must be supplied: makensis /DTEST_DIR=..."
!endif
!ifndef RESULT_FILE
  !error "RESULT_FILE must be supplied: makensis /DRESULT_FILE=..."
!endif
!ifndef OUTFILE
  !error "OUTFILE must be supplied: makensis /DOUTFILE=..."
!endif

!include "LogicLib.nsh"
!ifndef PIXEL_BUILD_DIR
  !error "PIXEL_BUILD_DIR must be supplied: makensis /DPIXEL_BUILD_DIR=..."
!endif
!include "${PIXEL_BUILD_DIR}\dir-check.nsh"

Name "PixelDirCheck"
OutFile "${OUTFILE}"
RequestExecutionLevel user
SilentInstall silent
ShowInstDetails nevershow
SetCompressor /SOLID zlib

Section "Check"
  StrCpy $INSTDIR "${TEST_DIR}"

  ; --- OLD logic (what 0.2.0 shipped) -------------------------------------
  StrCpy $R1 0   ; verdict

  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors old_done

  ClearErrors
  FileOpen $0 "$INSTDIR\.pixel-write-test" w
  IfErrors old_done

  FileClose $0
  Delete "$INSTDIR\.pixel-write-test"
  StrCpy $R1 1

  old_done:

  ; --- NEW logic ----------------------------------------------------------
  !insertmacro PIXEL_CHECK_DIR_WRITABLE "$INSTDIR" $R2

  ; --- Report -------------------------------------------------------------
  StrCpy $3 "${RESULT_FILE}"
  ClearErrors
  FileOpen $4 "$3" w
  IfErrors report_failed

  FileWrite $4 "OLD=$R1$\r$\n"
  FileWrite $4 "NEW=$R2$\r$\n"
  FileWrite $4 "DIR=$INSTDIR$\r$\n"
  FileClose $4
  Goto done

  report_failed:
    SetErrorLevel 2
    Goto done

  done:
SectionEnd
