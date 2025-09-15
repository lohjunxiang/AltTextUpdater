#!/usr/bin/env python3
"""
Self-contained Alt Text Updater (relative paths, orig-link mapping, no external deps)

Expected folder layout (put everything in one folder):
  AltTextUpdater/
    update_alt_text_from_csv.py     <-- this file
    alt-text-output.csv             <-- CSV:
                                        - 2 cols: [rel_or_url_or_filename, alt]
                                        - 3 cols: [new_relative_path, alt, original_link_url_or_path]
    jsonFiles/                      <-- contains *.json files to update

How to run:
  python update_alt_text_from_csv.py

Optional environment toggles:
  ALT_DRY_RUN=1        # preview only, do not write
  ALT_BACKUP=1         # write .bak files before saving
  ALT_REWRITE_SRC=1    # if an image src matches the CSV "original link", rewrite src to the CSV "relative path"
"""

import os
import json
import csv
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit, unquote
from typing import Tuple, Dict, Any, List, Optional

# ---------------- Helpers ----------------

def norm_url(u: str) -> str:
    if not u:
        return ""
    parts = urlsplit(u)
    normalized = unquote(parts.scheme + "://" + parts.netloc + parts.path if parts.scheme else parts.path)
    return normalized

def path_only(u: str) -> str:
    """Return decoded URL path only (no scheme/host/query/fragment)."""
    try:
        return unquote(urlsplit(u or "").path or "")
    except Exception:
        return u or ""

def is_image_path(p: str) -> bool:
    p = (p or "").lower()
    return any(p.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"))

def basename(p: str) -> str:
    try:
        return Path(norm_url(p)).name
    except Exception:
        return p or ""

def to_slug(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"\.[a-z0-9]+$", "", s)   # remove extension
    s = re.sub(r"[0-9]", "", s)          # remove digits
    s = re.sub(r"[^a-z]+", "", s)        # keep letters only
    return s

def _script_dir() -> Path:
    try:
        return Path(__file__).resolve().parent
    except NameError:
        return Path.cwd()

def find_csv(default_name: str = "alt-text-output.csv") -> Path:
    d = _script_dir()
    default = d / default_name
    if default.exists():
        return default
    csvs = list(d.glob("*.csv"))
    if len(csvs) == 1:
        return csvs[0]
    for c in csvs:
        if "alt" in c.name.lower():
            return c
    return default

def find_json_root() -> Path:
    d = _script_dir()
    jf = d / "jsonFiles"
    if jf.exists():
        return jf
    jf.mkdir(exist_ok=True)
    return jf

# ---------- CSV loader (2 or 3 columns) ----------

def load_alt_mapping(csv_path: Path) -> Tuple[
    Dict[str, str],  # by_relpath: path -> alt
    Dict[str, str],  # by_basename: filename -> alt
    Dict[str, str],  # by_slug: slug -> alt
    Dict[str, Tuple[str, str]],  # by_orig_map: orig_path -> (new_rel_path, alt)
    Dict[str, str],  # alt_by_origpath: orig_path -> alt
    Dict[str, str],  # alt_by_origbase: orig_basename -> alt
]:
    """
    Returns mappings for matching:
      - by_relpath: normalized relative path (e.g., /images/x.jpg) -> alt
      - by_basename: basename (e.g., x.jpg) -> alt
      - by_slug: fuzzy slug (letters only) -> alt
      - by_orig_map: original link path (e.g., /-//media/.../x.ashx) -> (new_relative_path, alt)
      - alt_by_origpath: original link path -> alt
      - alt_by_origbase: original link basename -> alt

    CSV accepted formats:
      2 columns (no header required):
        col0: image name/path/url
        col1: alt
      3 columns:
        col0: new relative path (for rewrite), e.g. /photos/.../x.jpg
        col1: alt
        col2: original link (url or path), e.g. https://.../x.ashx
    """
    by_relpath, by_basename, by_slug = {}, {}, {}
    by_orig_map: Dict[str, Tuple[str, str]] = {}
    alt_by_origpath, alt_by_origbase = {}, {}

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        return by_relpath, by_basename, by_slug, by_orig_map, alt_by_origpath, alt_by_origbase

    # Detect and skip a header-like first row
    start_idx = 0
    if len(rows[0]) >= 2 and ("alt" in (rows[0][1] or "").lower() or "image" in (rows[0][0] or "").lower()):
        start_idx = 1

    for row in rows[start_idx:]:
        if not row or len(row) < 2:
            continue

        # 2-column mode
        if len(row) == 2 or (len(row) >= 3 and not (row[2] or "").strip()):
            raw_path = (row[0] or "").strip()
            alt = (row[1] or "").strip()
            if not raw_path or not alt:
                continue

            parts = urlsplit(raw_path)
            rel = parts.path if parts.scheme else raw_path
            rel = path_only(rel)

            # Map by exact relative path if it looks like an image path or starts with /
            if rel and (rel.startswith("/") or is_image_path(rel)):
                by_relpath[rel] = alt

            b = basename(raw_path)
            if b:
                by_basename[b.lower()] = alt
                sl = to_slug(b)
                if sl:
                    by_slug[sl] = alt

        # 3-column mode: [new_rel_path, alt, original_link]
        else:
            new_rel = path_only((row[0] or "").strip())
            alt = (row[1] or "").strip()
            orig_raw = (row[2] or "").strip()
            orig_path = path_only(orig_raw)
            if not alt or not orig_path:
                continue

            # record mapping from original path -> alt
            alt_by_origpath[orig_path] = alt
            ob = basename(orig_raw)
            if ob:
                alt_by_origbase[ob.lower()] = alt

            # if new_rel exists, set mapping for rewrite and also allow normal matching by rel
            if new_rel:
                by_orig_map[orig_path] = (new_rel, alt)
                if new_rel.startswith("/") or is_image_path(new_rel):
                    by_relpath[new_rel] = alt

            # also add filename/slug variants for convenience
            if new_rel:
                b = basename(new_rel)
            else:
                b = basename(orig_raw)
            if b:
                by_basename[b.lower()] = alt
                sl = to_slug(b)
                if sl:
                    by_slug[sl] = alt

    return by_relpath, by_basename, by_slug, by_orig_map, alt_by_origpath, alt_by_origbase

# ------------- JSON writers -------------

def _tiptap_has_attrs_src(node: dict) -> bool:
    return isinstance(node.get("attrs"), dict) and "src" in node["attrs"]

def set_alt_in_node(node: Any, alt: str, *, force: bool = False) -> bool:
    """
    Update only the existing shape:
      - TipTap: node.type=="image" with attrs.src -> update attrs.alt
      - Top-level image node: node.type=="image" with src -> update node.alt
      - page.image{src,alt}, imageSrc/imageAlt, or plain src/alt pairs
    Never create attrs if it didn't exist.
    """
    changed = False
    if not isinstance(node, dict):
        return False

    # Prefer explicit image-node handling
    if node.get("type") == "image":
        if _tiptap_has_attrs_src(node):
            attrs = dict(node["attrs"])
            if attrs.get("alt") != alt:
                attrs["alt"] = alt
                node["attrs"] = attrs
                changed = True
            return changed
        elif "src" in node and (force or is_image_path(str(node.get("src")))):
            if node.get("alt") != alt:
                node["alt"] = alt
                changed = True
            return changed
        # fall through to other shapes if neither applies

    # Case 1: page.image.src / page.image.alt
    if "image" in node and isinstance(node["image"], dict) and "src" in node["image"]:
        if node["image"].get("alt") != alt:
            node["image"]["alt"] = alt
            changed = True

    # Case 2: sibling keys imageSrc/imageAlt
    if "imageSrc" in node:
        if node.get("imageAlt") != alt:
            node["imageAlt"] = alt
            changed = True

    # Case 3: plain src/alt pair
    if "src" in node and (force or is_image_path(str(node.get("src")))):
        if node.get("alt") != alt:
            node["alt"] = alt
            changed = True

    return changed

def set_src_and_alt_in_node(node: Any, new_src: str, alt: str) -> bool:
    """
    Rewrite src to new_src and set alt, touching only the existing shape.
    Never create attrs if it didn't exist.
    """
    changed = False
    if not isinstance(node, dict):
        return False

    # Prefer explicit image-node handling
    if node.get("type") == "image":
        if _tiptap_has_attrs_src(node):
            attrs = dict(node["attrs"])
            if attrs.get("src") != new_src:
                attrs["src"] = new_src
                changed = True
            if attrs.get("alt") != alt:
                attrs["alt"] = alt
                changed = True
            node["attrs"] = attrs
            return changed
        elif "src" in node:
            if node.get("src") != new_src:
                node["src"] = new_src
                changed = True
            if node.get("alt") != alt:
                node["alt"] = alt
                changed = True
            return changed
        # fall through to other shapes if neither applies

    # Case 1: page.image.{src,alt}
    if "image" in node and isinstance(node["image"], dict) and "src" in node["image"]:
        if node["image"].get("src") != new_src:
            node["image"]["src"] = new_src
            changed = True
        if node["image"].get("alt") != alt:
            node["image"]["alt"] = alt
            changed = True

    # Case 2: imageSrc/imageAlt
    if "imageSrc" in node:
        if node.get("imageSrc") != new_src:
            node["imageSrc"] = new_src
            changed = True
        if node.get("imageAlt") != alt:
            node["imageAlt"] = alt
            changed = True

    # Case 3: plain src/alt
    if "src" in node:
        if node.get("src") != new_src:
            node["src"] = new_src
            changed = True
        if node.get("alt") != alt:
            node["alt"] = alt
            changed = True

    return changed

# ------------- Matching helpers -------------

def match_alt_for_src(
    img_src: str,
    by_relpath: Dict[str, str],
    by_basename: Dict[str, str],
    by_slug: Dict[str, str],
    alt_by_origpath: Dict[str, str],
    alt_by_origbase: Dict[str, str],
) -> str:
    """Find an alt for a given src without rewriting the src."""
    if not img_src:
        return ""
    k_rel = path_only(img_src)
    k_base = basename(img_src).lower()
    k_slug = to_slug(k_base)

    # Prefer explicit original-link mappings first (when present)
    if k_rel in alt_by_origpath:
        return alt_by_origpath[k_rel]
    if k_base in alt_by_origbase:
        return alt_by_origbase[k_base]

    if k_rel in by_relpath:
        return by_relpath[k_rel]
    if k_base in by_basename:
        return by_basename[k_base]
    if k_slug in by_slug:
        return by_slug[k_slug]
    return ""

# ------------- Core walker -------------

def update_image_alts_in_json(
    data: Any,
    by_relpath: Dict[str, str],
    by_basename: Dict[str, str],
    by_slug: Dict[str, str],
    by_orig_map: Dict[str, Tuple[str, str]],
    alt_by_origpath: Dict[str, str],
    alt_by_origbase: Dict[str, str],
    *,
    rewrite_src: bool,
    updates: Optional[List[Tuple[str, str, Optional[str]]]] = None,  # (old_src, alt, new_src_if_rewritten)
) -> Tuple[Any, bool]:
    """
    Traverse JSON, possibly rewrite src (if rewrite_src=True and CSV maps it),
    and set alt text. Returns (new_data, changed?).
    """
    changed = False
    if updates is None:
        updates = []

    if isinstance(data, dict):
        target_src = None

        # Identify a src-bearing node
        if "image" in data and isinstance(data["image"], dict) and "src" in data["image"]:
            target_src = data["image"]["src"]

        elif "imageSrc" in data:
            target_src = data.get("imageSrc")

        elif data.get("type") == "image":
            attrs = data.get("attrs")
            # TipTap shape first
            if isinstance(attrs, dict) and "src" in attrs:
                target_src = attrs.get("src")
            # Fallback: many docs use top-level src/alt with type:"image"
            elif "src" in data:
                target_src = data.get("src")

        elif "src" in data:
            candidate = data.get("src")
            k_rel  = path_only(str(candidate))
            k_base = basename(str(candidate)).lower()
            k_slug = to_slug(k_base)
            # Accept if it looks like an image OR we can match via any mapping (including basename/slug)
            if (is_image_path(str(candidate)) or
                k_rel in by_orig_map or
                k_rel in alt_by_origpath or
                k_base in alt_by_origbase or
                k_base in by_basename or
                k_slug in by_slug):
                target_src = candidate

        # Now act on the src if present
        if target_src:
            old_src = str(target_src)
            k_rel = path_only(old_src)

            # Prefer rewrite when toggled and mapping exists
            if rewrite_src and k_rel in by_orig_map:
                new_rel, alt = by_orig_map[k_rel]
                if set_src_and_alt_in_node(data, new_rel, alt):
                    changed = True
                    updates.append((old_src, alt, new_rel))
            else:
                # Just set alt (try orig-link maps first, then normal maps)
                alt = match_alt_for_src(old_src, by_relpath, by_basename, by_slug, alt_by_origpath, alt_by_origbase)
                if alt:
                    # force=True allows alt update even if src isn't a "known image" ext
                    if set_alt_in_node(data, alt, force=True):
                        changed = True
                        updates.append((old_src, alt, None))

        # Recurse
        for k, v in list(data.items()):
            new_v, ch = update_image_alts_in_json(
                v, by_relpath, by_basename, by_slug, by_orig_map, alt_by_origpath, alt_by_origbase,
                rewrite_src=rewrite_src, updates=updates
            )
            if ch:
                data[k] = new_v
                changed = True
        return data, changed

    elif isinstance(data, list):
        out = []
        any_changed = False
        for item in data:
            new_item, ch = update_image_alts_in_json(
                item, by_relpath, by_basename, by_slug, by_orig_map, alt_by_origpath, alt_by_origbase,
                rewrite_src=rewrite_src, updates=updates
            )
            out.append(new_item)
            any_changed = any_changed or ch
        return out, any_changed

    else:
        return data, False

# ------------- Post-processing (prune duplicates) -------------

def _prune_duplicate_image_shapes(data: Any) -> Tuple[Any, bool]:
    """
    Remove redundant TipTap attrs when they exactly duplicate top-level image fields.
    Only prunes nodes with type:"image" that have both shapes present and identical.
    """
    changed = False

    if isinstance(data, dict):
        if data.get("type") == "image" and "src" in data and isinstance(data.get("attrs"), dict):
            a = data["attrs"]
            if "src" in a:
                same_src = a.get("src") == data.get("src")
                same_alt = a.get("alt") == data.get("alt")
                if same_src and same_alt:
                    data.pop("attrs", None)
                    changed = True
        for k, v in list(data.items()):
            new_v, ch = _prune_duplicate_image_shapes(v)
            if ch:
                data[k] = new_v
                changed = True
        return data, changed

    if isinstance(data, list):
        out = []
        for item in data:
            new_item, ch = _prune_duplicate_image_shapes(item)
            out.append(new_item)
            changed = changed or ch
        return out, changed

    return data, changed

# ------------- File processing -------------

def process_json_file(
    path: Path,
    by_relpath: Dict[str, str],
    by_basename: Dict[str, str],
    by_slug: Dict[str, str],
    by_orig_map: Dict[str, Tuple[str, str]],
    alt_by_origpath: Dict[str, str],
    alt_by_origbase: Dict[str, str],
    *,
    write: bool,
    rewrite_src: bool
) -> Tuple[bool, List[Tuple[str, str, Optional[str]]]]:
    updates: List[Tuple[str, str, Optional[str]]] = []
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception:
        raw = path.read_text(encoding="latin-1")
    try:
        data = json.loads(raw)
    except Exception as e:
        print(f"[WARN] Skipping non-JSON or invalid JSON: {path.name} ({e})")
        return False, updates

    new_data, changed = update_image_alts_in_json(
        data, by_relpath, by_basename, by_slug, by_orig_map, alt_by_origpath, alt_by_origbase,
        rewrite_src=rewrite_src, updates=updates
    )

    # Clean up any identical duplicate shapes introduced by earlier runs
    new_data, pruned = _prune_duplicate_image_shapes(new_data)
    if pruned:
        changed = True

    if changed and write:
        path.write_text(json.dumps(new_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed, updates

def update_alts_rel(dry_run: bool = False, backup: bool = False, rewrite_src: bool = False) -> dict:
    """
    Use relative locations:

      CSV file:     ./alt-text-output.csv  (or the only *.csv in folder)
      JSON folder:  ./jsonFiles

    Returns a dict summary and saves a report CSV/JSON to ./reports.
    """
    script_dir = _script_dir()
    csv_path = find_csv()
    json_root = find_json_root()

    (by_relpath, by_basename, by_slug,
     by_orig_map, alt_by_origpath, alt_by_origbase) = load_alt_mapping(csv_path)

    total_files = 0
    changed_files = 0
    details = {}

    if backup and not dry_run:
      # backup entire jsonFiles folder (shallow copy of files)
      backup_dir = script_dir / "backup_jsonFiles"
      backup_dir.mkdir(exist_ok=True)
      for p in json_root.rglob("*.json"):
          rel = p.relative_to(json_root)
          target = backup_dir / rel
          target.parent.mkdir(parents=True, exist_ok=True)
          try:
              shutil.copy2(p, target)
          except Exception as e:
              print(f"[WARN] Backup failed: {p.name} ({e})")

    for path in json_root.rglob("*.json"):
        total_files += 1
        changed, updates = process_json_file(
            path,
            by_relpath, by_basename, by_slug,
            by_orig_map, alt_by_origpath, alt_by_origbase,
            write=not dry_run,
            rewrite_src=rewrite_src
        )
        if updates:
            # dedupe (old_src, alt, new_src) per file while keeping order
            dedup = list(dict.fromkeys(updates))
            details[str(path)] = dedup
        if changed:
            changed_files += 1

    summary = {
        "csv": str(csv_path),
        "json_root": str(json_root),
        "total_json_files_scanned": total_files,
        "changed_files": changed_files,
        "rewrite_src_enabled": bool(rewrite_src),
        "details": details,
    }


    # Save reports
    reports_dir = script_dir / "reports"
    reports_dir.mkdir(exist_ok=True)
    (reports_dir / "alt-text-update-summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    # CSV report (flat)
    try:
        import io
        out_csv = io.StringIO()
        w = csv.writer(out_csv)
        w.writerow(["json_file", "old_src", "new_alt", "new_src_if_rewritten"])
        for fpath, triples in details.items():
            for old_src, alt, new_src in triples:
                w.writerow([fpath, old_src, alt, new_src or ""])
        (reports_dir / "alt-text-update-report.csv").write_text(out_csv.getvalue(), encoding="utf-8")
    except Exception as e:
        print(f"[WARN] Could not write CSV report: {e}")

    # Console summary
    print("Alt-text Updater")
    print("----------------")
    print(f"CSV:        {csv_path.name if csv_path.exists() else '(missing)'}")
    print(f"JSON root:  {json_root.relative_to(script_dir) if json_root.exists() else '(missing jsonFiles/)'}")
    print(f"Scanned:    {total_files} JSON files")
    print(f"Updated:    {changed_files} files")
    print(f"Rewrite:    {'ON' if rewrite_src else 'OFF'}")
    if details:
        print(f"Report:     reports/alt-text-update-report.csv")
    else:
        print("Report:     (no changes; summary.json saved)")

    return summary

# ---------------- Runner ----------------

def _in_notebook():
    try:
        get_ipython  # type: ignore
        return True
    except NameError:
        return False

def main():
    dry_run = (os.environ.get("ALT_DRY_RUN", "0").lower() in ("1","true","yes"))
    backup  = (os.environ.get("ALT_BACKUP", "0").lower() in ("1","true","yes"))
    rewrite = (os.environ.get("ALT_REWRITE_SRC", "0").lower() in ("1","true","yes"))
    update_alts_rel(dry_run=dry_run, backup=backup, rewrite_src=rewrite)

if __name__ == "__main__":
    main()
