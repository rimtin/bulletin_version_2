// === Sub-division coloring by ST_NM with centered icons + per-map legends ===

const W = 860, H = 580, PAD = 18;
const MATCH_KEY = "ST_NM";       // color by this field in GeoJSON
let STATE_KEY = "ST_NM";
let NAME_KEY  = "name";

// Per-map stores
const indexByGroup  = { "#indiaMapDay1": new Map(), "#indiaMapDay2": new Map() }; // norm(ST_NM) -> [paths]
const groupCentroid = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };                // norm(ST_NM) -> [x,y]

// optional fine-tune offsets per group
const ICON_OFFSETS = {};

// ---------- helpers ----------
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
  console.log("[Map] keys:", { stateKey: STATE_KEY, districtKey: NAME_KEY, matchKey: MATCH_KEY });
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
    }catch{}
  }
  throw new Error("No GeoJSON found");
}

/* ---------- COLORED cloud table ---------- */
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

/* ---------- legends ---------- */
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

/* ---------- helper: color the select controls ---------- */
function colorizeSelect(sel, label){
  const pal=window.forecastColors||{};
  const c=pal[label]||"#fff";
  sel.style.backgroundColor=c;
  sel.style.color="#000";
  sel.style.borderColor="#000";
}

/* ---------- draw one map ---------- */
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
  console.log("[Map] Features:", features.length);

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

  // --- hover tooltip (only for configured 19 sub-divisions) ---
  const allowed = new Set((window.subdivisions || []).map(r => norm(r.name)));
  const tooltip = ensureTooltip();

  paths
    .on("pointerenter", function(){ d3.select(this).raise(); })
    .on("pointermove", function(event, d){
      const raw = d?.properties?.[MATCH_KEY] ?? "";
      const key = norm(raw);
      if (!allowed.has(key)) { tooltip.style("opacity", 0); return; }

      // clamp tooltip inside viewport
      const pad = 14, vw = window.innerWidth, vh = window.innerHeight, ttW = 200, ttH = 44;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + ttW > vw) x = vw - ttW - pad;
      if (y + ttH > vh) y = vh - ttH - pad;

      tooltip.style("opacity", 1).html(raw)
             .style("left", x + "px").style("top", y + "px");
    })
    .on("pointerleave", function(){ tooltip.style("opacity", 0); })
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
    const off = ICON_OFFSETS[key]; if (off) { x += off.dx||0; y += off.dy||0; }
    if (Number.isFinite(x) && Number.isFinite(y)) groupCentroid[svgId][key] = [x,y];
  });

  drawLegend(svg, svgId === "#indiaMapDay1" ? "Index — Day 1" : "Index — Day 2");

  if (svgId === "#indiaMapDay2"){
    buildFixedTable();
    document.querySelectorAll("#forecast-table-body select").forEach(sel => {
      if (sel.options.length && sel.selectedIndex < 0) sel.selectedIndex = 0;
    });
    updateMapColors();
  }
}

/* ---------- Forecast table with merged State cells ---------- */
function buildFixedTable(){
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const options = window.forecastOptions || [];

  // group by state
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
        options.forEach(opt => {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          sel.appendChild(o);
        });
        sel.addEventListener("change", () => {
          updateMapColors();               // recolor map + all selects
        });
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

/* ---------- coloring + icons + colored selects ---------- */
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

    // icon layer on top
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

      // dot + emoji
      gIcons.append("circle")
        .attr("cx", x).attr("cy", y).attr("r", 5.5)
        .attr("fill", "#f5a623").attr("stroke","#fff")
        .attr("stroke-width",1.3).attr("vector-effect","non-scaling-stroke");

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

/* ---------- Print notes mirroring (PDF: notes under table) ---------- */
function wirePrintNotesMirror(){
  const live = document.getElementById('notes');
  const ghost = document.getElementById('notes-print');
  if (!live || !ghost) return;
  const sync = () => { ghost.value = live.value; };
  live.addEventListener('input', sync);
  window.addEventListener('beforeprint', sync);
  sync(); // initial
}

/* ---------- init ---------- */
function init(){
  if (typeof updateISTDate === "function") updateISTDate();
  buildCloudTable();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
  wirePrintNotesMirror();
}
document.addEventListener("DOMContentLoaded", init);
