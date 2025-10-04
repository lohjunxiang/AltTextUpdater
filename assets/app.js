
(() => {
  const csvInput = document.getElementById('csvInput');
  const csvName = document.getElementById('csvName');
  const statRows = document.getElementById('statRows');
  const statMode = document.getElementById('statMode');
  const statAlts = document.getElementById('statAlts');

  const folderInput = document.getElementById('folderInput');
  const folderName = document.getElementById('folderName');
  const statFiles = document.getElementById('statFiles');
  const statScanned = document.getElementById('statScanned');
  const statUpdated = document.getElementById('statUpdated');
  const progress = document.getElementById('progress');
  const bar = document.getElementById('bar');
  const pct = document.getElementById('pct');

  const toggleRewrite = document.getElementById('toggleRewrite');
  const toggleBackup = document.getElementById('toggleBackup');

  const btnPreview = document.getElementById('btnPreview');
  const btnApply = document.getElementById('btnApply');
  const btnReports = document.getElementById('btnReports');
  const btnReset = document.getElementById('btnReset');

  const tbody = document.getElementById('tbody');
  const resultCount = document.getElementById('resultCount');
  const filterInput = document.getElementById('filterInput');
  const btnClear = document.getElementById('btnClear');

  const ovScanned = document.getElementById('ovScanned');
  const ovChanged = document.getElementById('ovChanged');
  const ovUpdates = document.getElementById('ovUpdates');

  const menuItems = Array.from(document.querySelectorAll('.menu-item'));
  let step = 1;
  function setStep(n){ step=n; menuItems.forEach(mi=>mi.classList.toggle('active', Number(mi.dataset.step)===n)); }

  // State
  let csvFile=null, maps=null, jsonFiles=[], results={ totalFiles:0, changedFiles:0, updates:[] }, updatedJson=new Map(), running=false;

  function enable(){ btnPreview.disabled = !(maps && jsonFiles.length && !running); }

  // helpers
  const pathOnly = (u)=>{
    try{ if(!u) return ""; if(/^[a-z]+:\/\//i.test(u)){ const url=new URL(u); return decodeURIComponent(url.pathname||""); } return decodeURIComponent((u.split("#")[0]||"").split("?")[0]||""); }catch{ return u||""; }
  };
  const isImagePath = (p)=> (p||"").toLowerCase().match(/\.(png|jpe?g|gif|webp|svg)$/);
  const basename = (p)=>{ try{ const pp=pathOnly(p); const segs=pp.split("/"); return decodeURIComponent(segs[segs.length-1]||""); }catch{ return p||""; } };
  const toSlug = (s)=>{ s=(s||"").toLowerCase(); s=s.replace(/\.[a-z0-9]+$/, ""); s=s.replace(/[0-9]/g,""); s=s.replace(/[^a-z]+/g,""); return s; };

  function buildAltMapping(rows){
    const byRelpath={}, byBasename={}, bySlug={}, byOrigMap={}, altByOrigpath={}, altByOrigbase={};
    if(!rows?.length) return { byRelpath, byBasename, bySlug, byOrigMap, altByOrigpath, altByOrigbase, mode:"—", alts:0 };
    let start=0; const r0=rows[0]||[]; if(r0.length>=2 && (((r0[0]||"").toLowerCase().includes("image")) || ((r0[1]||"").toLowerCase().includes("alt")))) start=1;
    let mode="2 cols", alts=0;
    for(let i=start;i<rows.length;i++){ const row=rows[i]; if(!row) continue;
      if(row.length<=2 || (row.length>=3 && !(row[2]||"").trim())){
        const raw=(row[0]||"").trim(); const alt=(row[1]||"").trim(); if(!raw||!alt) continue; alts++;
        const rel = pathOnly(/^[a-z]+:\/\//i.test(raw) ? new URL(raw).pathname : raw);
        if(rel && (rel.startsWith("/") || isImagePath(rel))) byRelpath[rel]=alt;
        const b=(basename(raw)||"").toLowerCase(); if(b){ byBasename[b]=alt; const sl=toSlug(b); if(sl) bySlug[sl]=alt; }
      }else{
        mode="3 cols";
        const new_rel=pathOnly((row[0]||"").trim()); const alt=(row[1]||"").trim(); const orig_raw=(row[2]||"").trim(); const orig_path=pathOnly(orig_raw);
        if(!alt||!orig_path) continue; alts++;
        altByOrigpath[orig_path]=alt;
        const ob=(basename(orig_raw)||"").toLowerCase(); if(ob) altByOrigbase[ob]=alt;
        if(new_rel){ byOrigMap[orig_path]=[new_rel,alt]; if(new_rel.startsWith("/") || isImagePath(new_rel)) byRelpath[new_rel]=alt; }
        const b=(new_rel ? basename(new_rel) : basename(orig_raw) || "").toLowerCase(); if(b){ byBasename[b]=alt; const sl=toSlug(b); if(sl) bySlug[sl]=alt; }
      }
    }
    return { byRelpath, byBasename, bySlug, byOrigMap, altByOrigpath, altByOrigbase, mode, alts };
  }

  function matchAltForSrc(imgSrc, maps){
    if(!imgSrc) return "";
    const k_rel=pathOnly(imgSrc); const k_base=(basename(imgSrc)||"").toLowerCase(); const k_slug=toSlug(k_base);
    if(maps.altByOrigpath[k_rel]) return maps.altByOrigpath[k_rel];
    if(maps.altByOrigbase[k_base]) return maps.altByOrigbase[k_base];
    if(maps.byRelpath[k_rel]) return maps.byRelpath[k_rel];
    if(maps.byBasename[k_base]) return maps.byBasename[k_base];
    if(maps.bySlug[k_slug]) return maps.bySlug[k_slug];
    return "";
  }

  const hasTiptapAttrs = (node)=> node && typeof node==="object" && node.attrs && typeof node.attrs==="object" && ("src" in node.attrs);
  function setAltOnly(node, alt){ let changed=false; if(!node||typeof node!=="object") return false;
    if(node.type==="image"){ if(hasTiptapAttrs(node)){ const attrs={...(node.attrs||{})}; if(attrs.alt!==alt){ attrs.alt=alt; node.attrs=attrs; changed=true; } return changed; }
      if("src" in node){ if(node.alt!==alt){ node.alt=alt; changed=true; } return changed; } }
    if(node.image && typeof node.image==="object" && "src" in node.image){ if(node.image.alt!==alt){ node.image.alt=alt; changed=true; } }
    if("imageSrc" in node){ if(node.imageAlt!==alt){ node.imageAlt=alt; changed=true; } }
    if("src" in node && isImagePath(String(node.src))){ if(node.alt!==alt){ node.alt=alt; changed=true; } }
    return changed; }
  function setSrcAndAlt(node,newSrc,alt){ let changed=false; if(!node||typeof node!=="object") return false;
    if(node.type==="image"){ if(hasTiptapAttrs(node)){ const attrs={...(node.attrs||{})}; if(attrs.src!==newSrc){ attrs.src=newSrc; changed=true; } if(attrs.alt!==alt){ attrs.alt=alt; changed=true; } node.attrs=attrs; return changed; }
      if("src" in node){ if(node.src!==newSrc){ node.src=newSrc; changed=true; } if(node.alt!==alt){ node.alt=alt; changed=true; } return changed; } }
    if(node.image && typeof node.image==="object" && "src" in node.image){ if(node.image.src!==newSrc){ node.image.src=newSrc; changed=true; } if(node.image.alt!==alt){ node.image.alt=alt; changed=true; } }
    if("imageSrc" in node){ if(node.imageSrc!==newSrc){ node.imageSrc=newSrc; changed=true; } if(node.imageAlt!==alt){ node.imageAlt=alt; changed=true; } }
    if("src" in node){ if(node.src!==newSrc){ node.src=newSrc; changed=true; } if(node.alt!==alt){ node.alt=alt; changed=true; } }
    return changed; }

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
          const looks = isImagePath(String(candidate)) || (k_rel in maps.byOrigMap) || (k_rel in maps.altByOrigpath) || (k_base in maps.altByOrigbase) || (k_base in maps.byBasename) || (k_slug in maps.bySlug);
          if(looks) targetSrc=candidate;
        }
        if(targetSrc){
          const old_src=String(targetSrc); const k_rel=pathOnly(old_src);
          if(rewriteSrc && (k_rel in maps.byOrigMap)){
            const [new_rel, alt] = maps.byOrigMap[k_rel];
            if(setSrcAndAlt(node,new_rel,alt)){ outUpdates.push({ file:filePath, old_src, alt, new_src:new_rel }); localChanged=true; }
          }else{
            const alt = matchAltForSrc(old_src, maps);
            if(alt){ if(setAltOnly(node,alt)){ outUpdates.push({ file:filePath, old_src, alt, new_src:null }); localChanged=true; } }
          }
        }
        for(const k of Object.keys(node)){ const [nv, ch]=walk(node[k]); if(ch) node[k]=nv; localChanged = localChanged || ch; }
        return [node, localChanged];
      }
      if(Array.isArray(node)){ let any=false; const arr=node.slice(); for(let i=0;i<arr.length;i++){ const [nv, ch]=walk(arr[i]); if(ch) arr[i]=nv; any = any || ch; } return [arr, any]; }
      return [node, false];
    }
    return walk(data);
  }

  function updateProgress(done,total){ const p=Math.round((done/total)*100); pct.textContent=p+"%"; bar.style.width=p+"%"; statScanned.textContent=p+"%"; }
  function finalize(){
    statUpdated.textContent=String(results.changedFiles);
    ovScanned.textContent=String(results.totalFiles);
    ovChanged.textContent=String(results.changedFiles);
    ovUpdates.textContent=String(results.updates.length);
    progress.classList.add('hidden');
    btnReports.disabled = results.updates.length===0;
    btnApply.disabled = updatedJson.size===0;
    renderTable();
  }
  function renderTable(){
    const q=(filterInput.value||"").toLowerCase();
    const items = results.updates.filter(r => (r.file||"").toLowerCase().includes(q) || (r.old_src||"").toLowerCase().includes(q) || (r.alt||"").toLowerCase().includes(q));
    resultCount.textContent = `Showing ${items.length} of ${results.updates.length}`;
    const frag=document.createDocumentFragment();
    for(const r of items){
      const row=document.createElement('div');
      row.innerHTML = `
        <div title="${esc(r.file)}" class="clip">${esc(r.file)}</div>
        <div title="${esc(r.old_src)}" class="clip">${esc(r.old_src)}</div>
        <div style="padding:8px 10px;">${r.new_src?'<span class="pill yes">Yes</span>':'<span class="pill">No</span>'}</div>
        <div title="${esc(r.alt)}" class="clip">${esc(r.alt||"")}</div>`;
      frag.appendChild(row);
    }
    tbody.innerHTML=""; tbody.appendChild(frag);
  }
  const esc = (s)=> String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  // CSV
  document.getElementById('csvDrop').addEventListener('click', ()=> csvInput.click());
  csvInput.addEventListener('change', (e)=>{
    const file = e.target.files?.[0]; if(!file) return;
    csvFile = file; csvName.textContent = file.name; setStep(2);
    Papa.parse(file, { complete: (res)=>{
      const rows = res.data.filter(r => Array.isArray(r) && r.some(x => (x||"").toString().trim().length));
      maps = buildAltMapping(rows);
      statRows.textContent = rows.length; statMode.textContent = maps.mode||"—"; statAlts.textContent = maps.alts||0; enable();
    }, skipEmptyLines: true });
  });

  // Folder
  document.querySelectorAll('label.drop')[1].addEventListener('click', ()=> folderInput.click());
  folderInput.addEventListener('change', (e)=>{
    const arr = Array.from(e.target.files||[]).filter(f => f.type==="application/json" || (f.name||"").toLowerCase().endsWith(".json")).map(f => ({ file:f, path:f.webkitRelativePath || f.name, size:f.size }));
    jsonFiles = arr; folderName.textContent = jsonFiles.length ? `${jsonFiles.length} files selected` : "Pick your jsonFiles/ directory"; statFiles.textContent = jsonFiles.length; setStep(3); enable();
  });

  // Preview
  btnPreview.addEventListener('click', async ()=>{
    if(!maps || !jsonFiles.length || running) return;
    running = true; enable(); progress.classList.remove('hidden'); pct.textContent="0%"; bar.style.width="0%";
    results={ totalFiles:0, changedFiles:0, updates:[] }; updatedJson=new Map();
    tbody.innerHTML=""; resultCount.textContent="Showing 0 of 0";
    statScanned.textContent="0%"; statUpdated.textContent="0"; ovScanned.textContent="0"; ovChanged.textContent="0"; ovUpdates.textContent="0";

    for(let i=0;i<jsonFiles.length;i++){
      const jf=jsonFiles[i]; results.totalFiles++;
      let text=""; try{ text=await jf.file.text(); }catch{}
      if(!text){ updateProgress(i+1,jsonFiles.length); continue; }
      let data; try{ data=JSON.parse(text); }catch{ updateProgress(i+1,jsonFiles.length); continue; }
      const local=[]; const [nv, ch]=updateImageAltsInJSON(data, maps, toggleRewrite.checked, jf.path, local);
      if(ch){ results.changedFiles++; updatedJson.set(jf.path, JSON.stringify(nv, null, 2)); }
      for(const u of local) results.updates.push(u);
      updateProgress(i+1,jsonFiles.length);
    }
    finalize(); running=false; enable(); setStep(4);
  });

  // Reports
  btnReports.addEventListener('click', async ()=>{
    const zip=new JSZip(); const rep=zip.folder("reports");
    const sum={ scanned_files:results.totalFiles, changed_files:results.changedFiles, total_updates:results.updates.length, rewrite_src:toggleRewrite.checked, backup:toggleBackup.checked, generated_at:new Date().toISOString() };
    rep.file("alt-text-update-summary.json", JSON.stringify(sum, null, 2));
    const csvOut=["file,old_src,new_alt,rewritten"].concat(results.updates.map(u => [u.file,u.old_src,(u.alt||"").replaceAll("\n"," "),u.new_src?'yes':'no'].map(v => `\"${String(v||\"\").replaceAll('\"','\"\"')}\"`).join(","))).join("\n");
    rep.file("alt-text-update-report.csv", csvOut);
    const blob=await zip.generateAsync({type:"blob"}); saveAs(blob, "alt-text-updater-reports.zip");
  });

  // Apply
  btnApply.addEventListener('click', async ()=>{
    if(!updatedJson.size) return;
    const zip=new JSZip(); const out=zip.folder("jsonFiles"); const backupFolder=toggleBackup.checked? zip.folder("backup_jsonFiles") : null;
    for(const jf of jsonFiles){
      const original = await jf.file.text().catch(()=>null);
      const updated = updatedJson.get(jf.path);
      if(updated){ out.file(jf.path, updated); if(backupFolder && original) backupFolder.file(jf.path, original); }
      else{ out.file(jf.path, original || ""); }
    }
    const rep=zip.folder("reports");
    rep.file("alt-text-update-summary.json", JSON.stringify({ scanned_files:results.totalFiles, changed_files:results.changedFiles, total_updates:results.updates.length, rewrite_src:toggleRewrite.checked, backup:toggleBackup.checked, generated_at:new Date().toISOString() }, null, 2));
    const csvOut=["file,old_src,new_alt,rewritten"].concat(results.updates.map(u => [u.file,u.old_src,(u.alt||"").replaceAll("\n"," "),u.new_src?'yes':'no'].map(v => `\"${String(v||\"\").replaceAll('\"','\"\"')}\"`).join(","))).join("\n");
    rep.file("alt-text-update-report.csv", csvOut);
    const blob=await zip.generateAsync({type:"blob"}); saveAs(blob, "alt-text-updater-results.zip");
  });

  // Reset
  btnReset.addEventListener('click', ()=>{
    csvFile=null; maps=null; jsonFiles=[]; results={ totalFiles:0, changedFiles:0, updates:[] }; updatedJson=new Map(); running=false;
    csvInput.value=""; folderInput.value="";
    csvName.textContent="Drop or click to upload CSV";
    folderName.textContent="Pick your jsonFiles/ directory";
    statRows.textContent="0"; statMode.textContent="—"; statAlts.textContent="0";
    statFiles.textContent="0"; statScanned.textContent="0%"; statUpdated.textContent="0";
    resultCount.textContent="Showing 0 of 0"; tbody.innerHTML="";
    ovScanned.textContent="0"; ovChanged.textContent="0"; ovUpdates.textContent="0";
    bar.style.width="0%"; pct.textContent="0%"; progress.classList.add('hidden');
    setStep(1); enable();
  });

  setStep(1); enable();
})();
