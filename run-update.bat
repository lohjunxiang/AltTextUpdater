\
    @echo off
    setlocal
    REM Run (writes changes) with backups.
    set ALT_BACKUP=1
    REM Prefer 'py -3', fallback to 'python'
    where py >nul 2>nul && (set PY=py -3) || (set PY=python)
    %PY% "%~dp0update_alt_text_from_csv.py"
    echo.
    echo Done. Press any key to close...
    pause >nul
