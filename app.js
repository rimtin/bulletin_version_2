// =============================
// app.js — DAILY-ONLY (Sub-division)
// Open-Meteo daily cloud_cover_mean + NASA POWER daily CLOUD_AMT (ensemble)
// Sub-division coloring, centered icons, per-map legends, IMD WMS (visual)
// =============================

// ---------- Global stores ----------
const W = 860, H = 580, PAD = 18;

// IMPORTANT: set this to the *sub-division* property in your GeoJSON
// (examples: "SUBDIV", "name", "NAME_2"). It must match your subdivision table names.
let MATCH_KEY = "name";

// These get auto-detected from the first feature for convenience (fallbacks set here):
let STATE_KEY = "ST_NM";
let NAME_KEY  = "name"; // district/subdivision display label (for tooltip only)

// Per-map indexes (keyed by normalized sub-division label)
const indexByGroup     = { "#indiaMapDay1": new Map(), "#indiaMapDay2": new Map() }; // norm -> [SVGPath]
const groupCentroid    = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };                // norm -> [x,y] (pixel)
const groupGeoCentroid = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };                // norm -> [lon,lat]

// Optional fine-tune offsets for certain labels, e.g. { "west rajasthan": {dx: 8, dy: -6} }
const ICON_OFFSETS = {};

// ---------- Daily ensemble config ----------
const IST_TZ = "Asia/Kolkata";

// ---------- Optional IMD WMS overlay (visual only) ----------
const IMD_WMS_BASE    = "https://webgis.imd.gov.in/geoserver/IMD_Data/wms";
const IMD_WMS_LAYER   = "";         // e.g. "IMD_Data:INSAT_CLOUDS_LATEST" once you confirm from GetCapabilities
const IMD_WMS_VERSION = "1.3.0";    // Use "1.1.1" if you prefer lon,lat BBOX order
const IMD_WMS_CRS     = "EPSG:4326";
const IMD_WMS_OPACITY = 0.45;
const INDIA_BBOX      = { minLon: 68, minLat: 6, maxLon: 98, maxLat: 37 }; // rough India extent

// ---------- Tooltip ----------
let mapTooltip = null;
function ensureTooltip(){
  if (!mapTooltip){
    mapTooltip = d3.select("body")
      .append("div")
      .attr("class", "map-tooltip")
      .style("opacity", 0);
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

  // If MATCH_KEY is not present, default to NAME_KEY
  if (!(MATCH_KEY in sample)) MATCH_KEY = NAME_KEY;

  console.log("[Map] keys:", { stateKey: STATE_KEY, subdivKey: NAME_KEY, matchKey: MATCH_KEY });
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

// ---------- Robust GeoJSON fallbacks ----------
const GEO_URLS = [
  "indian_met_zones.geojson",
  "assets/indian_met_zones.geojson",
  "weather_bulletin/indian_met_zones.geojson",
  "https://rimtin.github.io/weather_bulletin/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/rimtin/weather_bulletin/main/indian_met_zones.geojson",
  "https://cdn.jsdelivr.net/gh/rimtin/weather_bulletin@main/indian_met_zones.geojson"
];

async function fetchFirst(urls){
  for (const url of urls){
    try{
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) continue;
      const j = await r.json();
      console.log("[Map] Loaded:", url);
      return j;
    }catch{ /* try next */ }
  }
  throw new Error("No GeoJSON found");
}

// ---------- Cloud reference table (optional pretty block) ----------
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
      <td>${r.label}</td>
      <td>${r.type}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Legends (per map) ----------
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

  labels.forEach((label, i) => {
    const y = pad + 28 + i * gap;
    g.append("rect").attr("x", pad).attr("y", y - 12).attr("width", sw).attr("height", 12)
      .attr("fill", pal[label] || "#eee").attr("stroke", "#999");
    g.append("text").attr("x", pad + sw + 8).attr("y", y - 2)
      .attr("font-size", 12).text(label);
  });
}

// ---------- Color the <select> UI ----------
function colorizeSelect(sel, label){
  const pal=window.forecastColors||{};
  const c=pal[label]||"#fff";
  sel.style.backgroundColor=c;
  sel.style.color="#000";
  sel.style.borderColor="#000";
}

// ---------- Draw ONE map (sub-division polygons) ----------
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

  // size
  svg.attr("viewBox", `0 0 ${W} ${H}`);

  // optional IMD WMS behind polygons
  addWMSOverlay(svgId);

  // load GeoJSON
  let features = [];
  try{
    const geo = await fetchFirst(GEO_URLS);
    features = (geo.type === "Topology")
      ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features
      : (geo.features || []);
  }catch(e){ alert("Could not load GeoJSON"); console.error(e); return; }
  if (!features.length){ alert("GeoJSON has 0 features"); return; }

  detectKeys(features);

  const fc = { type:"FeatureCollection", features };
  const projection = pickProjection(fc);
  const path = d3.geoPath(projection);

  // draw
  const paths = fillLayer.selectAll("path").data(features).join("path")
    .attr("class","subdiv")
    .attr("data-st", d => d.properties?.[STATE_KEY] ?? "")
    .attr("data-sub", d => d.properties?.[NAME_KEY]  ?? "")
    .attr("d", path)
    .attr("fill", "url(#diagonalHatch)")
    .attr("stroke", "#666").attr("stroke-width", 0.7);

  // Tooltip only for configured sub-divisions
  const allowed = new Set((window.subdivisions || []).map(r => norm(r.name)));
  const tooltip = ensureTooltip();

  paths
    .on("pointerenter", function(){ d3.select(this).raise(); })
    .on("pointermove", function(event, d){
      const raw = d?.properties?.[MATCH_KEY] ?? "";
      const key = norm(raw);
      if (!allowed.has(key)) { tooltip.style("opacity", 0); return; }

      const pad = 14, vw = window.innerWidth, vh = window.innerHeight, ttW = 220, ttH = 44;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + ttW > vw) x = vw - ttW - pad;
      if (y + ttH > vh) y = vh - ttH - pad;

      tooltip.style("opacity", 1).html(raw)
             .style("left", x + "px").style("top", y + "px");
    })
    .on("pointerleave", function(){ tooltip.style("opacity", 0); })
    .style("cursor", d => allowed.has(norm(d?.properties?.[MATCH_KEY] ?? "")) ? "pointer" : "default");

  // Build group indexes keyed by sub-division label (normalized)
  const idx = new Map(), groups = new Map();
  paths.each(function(d){
    const key = norm(String(d.properties?.[MATCH_KEY] ?? ""));
    if (!key) return;
    (idx.get(key) || idx.set(key, []).get(key)).push(this);
    (groups.get(key) || groups.set(key, []).get(key)).push(d);
  });
  indexByGroup[svgId] = idx;

  // Centroids per group (pixel + geographic)
  groupCentroid[svgId] = {};
  groupGeoCentroid[svgId] = {};
  const gp = d3.geoPath(projection);

  groups.forEach((arr, key) => {
    const groupFC = { type: "FeatureCollection", features: arr };

    // pixel centroid (for icon placement)
    let [x, y] = gp.centroid(groupFC);
    const off = ICON_OFFSETS[key]; if (off) { x += off.dx||0; y += off.dy||0; }
    if (Number.isFinite(x) && Number.isFinite(y)) groupCentroid[svgId][key] = [x,y];

    // geographic centroid (lon, lat) for API calls
    const [lon, lat] = d3.geoCentroid(groupFC);
    if (Number.isFinite(lon) && Number.isFinite(lat)) groupGeoCentroid[svgId][key] = [lon, lat];
  });

  // Legend
  drawLegend(svg, svgId === "#indiaMapDay1" ? "Index — Day 1" : "Index — Day 2");

  // After second map: build table, color once
  if (svgId === "#indiaMapDay2"){
    buildFixedTable();
    // Ensure selects have a value
    document.querySelectorAll("#forecast-table-body select").forEach(sel => {
      if (sel.options.length && sel.selectedIndex < 0) sel.selectedIndex = 0;
    });
    updateMapColors();
  }
}

// ---------- Forecast table (merged State column) ----------
function buildFixedTable(){
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

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
        tdState.setAttribute("data-col", "state");
        tdState.textContent = state;
        tdState.rowSpan = rows.length;
        tdState.style.verticalAlign = "middle";
        tr.appendChild(tdState);
      }

      const tdSub = document.createElement("td");
      tdSub.setAttribute("data-col", "subdiv");
      tdSub.textContent = row.name;
      tr.appendChild(tdSub);

      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      td1.setAttribute("data-col","day1");
      td2.setAttribute("data-col","day2");

      const s1 = document.createElement("select");
      const s2 = document.createElement("select");
      [s1, s2].forEach(sel=>{
        (options || []).forEach(opt => {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          sel.appendChild(o);
        });
        sel.addEventListener("change", updateMapColors);
        if (sel.options.length && sel.selectedIndex < 0) sel.selectedIndex = 0;
      });

      td1.appendChild(s1); td2.appendChild(s2);
      tr.appendChild(td1); tr.appendChild(td2);

      tr.addEventListener("mouseenter", () => highlight(row.name, true));
      tr.addEventListener("mouseleave", () => highlight(row.name, false));

      tbody.appendChild(tr);
    });
  }
}

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

// ---------- Coloring + icons + colored selects ----------
function updateMapColors(){
  const pal   = window.forecastColors || {};
  const icons = window.forecastIcons  || {};

  const rows = Array.from(document.querySelectorAll("#forecast-table-body tr")).map(tr => {
    const subdiv = tr.dataset.subdiv;
    const day1Sel = tr.querySelector('td[data-col="day1"] select');
    const day2Sel = tr.querySelector('td[data-col="day2"] select');
    const day1   = day1Sel?.value || null;
    const day2   = day2Sel?.value || null;

    // Color the selects themselves
    if (day1Sel) colorizeSelect(day1Sel, day1);
    if (day2Sel) colorizeSelect(day2Sel, day2);

    return { key: norm(subdiv), day1, day2, raw: subdiv };
  });

  ["#indiaMapDay1","#indiaMapDay2"].forEach((svgId, idx) => {
    const dayKey = idx === 0 ? "day1" : "day2";
    const svg = d3.select(svgId);
    const idxMap = indexByGroup[svgId] || new Map();

    // reset fills
    svg.selectAll(".subdiv").attr("fill","url(#diagonalHatch)");

    // icons layer
    const gIcons = ensureLayer(svg, "icon-layer").style("pointer-events","none");
    gIcons.raise(); gIcons.selectAll("*").remove();

    rows.forEach(rec => {
      const nodes = idxMap.get(rec.key);
      if (!nodes) { console.warn("[No match]", rec.raw); return; }
      const color = pal[rec[dayKey]] || "#eee";
      nodes.forEach(n => n.setAttribute("fill", color));

      const pos = groupCentroid[svgId][rec.key];
      if (!pos) return;
      const [x,y] = pos;

      // anchor dot
      gIcons.append("circle")
        .attr("cx", x).attr("cy", y).attr("r", 5.5)
        .attr("fill", "#f5a623").attr("stroke","#fff")
        .attr("stroke-width",1.3).attr("vector-effect","non-scaling-stroke");

      // emoji icon
      const emoji = icons[rec[dayKey]];
      if (emoji) {
        gIcons.append("text")
          .attr("x", x).attr("y", y)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size", 18)
          .attr("font-family", `"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`)
          .attr("paint-order", "stroke")
          .attr("stroke", "white").attr("stroke-width", 2)
          .text(emoji);
      }
    });
  });
}

// ---------- Print notes mirroring to print-only textarea ----------
function wirePrintNotesMirror(){
  const live = document.getElementById('notes');
  const ghost = document.getElementById('notes-print');
  if (!live || !ghost) return;
  const sync = () => { ghost.value = live.value; };
  live.addEventListener('input', sync);
  window.addEventListener('beforeprint', sync);
  sync();
}

// ============================
// DAILY ENSEMBLE (Open-Meteo + NASA POWER)
// ============================
function isoTodayIST() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`; // YYYY-MM-DD
}
function yyyymmddIST(offsetDays = 0) {
  const now = new Date();
  const withOffset = new Date(now.getTime() + (330*60*1000) + offsetDays*24*60*60*1000);
  const y = withOffset.getUTCFullYear();
  const m = String(withOffset.getUTCMonth()+1).padStart(2,'0');
  const d = String(withOffset.getUTCDate()).padStart(2,'0');
  return `${y}${m}${d}`;
}
function avg(nums) { const a = (nums||[]).filter(Number.isFinite); return a.length ? a.reduce((x,y)=>x+y,0)/a.length : undefined; }
function fixPercentUnits(v){ if(v==null) return undefined; const n=Number(v); if(!isFinite(n)) return undefined; return n<=1 ? n*100 : n; }

// Open-Meteo daily mean cloud cover
async function fetchOpenMeteoDaily(lat, lon) {
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

// NASA POWER daily CLOUD_AMT (may lag 1–3 days)
async function fetchNASAPowerDaily(lat, lon) {
  const start = yyyymmddIST(0); // today
  const end   = yyyymmddIST(1); // tomorrow

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
  const d1 = fixPercentUnits(obj[start]);
  const d2 = fixPercentUnits(obj[end]);

  return { day1: d1, day2: d2 };
}

async function ensembleDaily(lat, lon) {
  const [om, np] = await Promise.allSettled([
    fetchOpenMeteoDaily(lat, lon),
    fetchNASAPowerDaily(lat, lon)
  ]);
  const a = om.status === "fulfilled" ? om.value : {};
  const b = np.status === "fulfilled" ? np.value : {};

  return {
    day1: avg([a.day1, b.day1].filter(v => v!=null)) ?? a.day1 ?? b.day1,
    day2: avg([a.day2, b.day2].filter(v => v!=null)) ?? a.day2 ?? b.day2,
  };
}

function cloudLabel(pct) {
  const v = Number(pct);
  if (!isFinite(v)) return "Clear Sky";
  if (v < 10) return "Clear Sky";
  if (v < 30) return "Low Cloud Cover";
  if (v < 50) return "Medium Cloud Cover";
  if (v < 75) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}
window.cloudLabel = window.cloudLabel || cloudLabel;

function setRowFromPct(row, p1, p2){
  const s1 = row.querySelector('td[data-col="day1"] select');
  const s2 = row.querySelector('td[data-col="day2"] select');
  if (s1 && p1!=null) s1.value = cloudLabel(p1);
  if (s2 && p2!=null) s2.value = cloudLabel(p2);
}

// Public: Autofill daily labels for *sub-divisions*
async function autoFillFromAPIsSubdiv(){
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;

  const btn = document.getElementById("autofillBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; }

  for (const tr of tbody.querySelectorAll("tr")){
    const subdivRaw = tr.dataset.subdiv;
    const key = norm(subdivRaw);

    // use Day-1 map’s group geo centroid (same grouping on both maps)
    const gloc = groupGeoCentroid["#indiaMapDay1"]?.[key];
    if (!gloc) { console.warn("[No centroid]", subdivRaw); continue; }
    const [lon, lat] = gloc;

    const { day1, day2 } = await ensembleDaily(lat, lon);
    setRowFromPct(tr, day1, day2);
    updateMapColors(); // repaint incrementally
  }

  if (btn) { btn.disabled = false; btn.textContent = "Auto-fill from APIs (Ensemble)"; }
}
window.autoFillFromAPIsSubdiv = autoFillFromAPIsSubdiv;

// ---------- IMD WMS overlay behind polygons ----------
function addWMSOverlay(svgId){
  if (!IMD_WMS_LAYER) return; // skip unless configured

  const wrap = document.querySelector(`${svgId}`)?.parentElement; // expect .map-wrapper
  if (!wrap) return;
  wrap.style.position = wrap.style.position || "relative";

  const svg = document.querySelector(svgId);
  const vb = (svg?.getAttribute("viewBox")||"0 0 860 580").split(/\s+/).map(Number);
  const w = vb[2] || 860; const h = vb[3] || 580;

  // Axis order: WMS 1.3.0 + EPSG:4326 => lat,lon; 1.1.1 => lon,lat
  const bbox = (IMD_WMS_VERSION === "1.3.0" && IMD_WMS_CRS === "EPSG:4326")
    ? `${INDIA_BBOX.minLat},${INDIA_BBOX.minLon},${INDIA_BBOX.maxLat},${INDIA_BBOX.maxLon}`
    : `${INDIA_BBOX.minLon},${INDIA_BBOX.minLat},${INDIA_BBOX.maxLon},${INDIA_BBOX.maxLat}`;

  const url = `${IMD_WMS_BASE
    }?SERVICE=WMS&REQUEST=GetMap&VERSION=${encodeURIComponent(IMD_WMS_VERSION)
    }&CRS=${encodeURIComponent(IMD_WMS_CRS)
    }&LAYERS=${encodeURIComponent(IMD_WMS_LAYER)
    }&STYLES=&FORMAT=image/png&TRANSPARENT=true&WIDTH=${w}&HEIGHT=${h}&BBOX=${bbox}`;

  let img = wrap.querySelector("img.imd-wms");
  if (!img){
    img = document.createElement("img");
    img.className = "imd-wms";
    img.style.position = "absolute";
    img.style.left = 0; img.style.top = 0;
    img.style.width = "100%"; img.style.height = "100%";
    img.style.opacity = String(IMD_WMS_OPACITY);
    img.style.pointerEvents = "none"; // mouse events go to SVG
    wrap.prepend(img); // behind the SVG
  }
  img.src = url;
}

// ---------- Init ----------
function init(){
  if (typeof updateISTDate === "function") updateISTDate();
  buildCloudTable();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
  wirePrintNotesMirror();
}
document.addEventListener("DOMContentLoaded", init);
