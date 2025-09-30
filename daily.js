// ===================== daily.js (accuracy-first, aligned to daily.html) =====================
// What this does:
// - Auto-update every 3 hours (00/03/06… IST) from Open-Meteo models (ECMWF+ICON+GFS)
// - Median ensemble (robust), centroid-averaged per region, weighted low/mid/high -> effective cloud%
// - Daily mean for 09–16 IST -> locked to your 5 buckets (colors from window.forecastColors)
// - 12-hour sparkline per row (last 12 IST hours); click a dot to enter observed % (bias learning, localStorage)
// - Updates table selects + map. If window.applyDailyToMap exists, it’s used; otherwise calls updateMapColors().
//
// Minimal expectations on the page (kept same as your setup):
// <tbody id="forecast-table-body"> … rows with data-state, data-subdiv, Day1/Day2 <select> cells …
// Colors & options in window.forecastColors / window.forecastOptions
// Region centroids in window.regionCentroids = { "State:Subdivision": [[lat,lon], ...], ... }
// Optional map hook: window.applyDailyToMap(Map(id->{cloud_pct}))
//
// You can keep your existing buildFixedTable(), drawMap(), updateMapColors() as-is.

(() => {
/* ------------------- CONFIG ------------------- */
const IST_TZ = "Asia/Kolkata";
const SOLAR_START = 9, SOLAR_END = 16;       // daily mean window
const REFRESH_HOURS = 3;                     // refresh cadence
const MODELS = ["ecmwf_ifs04","icon_seamless","gfs_seamless"]; // ensemble set

// Buckets (your Excel scheme)
const CLOUD_BUCKETS = [
  { key: "Clear Sky",            min: 0,  max: 10 },
  { key: "Low Cloud Cover",      min: 10, max: 30 },
  { key: "Medium Cloud Cover",   min: 30, max: 50 },
  { key: "High Cloud Cover",     min: 50, max: 75 },
  { key: "Overcast Cloud Cover", min: 75, max: 100 }
];
const HYSTERESIS = 3; // % to avoid flicker at edges

// Minimal fallbacks if a centroid is missing (you can remove once your centroids are complete)
const FALLBACK_CENTROIDS = {
  "Punjab:Punjab": [[31.1,75.4]],
  "Rajasthan:West Rajasthan": [[26.9,73.2]],
  "Rajasthan:East Rajasthan": [[26.9,75.8]]
};

/* ------------------- HELPERS ------------------- */
const clampPct = x => Math.min(100, Math.max(0, Math.round(Number(x))));
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function median(a){ const s=a.slice().sort((x,y)=>x-y); const m=s.length>>1; return s.length%2?s[m]:0.5*(s[m-1]+s[m]); }
function msToNext3h(){
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US',{timeZone:IST_TZ}));
  const h = ist.getHours();
  const next = new Date(ist); next.setHours(h + (3 - (h % 3)), 0, 5, 0); // +5s cushion
  return next - ist;
}
function classify(pct, prevKey){
  pct = clampPct(pct);
  if(prevKey){
    const bPrev = CLOUD_BUCKETS.find(b=>b.key===prevKey);
    if(bPrev){
      const lo = Math.max(0, bPrev.min - HYSTERESIS);
      const hi = Math.min(100, bPrev.max + HYSTERESIS);
      if(pct>=lo && pct<hi) return bPrev.key;
    }
  }
  return (CLOUD_BUCKETS.find(b=>pct>=b.min && pct<b.max) || CLOUD_BUCKETS.at(-1)).key;
}

/* ------------------- FEEDBACK / BIAS (per-region EWMA) ------------------- */
const BIAS_KEY = "dailyCloudBias.v1";
const loadBias = () => { try { return JSON.parse(localStorage.getItem(BIAS_KEY)||'{}'); } catch { return {}; } };
const saveBias = o => localStorage.setItem(BIAS_KEY, JSON.stringify(o));
const getBias  = id => (loadBias()[id]?.bias ?? 0);
function addBias(id, error){ const a=0.2; const b=loadBias(); const prev=b[id]?.bias??0; b[id]={bias:(1-a)*prev+a*error, t:Date.now()}; saveBias(b); }

/* ------------------- FETCH + NORMALIZE ------------------- */
async function fetchHourly(lat, lon, model){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("hourly", "cloudcover,cloudcover_low,cloudcover_mid,cloudcover_high");
  url.searchParams.set("models", model);
  url.searchParams.set("timezone", IST_TZ);
  // keep a window around now for “last 12h” and near-future smoothing if needed
  url.searchParams.set("past_hours", 18);
  url.searchParams.set("forecast_hours", 18);

  const r = await fetch(url.toString(), { cache: "no-store" });
  if(!r.ok) throw new Error(`${model} fetch: ${r.status}`);
  const h = (await r.json()).hourly;
  if(!h) return [];

  const out = [];
  for(let i=0; i<h.time.length; i++){
    out.push({
      time: h.time[i],                           // already IST due to timezone=Asia/Kolkata
      hr:   +h.time[i].slice(11,13),
      low:  clampPct(h.cloudcover_low[i]),
      mid:  clampPct(h.cloudcover_mid[i]),
      high: clampPct(h.cloudcover_high[i])
    });
  }
  return out;
}

// “Effective” % with low>mid>high weighting (GHI relevance)
const effectivePct = r => clampPct(0.6*r.low + 0.3*r.mid + 0.1*r.high);

// Average multiple centroids (same timestamps -> mean per hour)
function averageCentroids(seriesPerCentroid){
  if(seriesPerCentroid.length===1) return seriesPerCentroid[0];
  const N = seriesPerCentroid[0].length;
  const out = new Array(N);
  for(let i=0;i<N;i++){
    let low=0, mid=0, high=0;
    for(const arr of seriesPerCentroid){ low+=arr[i].low; mid+=arr[i].mid; high+=arr[i].high; }
    out[i] = {
      time: seriesPerCentroid[0][i].time,
      hr:   seriesPerCentroid[0][i].hr,
      low:  Math.round(low/seriesPerCentroid.length),
      mid:  Math.round(mid/seriesPerCentroid.length),
      high: Math.round(high/seriesPerCentroid.length)
    };
  }
  return out;
}

// Median ensemble across models (robust to one bad model)
function ensembleMedian(byModel){
  const any = Object.values(byModel)[0];
  const out = [];
  for(let i=0;i<any.length;i++){
    const v = median(Object.values(byModel).map(arr => effectivePct(arr[i])));
    out.push({ time: any[i].time, hr: any[i].hr, v });
  }
  return out; // [{time, hr, v(%)}, ...]
}

// Daily mean over SOLAR_START..END
function dailyMeanPct(hourlyEff){
  const window = hourlyEff.filter(h => h.hr >= SOLAR_START && h.hr <= SOLAR_END);
  if(!window.length) return null;
  return clampPct(window.reduce((s,h)=>s+h.v,0)/window.length);
}

/* ------------------- TABLE + SPARKLINE ------------------- */
function ensureSparklineHeader(){
  const theadRow = document.querySelector('#forecast-table thead tr');
  if(!theadRow) return;
  const lastColExists = Array.from(theadRow.children).some(th => th.textContent?.trim().toLowerCase().includes('last 12h'));
  if(!lastColExists){
    const th = document.createElement('th');
    th.className = "text-left px-3 py-2";
    th.textContent = "Last 12h (IST)";
    theadRow.appendChild(th);
  }
}
function ensureChartCell(tr){
  let td = tr.querySelector('.cell-chart');
  if(!td){ td = document.createElement('td'); td.className = 'cell-chart'; tr.appendChild(td); }
  return td;
}
function renderSparkline(td, regionId, hourlyEff){
  const W=140,H=36,P=4;
  td.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.style.width = W+'px'; svg.style.height = H+'px';
  td.appendChild(svg);

  const last12 = hourlyEff.slice(-12);
  if(!last12.length) return;

  const xs = last12.map((_,i)=>i/(last12.length-1));
  const path = document.createElementNS(svg.namespaceURI,'path');
  let d=''; last12.forEach((p,i)=>{ const x=P+xs[i]*(W-2*P); const y=P+(1-p.v/100)*(H-2*P); d+=(i?'L':'M')+x+','+y+' '; });
  path.setAttribute('d', d);
  path.setAttribute('fill','none'); path.setAttribute('stroke','#333'); path.setAttribute('stroke-width','1.5');
  svg.appendChild(path);

  // clickable dots for feedback
  last12.forEach((p,i)=>{
    const cx=P+xs[i]*(W-2*P), cy=P+(1-p.v/100)*(H-2*P);
    const c=document.createElementNS(svg.namespaceURI,'circle');
    c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',2.5); c.setAttribute('fill','#555');
    c.style.cursor='pointer'; c.title=`${p.time.slice(11,16)} IST → ${p.v}%`;
    c.addEventListener('click',()=>{
      const a = prompt(`Enter observed cloud % for ${regionId} at ${p.time.slice(11,16)} IST (0–100):`, String(p.v));
      if(a==null) return;
      const obs = clampPct(a);
      addBias(regionId, obs - p.v);   // +ve means model under-predicted
      alert('Thanks! Bias updated; future daily values will be corrected.');
    });
    svg.appendChild(c);
  });
}

/* ------------------- CORE UPDATE ------------------- */
const prevLabel = new Map();

async function updateAll(){
  const tbody = $('#forecast-table-body') || document.querySelector('tbody[data-role="forecast"]');
  if(!tbody) return;

  const rows = Array.from(tbody.querySelectorAll('tr'));
  if(!rows.length) return;

  const palette = (window.forecastColors||{});
  const outForMap = new Map();

  for(const tr of rows){
    const regionId = `${tr.dataset.state}:${tr.dataset.subdiv}`;
    const cents = (window.regionCentroids?.[regionId] || FALLBACK_CENTROIDS[regionId] || []);
    if(!cents.length){ console.warn('No centroid for', regionId); continue; }

    const byModel = {};
    for(const model of MODELS){
      const seriesPerCentroid = [];
      for(const [lat,lon] of cents){
        try { seriesPerCentroid.push(await fetchHourly(lat,lon,model)); }
        catch(e){ console.warn(e.message); }
      }
      if(!seriesPerCentroid.length) continue;
      byModel[model] = averageCentroids(seriesPerCentroid);
    }
    if(!Object.keys(byModel).length){ console.warn('No model data for', regionId); continue; }

    // Hourly effective % from ensemble-median
    const hourlyEff = ensembleMedian(byModel);

    // Sparkline (last 12h)
    ensureSparklineHeader();
    renderSparkline(ensureChartCell(tr), regionId, hourlyEff);

    // Daily mean (raw) -> bias correction -> classify
    const rawDaily = dailyMeanPct(hourlyEff);
    if(rawDaily==null) continue;

    const corrected = clampPct(rawDaily - getBias(regionId));
    const label = classify(corrected, prevLabel.get(regionId)||null);
    prevLabel.set(regionId, label);

    // Fill Day1/Day2 selects & color
    const s1 = tr.querySelector('td[data-col="day1"] select') || tr.querySelectorAll('select')[0];
    const s2 = tr.querySelector('td[data-col="day2"] select') || tr.querySelectorAll('select')[1];
    if(s1){ s1.value = label; s1.disabled = true; s1.style.backgroundColor = palette[label]||'#eee'; }
    if(s2 && !s2.value){ s2.value = label; s2.disabled = true; s2.style.backgroundColor = palette[label]||'#eee'; }

    // For map consumers
    outForMap.set(regionId, { cloud_pct: corrected });
  }

  // Map repaint: prefer your external hook; otherwise use your existing palette-driven updater
  if(typeof window.applyDailyToMap === 'function'){
    window.applyDailyToMap(outForMap);
  }else if(typeof window.updateMapColors === 'function'){
    window.updateMapColors();
  }
}

/* ------------------- SCHEDULER ------------------- */
function startScheduler(){
  updateAll();
  setTimeout(()=>{
    updateAll();
    setInterval(updateAll, REFRESH_HOURS*3600*1000);
  }, msToNext3h());
}

/* ------------------- BOOT ------------------- */
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', startScheduler);
}else{
  startScheduler();
}

})(); // IIFE end
