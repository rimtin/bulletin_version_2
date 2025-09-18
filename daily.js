// === Map + table app (legend + satellite + hourly Day1/Day2) ===
const W = 860, H = 580, PAD = 18;
const MATCH_KEY = "ST_NM";
let STATE_KEY = "ST_NM";
let NAME_KEY  = "name";

// per-map stores
const indexByGroup  = { "#indiaMapDay1": new Map(), "#indiaMapDay2": new Map() };
const groupCentroid = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };

/* ---------------- Satellite links for legend button ---------------- */
const SATELLITE_LINKS = {
  "#indiaMapDay1": "https://zoom.earth/#view=22.5,79.0,5z/layers=labels,clouds",
  "#indiaMapDay2": "https://zoom.earth/#view=22.5,79.0,5z/layers=labels,clouds"
};

/* ---------------- DAILY auto-fill (Open-Meteo) -------------------- */
// Add more when you’re ready. Keys must match your table’s "Sub Division" text.
const CENTROIDS = {
  "Punjab":           { lat: 31.1, lon: 75.4 },
  "West Rajasthan":   { lat: 26.9, lon: 73.2 },
  "East Rajasthan":   { lat: 26.9, lon: 75.8 }
};

// % → bucket (tweak thresholds if you like)
function bucketFromPct(pct){
  if (pct < 10) return "Clear Sky";
  if (pct < 30) return "Low Cloud Cover";
  if (pct < 50) return "Medium Cloud Cover";
  if (pct < 75) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}

// severity rank (for “cloudier of West/East Rajasthan”)
const BUCKET_RANK = {
  "Clear Sky": 0, "Low Cloud Cover": 1, "Medium Cloud Cover": 2,
  "High Cloud Cover": 3, "Overcast Cloud Cover": 4
};

/* --------- FIX: use HOURLY cloud from NOW for Day1/Day2 --------- */
// Fetch 48h of hourly total cloud cover; bucket Day1/Day2 from NOW (IST)
async function fetchHourlyCloudBuckets(lat, lon){
  const url = `https://api.open-meteo.com/v1/forecast`+
              `?latitude=${lat}&longitude=${lon}`+
              `&hourly=cloud_cover&forecast_hours=48&timezone=Asia%2FKolkata`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("Open-Meteo error");
  const j = await r.json();

  const arr = j?.hourly?.cloud_cover || [];
  // Day 1: next 24h, Day 2: hours 25–48
  const a1 = arr.slice(0, 24);
  const a2 = arr.slice(24, 48);

  const mean = a => a.length ? a.reduce((s,x)=>s+(x??0),0)/a.length : 0;
  const d1 = bucketFromPct(mean(a1));
  const d2 = bucketFromPct(mean(a2));
  return { d1, d2 };
}

// Only runs on daily.html (where <body data-readonly="true">)
async function autoFillDailyFromOpenMeteo(){
  if (document.body.dataset.readonly !== "true") return;

  const rows = Array.from(document.querySelectorAll("#forecast-table-body tr"));
  if (!rows.length) return;

  const wants = rows.map(tr => tr.dataset.subdiv).filter(n => !!CENTROIDS[n]);
  const unique = Array.from(new Set(wants));

  const results = {};
  await Promise.all(unique.map(async name => {
    try{
      const { lat, lon } = CENTROIDS[name];
      // HOURLY from now → Day1/Day2
      results[name] = await fetchHourlyCloudBuckets(lat, lon);
    }catch(e){ console.warn("Open-Meteo failed for", name, e); }
  }));

  // Rajasthan (cloudier of West/East)
  const west = results["West Rajasthan"];
  const east = results["East Rajasthan"];
  let rajasthan = null;
  if (west && east){
    const pick = (a,b) => (BUCKET_RANK[a] >= BUCKET_RANK[b]) ? a : b;
    rajasthan = { d1: pick(west.d1, east.d1), d2: pick(west.d2, east.d2) };
  }

  rows.forEach(tr => {
    const subdiv = tr.dataset.subdiv;
    const s1 = tr.querySelector('td[data-col="day1"] select') || tr.querySelectorAll('select')[0];
    const s2 = tr.querySelector('td[data-col="day2"] select') || tr.querySelectorAll('select')[1];
    if (!s1 || !s2) return;

    if (results[subdiv]) {
      s1.value = results[subdiv].d1;
      s2.value = results[subdiv].d2;
    } else if (subdiv === "Rajasthan" && rajasthan){
      s1.value = rajasthan.d1;
      s2.value = rajasthan.d2;
    }
    s1.disabled = true; s2.disabled = true; // daily page is read-only
  });

  updateMapColors();
}

/* ----------------- Helpers ----------------- */
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
const norm = s => String(s || "")
  .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s*&\s*/g, " and ").replace(/\s*\([^)]*\)\s*/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

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

// Robust GeoJSON fallbacks
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
  const height = pad + 18 + labels.length * gap + 44; // space for button

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

  // Button (open in new tab)
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

/* ---------------- Draw one map ---------------- */
async function drawMap(svgId){
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  // layers
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

  // hover tooltip for configured sub-divisions
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

      tooltip.style("opacity", 1).html(raw)
             .style("left", x + "px").style("top", y + "px");
    })
    .on("pointerleave", () => tooltip.style("opacity", 0))
    .style("cursor", d => allowed.has(norm(d?.properties?.[MATCH_KEY] ?? "")) ? "pointer" : "default");

  // index & group by ST_NM
  const idx = new Map(), groups = new Map();
  paths.each(function(d){
    const key = norm(String(d.properties?.[MATCH_KEY] ?? ""));
    if (!key) return;
    (idx.get(key) || idx.set(key, []).get(key)).push(this);
    (groups.get(key) || groups.set(key, []).get(key)).push(d);
  });
  indexByGroup[svgId] = idx;

  // projected centroid per group
  groupCentroid[svgId] = {};
  const gp = d3.geoPath(projection);
  groups.forEach((arr, key) => {
    const groupFC = { type: "FeatureCollection", features: arr };
    let [x, y] = gp.centroid(groupFC);
    if (Number.isFinite(x) && Number.isFinite(y)) groupCentroid[svgId][key] = [x,y];
  });

  // For Day2: after table exists, color + auto-fill if daily page
  if (svgId === "#indiaMapDay2"){
    buildFixedTable();
    document.querySelectorAll("#forecast-table-body select").forEach(sel=>{
      if (sel.options.length && sel.selectedIndex < 0) sel.selectedIndex = 0;
    });
    await autoFillDailyFromOpenMeteo().catch(e=>console.error(e));
    updateMapColors();
  }

  // Legend + satellite button (top-right)
  const title = (svgId === "#indiaMapDay1") ? "Index — Day 1" : "Index — Day 2";
  drawLegendWithButton(svg, title, SATELLITE_LINKS[svgId] || SATELLITE_LINKS["#indiaMapDay1"]);
}

/* ---------------- Forecast table ---------------- */
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

/* ---------------- Init ---------------- */
function init(){
  if (typeof updateISTDate === "function") updateISTDate();
  buildCloudTable();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
}
document.addEventListener("DOMContentLoaded", init);
