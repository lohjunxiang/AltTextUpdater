\
    @echo off
    setlocal
    REM Dry-run (preview only) — no writes.
    set ALT_DRY_RUN=1
    where py >nul 2>nul && (set PY=py -3) || (set PY=python)
    %PY% "%~dp0update_alt_text_from_csv.py"
    echo.
    echo Done. Press any key to close...
    pause >nul
