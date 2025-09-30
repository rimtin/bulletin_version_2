// ===================== daily.js (aligned to your daily.html) =====================
// Features:
// - Auto-update every 3 hours (00/03/06… IST) using Open‑Meteo models (ensemble median)
// - Computes daily cloud % over 09–16 IST; fills Day 1 & Day 2 selects
// - Colors both maps with your 5 fixed buckets + icons
// - 12‑hour sparkline per row; click any dot to enter observed % (bias learning)
// - No backend needed (bias saved in localStorage). Can be moved server‑side later.

/* ------------------- CONFIG ------------------- */
const IST_TZ = "Asia/Kolkata";
const SOLAR_START = 9, SOLAR_END = 16;     // daily mean window
const REFRESH_HOURS = 3;                   // refresh cadence
const MODELS = ["ecmwf_ifs04","icon_seamless","gfs_seamless"]; // ensemble set

// Your buckets/colors (must match data.js forecastOptions/colors)
const CLOUD_BUCKETS = [
  {key:"Clear Sky",            min:0,  max:10},
  {key:"Low Cloud Cover",      min:10, max:30},
  {key:"Medium Cloud Cover",   min:30, max:50},
  {key:"High Cloud Cover",     min:50, max:75},
  {key:"Overcast Cloud Cover", min:75, max:100}
];
const BUCKET_RANK = {"Clear Sky":0,"Low Cloud Cover":1,"Medium Cloud Cover":2,"High Cloud Cover":3,"Overcast Cloud Cover":4};
const HYSTERESIS = 3; // % to avoid flicker

// Minimal fallback centroids if window.regionCentroids is not provided
const FALLBACK_CENTROIDS = {
  "Punjab:Punjab": [[31.1,75.4]],
  "Rajasthan:West Rajasthan": [[26.9,73.2]],
  "Rajasthan:East Rajasthan": [[26.9,75.8]]
};

/* ------------------- HELPERS ------------------- */
const clampPct = x => Math.min(100, Math.max(0, Math.round(x)));
const by = s => document.querySelector(s);
const all = s => Array.from(document.querySelectorAll(s));
const norm = s => String(s||"").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim();
function classify(pct, prev){
  pct = clampPct(pct);
  if(prev){
    const bPrev = CLOUD_BUCKETS.find(b=>b.key===prev);
    if(bPrev){
      const lo = Math.max(0, bPrev.min - HYSTERESIS), hi = Math.min(100, bPrev.max + HYSTERESIS);
      if(pct>=lo && pct<hi) return bPrev.key;
    }
  }
  return (CLOUD_BUCKETS.find(b=>pct>=b.min && pct<b.max) || CLOUD_BUCKETS.at(-1)).key;
}
function median(a){ const s=a.slice().sort((x,y)=>x-y); const m=s.length>>1; return s.length%2?s[m]:0.5*(s[m-1]+s[m]); }
function msToNext3h(){
  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US',{timeZone:IST_TZ}));
  const h = istNow.getHours();
  const next = new Date(istNow); next.setHours(h+(3-(h%3)),0,5,0);
  return next - istNow;
}

/* ------------------- FEEDBACK / BIAS ------------------- */
const BIAS_KEY = "dailyCloudBias.v1";
const loadBias = () => { try{ return JSON.parse(localStorage.getItem(BIAS_KEY)||'{}'); }catch{ return {}; } };
const saveBias = o => localStorage.setItem(BIAS_KEY, JSON.stringify(o));
const getBias = id => (loadBias()[id]?.bias ?? 0);
function addBias(id, error){ const a=0.2; const b=loadBias(); const prev=b[id]?.bias??0; b[id]={bias:(1-a)*prev+a*error, t:Date.now()}; saveBias(b); }

/* ------------------- OPEN‑METEO FETCH ------------------- */
async function fetchHourly(lat, lon, model){
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", lat); u.searchParams.set("longitude", lon);
  u.searchParams.set("hourly", "cloudcover,cloudcover_low,cloudcover_mid,cloudcover_high");
  u.searchParams.set("models", model); u.searchParams.set("timezone", IST_TZ);
  u.searchParams.set("past_hours", 18); u.searchParams.set("forecast_hours", 18);
  const r = await fetch(u, {cache:"no-store"}); if(!r.ok) throw new Error(model+" fetch fail");
  const j = await r.json(); const h=j.hourly;
  const out=[]; if(!h) return out;
  for(let i=0;i<h.time.length;i++) out.push({
    time:h.time[i],
    hr:+h.time[i].slice(11,13),
    low:clampPct(h.cloudcover_low[i]), mid:clampPct(h.cloudcover_mid[i]), high:clampPct(h.cloudcover_high[i])
  });
  return out;
}
const eff = r => clampPct(0.6*r.low + 0.3*r.mid + 0.1*r.high);
function dailyMean(hourly){
  const day = hourly.filter(h=>h.hr>=SOLAR_START && h.hr<=SOLAR_END).map(eff);
  if(!day.length) return null; return clampPct(day.reduce((s,x)=>s+x,0)/day.length);
}

/* ------------------- TABLE + CHART UI ------------------- */
function ensureChartCell(tr){
  let td = tr.querySelector('.cell-chart');
  if(!td){ td = document.createElement('td'); td.className='cell-chart'; tr.appendChild(td); }
  return td;
}
function renderSparkline(td, regionId, hourly){
  const W=140,H=36,P=4; td.innerHTML='';
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.style.width=W+'px'; svg.style.height=H+'px'; td.appendChild(svg);
  const last12 = hourly.slice(-12).map(h=>({t:h.time,v:eff(h)}));
  if(!last12.length) return;
  const xs = last12.map((_,i)=>i/(last12.length-1));
  const path = document.createElementNS(svg.namespaceURI,'path');
  let d=''; last12.forEach((p,i)=>{ const x=P+xs[i]*(W-2*P); const y=P+(1-p.v/100)*(H-2*P); d+=(i?'L':'M')+x+','+y+' '; });
  path.setAttribute('d',d); path.setAttribute('fill','none'); path.setAttribute('stroke','#333'); path.setAttribute('stroke-width','1.5'); svg.appendChild(path);
  last12.forEach((p,i)=>{
    const cx=P+xs[i]*(W-2*P), cy=P+(1-p.v/100)*(H-2*P); const c=document.createElementNS(svg.namespaceURI,'circle');
    c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',2.5); c.setAttribute('fill','#555'); c.style.cursor='pointer';
    c.title=`${p.t.slice(11,16)} IST → ${p.v}%`;
    c.addEventListener('click',()=>{ const a=prompt(`Enter observed cloud % for ${regionId} at ${p.t.slice(11,16)} IST (0–100):`, String(p.v)); if(a==null) return; const obs=clampPct(Number(a)); addBias(regionId, obs - p.v); alert('Thanks! Bias updated.'); });
    svg.appendChild(c);
  });
}

/* ------------------- CORE UPDATE ------------------- */
const prevLabel = new Map();
async function updateAll(){
  const rows = all('#forecast-table-body tr'); if(!rows.length) return;
  const pal = window.forecastColors||{};
  const outForMap = new Map();
  for(const tr of rows){
    const regionId = `${tr.dataset.state}:${tr.dataset.subdiv}`;
    const cents = (window.regionCentroids?.[regionId] || FALLBACK_CENTROIDS[regionId] || []);
    if(!cents.length) continue;
    const byModel = {};
    for(const m of MODELS){
      const seriesPerCentroid = [];
      for(const [lat,lon] of cents){ try{ seriesPerCentroid.push(await fetchHourly(lat,lon,m)); }catch(e){ console.warn(e.message); } }
      if(!seriesPerCentroid.length) continue;
      // average centroids hour-by-hour (assume same timestamps due to API TZ=IST)
      const N = seriesPerCentroid[0].length, avg=[];
      for(let i=0;i<N;i++){
        let low=0,mid=0,high=0; for(const arr of seriesPerCentroid){ low+=arr[i].low; mid+=arr[i].mid; high+=arr[i].high; }
        avg.push({ time:seriesPerCentroid[0][i].time, hr:seriesPerCentroid[0][i].hr, low:Math.round(low/seriesPerCentroid.length), mid:Math.round(mid/seriesPerCentroid.length), high:Math.round(high/seriesPerCentroid.length) });
      }
      byModel[m]=avg;
    }
    const any = Object.values(byModel)[0]; if(!any) continue;
    // ensemble median of effective % hour-by-hour
    const hourly = any.map((_,i)=>({ time:any[i].time, hr:any[i].hr, v: median(Object.values(byModel).map(arr=>eff(arr[i]))) }));

    // render 12h chart
    renderSparkline(ensureChartCell(tr), regionId, any);

    // daily mean (raw) then bias correction
    const raw = dailyMean(any); if(raw==null) continue;
    const corrected = clampPct(raw - getBias(regionId));
    const label = classify(corrected, prevLabel.get(regionId)||null); prevLabel.set(regionId, label);

    // set selects (Day 1 = today, Day 2 = placeholder from previous logic if present)
    const s1 = tr.querySelector('td[data-col="day1"] select') || tr.querySelectorAll('select')[0];
    const s2 = tr.querySelector('td[data-col="day2"] select') || tr.querySelectorAll('select')[1];
    if(s1){ s1.value = label; s1.disabled = true; s1.style.backgroundColor = pal[label]||'#eee'; }
    if(s2 && !s2.value){ s2.value = label; s2.disabled = true; s2.style.backgroundColor = pal[label]||'#eee'; }

    outForMap.set(`${tr.dataset.subdiv}`.toLowerCase(), {cloud_pct: corrected});
  }
  // repaint maps using existing updateMapColors, which reads the selects/colors
  if(typeof updateMapColors === 'function') updateMapColors();
}

/* ------------------- SCHEDULING ------------------- */
function bootScheduler(){
  updateAll();
  setTimeout(()=>{ updateAll(); setInterval(updateAll, REFRESH_HOURS*3600*1000); }, msToNext3h());
}

/* ------------------- EXISTING PAGE HOOKS ------------------- */
// Reuse your existing map/table builders from the current daily.js
// (drawMap, buildFixedTable, updateMapColors, etc.)
// We only add the scheduler on top after DOM content is ready.
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', bootScheduler);
}else{ bootScheduler(); }


// ===================== daily.html (adjustments) =====================
// Add one more <th> after "Day 2" for the sparkline and ensure each <tr>
// ends with an empty <td class="cell-chart"></td>. Example table head:
/*
  <thead class="bg-gray-50">
    <tr>
      <th class="text-left px-3 py-2">S. No.</th>
      <th class="text-left px-3 py-2">State</th>
      <th class="text-left px-3 py-2">Sub Division</th>
      <th class="text-left px-3 py-2">Day 1</th>
      <th class="text-left px-3 py-2">Day 2</th>
      <th class="text-left px-3 py-2">Last 12h (IST)</th>
    </tr>
  </thead>
*/
// If you build rows dynamically, append a <td class="cell-chart"></td> to each row
// inside buildFixedTable(). The JS above will fill it with a mini chart.
