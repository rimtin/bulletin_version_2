// === Map + table app (legend + satellite + hourly Day1/Day2 + Punjab panel + IST rollover, STATIC per day) ===
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
const CENTROIDS = {
  "Punjab":           { lat: 31.1, lon: 75.4 },
  "West Rajasthan":   { lat: 26.9, lon: 73.2 },
  "East Rajasthan":   { lat: 26.9, lon: 75.8 }
};

// % → bucket
function bucketFromPct(pct){
  if (pct < 10) return "Clear Sky";
  if (pct < 30) return "Low Cloud Cover";
  if (pct < 50) return "Medium Cloud Cover";
  if (pct < 75) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}

// severity rank (for West/East Rajasthan)
const BUCKET_RANK = {
  "Clear Sky": 0, "Low Cloud Cover": 1, "Medium Cloud Cover": 2,
  "High Cloud Cover": 3, "Overcast Cloud Cover": 4
};

/* --------- HOURLY → Day1/Day2 from NOW (IST) --------- */
// cache-busted so the FIRST fetch of the day is fresh, then we keep it
async function fetchHourlyCloudBuckets(lat, lon){
  const url = `https://api.open-meteo.com/v1/forecast`+
              `?latitude=${lat}&longitude=${lon}`+
              `&hourly=cloud_cover&forecast_hours=48&timezone=Asia%2FKolkata&_=${Date.now()}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("Open-Meteo error");
  const j = await r.json();

  const arr = j?.hourly?.cloud_cover || [];
  const a1 = arr.slice(0, 24);
  const a2 = arr.slice(24, 48);

  const mean = a => a.length ? a.reduce((s,x)=>s+(x??0),0)/a.length : 0;
  const d1 = bucketFromPct(mean(a1));
  const d2 = bucketFromPct(mean(a2));
  return { d1, d2 };
}

/* ---------- Daylight-only HOURLY series for charts ---------- */
const DAYLIGHT_START = 4, DAYLIGHT_END = 19;
async function fetchDaylightSeries(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "cloud_cover");
  url.searchParams.set("forecast_hours", "48");
  url.searchParams.set("timezone", "Asia/Kolkata");
  const r = await fetch(url.toString(), { cache:"no-store" });
  if(!r.ok) throw new Error("Open-Meteo "+r.status);
  const j = await r.json();
  const times  = j.hourly?.time || [];
  const clouds = j.hourly?.cloud_cover || [];
  const T=[], V=[];
  for(let i=0;i<times.length;i++){
    const h = new Date(times[i]).getHours();
    if(h>=DAYLIGHT_START && h<=DAYLIGHT_END){ T.push(times[i]); V.push(clouds[i]); }
  }
  const ghi = V.map(p => 950 * Math.max(0, 1 - (p||0)/100)); // proxy
  return { times:T, clouds:V, ghi };
}

function drawLineChart({ holderId, labels, values, yMax, title="", unit="", width=520, height=260 }){
  const holder = document.getElementById(holderId);
  if (!holder) return;
  holder.innerHTML = "";
  Object.assign(holder.style,{ background:"#fff", borderRadius:"12px", boxShadow:"0 10px 25px -5px rgba(0,0,0,.10), 0 10px 10px -5px rgba(0,0,0,.04)", padding:"10px" });

  const P={t:28,r:18,b:36,l:44};
  const svg=d3.select(holder).append("svg").attr("width",width).attr("height",height);
  svg.append("text").attr("x",12).attr("y",18).attr("font-weight",800).attr("font-size",13).text(title);

  const x=d3.scalePoint().domain(d3.range(labels.length)).range([P.l,width-P.r]);
  const y=d3.scaleLinear().domain([0,yMax]).nice().range([height-P.b,P.t+6]);

  svg.append("g").attr("transform",`translate(0,${height-P.b})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter(i=>i%2===0))
      .tickFormat(i=>new Date(labels[i]).toLocaleTimeString("en-IN",{hour:"numeric"})));
  svg.append("g").attr("transform",`translate(${P.l},0)`).call(d3.axisLeft(y).ticks(5));

  const line=d3.line().x((d,i)=>x(i)).y(d=>y(d));
  svg.append("path").attr("d",line(values)).attr("fill","none").attr("stroke","#2563eb").attr("stroke-width",2);
  if(unit) svg.append("text").attr("x",P.l).attr("y",P.t-6).attr("font-size",11).attr("fill","#555").text(unit);
}

async function drawDistrictCharts(name, lat, lon){
  try{
    const { times, clouds, ghi } = await fetchDaylightSeries(lat, lon);
    drawLineChart({ holderId: "cloudChart", labels: times, values: clouds, yMax: 100,  title: "Hourly Cloud % (ensemble)" });
    drawLineChart({ holderId: "ghiChart",   labels: times, values: ghi,    yMax: 1000, title: "GHI (proxy) — daylight only", unit: "W/m²" });
    const t = document.getElementById("districtTitle");
    if (t) t.textContent = `${name} — next 48 h (daylight only, 4:00–19:00 IST)`;
  }catch(e){ console.warn("district charts failed", e); }
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

// Robust district-name key finder
function findDistrictNameKey(props = {}) {
  const keys = Object.keys(props);
  const exact = [
    "DISTRICT","District","district",
    "DIST_NAME","DIST_NM","DISTNAME","dist_name",
    "DT_NAME","DTNAME","dt_name","dtname",
    "DISTRICT_N","District_Name",
    "NAME_2","name_2","NAME2","name2",
    "NAME","name","NAMELSAD","NL_NAME_2"
  ];
  for (const k of exact) if (k in props) return k;
  const fuzzyDN = keys.find(k => {
    const s = k.toLowerCase();
    return s.includes("dist") && s.includes("name");
  });
  if (fuzzyDN) return fuzzyDN;
  const fuzzyName = keys.find(k => {
    const s = k.toLowerCase();
    return s.startsWith("name") && !s.includes("state") && !s.includes("st_nm");
  });
  if (fuzzyName) return fuzzyName;
  return keys[0] || "name";
}

// India GeoJSON fallbacks
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

/* ---------------- Draw one map ---------------- */
async function drawMap(svgId){
  const svg = d3.select(svgId);
  svg.attr("viewBox",`0 0 ${W} ${H}`).style("width","100%").style("height",`${H}px`);
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

  // CLICK → Punjab district panel + charts + back button
  paths.on("click", async (evt, d) => {
    const st = String(d?.properties?.[STATE_KEY] ?? "").toLowerCase();
    if (st === "punjab") {
      await openPunjabDistrictView("day1");
      showPunjabPanelAndHideIndia(); // back button UX
    }
  });

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

  if (svgId === "#indiaMapDay2"){
    buildFixedTable();
    document.querySelectorAll("#forecast-table-body select").forEach(sel=>{
      if (sel.options.length && sel.selectedIndex < 0) sel.selectedIndex = 0;
    });
    await autoFillDailyFromOpenMeteo().catch(e=>console.error(e));
    updateMapColors();
  }

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

/* ---------------- Punjab District Panel (Daily, STATIC) ---------------- */

// UPDATED: Punjab districts sources
const PUNJAB_DISTRICT_URLS = [
  "https://vega.github.io/vega-datasets/data/india-districts.json",
  "https://raw.githubusercontent.com/vega/vega-datasets/main/data/india-districts.json",
  "https://raw.githubusercontent.com/datameet/maps/master/Districts/india_district.geojson",
  "https://raw.githubusercontent.com/datameet/india-geojson/master/geojson/india_district.geojson"
];

async function loadPunjabFeatures() {
  // Use the generic fetchFirst and normalize both TopoJSON & GeoJSON
  const geo = await fetchFirst(PUNJAB_DISTRICT_URLS);
  if (!geo) return [];

  let features;
  if (geo.type === "Topology") {
    const key = Object.keys(geo.objects || {})[0];
    if (!key || !window.topojson) return [];
    features = topojson.feature(geo, geo.objects[key]).features || [];
  } else {
    features = geo.features || [];
  }

  // Filter to Punjab by common state keys; if none, assume already Punjab-only
  const STATE_KEYS = ["ST_NM","st_nm","STATE","state","state_name","State_Name","STATE_UT","NAME_1","stname"];
  const probe = features[0]?.properties || {};
  const sKey = STATE_KEYS.find(k => k in probe);

  return sKey
    ? features.filter(f => String(f.properties?.[sKey]).toLowerCase() === "punjab")
    : features;
}

function openDistrictPanel(){ document.getElementById("districtPanel")?.classList.remove("hidden"); }
function closeDistrictPanel(){ document.getElementById("districtPanel")?.classList.add("hidden"); }

/* Back button UX: hide India maps while panel is open */
function showPunjabPanelAndHideIndia(){
  const d = document.getElementById("districtPanel");
  if (d) d.classList.remove("hidden");

  document.getElementById("indiaMapDay1")?.classList.add("hidden");
  document.getElementById("indiaMapDay2")?.classList.add("hidden");

  let back = document.getElementById("dp-back");
  if (!back){
    back = document.createElement("button");
    back.id = "dp-back";
    back.textContent = "← Back to India";
    Object.assign(back.style,{margin:"8px 0 10px", padding:"6px 12px", borderRadius:"9999px", border:"1px solid #d1d5db", background:"#fff"});
    d.prepend(back);
    back.addEventListener("click", ()=>{
      d.classList.add("hidden");
      document.getElementById("indiaMapDay1")?.classList.remove("hidden");
      document.getElementById("indiaMapDay2")?.classList.remove("hidden");
    });
  }
}

document.addEventListener("click", e=>{
  if (e.target?.id==="dp-close"){
    closeDistrictPanel();
    document.getElementById("indiaMapDay1")?.classList.remove("hidden");
    document.getElementById("indiaMapDay2")?.classList.remove("hidden");
  }
});
document.addEventListener("change", e=>{ if (e.target?.name==="dp-day") openPunjabDistrictView(e.target.value); });

/* === STATIC cache: one set of labels per IST day === */
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

/* compute labels for all districts ONCE per day */
async function computePunjabLabelsIfNeeded(feats, keyName){
  const today = istDateKey();
  if (PUNJAB_DAY_CACHE.date !== today) {
    PUNJAB_DAY_CACHE = { date: today, byKey: new Map() };
  }
  const cache = PUNJAB_DAY_CACHE.byKey;

  for (const f of feats){
    const key = String(f.properties[keyName] ?? f.properties.DISTRICT ?? f.properties.NAME ?? "").trim();
    if (!key) continue;
    if (!cache.has(key)) {
      const [lon, lat] = d3.geoCentroid(f);
      const { d1, d2 } = await fetchHourlyCloudBuckets(lat, lon);
      cache.set(key, { day1: d1, day2: d2 });
    }
    f.properties._labels = cache.get(key);
  }
}

// Use loadPunjabFeatures() (no local fetch/404s)
async function openPunjabDistrictView(dayKey){
  const svg = d3.select("#punjabDistrictMap"); if (svg.empty()) return;
  svg.selectAll("*").remove();

  // Load + filter using the robust loader
  const feats = await loadPunjabFeatures();
  if (!feats.length) throw new Error("No district features.");

  const sampleProps = feats[0]?.properties || {};
  const DIST_KEY = findDistrictNameKey(sampleProps);

  // compute & cache labels ONLY if needed for today's date
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
    .on("pointerleave", function(){
      d3.select(this).attr("stroke-width", 0.8);
      panelTooltip.style("opacity", 0);
    })
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
      const pad = 12, vw = window.innerWidth, vh = window.innerHeight;
      const ttW = 260, ttH = 56;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + ttW > vw) x = vw - ttW - pad;
      if (y + ttH > vh) y = vh - ttH - pad;
      panelTooltip.style("opacity", 1).html(html).style("left", x + "px").style("top", y + "px");
    })
    .on("click", async (_ev, d) => {
      const name = String(d?.properties?.[DIST_KEY] || "").trim() || "District";
      const [lon, lat] = d3.geoCentroid(d);
      await drawDistrictCharts(name, lat, lon);
    });

  const icons = svg.append("g").attr("class","punjab-icons").style("pointer-events","none");
  const dayRadio = document.querySelector('input[name="dp-day"]:checked');
  const day = dayKey || (dayRadio ? dayRadio.value : "day1");

  // Color districts from the CACHED labels
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

  // legend inside panel
  const host = d3.select(".dp-legend"); host.selectAll("*").remove();
  const labs = Object.keys(window.forecastColors||{});
  const leg = host.append("svg").attr("width",300).attr("height", 12 + labs.length*20);
  labs.forEach((lab,i)=>{
    const y = 12 + i*20;
    leg.append("rect").attr("x",8).attr("y",y-10).attr("width",14).attr("height",14)
      .attr("fill", (window.forecastColors||{})[lab]||"#eee").attr("stroke","#999");
    leg.append("text").attr("x",28).attr("y",y+2).attr("font-size",12).text(lab);
  });

  const ttl = document.getElementById("dp-title");
  if (ttl) ttl.textContent = "Punjab — District Forecast";
  openDistrictPanel();

  // Preload panel charts with Punjab center once
  await drawDistrictCharts("Punjab", 31.0, 75.3);
}

/* ---------------- Daily rollover at IST midnight ---------------- */
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
  clearPunjabCache();                      // invalidate district cache
  await autoFillDailyFromOpenMeteo().catch(() => {});
  updateMapColors();

  const panel = document.getElementById("districtPanel");
  if (panel && !panel.classList.contains("hidden")) {
    const day = document.querySelector('input[name="dp-day"]:checked')?.value || "day1";
    await openPunjabDistrictView(day);     // recompute once for the new day
  }
}

function scheduleDailyRollover() {
  if (__rolloverTimer) clearTimeout(__rolloverTimer);
  if (__periodicTimer) clearInterval(__periodicTimer);

  __rolloverTimer = setTimeout(async () => {
    await doDailyRefresh();
    scheduleDailyRollover(); // schedule the next day
  }, msUntilNextISTMidnight() + 2000);

  // Safety refresh every 6 hours (in case the tab slept through midnight)
  __periodicTimer = setInterval(doDailyRefresh, 6 * 60 * 60 * 1000);
}

/* ---------------- Init ---------------- */
function init(){
  if (typeof updateISTDate === "function") updateISTDate();
  buildCloudTable();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
  scheduleDailyRollover(); // keep the page “daily”
}
document.addEventListener("DOMContentLoaded", init);

/* --- (older helper kept for compat; unused if data-readonly="true") --- */
async function fetchHourlyCloud(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloud_cover&forecast_hours=48&timezone=Asia%2FKolkata&_=${Date.now()}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  const arr = j?.hourly?.cloud_cover || [];
  const mean = a => a.reduce((s,x)=>s+(x??0),0)/a.length;
  const d1 = bucketFromPct(mean(arr.slice(0,24)));
  const d2 = bucketFromPct(mean(arr.slice(24,48)));
  return { d1, d2 };
}

async function autoFillDaily() {
  if (!document.body.classList.contains("auto-daily")) return;
  const centroids = {
    "Punjab": { lat: 30.84285, lon: 75.41854 },
    "W-Raj": { lat: 27.15893, lon: 72.70219 },
    "E-Raj": { lat: 25.81073, lon: 75.39164 }
  };
  const results = {};
  for (const [name, {lat,lon}] of Object.entries(centroids)) {
    try { results[name] = await fetchHourlyCloud(lat,lon); }
    catch(e){ console.warn("fetch fail", name, e); }
  }
  if (results["W-Raj"] && results["E-Raj"]) {
    const rank = {"Clear Sky":0,"Low Cloud Cover":1,"Medium Cloud Cover":2,"High Cloud Cover":3,"Overcast Cloud Cover":4};
    results["Rajasthan"] = {
      d1: rank[results["W-Raj"].d1] >= rank[results["E-Raj"].d1] ? results["W-Raj"].d1 : results["E-Raj"].d1,
      d2: rank[results["W-Raj"].d2] >= rank[results["E-Raj"].d2] ? results["W-Raj"].d2 : results["E-Raj"].d2
    };
  }
  document.querySelectorAll("#forecast-table-body tr").forEach(tr => {
    const st = tr.dataset.state;
    const s1 = tr.querySelectorAll("select")[0];
    const s2 = tr.querySelectorAll("select")[1];
    if (results[st]) {
      s1.value = results[st].d1;
      s2.value = results[st].d2;
      s1.disabled = true; s2.disabled = true;
    }
  });
  updateMapColors();
}
window.addEventListener("load", autoFillDaily);
