
// Minimal utilities
const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
const byId = (id) => document.getElementById(id);
const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const toastStack = byId('toastStack');
const showToast = (msg) => { const t = html(`<div class="toast" role="status">${escapeHtml(msg)}</div>`); toastStack.appendChild(t); setTimeout(()=>t.remove(), 2600); };

// State
let csvFile = null;
let csvRows = [];
let maps = null;
let jsonFiles = []; // [{file, path, size}]
let fileStatuses = []; // {file, status:'changed'|'unchanged'|'error', error?:string}
let results = { totalFiles:0, changedFiles:0, updates:[] }; // updates: {file, old_src, alt, new_src|null}
let updatedJson = new Map(); // path -> updated JSON
let cancelRequested = false;

// Stepper helpers
function setStep(n){
  qsa('.stepper .step').forEach((el,i)=>{
    el.setAttribute('aria-current', i===n-1 ? 'step' : 'false');
  });
}

function escapeHtml(str){
  return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
}

// CSV parsing & mapping (supports 2-col and both 3-col orders)
function normUrl(u){
  try{
    if(!u) return "";
    if(/^[a-z]+:\/\//i.test(u)){
      const url = new URL(u);
      return decodeURIComponent(url.pathname || "");
    }
    // strip query/hash
    const base = (u.split('#')[0]||'').split('?')[0]||'';
    return decodeURIComponent(base);
  }catch{ return u || ""; }
}
function isImagePath(p){ p=(p||"").toLowerCase(); return [".jpg",".jpeg",".png",".gif",".webp",".svg"].some(ext => p.endsWith(ext)); }
function isUrl(s){ return /^https?:\/\//i.test(s||""); }
function basename(p){ try{ const parts = normUrl(p).split('/'); return decodeURIComponent(parts[parts.length-1]||""); }catch{ return p||""; } }
function toSlug(s){ s=(s||"").toLowerCase(); s=s.replace(/\.[a-z0-9]+$/, ""); s=s.replace(/[0-9]/g,""); s=s.replace(/[^a-z]+/g,""); return s; }
function pathOnly(u){ return normUrl(u); } // alias

function detectColumns(firstRow){
  // Return a descriptor string for validation messages
  return firstRow.map(x => (x||"").toString().trim()).filter(Boolean).join(',');
}

function buildAltMapping(rows){
  const byRelpath={}, byBasename={}, bySlug={}, byOrigMap={}, altByOrigpath={}, altByOrigbase={};
  if(!rows?.length) return { byRelpath, byBasename, bySlug, byOrigMap, altByOrigpath, altByOrigbase, mode:"—", alts:0 };

  // Detect header
  let start = 0;
  const r0 = rows[0] || [];
  const h0 = String(r0[0]||"").toLowerCase();
  const h1 = String(r0[1]||"").toLowerCase();
  if(h0.includes("path") || h0.includes("image") || h1.includes("alt")) start = 1;

  let mode = "2 cols", alts = 0;
  for(let i=start;i<rows.length;i++){
    const row = rows[i]; if(!row) continue;
    // Normalize columns
    const c0 = (row[0]||"").toString().trim();
    const c1 = (row[1]||"").toString().trim();
    const c2 = (row[2]||"").toString().trim();

    if(!c2){ // 2 columns
      const raw = c0, alt = c1; if(!raw || !alt) continue; alts++;
      const rel = pathOnly(/^[a-z]+:\/\//i.test(raw) ? new URL(raw).pathname : raw);
      if(rel && (rel.startsWith("/") || isImagePath(rel))) byRelpath[rel] = alt;
      const b = (basename(raw)||"").toLowerCase();
      if(b){ byBasename[b]=alt; const sl=toSlug(b); if(sl) bySlug[sl]=alt; }
    } else { // 3 columns (support both orders)
      const alt = c1;
      // Guess which side is original and which is new
      let a = c0, b = c2;
      // header-based hints
      if(start === 1){
        const H0 = String(r0[0]||"").toLowerCase();
        const H2 = String(r0[2]||"").toLowerCase();
        if(H0.includes("new")){ a = c2; b = c0; } // header says col0=new -> swap
        if(H2.includes("orig") || H2.includes("original")){ a = c2; b = c0; } // col2=orig -> a=orig
      } else {
        // heuristic: URLs or .ashx look like "original link"
        const score = (s)=> (isUrl(s)?2:0) + (s.includes(".ashx")?2:0) + (s.includes("/-/")?1:0) + (s.includes("?")?1:0);
        const s0 = score(c0), s2 = score(c2);
        if(s0 > s2){ a=c0; b=c2; } // c0 likely original, c2 new
        else if(s2 > s0){ a=c2; b=c0; } // c2 original
        else { a=c0; b=c2; } // tie: assume c0=orig, c2=new
      }
      const orig_path = pathOnly(a);
      const new_rel = pathOnly(b);
      if(!alt || !orig_path) continue; alts++;

      altByOrigpath[orig_path] = alt;
      const ob=(basename(a)||"").toLowerCase(); if(ob) altByOrigbase[ob]=alt;
      if(new_rel){ byOrigMap[orig_path] = [new_rel, alt]; if(new_rel.startsWith("/") || isImagePath(new_rel)) byRelpath[new_rel] = alt; }
      const bb=(new_rel ? basename(new_rel) : basename(a) || "").toLowerCase();
      if(bb){ byBasename[bb]=alt; const sl=toSlug(bb); if(sl) bySlug[sl]=alt; }
      mode = "3 cols";
    }
  }
  return { byRelpath, byBasename, bySlug, byOrigMap, altByOrigpath, altByOrigbase, mode, alts, header: rows[0]||[] };
}

// Matching & JSON transforms (TipTap + common shapes)
const hasTiptapAttrs = (node)=> node && typeof node==="object" && node.attrs && typeof node.attrs==="object" && ("src" in node.attrs);
function setAltOnly(node, alt){
  let changed=false; if(!node||typeof node!=="object") return false;
  if(node.type==="image"){
    if(hasTiptapAttrs(node)){ const attrs={...(node.attrs||{})}; if(attrs.alt!==alt){ attrs.alt=alt; node.attrs=attrs; changed=true; } return changed; }
    if("src" in node){ if(node.alt!==alt){ node.alt=alt; changed=true; } return changed; }
  }
  if(node.image && typeof node.image==="object" && "src" in node.image){ if(node.image.alt!==alt){ node.image.alt=alt; changed=true; } }
  if("imageSrc" in node){ if(node.imageAlt!==alt){ node.imageAlt=alt; changed=true; } }
  if("src" in node && (String(node.src)||"").match(/\.(png|jpe?g|gif|webp|svg)$/i)){ if(node.alt!==alt){ node.alt=alt; changed=true; } }
  return changed;
}
function setSrcAndAlt(node, newSrc, alt){
  let changed=false; if(!node||typeof node!=="object") return false;
  if(node.type==="image"){
    if(hasTiptapAttrs(node)){ const attrs={...(node.attrs||{})}; if(attrs.src!==newSrc){ attrs.src=newSrc; changed=true; } if(attrs.alt!==alt){ attrs.alt=alt; changed=true; } node.attrs=attrs; return changed; }
    if("src" in node){ if(node.src!==newSrc){ node.src=newSrc; changed=true; } if(node.alt!==alt){ node.alt=alt; changed=true; } return changed; }
  }
  if(node.image && typeof node.image==="object" && "src" in node.image){ if(node.image.src!==newSrc){ node.image.src=newSrc; changed=true; } if(node.image.alt!==alt){ node.image.alt=alt; changed=true; } }
  if("imageSrc" in node){ if(node.imageSrc!==newSrc){ node.imageSrc=newSrc; changed=true; } if(node.imageAlt!==alt){ node.imageAlt=alt; changed=true; } }
  if("src" in node){ if(node.src!==newSrc){ node.src=newSrc; changed=true; } if(node.alt!==alt){ node.alt=alt; changed=true; } }
  return changed;
}
function matchAltForSrc(imgSrc, maps){
  if(!imgSrc) return "";
  const k_rel = pathOnly(imgSrc);
  const k_base = (basename(imgSrc)||"").toLowerCase();
  const k_slug = toSlug(k_base);
  if(maps.altByOrigpath && maps.altByOrigpath[k_rel]) return maps.altByOrigpath[k_rel];
  if(maps.altByOrigbase && maps.altByOrigbase[k_base]) return maps.altByOrigbase[k_base];
  if(maps.byRelpath && maps.byRelpath[k_rel]) return maps.byRelpath[k_rel];
  if(maps.byBasename && maps.byBasename[k_base]) return maps.byBasename[k_base];
  if(maps.bySlug && maps.bySlug[k_slug]) return maps.bySlug[k_slug];
  return "";
}

function updateImageAltsInJSON(data, maps, rewriteSrc, filePath, outUpdates){
  function walk(node){
    let localChanged=false;
    if(node && typeof node==="object" && !Array.isArray(node)){
      let targetSrc=null;
      if(node.image && typeof node.image==="object" && "src" in node.image) targetSrc=node.image.src;
      else if("imageSrc" in node) targetSrc=node.imageSrc;
      else if(node.type==="image") targetSrc=hasTiptapAttrs(node)? node.attrs.src : node.src;
      else if("src" in node){
        const candidate=node.src; const k_rel=pathOnly(String(candidate)); const k_base=(basename(String(candidate))||"").toLowerCase(); const k_slug=toSlug(k_base);
        const looks = (String(candidate)||"").match(/\.(png|jpe?g|gif|webp|svg)$/i) || (maps.byOrigMap && (k_rel in maps.byOrigMap)) || (maps.altByOrigpath && (k_rel in maps.altByOrigpath)) || (maps.altByOrigbase && (k_base in maps.altByOrigbase)) || (maps.byBasename && (k_base in maps.byBasename)) || (maps.bySlug && (k_slug in maps.bySlug));
        if(looks) targetSrc=candidate;
      }

      if(targetSrc){
        const old_src=String(targetSrc);
        const k_rel=pathOnly(old_src);
        if(rewriteSrc && maps.byOrigMap && (k_rel in maps.byOrigMap)){
          const [new_rel, alt] = maps.byOrigMap[k_rel];
          if(setSrcAndAlt(node,new_rel,alt)){ outUpdates.push({ file:filePath, old_src, alt, new_src:new_rel }); localChanged=true; }
        }else{
          const alt=matchAltForSrc(old_src, maps);
          if(alt){ if(setAltOnly(node,alt)){ outUpdates.push({ file:filePath, old_src, alt, new_src:null }); localChanged=true; } }
        }
      }

      for(const k of Object.keys(node)){ const [nv, ch]=walk(node[k]); if(ch) node[k]=nv; localChanged = localChanged || ch; }
      return [node, localChanged];
    }
    if(Array.isArray(node)){
      let any=false; const arr=node.slice(); for(let i=0;i<arr.length;i++){ const [nv, ch]=walk(arr[i]); if(ch) arr[i]=nv; any = any || ch; } return [arr, any];
    }
    return [node, false];
  }
  return walk(data);
}

// Wiring UI elements
const csvInput = byId('csvInput');
const dirInput = byId('dirInput');
const csvHelp = byId('csvHelp');
const detectedCols = byId('detectedCols');
const dirHelp = byId('dirHelp');
const btnPreview = byId('btnPreview');
const btnCancel = byId('btnCancel');
const btnApply = byId('btnApply');
const btnReports = byId('btnReports');
const btnReset = byId('btnReset');
const emptyState = byId('emptyState');
const table = byId('resultsTable');
const tbody = table.querySelector('tbody');
const resultsCount = byId('resultsCount');
const loadingBox = byId('loadingBox');
const progressBar = byId('progressBar');
const progressCount = byId('progressCount');
const progressPhase = byId('progressPhase');
const st1 = byId('st1'); const st2 = byId('st2'); const st3 = byId('st3'); const st4 = byId('st4');
const statScanned = byId('statScanned'); const statChanged = byId('statChanged'); const statUpdates = byId('statUpdates');
const search = byId('search');
const fltChanged = byId('fltChanged'); const fltUnchanged = byId('fltUnchanged'); const fltErrors = byId('fltErrors');
const tgRewrite = byId('tgRewrite'); const tgBackup = byId('tgBackup');
const sampleCsvLink = byId('sampleCsv');
const csvTitle = byId('csvTitle'); const dirTitle = byId('dirTitle');

// Sample CSV download
sampleCsvLink.addEventListener('click', (e)=>{
  e.preventDefault();
  const sample = "path,alt,new_rel\n/images/hero.jpg,Sunset over hills,/assets/hero.jpg\nteam.png,Two people smiling,\n";
  const blob = new Blob([sample], {type:"text/csv"}); const a=document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = "sample-alt-text.csv"; a.click(); URL.revokeObjectURL(a.href);
});

function enableRunIfReady(){
  const ok = !!(csvFile && jsonFiles.length);
  btnPreview.disabled = !ok;
  setStep(ok ? 3 : (csvFile ? 2 : 1));
}

function show(el){ el.classList.remove('sr-only'); }
function hide(el){ el.classList.add('sr-only'); }

// CSV handler
csvInput.addEventListener('change', (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  csvFile = file; csvTitle.textContent = file.name;
  // Parse via FileReader + simple CSV split (Papaparse not used to keep zero deps)
  const fr = new FileReader();
  progressPhase.textContent = "Parsing CSV";
  fr.onload = () => {
    const text = String(fr.result||"");
    const rows = text.split(/\r?\n/).map(r => r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g,""))).filter(r => r.some(x => String(x||"").trim().length));
    csvRows = rows;
    const d = detectColumns(rows[0]||[]);
    detectedCols.textContent = d || "—";
    maps = buildAltMapping(rows);
    // Basic validation: need at least 2 columns
    const valid = rows[0] && (rows[0].length>=2);
    if(!valid){ show(csvHelp); } else { hide(csvHelp); }
    enableRunIfReady();
    setStep(2);
    showToast("CSV loaded");
  };
  fr.readAsText(file);
});

// Directory handler
dirInput.addEventListener('change', (e)=>{
  const arr = Array.from(e.target.files||[]).filter(f => f.type==="application/json" || (f.name||"").toLowerCase().endsWith(".json")).map(f => ({ file:f, path: f.webkitRelativePath || f.name, size: f.size }));
  jsonFiles = arr;
  dirTitle.textContent = jsonFiles.length ? `${jsonFiles.length} files selected` : "Pick your jsonFiles/ directory";
  if(!jsonFiles.length){ show(dirHelp); } else { hide(dirHelp); }
  enableRunIfReady();
});

// Preview run
btnPreview.addEventListener('click', async ()=>{
  if(!csvFile || !jsonFiles.length || btnPreview.disabled) return;
  cancelRequested = false;
  btnPreview.hidden = true; btnCancel.hidden = false; // swap buttons
  hide(emptyState); show(loadingBox);
  progressPhase.textContent = "Scanning JSON";
  progressBar.style.width = "0%";
  tbody.innerHTML = ""; resultsCount.textContent = "0 results";
  fileStatuses = []; results = { totalFiles:0, changedFiles:0, updates:[] }; updatedJson = new Map();
  statScanned.textContent = "0"; statChanged.textContent = "0"; statUpdates.textContent = "0";
  setStep(3);

  const total = jsonFiles.length;
  for(let i=0;i<jsonFiles.length;i++){
    if(cancelRequested) break;
    const jf = jsonFiles[i];
    results.totalFiles++;
    progressCount.textContent = `Scanning ${i+1} / ${total} files…`;
    progressPhase.textContent = i<3 ? "Scanning JSON" : (i<6 ? "Matching" : "Generating diff");
    const pct = Math.round(((i+1)/total)*100); progressBar.style.width = pct + "%";

    let text = ""; let data=null;
    try{ text = await jf.file.text(); data = JSON.parse(text); }
    catch(e){ fileStatuses.push({file:jf.path, status:'error', error:String(e)}); continue; }

    const local=[];
    const [nv, ch] = updateImageAltsInJSON(data, maps, tgRewrite.checked, jf.path, local);
    if(ch){ results.changedFiles++; updatedJson.set(jf.path, JSON.stringify(nv, null, 2)); fileStatuses.push({file:jf.path, status:'changed'}); }
    else { fileStatuses.push({file:jf.path, status:'unchanged'}); }
    for(const u of local) results.updates.push(u);
  }

  statScanned.textContent = String(results.totalFiles);
  statChanged.textContent = String(results.changedFiles);
  statUpdates.textContent = String(results.updates.length);

  // Finish
  hide(loadingBox); btnCancel.hidden = true; btnPreview.hidden = false;
  btnApply.disabled = updatedJson.size===0;
  btnReports.disabled = results.updates.length===0;
  renderTable();
  showToast(cancelRequested ? "Preview canceled" : "Preview ready");
  setStep(4);
});

btnCancel.addEventListener('click', ()=>{
  cancelRequested = true;
});

// Render table with filters/search
function renderTable(){
  const q = (search.value||"").toLowerCase();
  const includeChanged = fltChanged.checked;
  const includeUnchanged = fltUnchanged.checked;
  const includeErrors = fltErrors.checked;

  let rows = results.updates.map(u => ({kind:'update', ...u}));

  if(includeUnchanged){
    for(const fs of fileStatuses.filter(f=>f.status==='unchanged')){
      rows.push({kind:'unchanged', file:fs.file, old_src:'—', new_src:null, alt:'—'});
    }
  }
  if(includeErrors){
    for(const fs of fileStatuses.filter(f=>f.status==='error')){
      rows.push({kind:'error', file:fs.file, old_src:'—', new_src:null, alt:fs.error||'Error'});
    }
  }

  // search filter
  rows = rows.filter(r => (r.file||"").toLowerCase().includes(q) || (r.old_src||"").toLowerCase().includes(q) || (r.alt||"").toLowerCase().includes(q));

  resultsCount.textContent = `${rows.length} result${rows.length===1?'':'s'}`;
  emptyState.classList.toggle('sr-only', rows.length>0);

  const frag = document.createDocumentFragment();
  for(const r of rows){
    const tr = document.createElement('tr');
    const badge = r.kind==='update' ? (r.new_src?'<span class="badge badge--ok">Yes</span>':'<span class="badge badge--muted">No</span>')
                 : r.kind==='error' ? '<span class="badge" style="background:#2a1218;color:#ffd6dd;border-color:#5f2634">Error</span>'
                 : '<span class="badge badge--muted">—</span>';
    tr.innerHTML = `
      <td title="${escapeHtml(r.file)}">${escapeHtml(r.file)}</td>
      <td title="${escapeHtml(r.old_src)}">${escapeHtml(r.old_src)}</td>
      <td>${badge}</td>
      <td title="${escapeHtml(r.alt)}">${escapeHtml(r.alt||"")}</td>`;
    frag.appendChild(tr);
  }
  tbody.innerHTML = "";
  tbody.appendChild(frag);
}

// Filters/search listeners
[search, fltChanged, fltUnchanged, fltErrors].forEach(el => el.addEventListener('input', renderTable));

// Reports
btnReports.addEventListener('click', async ()=>{
  if(!results.updates.length) return;
  const summary = {
    total_files: results.totalFiles,
    changed_files: results.changedFiles,
    updates: results.updates.length,
    rewrite_src: !!tgRewrite.checked,
    backup: !!tgBackup.checked,
    generated_at: new Date().toISOString()
  };
  const csvLines = ["file,old_src,new_alt,rewritten"].concat(results.updates.map(u => [u.file,u.old_src,(u.alt||"").replaceAll("\\n"," "),u.new_src?'yes':'no'].map(v => `"${String(v||"").replaceAll('"','""')}"`).join(",")));
  const zip = new JSZip();
  zip.file("reports/alt-text-update-summary.json", JSON.stringify(summary, null, 2));
  zip.file("reports/alt-text-update-report.csv", csvLines.join("\\n"));
  const blob = await zip.generateAsync({type:"blob"});
  saveAs(blob, "alt-text-updater-reports.zip");
  showToast("Reports downloaded");
});

// Apply (download updated JSONs + backups)
btnApply.addEventListener('click', async ()=>{
  if(!updatedJson.size){ showToast("Nothing to apply"); return; }
  const zip = new JSZip();
  const out = zip.folder("jsonFiles");
  const backup = tgBackup.checked ? zip.folder("backup_jsonFiles") : null;
  const errors = [];
  for(const jf of jsonFiles){
    let original=null; try{ original = await jf.file.text(); } catch(e){ errors.push({file:jf.path, error:String(e)}); }
    const updated = updatedJson.get(jf.path);
    try{
      if(updated){ out.file(jf.path, updated); if(backup && original!=null) backup.file(jf.path, original); }
      else { out.file(jf.path, original || ""); }
    } catch(e){ errors.push({file:jf.path, error:String(e)}); }
  }
  if(errors.length){
    const csv = ["file,error"].concat(errors.map(e => `"${e.file.replace(/"/g,'""')}","${String(e.error||'').replace(/"/g,'""')}"`)).join("\\n");
    zip.file("reports/apply-errors.csv", csv);
  }
  const summary = {
    total_files: results.totalFiles,
    changed_files: results.changedFiles,
    updates: results.updates.length,
    errors: errors.length,
    rewrite_src: !!tgRewrite.checked,
    backup: !!tgBackup.checked,
    generated_at: new Date().toISOString()
  };
  zip.file("reports/alt-text-update-summary.json", JSON.stringify(summary, null, 2));
  const blob = await zip.generateAsync({type:"blob"});
  saveAs(blob, "alt-text-updater-results.zip");
  if(errors.length){
    const banner = byId('applyErrors'); banner.classList.remove('sr-only');
    const dl = byId('dlErrorReport'); dl.onclick = (e)=>{ e.preventDefault(); const b = new Blob([zip.file("reports/apply-errors.csv").async? "":""]); };
  }
  showToast("ZIP downloaded");
});

// Reset
btnReset.addEventListener('click', ()=>{
  csvFile=null; csvRows=[]; maps=null; jsonFiles=[]; fileStatuses=[]; results={ totalFiles:0, changedFiles:0, updates:[] }; updatedJson=new Map();
  byId('csvInput').value=""; byId('dirInput').value="";
  byId('csvTitle').textContent="Drag & drop your CSV or click to browse";
  byId('dirTitle').textContent="Pick your jsonFiles/ directory";
  hide(csvHelp); hide(dirHelp);
  setStep(1);
  tbody.innerHTML=""; emptyState.classList.remove('sr-only'); resultsCount.textContent="0 results";
  statScanned.textContent="0"; statChanged.textContent="0"; statUpdates.textContent="0";
  btnPreview.disabled=true; btnApply.disabled=true; btnReports.disabled=true;
  showToast("Reset");
});

// Polyfill: JSZip & FileSaver via CDN
// (Included at runtime by Netlify; for local file:// testing add CDN scripts below.)
(function injectCDNs(){
  const s1 = document.createElement('script'); s1.src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"; document.head.appendChild(s1);
  const s2 = document.createElement('script'); s2.src="https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js"; document.head.appendChild(s2);
})();
