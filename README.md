# Alt Text Updater (No-Setup Edition)

Update all image `alt` texts in your JSON files based on a simple CSV — **no extra installs**.
Works on macOS, Windows, and Linux with **Python 3**.

## Folder layout
Put this entire folder anywhere, then drop your JSON files into `jsonFiles/`:

```
AltTextUpdater/
├─ update_alt_text_from_csv.py     ← the script
├─ alt-text-output.csv             ← 2 columns: image path/name, alt text
├─ jsonFiles/                      ← your *.json files (can have subfolders)
├─ run-update.sh / run-dry.sh      ← macOS/Linux helpers
└─ run-update.bat / run-dry.bat    ← Windows helpers
```

## CSV format
- **Two columns** per row (no header required):
  1. image path or filename (e.g. `/images/about-us/org-chart/president-loh.jpg` or `this-is-an-image.png`)
  2. alt text for that image
- The script matches in this order: **exact path → filename → fuzzy slug** (filename stripped of digits/punctuation).

## How to run

### Windows
1. Ensure **Python 3** is installed (start > "Python", or install from https://python.org if needed).
2. Double-click **`run-dry.bat`** to preview changes (no files are modified).
3. Double-click **`run-update.bat`** to apply changes. A backup copy of `jsonFiles/` is saved to `backup_jsonFiles/`.

### macOS / Linux
1. Ensure **Python 3** is installed:
   - macOS: `python3 --version`
   - Linux: `python3 --version`
2. In Terminal, `cd` into this folder and run one of:
   - Preview only: `./run-dry.sh`
   - Apply updates: `./run-update.sh`
   (If needed, run `chmod +x run-*.sh` once to make them executable.)

### VS Code (optional)
- Open this folder in VS Code.
- Use the integrated Terminal (View → Terminal), then run:
  - Preview: `./run-dry.sh` (macOS/Linux) or `.
un-dry.bat` (Windows)
  - Update: `./run-update.sh` (macOS/Linux) or `.
un-update.bat` (Windows)

## What the script does
- Scans all `*.json` under `jsonFiles/` (recursively).
- Updates any image alt text when it finds a match in your CSV.
- Saves a report in `reports/`:
  - `alt-text-update-summary.json` (overview)
  - `alt-text-update-report.csv` (flat list of changes)

## Safe switches (optional)
- `ALT_DRY_RUN=1` → preview only (no writes).
- `ALT_BACKUP=1` → creates a `backup_jsonFiles/` folder before writing.

Examples (macOS/Linux):
```bash
ALT_DRY_RUN=1 python3 update_alt_text_from_csv.py
ALT_BACKUP=1 python3 update_alt_text_from_csv.py
```

## Troubleshooting
- **Python not found**: Install Python 3 from https://python.org and re-open your terminal or VS Code.
- **No changes**: Make sure image names/paths in the CSV match those in your JSON. The script tries exact-path, then filename, then fuzzy match.
- **CSV has a header**: That’s fine — the script will try to skip a header-like first row automatically.
- **JSON errors**: Invalid JSON files are skipped with a warning.

---
