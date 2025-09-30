// === Map + table app (legend + satellite + hourly Day1/Day2 + Punjab panel + IST rollover, ACCURATE & AUTO-UPDATING) ===
const W = 860, H = 580, PAD = 18;
const MATCH_KEY = "ST_NM";        // Sub-division display name in your GeoJSON
let STATE_KEY = "ST_NM";          // Will be auto-detected
let NAME_KEY  = "name";           // Will be auto-detected

// per-map stores
const indexByGroup  = { "#indiaMapDay1": new Map(), "#indiaMapDay2": new Map() };
const groupCentroid = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };

/* ---------------- Satellite links for legend button ---------------- */
const SATELLITE_LINKS = {
  "#indiaMapDay1": "https://zoom.earth/#view=22.5,79.0,5z/layers=labels,clouds",
  "#indiaMapDay2": "https://zoom.earth/#view=22.5,79.0,5z/layers=labels,clouds"
};

/* ---------------- ACCURACY CONFIG (IST + models + buckets) -------- */
const IST_TZ = "Asia/Kolkata";
const SOLAR_START = 9, SOLAR_END = 16;       // daily mean window
const REFRESH_HOURS = 3;                     // auto update cadence
const MODELS = ["ecmwf_ifs04","icon_seamless","gfs_seamless"]; // ensemble set
const HYSTERESIS = 3;                        // % buffer at bucket edges

// Single source of truth for buckets
const CLOUD_BUCKETS = [
  { key: "Clear Sky",            min: 0,  max: 10 },
  { key: "Low Cloud Cover",      min: 10, max: 30 },
  { key: "Medium Cloud Cover",   min: 30, max: 50 },
  { key: "High Cloud Cover",     min: 50, max: 75 },
  { key: "Overcast Cloud Cover", min: 75, max: 100 }
];
const BUCKET_RANK = { "Clear Sky":0,"Low Cloud Cover":1,"Medium Cloud Cover":2,"High Cloud Cover":3,"Overcast Cloud Cover":4 };

/* ---- minimal manual fallbacks (kept, but the new seeding covers all) ---- */
const FALLBACK_CENTROIDS = {
  "Punjab": [[31.1,75.4]], "West Rajasthan": [[26.9,73.2]], "East Rajasthan": [[26.9,75.8]]
};

/* ---------------- Helpers ---------------- */
const clampPct = x => Math.min(100, Math.max(0, Math.round(Number(x))));
const norm = s => String(s || "")
  .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s*&\s*/g, " and ").replace(/\s*\([^)]*\)\s*/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

function bucketFromPct(pct){
  pct = clampPct(pct);
  for (const b of CLOUD_BUCKETS){ if (pct >= b.min && pct < b.max) return b.key; }
  return CLOUD_BUCKETS.at(-1).key;
}
function classifyWithHysteresis(pct, prevKey){
  pct = clampPct(pct);
  if (prevKey){
    const b = CLOUD_BUCKETS.find(x => x.key === prevKey);
    if (b){
      const lo = Math.max(0, b.min - HYSTERESIS), hi = Math.min(100, b.max + HYSTERESIS);
      if (pct >= lo && pct < hi) return b.key;
    }
  }
  return bucketFromPct(pct);
}
function detectKeys(features){
  const sKeys = ["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","State"];
  const dKeys = ["DISTRICT","name","NAME_2","Name","district","dist_name"];
  const sample = features[0]?.properties || {};
  STATE_KEY = sKeys.find(k => k in sample) || STATE_KEY;
  NAME_KEY  = dKeys.find(k => k in sample) || NAME_KEY;
}
function pickProjection(fc){
  const [[minX,minY],[maxX,maxY]] = d3.geoBounds(fc);
  const w = maxX - minX, h = maxY - minY;
  const lonlat = w < 200 && h < 120 && minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
  return lonlat
    ? d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc)
    : d3.geoIdentity().reflectY(true).fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc);
}
function ensureLayer(svg, className){
  let g = svg.select(`.${className}`);
  if (g.empty()) g = svg.append("g").attr("class", className);
  return g;
}
function ensureTooltip(){
  let tt = d3.select(".map-tooltip");
  if (tt.empty()){
    tt = d3.select("body").append("div").attr("class","map-tooltip").style("opacity",0);
  }
  return tt;
}
function findDistrictNameKey(props = {}) {
  const keys = Object.keys(props);
  const exact = [
    "DISTRICT","District","district","DIST_NAME","DIST_NM","DISTNAME","dist_name",
    "DT_NAME","DTNAME","dist","DISTRICT_N","District_Name",
    "NAME_2","name_2","NAME2","name2","NAME","name","NAMELSAD","NL_NAME_2"
  ];
  for (const k of exact) if (k in props) return k;
  const fuzzyDN = keys.find(k => k.toLowerCase().includes("dist") && k.toLowerCase().includes("name"));
  if (fuzzyDN) return fuzzyDN;
  const fuzzyName = keys.find(k => k.toLowerCase().startsWith("name") && !k.toLowerCase().includes("state"));
  return fuzzyName || keys[0] || "name";
}

/* ---------------- GeoJSON fallbacks ---------------- */
const GEO_URLS = [
  "indian_met_zones.geojson",
  "assets/indian_met_zones.geojson",
  "bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/weather_bulletin/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/rimtin/weather_bulletin/main/indian_met_zones.geojson",
  "https://cdn.jsdelivr.net/gh/rimtin/weather_bulletin@main/indian_met_zones.geojson"
];
async function fetchFirst(urls){
  for (const url of urls){
    try{
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      console.log("[Map] Loaded:", url);
      return j;
    }catch{}
  }
  throw new Error("No GeoJSON found");
}

/* ---------------- Cloud classification table ---------------- */
function buildCloudTable(){
  const table = document.getElementById("cloudTable");
  if (!table) return;
  const tbody = table.querySelector("tbody") || table.appendChild(document.createElement("tbody"));
  tbody.innerHTML = "";

  const pal  = window.cloudRowColors || window.forecastColors || {};
  const rows = window.cloudRows || [];

  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.style.background = pal[r.label] || "#fff";
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${r.cover}</td>
      <td><strong>${r.label}</strong></td>
      <td>${r.type}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---------------- Legend with Satellite Button ---------------- */
function drawLegendWithButton(svg, title, linkUrl){
  svg.selectAll(".map-legend").remove();

  const pal = window.forecastColors || {};
  const labels = window.forecastOptions || Object.keys(pal);

  const pad = 10, sw = 18, gap = 18;
  const width = 210;
  const height = pad + 18 + labels.length * gap + 44;

  const g = svg.append("g")
    .attr("class", "map-legend")
    .attr("transform", `translate(${W - width - 14}, ${14})`);

  g.append("rect").attr("width", width).attr("height", height)
    .attr("rx", 12).attr("ry", 12)
    .attr("fill", "rgba(255,255,255,0.95)").attr("stroke", "#d1d5db");

  g.append("text").attr("x", pad).attr("y", pad + 14)
    .attr("font-weight", 700).attr("font-size", 13).attr("fill", "#111827")
    .text(title);

  labels.forEach((label, i) => {
    const y = pad + 28 + i * gap;
    g.append("rect").attr("x", pad).attr("y", y - 12)
      .attr("width", sw).attr("height", 12)
      .attr("fill", pal[label] || "#eee").attr("stroke", "#9ca3af");
    g.append("text").attr("x", pad + sw + 8).attr("y", y - 2)
      .attr("font-size", 12).attr("fill", "#111827")
      .text(label);
  });

  const btnW = width - pad*2, btnH = 28, btnY = height - pad - btnH;
  const btn = g.append("g")
    .attr("class", "legend-btn")
    .style("cursor", "pointer")
    .on("click", () => window.open(linkUrl, "_blank", "noopener"));

  btn.append("rect").attr("x", pad).attr("y", btnY)
    .attr("width", btnW).attr("height", btnH).attr("rx", 8).attr("ry", 8)
    .attr("fill", "#2563eb");

  btn.append("text")
    .attr("x", pad + btnW/2).attr("y", btnY + btnH/2 + 4)
    .attr("text-anchor", "middle")
    .attr("font-size", 12).attr("font-weight", 700).attr("fill", "#fff")
    .text("View satellite");
}

/* ---------------- NEW: seed centroids for ALL sub-divisions ---------------- */
// Build lat/lon centroids for every sub-division (from GeoJSON) so the
// ensemble forecast runs for *all* rows without manual coordinates.
function seedRegionCentroidsFromFeatures(features){
  if (!features?.length) return;
  if (!window.regionCentroids) window.regionCentroids = {};

  const groups = new Map();
  for (const f of features){
    const subdivName = String(f.properties?.[MATCH_KEY] ?? "").trim();
    if (!subdivName) continue;
    const stName = String(f.properties?.[STATE_KEY] ?? "").trim();
    const k = norm(subdivName);
    let g = groups.get(k);
    if (!g){ g = { name: subdivName, feats: [], states: new Set() }; groups.set(k, g); }
    g.feats.push(f);
    if (stName) g.states.add(stName);
  }

  groups.forEach(({name, feats, states}) => {
    const fc = { type: "FeatureCollection", features: feats };
    const [lon, lat] = d3.geoCentroid(fc);
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      // Save by plain sub-division name:
      window.regionCentroids[name] = [[lat, lon]];
      // Also save by "State:Subdivision" (for tables keyed that way):
      states.forEach(st => {
        window.regionCentroids[`${st}:${name}`] = [[lat, lon]];
      });
    }
  });

  console.log("[Centroids] Sub-divisions seeded:", Object.keys(window.regionCentroids).length);
}

/* ---------------- DRAW MAP ---------------- */
async function drawMap(svgId){
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diagonalHatch").attr("patternUnits","userSpaceOnUse")
    .attr("width",6).attr("height",6)
    .append("path").attr("d","M0,0 l6,6").attr("stroke","#999").attr("stroke-width",1);

  const fillLayer = ensureLayer(svg, "fill-layer");
  ensureLayer(svg, "icon-layer").style("pointer-events","none");

  // load features
  let features = [];
  try{
    const geo = await fetchFirst(GEO_URLS);
    features = (geo.type === "Topology")
      ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features
      : (geo.features || []);
  }catch(e){ alert("Could not load GeoJSON"); console.error(e); return; }
  if (!features.length){ alert("GeoJSON has 0 features"); return; }

  detectKeys(features);

  // NEW: seed centroids for *all* sub-divisions from polygons
  seedRegionCentroidsFromFeatures(features);

  const fc = { type:"FeatureCollection", features };
  const projection = pickProjection(fc);
  const path = d3.geoPath(projection);

  const paths = fillLayer.selectAll("path").data(features).join("path")
    .attr("class","subdiv")
    .attr("data-st", d => d.properties?.[STATE_KEY] ?? "")
    .attr("data-d",  d => d.properties?.[NAME_KEY]  ?? "")
    .attr("d", path)
    .attr("fill", "url(#diagonalHatch)")
    .attr("stroke", "#666").attr("stroke-width", 0.7);

  // tooltip + cursor
  const allowed = new Set((window.subdivisions || []).map(r => norm(r.name)));
  const tooltip = ensureTooltip();
  paths.on("pointerenter", function(){ d3.select(this).raise(); })
    .on("pointermove", function(event, d){
      const raw = d?.properties?.[MATCH_KEY] ?? "";
      const key = norm(raw);
      if (!allowed.has(key)) { tooltip.style("opacity", 0); return; }
      const pad = 14, vw = innerWidth, vh = innerHeight, ttW = 200, ttH = 44;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + ttW > vw) x = vw - ttW - pad;
      if (y + ttH > vh) y = vh - ttH - pad;
      tooltip.style("opacity", 1).html(raw).style("left", x + "px").style("top", y + "px");
    })
    .on("pointerleave", () => tooltip.style("opacity", 0))
    .style("cursor", d => allowed.has(norm(d?.properties?.[MATCH_KEY] ?? "")) ? "pointer" : "default");

  // CLICK → Punjab district panel
  paths.on("click", (evt, d) => {
    const st = String(d?.properties?.[STATE_KEY] ?? "").toLowerCase();
    if (st === "punjab") {
      if (typeof openPunjabDistrictView === "function") {
        openPunjabDistrictView("day1");
      } else {
        alert("Punjab click detected — add openPunjabDistrictView()");
      }
    }
  });

  // index & group by MATCH_KEY
  const idx = new Map(), groups = new Map();
  paths.each(function(d){
    const key = norm(String(d.properties?.[MATCH_KEY] ?? ""));
    if (!key) return;
    (idx.get(key) || idx.set(key, []).get(key)).push(this);
    (groups.get(key) || groups.set(key, []).get(key)).push(d);
  });
  indexByGroup[svgId] = idx;

  // projected centroid per group (for icon placement)
  groupCentroid[svgId] = {};
  const gp = d3.geoPath(projection);
  groups.forEach((arr, key) => {
    const groupFC = { type: "FeatureCollection", features: arr };
    let [x, y] = gp.centroid(groupFC);
    if (Number.isFinite(x) && Number.isFinite(y)) groupCentroid[svgId][key] = [x,y];
  });

  const title = (svgId === "#indiaMapDay1") ? "Index — Day 1" : "Index — Day 2";
  drawLegendWithButton(svg, title, SATELLITE_LINKS[svgId] || SATELLITE_LINKS["#indiaMapDay1"]);
}

/* ---------------- Forecast table ---------------- */
function buildFixedTable(){
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  // ensure sparkline header exists
  const theadRow = document.querySelector('#forecast-table thead tr');
  if (theadRow && !Array.from(theadRow.children).some(th => th.textContent?.toLowerCase().includes('last 12h'))){
    const th = document.createElement('th');
    th.className = "text-left px-3 py-2";
    th.textContent = "Last 12h (IST)";
    theadRow.appendChild(th);
  }

  const options = window.forecastOptions || [];
  const byState = new Map();
  (window.subdivisions || []).forEach(row => {
    if (!byState.has(row.state)) byState.set(row.state, []);
    byState.get(row.state).push(row);
  });

  let i = 1;
  for (const [state, rows] of byState) {
    rows.forEach((row, j) => {
      const tr = document.createElement("tr");
      tr.dataset.state  = state;
      tr.dataset.subdiv = row.name;

      const tdNo = document.createElement("td"); tdNo.textContent = i++; tr.appendChild(tdNo);

      if (j === 0) {
        const tdState = document.createElement("td");
        tdState.textContent = state;
        tdState.rowSpan = rows.length;
        tdState.style.verticalAlign = "middle";
        tr.appendChild(tdState);
      }

      const tdSub = document.createElement("td");
      tdSub.textContent = row.name; tr.appendChild(tdSub);

      const td1 = document.createElement("td"); td1.setAttribute("data-col","day1");
      const td2 = document.createElement("td"); td2.setAttribute("data-col","day2");

      const s1 = document.createElement("select");
      const s2 = document.createElement("select");
      [s1, s2].forEach(sel=>{
        sel.className = "select-clean w-full";
        (options || []).forEach(opt=>{
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt; sel.appendChild(o);
        });
        if (document.body.dataset.readonly === "true") sel.disabled = true;
        sel.addEventListener("change", updateMapColors);
      });

      td1.appendChild(s1); td2.appendChild(s2);
      tr.appendChild(td1); tr.appendChild(td2);

      // sparkline cell
      const tdChart = document.createElement("td"); tdChart.className = "cell-chart"; tr.appendChild(tdChart);

      tr.addEventListener("mouseenter", () => highlight(row.name, true));
      tr.addEventListener("mouseleave", () => highlight(row.name, false));

      tbody.appendChild(tr);
    });
  }
}

/* ---------------- Hover highlight ---------------- */
function highlight(label, on){
  const key = norm(label);
  ["#indiaMapDay1","#indiaMapDay2"].forEach(svgId=>{
    const nodes = indexByGroup[svgId]?.get(key);
    if (!nodes) return;
    nodes.forEach(n => {
      n.style.strokeWidth = on ? "2px" : "";
      n.style.filter = on ? "drop-shadow(0 0 4px rgba(0,0,0,0.4))" : "";
    });
  });
}

/* ---------------- Color maps + selects ---------------- */
function colorizeSelect(sel, label){
  const pal = window.forecastColors || {};
  const c   = pal[label] || "#fff";
  sel.style.backgroundColor = c;
  sel.style.color = "#111827";
  sel.style.borderColor = "#e5e7eb";
}
function updateMapColors(){
  const pal   = window.forecastColors || {};
  const icons = window.forecastIcons  || {};

  const rows = Array.from(document.querySelectorAll("#forecast-table-body tr")).map(tr=>{
    const subdiv = tr.dataset.subdiv;
    const day1Sel = tr.querySelectorAll('select')[0];
    const day2Sel = tr.querySelectorAll('select')[1];
    const day1 = day1Sel?.value || null;
    const day2 = day2Sel?.value || null;

    if (day1Sel) colorizeSelect(day1Sel, day1);
    if (day2Sel) colorizeSelect(day2Sel, day2);

    return { key: norm(subdiv), day1, day2, raw: subdiv };
  });

  ["#indiaMapDay1","#indiaMapDay2"].forEach((svgId, idx) => {
    const dayKey = idx === 0 ? "day1" : "day2";
    const svg = d3.select(svgId);
    const idxMap = indexByGroup[svgId] || new Map();

    svg.selectAll(".subdiv").attr("fill","url(#diagonalHatch)");

    const gIcons = ensureLayer(svg, "icon-layer").style("pointer-events","none");
    gIcons.raise(); gIcons.selectAll("*").remove();

    rows.forEach(rec => {
      const nodes = idxMap.get(rec.key);
      if (!nodes) return;
      const color = pal[rec[dayKey]] || "#eee";
      nodes.forEach(n => n.setAttribute("fill", color));

      const pos = groupCentroid[svgId][rec.key];
      if (!pos) return;
      const [x,y] = pos;

      gIcons.append("circle")
        .attr("cx", x).attr("cy", y).attr("r", 5.5)
        .attr("fill", "#f5a623").attr("stroke","#fff").attr("stroke-width",1.3)
        .attr("vector-effect","non-scaling-stroke");

      const emoji = icons[rec[dayKey]];
      if (emoji){
        gIcons.append("text")
          .attr("x", x).attr("y", y)
          .attr("text-anchor", "middle").attr("dominant-baseline", "central")
          .attr("font-size", 18).attr("paint-order", "stroke")
          .attr("stroke", "white").attr("stroke-width", 2)
          .text(emoji);
      }
    });
  });
}

/* ------------------------- ENSEMBLE PIPELINE ------------------------- */
// Bias (per-region) – EWMA persisted in localStorage
const BIAS_KEY = "dailyCloudBias.v1";
const loadBias = () => { try{ return JSON.parse(localStorage.getItem(BIAS_KEY)||'{}'); }catch{ return {}; } };
const saveBias = o => localStorage.setItem(BIAS_KEY, JSON.stringify(o));
const getBias  = id => (loadBias()[id]?.bias ?? 0);
function addBias(id, error){ const a=0.2; const b=loadBias(); const prev=b[id]?.bias??0; b[id]={bias:(1-a)*prev+a*error, t:Date.now()}; saveBias(b); }

// Open-Meteo hourly for ONE model
async function fetchHourly_LMH(lat, lon, model){
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", lat); u.searchParams.set("longitude", lon);
  u.searchParams.set("hourly", "cloudcover,cloudcover_low,cloudcover_mid,cloudcover_high");
  u.searchParams.set("models", model); u.searchParams.set("timezone", IST_TZ);
  u.searchParams.set("past_hours", 18); u.searchParams.set("forecast_hours", 42); // cover day1/day2 windows
  const r = await fetch(u.toString(), {cache:"no-store"});
  if(!r.ok) throw new Error(`${model} fetch ${r.status}`);
  const h = (await r.json()).hourly;
  if(!h) return [];
  const out = [];
  for(let i=0;i<h.time.length;i++){
    out.push({
      time: h.time[i],                   // IST local ISO
      hr:   +h.time[i].slice(11,13),
      low:  clampPct(h.cloudcover_low[i]),
      mid:  clampPct(h.cloudcover_mid[i]),
      high: clampPct(h.cloudcover_high[i])
    });
  }
  return out;
}
const effectivePct = r => clampPct(0.6*r.low + 0.3*r.mid + 0.1*r.high);

function averageCentroids(seriesPerCentroid){
  if(seriesPerCentroid.length===1) return seriesPerCentroid[0];
  const N = seriesPerCentroid[0].length, out = new Array(N);
  for(let i=0;i<N;i++){
    let low=0,mid=0,high=0;
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
function ensembleMedian(byModel){
  const any = Object.values(byModel)[0];
  const out = [];
  for(let i=0;i<any.length;i++){
    const v = median(Object.values(byModel).map(arr => effectivePct(arr[i])));
    out.push({ time: any[i].time, hr: any[i].hr, v });
  }
  return out; // [{time, hr, v}]
}
function median(arr){ const a=arr.slice().sort((x,y)=>x-y); const m=a.length>>1; return a.length%2?a[m]:0.5*(a[m-1]+a[m]); }
const pad2 = n => String(n).padStart(2,"0");
function istTodayStr(){
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US',{timeZone:IST_TZ}));
  return `${ist.getFullYear()}-${pad2(ist.getMonth()+1)}-${pad2(ist.getDate())}`;
}
function strAddOneDay(ymd){
  const d = new Date(`${ymd}T00:00:00+05:30`);
  d.setDate(d.getDate()+1);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function dailyMeanForDate(hourlyEff, ymd){
  const day = hourlyEff.filter(h => h.time.slice(0,10) === ymd && h.hr >= SOLAR_START && h.hr <= SOLAR_END);
  if(!day.length) return null;
  return clampPct(day.reduce((s,h)=>s+h.v,0)/day.length);
}

/* ---------------- SPARKLINE (last 12h) ---------------- */
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

  last12.forEach((p,i)=>{
    const cx=P+xs[i]*(W-2*P), cy=P+(1-p.v/100)*(H-2*P);
    const c=document.createElementNS(svg.namespaceURI,'circle');
    c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',2.5); c.setAttribute('fill','#555');
    c.style.cursor='pointer'; c.title=`${p.time.slice(11,16)} IST → ${p.v}%`;
    c.addEventListener('click',()=>{
      const a = prompt(`Enter observed cloud % for ${regionId} at ${p.time.slice(11,16)} IST (0–100):`, String(p.v));
      if(a==null) return;
      const obs = clampPct(a);
      addBias(regionId, obs - p.v);
      alert('Thanks! Bias updated for this region.');
    });
    svg.appendChild(c);
  });
}

/* ---------------- CORE: update table + maps (every 3h) --------------- */
const prevBucketByRegion = new Map();

async function updateAllForecasts(){
  const tbody = document.getElementById("forecast-table-body");
  if(!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  if(!rows.length) return;

  const palette = (window.forecastColors || {});
  const outForMap = new Map();

  const today = istTodayStr();
  const tomorrow = strAddOneDay(today);

  for(const tr of rows){
    const state = tr.dataset.state, subdiv = tr.dataset.subdiv;
    const regionKey = `${state}:${subdiv}`;

    // centroids priority: seeded "State:Subdiv" -> "Subdiv" -> fallback manual
    const cents = (window.regionCentroids?.[regionKey])
      || (window.regionCentroids?.[subdiv])
      || (FALLBACK_CENTROIDS[subdiv] || []);
    if(!cents.length){ console.warn('No centroid for', regionKey); continue; }

    // fetch per model → average centroids → ensemble median
    const byModel = {};
    for(const model of MODELS){
      const seriesPerCentroid = [];
      for(const [lat,lon] of cents){
        try{ seriesPerCentroid.push(await fetchHourly_LMH(lat,lon,model)); }
        catch(e){ console.warn(e.message); }
      }
      if(seriesPerCentroid.length) byModel[model] = averageCentroids(seriesPerCentroid);
    }
    if(!Object.keys(byModel).length){ console.warn('No model data for', regionKey); continue; }

    const hourlyEff = ensembleMedian(byModel);

    // Sparkline
    const tdChart = tr.querySelector('.cell-chart') || (()=>{ const td=document.createElement('td'); td.className='cell-chart'; tr.appendChild(td); return td; })();
    renderSparkline(tdChart, regionKey, hourlyEff);

    // Day1&Day2 daily means (raw)
    const d1Raw = dailyMeanForDate(hourlyEff, today);
    const d2Raw = dailyMeanForDate(hourlyEff, tomorrow);
    if(d1Raw==null && d2Raw==null) continue;

    // bias-correct both, classify with hysteresis
    const bias = getBias(regionKey);
    const d1 = d1Raw==null ? null : clampPct(d1Raw - bias);
    const d2 = d2Raw==null ? null : clampPct(d2Raw - bias);

    const prev = prevBucketByRegion.get(regionKey) || null;
    const lab1 = (d1==null) ? null : classifyWithHysteresis(d1, prev);
    const lab2 = (d2==null) ? null : classifyWithHysteresis(d2, lab1 || prev);

    // fill selects
    const s1 = tr.querySelector('td[data-col="day1"] select') || tr.querySelectorAll('select')[0];
    const s2 = tr.querySelector('td[data-col="day2"] select') || tr.querySelectorAll('select')[1];
    if(s1 && lab1){ s1.value = lab1; s1.disabled = true; s1.style.backgroundColor = palette[lab1]||'#eee'; }
    if(s2 && lab2){ s2.value = lab2; s2.disabled = true; s2.style.backgroundColor = palette[lab2]||'#eee'; }

    if(lab1) prevBucketByRegion.set(regionKey, lab1);

    // for map hooks (use day1 as “current daily”)
    if(d1!=null) outForMap.set(`${norm(subdiv)}`, { cloud_pct: d1 });
  }

  // repaint maps
  if(typeof window.applyDailyToMap === 'function'){
    window.applyDailyToMap(outForMap);
  }else{
    updateMapColors();
  }
}

/* ---------------- Punjab District Panel (uses SAME pipeline) ---------- */
const PUNJAB_DISTRICT_URLS = [
  "assets/punjab_districts.geojson",
  "punjab_districts.geojson",
  "https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@main/geojson/states/punjab.geojson",
  "https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@main/geojson/india_districts.geojson"
];
async function fetchFirstJSON(urls){
  for (const u of urls){
    try{
      const r = await fetch(u, {cache:"no-cache"});
      if (r.ok) return await r.json();
    }catch{}
  }
  throw new Error("Punjab districts GeoJSON not found.");
}
function openDistrictPanel(){ document.getElementById("districtPanel")?.classList.remove("hidden"); }
function closeDistrictPanel(){ document.getElementById("districtPanel")?.classList.add("hidden"); }
document.addEventListener("click", e=>{ if (e.target?.id==="dp-close") closeDistrictPanel(); });
document.addEventListener("change", e=>{ if (e.target?.name==="dp-day") openPunjabDistrictView(e.target.value); });

// IST date key for caching
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateKey() {
  const now = Date.now() + IST_OFFSET_MS;
  const y = new Date(now).getUTCFullYear();
  const m = String(new Date(now).getUTCMonth()+1).padStart(2,'0');
  const d = String(new Date(now).getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
let PUNJAB_DAY_CACHE = { date: null, byKey: new Map() }; // key -> {day1,day2}
function clearPunjabCache(){ PUNJAB_DAY_CACHE = { date: null, byKey: new Map() }; }

async function computePunjabLabelsIfNeeded(feats, keyName){
  const today = istDateKey();
  if (PUNJAB_DAY_CACHE.date !== today) PUNJAB_DAY_CACHE = { date: today, byKey: new Map() };
  const cache = PUNJAB_DAY_CACHE.byKey;

  const todayStr = istTodayStr();
  const tomorrowStr = strAddOneDay(todayStr);

  for (const f of feats){
    const key = String(f.properties[keyName] ?? f.properties.DISTRICT ?? f.properties.NAME ?? "").trim();
    if (!key || cache.has(key)) { f.properties._labels = cache.get(key); continue; }

    const [lon, lat] = d3.geoCentroid(f);
    // ensemble at district centroid
    const byModel = {};
    for(const m of MODELS){
      try{ byModel[m] = await fetchHourly_LMH(lat, lon, m); } catch(e){ console.warn(e.message); }
    }
    if(!Object.keys(byModel).length) continue;
    const hourlyEff = ensembleMedian(byModel);
    const d1 = dailyMeanForDate(hourlyEff, todayStr);
    const d2 = dailyMeanForDate(hourlyEff, tomorrowStr);
    const bias = getBias(`Punjab:${key}`);
    const lab1 = (d1==null)? null : bucketFromPct(clampPct(d1 - bias));
    const lab2 = (d2==null)? null : bucketFromPct(clampPct(d2 - bias));
    const rec = { day1: lab1, day2: lab2 };
    cache.set(key, rec);
    f.properties._labels = rec;
  }
}

async function openPunjabDistrictView(dayKey){
  const svg = d3.select("#punjabDistrictMap"); if (svg.empty()) return;
  svg.selectAll("*").remove();

  const geo = await fetchFirstJSON(PUNJAB_DISTRICT_URLS);
  const featsAll = (geo.type === "Topology")
    ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features
    : (geo.features || []);
  if (!featsAll.length) throw new Error("No district features.");

  // If file contains all states, filter to Punjab
  const feats = (() => {
    const p = featsAll[0]?.properties || {};
    const sKey = ("ST_NM" in p) ? "ST_NM" : (("st_nm" in p) ? "st_nm" : null);
    if (!sKey) return featsAll; // already Punjab-only file
    return featsAll.filter(f => String(f.properties[sKey]||"").toLowerCase()==="punjab");
  })();

  const DIST_KEY = findDistrictNameKey(feats[0]?.properties || {});
  await computePunjabLabelsIfNeeded(feats, DIST_KEY);

  const fc = { type:"FeatureCollection", features: feats };
  const projection = d3.geoMercator().fitExtent([[12,12],[588,508]], fc);
  const path = d3.geoPath(projection);

  const g = svg.append("g").attr("class","punjab-fill");
  const nodes = g.selectAll("path").data(feats).join("path")
    .attr("d", path).attr("fill","#eee").attr("stroke","#333").attr("stroke-width",0.8);

  const panelTooltip = ensureTooltip();
  nodes
    .style("cursor","pointer")
    .on("pointerenter", function(){ d3.select(this).raise().attr("stroke-width", 1.8); })
    .on("pointerleave", function(){ d3.select(this).attr("stroke-width", 0.8); panelTooltip.style("opacity", 0); })
    .on("pointermove", function (event, d) {
      const labelDay = document.querySelector('input[name="dp-day"]:checked')?.value || "day1";
      const raw   = d?.properties?.[DIST_KEY];
      const name  = (raw == null ? "" : String(raw)).trim() || "District";
      const lab   = d?.properties?._labels?.[labelDay] || "";
      const emoji = (window.forecastIcons || {})[lab] || "";
      const html = `<div style="font-weight:800;margin-bottom:4px">${name}</div>
                    <div style="display:flex;align-items:center;gap:6px;font-weight:600">
                      <span>${emoji}</span><span>${lab || "—"}</span>
                    </div>`;
      const pad = 12, vw = window.innerWidth, vh = window.innerHeight, ttW = 260, ttH = 56;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + ttW > vw) x = vw - ttW - pad;
      if (y + ttH > vh) y = vh - ttH - pad;
      panelTooltip.style("opacity", 1).html(html).style("left", x + "px").style("top", y + "px");
    });

  const icons = svg.append("g").attr("class","punjab-icons").style("pointer-events","none");
  const dayRadio = document.querySelector('input[name="dp-day"]:checked');
  const day = dayKey || (dayRadio ? dayRadio.value : "day1");

  for (const f of feats){
    const [x, y] = path.centroid(f);
    const labelNow = f.properties._labels?.[day];
    const color = (window.forecastColors||{})[labelNow] || "#ddd";

    nodes.filter(d => d === f).attr("fill", color);

    icons.append("circle").attr("cx",x).attr("cy",y).attr("r",5.5)
      .attr("fill","#f5a623").attr("stroke","#fff").attr("stroke-width",1.3);

    const emoji = (window.forecastIcons||{})[labelNow];
    if (emoji) icons.append("text")
      .attr("x",x).attr("y",y).attr("text-anchor","middle").attr("dominant-baseline","central")
      .attr("font-size",18).attr("paint-order","stroke").attr("stroke","white").attr("stroke-width",2)
      .text(emoji);
  }

  // legend
  const host = d3.select(".dp-legend"); host.selectAll("*").remove();
  const labs = Object.keys(window.forecastColors||{});
  const leg = host.append("svg").attr("width",300).attr("height", 12 + labs.length*20);
  labs.forEach((lab,i)=>{
    const y = 12 + i*20;
    leg.append("rect").attr("x",8).attr("y",y-10).attr("width",14).attr("height",14)
      .attr("fill", (window.forecastColors||{})[lab]||"#eee").attr("stroke","#999");
    leg.append("text").attr("x",28).attr("y",y+2).attr("font-size",12).text(lab);
  });

  document.getElementById("dp-title").textContent = "Punjab — District Forecast";
  openDistrictPanel();
}

/* ---------------- DAILY rollover at IST midnight + 3h updates -------- */
let __rolloverTimer = null;
let __periodicTimer = null;

function msUntilNextISTMidnight() {
  const now = Date.now();
  const istNow = now + IST_OFFSET_MS;
  const startOfTodayIST = Math.floor(istNow / 86400000) * 86400000;
  const nextMidnightIST = startOfTodayIST + 86400000;
  return Math.max(0, nextMidnightIST - istNow);
}
async function doDailyRefresh() {
  clearPunjabCache();
  await updateAllForecasts().catch(()=>{});
  updateMapColors();

  const panel = document.getElementById("districtPanel");
  if (panel && !panel.classList.contains("hidden")) {
    const day = document.querySelector('input[name="dp-day"]:checked')?.value || "day1";
    await openPunjabDistrictView(day);
  }
}
function scheduleDailyRollover() {
  if (__rolloverTimer) clearTimeout(__rolloverTimer);
  if (__periodicTimer) clearInterval(__periodicTimer);

  __rolloverTimer = setTimeout(async () => {
    await doDailyRefresh();
    scheduleDailyRollover();
  }, msUntilNextISTMidnight() + 2000);

  __periodicTimer = setInterval(doDailyRefresh, 6 * 60 * 60 * 1000); // safety
}

// 3-hourly aligned scheduler (00/03/06… IST)
function msToNext3h(){
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US',{timeZone:IST_TZ}));
  const h = ist.getHours();
  const next = new Date(ist); next.setHours(h + (3 - (h % 3)), 0, 5, 0);
  return next - ist;
}
function start3hScheduler(){
  updateAllForecasts();
  setTimeout(()=>{
    updateAllForecasts();
    setInterval(updateAllForecasts, REFRESH_HOURS*3600*1000);
  }, msToNext3h());
}

/* ---------------- Init ---------------- */
function init(){
  if (typeof updateISTDate === "function") updateISTDate();
  buildCloudTable();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
  scheduleDailyRollover();
  start3hScheduler();
}
document.addEventListener("DOMContentLoaded", init);

/* ---------------- Older helpers (kept for compatibility) ------------- */
function medianCompat(a){ return median(a); } // alias if other scripts call it
