/*
 * Daily forecast (cloud % + GHI) — free & open‑source
 * ----------------------------------------------------
 * - Pulls multiple Open‑Meteo models (no API key)
 * - Ensembles per region (median w/ outlier trim)
 * - Aggregates to a daily value over solar window (default 09–16 IST)
 * - Refreshes every 3 hours automatically
 * - Works for sub‑divisions and districts
 * - Plays nice with an external map renderer (app.js)
 *
 * Integration points expected on the page:
 * 1) Table body with rows: <tr data-region-id="STATE:Name" ...>
 *    and cells: .cell-cloud (for %), .cell-ghi (for W/m²)
 * 2) Optional map hook: window.applyDailyToMap(byId) — called with Map(id->{cloud_pct, ghi_wm2})
 * 3) Optional global centroids registry (preferred):
 *      window.regionCentroids = {
 *        "Punjab:Punjab": [[31.1,75.4]],                // one or more [lat,lon] per region
 *        "Rajasthan:West Rajasthan": [[26.9,71.2],[27.6,73.4]],
 *        ...
 *      }
 *    If missing, we’ll try to compute centroids from a loaded GeoJSON of sub‑divisions/districts.
 * 4) Optional prebuilt JSON (for zero client compute): set window.DAILY_DATA_URL = 
 *      "./data/daily-ensemble.json" to just load results produced by a GitHub Action.
 *
 * Notes:
 * - No paid services; all free endpoints.
 * - If you want stricter rate usage, enable PREBUILT mode via DAILY_DATA_URL.
 */

(() => {
  const OM_BASE = "https://api.open-meteo.com/v1/forecast";
  const MODELS  = ["gfs_seamless","icon_seamless","ifs04","best_match"]; // tweak if needed
  const HOURLY_VARS = "shortwave_radiation,direct_radiation,diffuse_radiation,cloudcover";
  const HOURS_AHEAD = 48;                     // horizon we aggregate from
  const DISPLAY_TZ  = "Asia/Kolkata";        // UI timezone
  const DAILY_WINDOW = window.DAILY_WINDOW || "09-16"; // solar hours for daily aggregation
  const CONCURRENCY = 6;                      // request concurrency limit
  const VERSION = "v1.2.0";                  // bump if logic changes (localStorage cache key)

  // ---- Lightweight math helpers ----
  const round = (x,d=0)=>{ const p=10**d; return Math.round(x*p)/p; };
  const median = a=>{ const s=[...a].sort((x,y)=>x-y); const n=s.length; return !n?NaN:(n%2?s[(n-1)/2]:0.5*(s[n/2-1]+s[n/2])); };
  const trimOutliers = a=>{ const s=[...a].sort((x,y)=>x-y); if(s.length<5) return s; const k=Math.floor(s.length*0.1); return s.slice(k, s.length-k); };

  // ---- Solar + fallback GHI (no deps, clear‑sky proxy) ----
  function clearSkyGHI(tsUTC, lat, lon){
    const d=new Date(tsUTC);
    const n=Math.floor((Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-Date.UTC(d.getUTCFullYear(),0,0))/86400000);
    const I_sc=1361, E0=1+0.033*Math.cos(2*Math.PI*n/365);
    const delta=23.45*Math.PI/180*Math.sin(2*Math.PI*(284+n)/365);
    const minutes=d.getUTCHours()*60+d.getUTCMinutes()+lon*4; // ~4 min/deg
    const H=(minutes/4-180)*Math.PI/180;
    const phi=lat*Math.PI/180;
    const cosZ=Math.sin(phi)*Math.sin(delta)+Math.cos(phi)*Math.cos(delta)*Math.cos(H);
    if(cosZ<=0) return 0; // night
    const tau=0.75; // bulk transmittance
    return Math.max(0, I_sc*E0*cosZ*tau);
  }
  function cloudToKt(cloudPct, alpha=0.75, beta=1.1){
    const c=Math.min(100,Math.max(0,cloudPct))/100; // 0..1
    const kt=1-alpha*Math.pow(c,beta);
    return Math.min(1, Math.max(0.05, kt));
  }

  // ---- Fetch one model for lat/lon ----
  async function fetchModel(lat, lon, model, hoursAhead=HOURS_AHEAD, tz="UTC"){
    const url=new URL(OM_BASE);
    url.searchParams.set("latitude",lat);
    url.searchParams.set("longitude",lon);
    url.searchParams.set("hourly",HOURLY_VARS);
    url.searchParams.set("forecast_days", Math.ceil(hoursAhead/24));
    url.searchParams.set("models",model);
    url.searchParams.set("timezone",tz);
    const r=await fetch(url, { cache:"no-store" });
    if(!r.ok) throw new Error(`${model} HTTP ${r.status}`);
    const j=await r.json();
    const t=j.hourly?.time||[], sw=j.hourly?.shortwave_radiation||[], cc=j.hourly?.cloudcover||[];
    const dr=j.hourly?.direct_radiation||[], df=j.hourly?.diffuse_radiation||[];
    return t.map((time,i)=>({time,model,sw:sw[i]??null,cc:cc[i]??null,dr:dr[i]??null,df:df[i]??null}));
  }

  // ---- Ensemble at one point ----
  async function ensembleAtPoint(lat, lon){
    const results = await Promise.allSettled(MODELS.map(m=>fetchModel(lat,lon,m,HOURS_AHEAD,"UTC")));
    const byTime=new Map();
    for(const res of results){
      if(res.status!=="fulfilled") continue;
      for(const row of res.value){
        if(!byTime.has(row.time)) byTime.set(row.time,[]);
        byTime.get(row.time).push(row);
      }
    }
    const times=[...byTime.keys()].sort();
    const series=[];
    for(const time of times){
      const rows=byTime.get(time);
      const ghis=[], clouds=[];
      for(const r of rows){
        if(Number.isFinite(r.sw)) ghis.push(r.sw);
        else if(Number.isFinite(r.cc)){
          const Gcs=clearSkyGHI(time,lat,lon);
          ghis.push(Gcs*cloudToKt(r.cc));
        }
        if(Number.isFinite(r.cc)) clouds.push(r.cc);
      }
      const ghi = ghis.length ? median(trimOutliers(ghis)) : 0;
      const cloud = clouds.length ? median(trimOutliers(clouds)) : null;
      series.push({ time, ghi: Math.max(0, round(ghi,1)), cloud: cloud!=null?round(cloud,0):null });
    }
    // 3‑pt median smooth
    for(let i=1;i<series.length-1;i++){
      const g=[series[i-1].ghi,series[i].ghi,series[i+1].ghi].sort((a,b)=>a-b); series[i].ghi=g[1];
      const c=[series[i-1].cloud,series[i].cloud,series[i+1].cloud].filter(x=>x!=null).sort((a,b)=>a-b);
      if(c.length===3) series[i].cloud=c[1];
    }
    return series;
  }

  // ---- Aggregate hourly → daily number (solar window in IST) ----
  function aggregateDaily(series, window=DAILY_WINDOW){
    const [h1,h2] = window.split("-").map(Number);
    const out = series.filter(row=>{
      const t=new Date(row.time);
      // IST = UTC+5:30
      let ist = t.getUTCHours()+5 + (t.getUTCMinutes()>=30?1:0); // rough hour bucket
      if(ist>=24) ist-=24;
      return ist>=h1 && ist<=h2;
    });
    if(!out.length) return { cloud_pct:null, ghi_wm2:null };
    const cloudVals=out.map(r=>r.cloud).filter(x=>x!=null);
    const ghiVals=out.map(r=>r.ghi).filter(Number.isFinite);
    const cloud = cloudVals.length? round(cloudVals.reduce((a,b)=>a+b)/cloudVals.length,0) : null;
    const ghi = ghiVals.length? round(ghiVals.reduce((a,b)=>a+b)/ghiVals.length,0) : null;
    return { cloud_pct: cloud, ghi_wm2: ghi };
  }

  // ---- Region driver: combine samples (multiple centroids per region) ----
  async function computeRegion(regionId, centroids){
    // simple concurrency inside region: run samples in parallel
    const seriesList = await Promise.all(centroids.map(([lat,lon])=>ensembleAtPoint(lat,lon)));
    // average samples per hour
    const byTime=new Map();
    for(const s of seriesList){
      for(const row of s){
        if(!byTime.has(row.time)) byTime.set(row.time,[]);
        byTime.get(row.time).push(row);
      }
    }
    const times=[...byTime.keys()].sort();
    const hourly = times.map(t=>{
      const rows=byTime.get(t);
      const cloudVals=rows.map(x=>x.cloud).filter(x=>x!=null);
      const ghiVals=rows.map(x=>x.ghi).filter(Number.isFinite);
      const cloud = cloudVals.length? round(cloudVals.reduce((a,b)=>a+b)/cloudVals.length,0) : null;
      const ghi = ghiVals.length? round(ghiVals.reduce((a,b)=>a+b)/ghiVals.length,1) : 0;
      return { time:t, cloud, ghi };
    });
    const daily = aggregateDaily(hourly);
    return { id: regionId, cloud_pct: daily.cloud_pct, ghi_wm2: daily.ghi_wm2, hourly };
  }

  // ---- Local cache (per 3‑hour cycle) ----
  function cacheKey(){
    const now = new Date();
    const utcHours = now.getUTCHours();
    const bucket = Math.floor(utcHours/3); // 0..7
    return `daily_ensemble_${VERSION}_${now.getUTCFullYear()}${now.getUTCMonth()+1}${now.getUTCDate()}_${bucket}`;
  }
  function loadCache(){ try{ return JSON.parse(localStorage.getItem(cacheKey())||"null"); }catch(e){ return null; } }
  function saveCache(obj){ try{ localStorage.setItem(cacheKey(), JSON.stringify(obj)); }catch(e){} }

  // ---- Try PREBUILT JSON first (if provided) ----
  async function maybeLoadPrebuilt(){
    const url = window.DAILY_DATA_URL;
    if(!url) return null;
    try{
      const r = await fetch(url, { cache:"no-store" });
      if(!r.ok) throw 0;
      const j = await r.json();
      return j;
    }catch(e){ return null; }
  }

  // ---- Region list discovery from table ----
  function discoverRegionsFromTable(){
    const rows = Array.from(document.querySelectorAll("#forecast-table-body tr[data-region-id]"));
    const ids = rows.map(tr=>tr.dataset.regionId).filter(Boolean);
    return Array.from(new Set(ids));
  }

  // ---- Centroids source resolution ----
  async function resolveCentroids(regionIds){
    const mapping = {};
    // Preferred: global registry
    const reg = (window.regionCentroids||{});
    regionIds.forEach(id=>{ if(reg[id]) mapping[id]=reg[id]; });

    // If missing, try to compute from a loaded GeoJSON (sub‑divisions/districts)
    const missing = regionIds.filter(id=>!mapping[id]);
    if(missing.length && window.subdivisionGeo){
      const byKey = new Map();
      for(const f of window.subdivisionGeo.features||[]){
        const state = (f.properties?.ST_NM||f.properties?.state||"-").trim();
        const name  = (f.properties?.name||f.properties?.NAME_1||f.properties?.district||"").trim();
        const id    = `${state}:${name}`;
        byKey.set(id.toLowerCase(), f);
      }
      for(const id of missing){
        const f = byKey.get(id.toLowerCase());
        if(!f) continue;
        const c = featureCentroid(f);
        if(c) mapping[id] = [c];
      }
    }
    return mapping;
  }

  // Basic polygon centroid (GeoJSON lon/lat)
  function featureCentroid(feat){
    try{
      const coords = feat.geometry.coordinates;
      let sumX=0,sumY=0,count=0;
      const walk = arr=>{
        for(const ring of arr){
          for(const pt of ring){ sumX+=pt[0]; sumY+=pt[1]; count++; }
        }
      };
      if(feat.geometry.type==="Polygon") walk(coords);
      if(feat.geometry.type==="MultiPolygon") for(const poly of coords) walk(poly);
      if(!count) return null;
      const lon=sumX/count, lat=sumY/count;
      return [lat,lon];
    }catch(e){ return null; }
  }

  // ---- Orchestrator ----
  async function buildDaily(){
    // 1) Prebuilt JSON? (fully free + scalable via GitHub Pages)
    const pre = await maybeLoadPrebuilt();
    if(pre && pre.regions){
      applyToUI(pre.regions, new Date(pre.generated_at));
      return;
    }

    // 2) Cache for this 3‑hour cycle?
    const cached = loadCache();
    if(cached && Array.isArray(cached.regions)){
      applyToUI(cached.regions, new Date(cached.generated_at));
      return;
    }

    // 3) Discover regions from table
    const regionIds = discoverRegionsFromTable();
    if(!regionIds.length){ console.warn("No region rows found"); return; }

    // 4) Resolve centroids
    const centMap = await resolveCentroids(regionIds);
    const unresolved = regionIds.filter(id=>!centMap[id]);
    if(unresolved.length) console.warn("Missing centroids for:", unresolved);

    // 5) Compute with a small concurrency pool
    const jobs = regionIds.map(id=>({ id, cents: centMap[id]||[] }));

    const results = [];
    let idx = 0; 
    async function worker(){
      while(idx < jobs.length){
        const my = jobs[idx++];
        if(!my.cents.length){ results.push({ id: my.id, cloud_pct: null, ghi_wm2: null, hourly: [] }); continue; }
        try{
          const rec = await computeRegion(my.id, my.cents);
          results.push(rec);
        }catch(err){
          console.error("Region compute failed", my.id, err);
          results.push({ id: my.id, cloud_pct: null, ghi_wm2: null, hourly: [] });
        }
      }
    }
    const workers = Array.from({length:Math.min(CONCURRENCY, jobs.length)}, ()=>worker());
    await Promise.all(workers);

    const stamp = new Date();
    saveCache({ generated_at: stamp.toISOString(), regions: results });
    applyToUI(results, stamp);
  }

  // ---- UI binding ----
  function applyToUI(regions, stamp){
    // 1) Update timestamp label
    const el = document.querySelector("#lastUpdated");
    if(el){ el.textContent = `Updated: ${stamp.toLocaleString("en-GB", { timeZone: DISPLAY_TZ })} IST`; }

    // 2) Table fill
    const by = new Map(regions.map(r=>[r.id, r]));
    document.querySelectorAll("#forecast-table-body tr[data-region-id]").forEach(tr=>{
      const id = tr.dataset.regionId;
      const rec = by.get(id);
      const cloudCell = tr.querySelector(".cell-cloud");
      const ghiCell   = tr.querySelector(".cell-ghi");
      if(rec){
        if(cloudCell) cloudCell.textContent = rec.cloud_pct==null?"—":`${rec.cloud_pct}%`;
        if(ghiCell)   ghiCell.textContent   = rec.ghi_wm2==null?"—":`${rec.ghi_wm2}`;
      } else {
        if(cloudCell) cloudCell.textContent = "—";
        if(ghiCell)   ghiCell.textContent   = "—";
      }
    });

    // 3) Map hook (optional)
    if(typeof window.applyDailyToMap === "function"){
      const forMap = new Map(regions.map(r=>[r.id, { cloud_pct: r.cloud_pct, ghi_wm2: r.ghi_wm2 }]));
      window.applyDailyToMap(forMap);
    }
  }

  // ---- 3‑hour auto‑refresh scheduler ----
  function msUntilNext3h(){
    const now = new Date();
    const h = now.getUTCHours();
    const nextBucket = (Math.floor(h/3)+1)*3; // 0,3,6..21 → next 3h mark
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), nextBucket%24, 0, 5)); // +5s pad
    if(nextBucket>=24) next.setUTCDate(next.getUTCDate()+1);
    return next - now;
  }

  async function boot(){
    await buildDaily();
    setTimeout(()=>{ localStorage.removeItem(cacheKey()); buildDaily(); }, msUntilNext3h());
  }

  // Fire when DOM ready
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
