/* ================= Cloud Bulletin — HOURLY =================
 * Reuses the same robust map pipeline as daily.js:
 *  - same GEO_URLS fallbacks
 *  - same key detection and projection logic
 *  - same hatch/legend scaffold
 * Then keeps your hourly table + Open-Meteo fetching.
 *
 * Requires:
 *   <script src="https://d3js.org/d3.v7.min.js"></script>
 *   <script src="https://unpkg.com/topojson-client@3"></script>
 */

/* ---------- constants shared with daily ---------- */
const W = 860, H = 580, PAD = 18;
const MATCH_KEY = "ST_NM";
let STATE_KEY = "ST_NM";
let NAME_KEY  = "name";

/* ---------- hourly-specific ---------- */
const IST_TZ = "Asia/Kolkata";
const MAX_HOURS = 48;
const hourlyStore = {}; // "State|Sub" -> { times:[], values:[] }

/* ===========================================================
   ==============  DAILY-STYLE MAP HELPERS  ==================
   (adapted from daily.js so the map loads the same way)
   =========================================================== */

/* --- tooltips --- */
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

/* --- string normalizer --- */
const norm = s => String(s || "")
  .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s*&\s*/g, " and ").replace(/\s*\([^)]*\)\s*/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/* --- detect property keys in GeoJSON --- */
function detectKeys(features){
  const sKeys = ["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","State"];
  const dKeys = ["DISTRICT","name","NAME_2","Name","district","dist_name"];
  const sample = features[0]?.properties || {};
  STATE_KEY = sKeys.find(k => k in sample) || STATE_KEY;
  NAME_KEY  = dKeys.find(k => k in sample) || NAME_KEY;
}

/* --- projection chooser (lon/lat vs identity) --- */
function pickProjection(fc){
  const [[minX,minY],[maxX,maxY]] = d3.geoBounds(fc);
  const w = maxX - minX, h = maxY - minY;
  const lonlat = w < 200 && h < 120 && minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
  return lonlat
    ? d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc)
    : d3.geoIdentity().reflectY(true).fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc);
}

/* --- ensure layer group exists --- */
function ensureLayer(svg, className){
  let g = svg.select(`.${className}`);
  if (g.empty()) g = svg.append("g").attr("class", className);
  return g;
}

/* --- same robust GeoJSON fallbacks as daily.js --- */
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

/* --- very small legend header (optional; no button here) --- */
function drawTinyLegend(svg){
  svg.selectAll(".map-legend").remove();
  const pal = window.forecastColors || {};
  const labels = window.forecastOptions || Object.keys(pal);

  const pad = 10, sw = 14, gap = 16, width = 190;
  const height = pad + 16 + labels.length * gap;

  const g = svg.append("g")
    .attr("class", "map-legend")
    .attr("transform", `translate(${W - width - 14}, ${14})`);

  g.append("rect").attr("width", width).attr("height", height)
    .attr("rx", 10).attr("ry", 10)
    .attr("fill", "rgba(255,255,255,0.95)").attr("stroke", "#d1d5db");

  g.append("text").attr("x", pad).attr("y", pad + 12)
    .attr("font-weight", 700).attr("font-size", 12).attr("fill", "#111827")
    .text("Hourly preview");

  labels.forEach((label, i) => {
    const y = pad + 24 + i * gap;
    g.append("rect").attr("x", pad).attr("y", y - 10)
      .attr("width", sw).attr("height", 10)
      .attr("fill", pal[label] || "#eee").attr("stroke", "#9ca3af");
    g.append("text").attr("x", pad + sw + 6).attr("y", y - 1)
      .attr("font-size", 11).attr("fill", "#111827")
      .text(label);
  });
}

/* ===========================================================
   ===============  HOURLY INDIA MAP (left card)  ============
   Draws once; colors can be hooked up later if needed.
   =========================================================== */

async function drawHourlyIndiaMap(svgId = "#indiaMapHourly"){
  // Create the SVG if it doesn't exist
  let svgEl = document.querySelector(svgId);
  if (!svgEl) {
    const holder = document.querySelector("#hourlyMapWrap") || document.body;
    svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("id", svgId.replace("#",""));
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svgEl.style.width = "100%";
    svgEl.style.height = "420px";
    holder.appendChild(svgEl);
  }
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  // hatch pattern like daily.js
  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diagonalHatch").attr("patternUnits","userSpaceOnUse")
    .attr("width",6).attr("height",6)
    .append("path").attr("d","M0,0 l6,6").attr("stroke","#999").attr("stroke-width",1);

  const fillLayer = ensureLayer(svg, "fill-layer");
  ensureLayer(svg, "icon-layer").style("pointer-events","none");

  // Load features using same fallbacks
  let features = [];
  try{
    const geo = await fetchFirst(GEO_URLS);
    features = (geo.type === "Topology")
      ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features
      : (geo.features || []);
  }catch(e){
    console.error(e);
    svg.append("text").attr("x", 12).attr("y", 24).attr("font-weight", 700)
      .text("Could not load GeoJSON");
    return;
  }
  if (!features.length){
    svg.append("text").attr("x", 12).attr("y", 24).text("GeoJSON has 0 features");
    return;
  }

  detectKeys(features);
  const fc = { type:"FeatureCollection", features };
  const projection = pickProjection(fc);
  const path = d3.geoPath(projection);

  // draw
  const paths = fillLayer.selectAll("path").data(features).join("path")
    .attr("class","subdiv")
    .attr("data-st", d => d.properties?.[STATE_KEY] ?? "")
    .attr("data-d",  d => d.properties?.[NAME_KEY]  ?? "")
    .attr("d", path)
    .attr("fill", "url(#diagonalHatch)")
    .attr("stroke", "#666").attr("stroke-width", 0.7);

  const tooltip = ensureTooltip();
  paths.on("pointerenter", function(){ d3.select(this).raise(); })
    .on("pointermove", function(event, d){
      const label = d?.properties?.[MATCH_KEY] ?? (d?.properties?.[NAME_KEY] ?? "");
      const pad = 14, vw = innerWidth, vh = innerHeight, ttW = 200, ttH = 44;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + ttW > vw) x = vw - ttW - pad;
      if (y + ttH > vh) y = vh - ttH - pad;
      tooltip.style("opacity", 1).html(label).style("left", x+"px").style("top", y+"px");
    })
    .on("pointerleave", () => tooltip.style("opacity", 0))
    .style("cursor","default");

  drawTinyLegend(svg);
}

/* ===========================================================
   ==============  YOUR HOURLY TABLE + FETCH  ================
   (unchanged, just tidied)
   =========================================================== */

async function fetchHourly(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "cloud_cover");
  url.searchParams.set("timezone", IST_TZ);
  url.searchParams.set("forecast_days", "2");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Open-Meteo " + res.status);
  const data = await res.json();
  return {
    times: (data.hourly?.time || []).slice(0, MAX_HOURS),
    values: (data.hourly?.cloud_cover || []).slice(0, MAX_HOURS)
  };
}

async function refreshAllHourly() {
  const tasks = subdivisions.map(async s => {
    const key = `${s.state}|${s.name}`;
    const c = centroids[key];
    if (!c) return;
    try {
      const {times, values} = await fetchHourly(c.lat, c.lon);
      hourlyStore[key] = {times, values};
    } catch (e) { console.warn("Fetch failed:", key, e); }
  });
  await Promise.allSettled(tasks);
}

function getPct(key, hourIdx) {
  const e = hourlyStore[key];
  if (!e || !e.values?.length) return NaN;
  const i = Math.max(0, Math.min(e.values.length - 1, hourIdx));
  return e.values[i];
}

function setHourLabel(hourIdx) {
  const anyKey = Object.keys(hourlyStore)[0];
  let label = `T+${hourIdx}h`;
  if (anyKey && hourlyStore[anyKey]?.times?.[hourIdx]) {
    label = hourlyStore[anyKey].times[hourIdx];
  }
  const el = document.getElementById("hourLabel");
  if (el) el.textContent = `${label} IST`;
}

function populateTable(hourIdx) {
  setHourLabel(hourIdx);
  const tbody = document.querySelector("#hourlyTable tbody");
  tbody.innerHTML = "";
  let i = 1;

  subdivisions.forEach(s => {
    const key = `${s.state}|${s.name}`;
    const pct = getPct(key, hourIdx);
    const bucket = pctToBucket(pct);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i++}</td>
      <td>${s.state}</td>
      <td>${s.name}</td>
      <td class="${classForBucket(bucket)}">${bucket}</td>
      <td>${Number.isFinite(pct) ? pct.toFixed(0)+"%" : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ===========================================================
   =========================  INIT  ==========================
   =========================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  // 1) Draw India map using DAILY’s exact loader/projection logic
  await drawHourlyIndiaMap("#indiaMapHourly");

  // 2) IST label
  if (typeof updateISTDate === "function") updateISTDate("dateEl");

  // 3) set up table shell
  const tbody = document.querySelector("#hourlyTable tbody");
  if (tbody) {
    tbody.innerHTML = subdivisions.map((s,i)=>`
      <tr>
        <td>${i+1}</td>
        <td>${s.state}</td>
        <td>${s.name}</td>
        <td>Loading…</td>
        <td>—</td>
      </tr>
    `).join("");
  }

  // 4) controls
  const input = document.getElementById("hourSelect");
  const btn = document.getElementById("refreshNow");
  const setHour = h => populateTable(Math.max(0, Math.min(MAX_HOURS-1, Number(h)||0)));
  if (input) input.addEventListener("input", e => setHour(e.target.value));
  if (btn) btn.addEventListener("click", async () => {
    btn.disabled = true;
    await refreshAllHourly();
    setHour(input ? input.value : 0);
    btn.disabled = false;
  });

  // 5) first load
  await refreshAllHourly();
  setHour(0);

  // 6) refresh hourly in background
  setInterval(async () => {
    await refreshAllHourly();
    setHour(input ? input.value : 0);
  }, 60*60*1000);
});
