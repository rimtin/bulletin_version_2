// =============================
// app.js — DAILY ONLY
// National view (states or sub-divisions) + Punjab district panel on click
// Open-Meteo daily cloud_cover_mean + NASA POWER daily CLOUD_AMT (ensemble)
// Optional IMD WMS overlay (visual background)
// =============================

// ---------- Globals ----------
const W = 860, H = 580, PAD = 18;

// If you are coloring SUB-DIVISIONS nationally, set MATCH_KEY to the
// sub-division property in your GeoJSON (e.g., "SUBDIV" or "name").
// If you are coloring STATES nationally, leave MATCH_KEY = "st_nm".
let MATCH_KEY = "st_nm";         // <-- set to your active national layer field
let STATE_KEY = "st_nm";
let NAME_KEY  = "name";          // used only for tooltips if needed

// Per-map indexes for coloring by MATCH_KEY (normalized)
const indexByGroup     = { "#indiaMapDay1": new Map(), "#indiaMapDay2": new Map() };
const groupCentroid    = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };                // pixel [x,y]
const groupGeoCentroid = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };                // [lon,lat]

// Optional fine-tune offsets for icon placement by normalized key
const ICON_OFFSETS = {};

// ---------- Daily ensemble config ----------
const IST_TZ = "Asia/Kolkata";

// ---------- Optional IMD WMS overlay (visual only) ----------
const IMD_WMS_BASE    = "https://webgis.imd.gov.in/geoserver/IMD_Data/wms";
const IMD_WMS_LAYER   = "";         // e.g., "IMD_Data:INSAT_CLOUDS_LATEST" (set after GetCapabilities)
const IMD_WMS_VERSION = "1.3.0";
const IMD_WMS_CRS     = "EPSG:4326";
const IMD_WMS_OPACITY = 0.45;
const INDIA_BBOX      = { minLon: 68, minLat: 6, maxLon: 98, maxLat: 37 };

// ---------- Tooltip ----------
let mapTooltip = null;
function ensureTooltip(){
  if (!mapTooltip){
    mapTooltip = d3.select("body").append("div")
      .attr("class", "map-tooltip").style("opacity", 0);
  }
  return mapTooltip;
}

// ---------- Helpers ----------
const norm = s => String(s || "")
  .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s*&\s*/g, " and ").replace(/\s*\([^)]*\)\s*/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

function detectKeys(features){
  const sample = features[0]?.properties || {};
  const sKeys = ["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","State"];
  const dKeys = ["SUBDIV","SUBDIVISION","name","NAME_2","Name","district","DISTRICT","dist_name"];
  STATE_KEY = sKeys.find(k => k in sample) || STATE_KEY;
  NAME_KEY  = dKeys.find(k => k in sample) || NAME_KEY;
  if (!(MATCH_KEY in sample)) MATCH_KEY = STATE_KEY; // fall back
  console.log("[Map] keys:", { stateKey: STATE_KEY, nameKey: NAME_KEY, matchKey: MATCH_KEY });
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

// ---------- National geometry (states TopoJSON) ----------
const INDIA_STATES_TOPO = "https://raw.githubusercontent.com/udit-001/india-maps-data/refs/heads/main/topojson/india.json";

// ---------- UI bits ----------
function colorizeSelect(sel, label){
  const pal = window.forecastColors||{};
  const c = pal[label]||"#fff";
  sel.style.backgroundColor=c; sel.style.color="#000"; sel.style.borderColor="#000";
}

// ---------- National map draw ----------
async function drawMap(svgId){
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  // defs
  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diagonalHatch").attr("patternUnits","userSpaceOnUse")
    .attr("width",6).attr("height",6)
    .append("path").attr("d","M0,0 l6,6").attr("stroke","#999").attr("stroke-width",1);

  // layers
  const fillLayer = ensureLayer(svg, "fill-layer");
  ensureLayer(svg, "icon-layer").style("pointer-events","none");

  // size + optional WMS
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  addWMSOverlay(svgId);

  // load states
  let feats = [];
  try{
    const topo = await d3.json(INDIA_STATES_TOPO);
    feats = topojson.feature(topo, topo.objects["states"]).features;
  }catch(e){ alert("Could not load India states TopoJSON."); console.error(e); return; }
  if (!feats.length){ alert("No features in states TopoJSON"); return; }

  detectKeys(feats);

  const fc = { type:"FeatureCollection", features: feats };
  const projection = d3.geoMercator().scale(850).center([89.8,21.5]).translate([430,290]);
  const path = d3.geoPath(projection);

  // draw polygons
  const paths = fillLayer.selectAll("path.state").data(feats).join("path")
    .attr("class","state")
    .attr("d", path)
    .attr("id", d => d.properties?.[STATE_KEY] || "")
    .attr("data-map", svgId.replace("#",""))
    .attr("fill", "#ccc")
    .attr("stroke", "#333").attr("stroke-width", 1)
    .on("mouseover", function(){ d3.select(this).attr("stroke-width", 2.5); })
    .on("mouseout",  function(){ d3.select(this).attr("stroke-width", 1); })
    .on("click", (evt, d) => {
      const st = String(d?.properties?.[STATE_KEY] || "").toLowerCase();
      if (st === "punjab") openPunjabDistrictView("day1"); // DAILY PANEL
    });

  // build group indexes (by MATCH_KEY—state by default)
  const idx = new Map(), groups = new Map();
  paths.each(function(d){
    const key = norm(String(d.properties?.[MATCH_KEY] ?? ""));
    if (!key) return;
    (idx.get(key) || idx.set(key, []).get(key)).push(this);
    (groups.get(key) || groups.set(key, []).get(key)).push(d);
  });
  indexByGroup[svgId] = idx;

  // centroids
  groupCentroid[svgId] = {};
  groupGeoCentroid[svgId] = {};
  const gp = d3.geoPath(projection);
  groups.forEach((arr, key) => {
    const groupFC = { type: "FeatureCollection", features: arr };
    let [x, y] = gp.centroid(groupFC);
    const off = ICON_OFFSETS[key]; if (off) { x += off.dx||0; y += off.dy||0; }
    if (Number.isFinite(x) && Number.isFinite(y)) groupCentroid[svgId][key] = [x,y];
    const [lon, lat] = d3.geoCentroid(groupFC);
    if (Number.isFinite(lon) && Number.isFinite(lat)) groupGeoCentroid[svgId][key] = [lon, lat];
  });

  // Legend
  drawLegend(svg, svgId === "#indiaMapDay1" ? "Index — Day 1" : "Index — Day 2");

  // After second map: build table then color once
  if (svgId === "#indiaMapDay2"){
    buildForecastTable();      // state-level table by default
    updateMapColors();
  }
}

// ---------- Legend ----------
function drawLegend(svg, title){
  svg.selectAll(".map-legend").remove();
  const pal = window.forecastColors || {};
  const labels = window.forecastOptions || Object.keys(pal);
  const pad = 10, sw = 18, gap = 18;
  const width = 200, height = pad + 18 + labels.length * gap + pad;

  const g = svg.append("g")
    .attr("class", "map-legend")
    .attr("transform", `translate(${W - width - 12}, ${H - height - 12})`);

  g.append("rect").attr("width", width).attr("height", height)
    .attr("rx", 10).attr("ry", 10)
    .attr("fill", "rgba(255,255,255,0.92)").attr("stroke", "#cfcfcf");

  g.append("text").attr("x", pad).attr("y", pad + 14)
    .attr("font-weight", 700).attr("font-size", 13).text(title);

  (window.forecastOptions || Object.keys(window.forecastColors||{})).forEach((lab,i)=>{
    const y = pad + 28 + i * gap;
    g.append("rect").attr("x", pad).attr("y", y - 12).attr("width", sw).attr("height", 12)
      .attr("fill", (window.forecastColors||{})[lab] || "#eee").attr("stroke", "#999");
    g.append("text").attr("x", pad + sw + 8).attr("y", y - 2)
      .attr("font-size", 12).text(lab);
  });
}

// ---------- Forecast table (states list from data.js -> window.states) ----------
function buildForecastTable(){
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const options = window.forecastOptions || [];
  const list = (window.states || []).slice();

  list.forEach((state, i) => {
    const tr = document.createElement("tr");
    tr.dataset.state = state;

    const tdNo = document.createElement("td"); tdNo.textContent = i+1; tr.appendChild(tdNo);
    const tdName = document.createElement("td"); tdName.textContent = state; tr.appendChild(tdName);

    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    const s1 = document.createElement("select");
    const s2 = document.createElement("select");
    [s1, s2].forEach(sel=>{
      options.forEach(opt => {
        const o = document.createElement("option"); o.value = opt; o.textContent = opt; sel.appendChild(o);
      });
      sel.addEventListener("change", updateMapColors);
    });
    td1.appendChild(s1); td2.appendChild(s2);
    tr.appendChild(td1); tr.appendChild(td2);
    tr.addEventListener("mouseenter", ()=> d3.selectAll(`[id='${state}']`).attr("stroke-width", 2.5));
    tr.addEventListener("mouseleave", ()=> d3.selectAll(`[id='${state}']`).attr("stroke-width", 1));

    tbody.appendChild(tr);
  });
}

// ---------- Apply colors + icons from table to maps ----------
function updateMapColors(){
  const rows = document.querySelectorAll("#forecast-table-body tr");
  rows.forEach(row => {
    const state = row.dataset.state;
    const f1 = row.children[2]?.querySelector("select")?.value;
    const f2 = row.children[3]?.querySelector("select")?.value;

    const c1 = (window.forecastColors||{})[f1] || "#ccc";
    const c2 = (window.forecastColors||{})[f2] || "#ccc";

    const r1 = d3.select(`[id='${state}'][data-map='indiaMapDay1']`);
    const r2 = d3.select(`[id='${state}'][data-map='indiaMapDay2']`);
    if (!r1.empty()) r1.attr("fill", c1);
    if (!r2.empty()) r2.attr("fill", c2);

    const s1 = row.children[2]?.querySelector("select"); if (s1) colorizeSelect(s1, f1);
    const s2 = row.children[3]?.querySelector("select"); if (s2) colorizeSelect(s2, f2);
  });

  // icons
  d3.selectAll(".forecast-icon").remove();
  document.querySelectorAll("#forecast-table-body tr").forEach(row => {
    const state = row.dataset.state;
    const f1 = row.children[2]?.querySelector("select")?.value;
    const f2 = row.children[3]?.querySelector("select")?.value;
    const coords1 = groupCentroid["#indiaMapDay1"][norm(state)];
    const coords2 = groupCentroid["#indiaMapDay2"][norm(state)];
    const i1 = (window.forecastIcons||{})[f1];
    const i2 = (window.forecastIcons||{})[f2];

    if (coords1 && i1) d3.select("#indiaMapDay1").append("text")
      .attr("class","forecast-icon").attr("x",coords1[0]).attr("y",coords1[1])
      .attr("text-anchor","middle").attr("alignment-baseline","middle").attr("font-size",18).text(i1);

    if (coords2 && i2) d3.select("#indiaMapDay2").append("text")
      .attr("class","forecast-icon").attr("x",coords2[0]).attr("y",coords2[1])
      .attr("text-anchor","middle").attr("alignment-baseline","middle").attr("font-size",18).text(i2);
  });
}

// ---------- IMD WMS background ----------
function addWMSOverlay(svgId){
  if (!IMD_WMS_LAYER) return;
  const wrap = document.querySelector(`${svgId}`)?.parentElement;
  if (!wrap) return;
  wrap.style.position = wrap.style.position || "relative";

  const svg = document.querySelector(svgId);
  const vb = (svg?.getAttribute("viewBox")||"0 0 860 580").split(/\s+/).map(Number);
  const w = vb[2] || 860, h = vb[3] || 580;

  const bbox = (IMD_WMS_VERSION === "1.3.0" && IMD_WMS_CRS === "EPSG:4326")
    ? `${INDIA_BBOX.minLat},${INDIA_BBOX.minLon},${INDIA_BBOX.maxLat},${INDIA_BBOX.maxLon}`
    : `${INDIA_BBOX.minLon},${INDIA_BBOX.minLat},${INDIA_BBOX.maxLon},${INDIA_BBOX.maxLat}`;

  const url = `${IMD_WMS_BASE}?SERVICE=WMS&REQUEST=GetMap&VERSION=${IMD_WMS_VERSION}&CRS=${IMD_WMS_CRS}&LAYERS=${encodeURIComponent(IMD_WMS_LAYER)}&STYLES=&FORMAT=image/png&TRANSPARENT=true&WIDTH=${w}&HEIGHT=${h}&BBOX=${bbox}`;

  let img = wrap.querySelector("img.imd-wms");
  if (!img){
    img = document.createElement("img");
    img.className = "imd-wms";
    img.style.position = "absolute";
    img.style.left = 0; img.style.top = 0; img.style.width = "100%"; img.style.height = "100%";
    img.style.opacity = String(IMD_WMS_OPACITY);
    img.style.pointerEvents = "none";
    wrap.prepend(img);
  }
  img.src = url;
}

// ============================
// DAILY ENSEMBLE (Open-Meteo + NASA POWER)
// ============================
function isoTodayIST() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function yyyymmddIST(offsetDays = 0) {
  const now = new Date();
  const withOffset = new Date(now.getTime() + (330*60*1000) + offsetDays*24*60*60*1000);
  const y = withOffset.getUTCFullYear();
  const m = String(withOffset.getUTCMonth()+1).padStart(2,'0');
  const d = String(withOffset.getUTCDate()).padStart(2,'0');
  return `${y}${m}${d}`;
}
function avg(nums){ const a=(nums||[]).filter(Number.isFinite); return a.length? a.reduce((x,y)=>x+y,0)/a.length : undefined; }
function fixPercentUnits(v){ if(v==null) return undefined; const n=+v; if(!isFinite(n)) return undefined; return n<=1 ? n*100 : n; }

async function fetchOpenMeteoDaily(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("daily", "cloud_cover_mean");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("timezone", IST_TZ);
  const res = await fetch(url.toString(), { mode: "cors" });
  const j = await res.json();
  const t = j?.daily?.time || [];
  const v = j?.daily?.cloud_cover_mean || [];
  const today = isoTodayIST();
  const idx = t.indexOf(today);
  const d1 = idx >= 0 ? v[idx] : v[0];
  const d2 = (idx >= 0 && v[idx+1]!=null) ? v[idx+1] : v[1];
  return { day1: Number(d1), day2: Number(d2) };
}

async function fetchNASAPowerDaily(lat, lon){
  const start = yyyymmddIST(0), end = yyyymmddIST(1);
  const url = new URL("https://power.larc.nasa.gov/api/temporal/daily/point");
  url.searchParams.set("parameters", "CLOUD_AMT");
  url.searchParams.set("community", "RE");
  url.searchParams.set("format", "JSON");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("start", start);
  url.searchParams.set("end",   end);
  const res = await fetch(url.toString(), { mode: "cors" });
  const j = await res.json();
  const obj = j?.properties?.parameter?.CLOUD_AMT || {};
  return { day1: fixPercentUnits(obj[start]), day2: fixPercentUnits(obj[end]) };
}

async function ensembleDaily(lat, lon){
  const [om, np] = await Promise.allSettled([fetchOpenMeteoDaily(lat, lon), fetchNASAPowerDaily(lat, lon)]);
  const a = om.status === "fulfilled" ? om.value : {};
  const b = np.status === "fulfilled" ? np.value : {};
  return {
    day1: avg([a.day1, b.day1].filter(v => v!=null)) ?? a.day1 ?? b.day1,
    day2: avg([a.day2, b.day2].filter(v => v!=null)) ?? a.day2 ?? b.day2
  };
}

function cloudLabel(pct){
  const v = Number(pct);
  if (!isFinite(v)) return "Clear Sky";
  if (v < 10) return "Clear Sky";
  if (v < 30) return "Low Cloud Cover";
  if (v < 50) return "Medium Cloud Cover";
  if (v < 75) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}
window.cloudLabel = window.cloudLabel || cloudLabel;

// ============================
// Punjab District Panel (Daily Only)
// ============================

// Robust sources: per-state and all-India (we'll filter to ST_NM='Punjab' if needed)
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

  const fc = { type:"FeatureCollection", features: feats };
  const projection = d3.geoMercator().fitExtent([[12,12],[588,508]], fc);
  const path = d3.geoPath(projection);

  const g = svg.append("g").attr("class","punjab-fill");
  const nodes = g.selectAll("path").data(feats).join("path")
    .attr("d", path).attr("fill","#eee").attr("stroke","#333").attr("stroke-width",0.8);

  const icons = svg.append("g").attr("class","punjab-icons").style("pointer-events","none");
  const dayRadio = document.querySelector('input[name="dp-day"]:checked');
  const day = dayKey || (dayRadio ? dayRadio.value : "day1");

  for (const f of feats){
    const [lon, lat] = d3.geoCentroid(f);
    const [x, y]     = path.centroid(f);
    const { day1, day2 } = await ensembleDaily(lat, lon); // DAILY ONLY
    const label = day === "day1" ? cloudLabel(day1) : cloudLabel(day2);
    const color = (window.forecastColors||{})[label] || "#ddd";

    nodes.filter(d=>d===f).attr("fill", color);

    icons.append("circle").attr("cx",x).attr("cy",y).attr("r",5.5)
      .attr("fill","#f5a623").attr("stroke","#fff").attr("stroke-width",1.3);
    const emoji = (window.forecastIcons||{})[label];
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

// ============================
// Init (Daily page)
// ============================
function updateISTDate(){
  const istDate = new Date(Date.now() + 330*60*1000);
  const txt = istDate.toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"});
  const el = document.getElementById("forecast-date"); if (el) el.textContent = txt;
}

window.onload = () => {
  updateISTDate();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
};

// expose for button if you have one to auto-fill states
window.autoFillFromAPIs = async function(){
  const tbody = document.getElementById("forecast-table-body"); if (!tbody) return;
  const btn = document.getElementById("autofillBtn"); if (btn){ btn.disabled = true; btn.textContent = "Fetching…"; }

  for (const tr of tbody.querySelectorAll("tr")){
    const state = tr.dataset.state;
    const gloc = groupGeoCentroid["#indiaMapDay1"][norm(state)];
    if (!gloc) continue;
    const [lon, lat] = gloc;
    const { day1, day2 } = await ensembleDaily(lat, lon);
    const s1 = tr.children[2]?.querySelector("select");
    const s2 = tr.children[3]?.querySelector("select");
    if (s1) s1.value = cloudLabel(day1);
    if (s2) s2.value = cloudLabel(day2);
    updateMapColors();
  }

  if (btn){ btn.disabled = false
