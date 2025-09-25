/* ========= Hourly page (robust fetch + adaptive map + Punjab drill-down + outline/points fallback) ========= */
const IST_TZ = "Asia/Kolkata";
const MAX_HOURS = 48;
const W = 860, H = 620, PAD = 18;

const STATUS = (msg) => {
  const el = document.getElementById("status");
  if (!el) return;
  if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.textContent = msg; el.classList.remove("hidden");
};

/* ---- Regions on India view (centroids for API) ---- */
const CENTROIDS = {
  "Punjab":         { lat: 30.84284696845263, lon: 75.41854251284677 },
  "West Rajasthan": { lat: 27.1589259099715,  lon: 72.70218563309521 },
  "East Rajasthan": { lat: 25.810727217600284,lon: 75.39163711411086 }
};

const COLORS = (window.forecastColors || {
  "Clear Sky":"#66CCFF",
  "Low Cloud Cover":"#57E66D",
  "Medium Cloud Cover":"#FFF500",
  "High Cloud Cover":"#FF8A00",
  "Overcast Cloud Cover":"#FF0000"
});

/* ---------- Helpers ---------- */
const fmtIST = s => new Date(s).toLocaleString("en-IN", {hour:"2-digit", minute:"2-digit", weekday:"short", day:"2-digit", month:"short", hour12:true, timeZone: IST_TZ});
const bucketFromPct = p => (p<10)?"Clear Sky":(p<30)?"Low Cloud Cover":(p<50)?"Medium Cloud Cover":(p<75)?"High Cloud Cover":"Overcast Cloud Cover";
const norm = s => String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const getParam = k => new URLSearchParams(location.search).get(k);

function updateNowIST(){
  const el = document.getElementById("now-ist");
  if (!el) return;
  el.textContent = new Date().toLocaleString("en-IN",{
    timeZone: IST_TZ, hour:'2-digit', minute:'2-digit', weekday:'long', year:'numeric', month:'long', day:'numeric', hour12:true
  });
}
function setHourLabel(times){
  const el = document.getElementById("hourLabel");
  if (!el) return;
  const t = times?.[HOUR_IDX];
  el.textContent = t ? fmtIST(t) : "—";
}
function setSeriesName(){
  const el = document.getElementById("seriesName");
  if (!el) return;
  el.textContent = (MODE==="punjabDistrict" && CURRENT_DISTRICT) ? CURRENT_DISTRICT : "ensemble";
}

/* ---------- Fetchers ---------- */
function buildOMUrl(lat,lon,parts="hourly=cloud_cover&forecast_hours=48"){
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${parts}&timezone=${encodeURIComponent(IST_TZ)}`;
}
async function fetchOpenMeteo(lat, lon){
  const uHours = buildOMUrl(lat,lon,"hourly=cloud_cover&forecast_hours=48");
  const uSun   = buildOMUrl(lat,lon,"daily=sunrise,sunset&forecast_days=3");
  const [rh, rs] = await Promise.allSettled([
    fetch(uHours,{cache:"no-store", mode:"cors"}),
    fetch(uSun,{cache:"no-store", mode:"cors"})
  ]);
  if (rh.status!=="fulfilled" || !rh.value.ok) throw new Error("Open-Meteo hourly failed");
  const jh = await rh.value.json();

  let sunrise=[], sunset=[];
  if (rs.status==="fulfilled" && rs.value.ok){
    const js = await rs.value.json();
    sunrise = js?.daily?.sunrise || []; sunset = js?.daily?.sunset || [];
  }

  const times = (jh.hourly?.time || []).slice(0,MAX_HOURS);
  const vals  = (jh.hourly?.cloud_cover || []).slice(0,MAX_HOURS).map(v=>+v||0);
  return { times, vals, sunrise, sunset };
}

// Optional: OpenWeatherMap OneCall (?owm=KEY)
async function fetchOpenWeatherMap(lat, lon){
  const key = getParam("owm") || window.OWM_KEY;
  if (!key) return null;
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=current,minutely,daily,alerts&appid=${key}`;
  try{
    const r = await fetch(url, { cache:"no-store", mode:"cors" });
    if (!r.ok) throw new Error("OWM not ok");
    const j = await r.json();
    const hours = (j.hourly||[]).slice(0,MAX_HOURS);
    return { vals: hours.map(h => Number(h.clouds)||0) };
  }catch{ return null; }
}

function ensembleSeries(a, b){
  const out = [];
  for (let i=0;i<Math.min(MAX_HOURS, a.length);i++){
    const x=a[i], y=(b && Number.isFinite(b[i]))?b[i]:null;
    out.push(y==null?x:(x+y)/2);
  }
  return out;
}

/* ---------- Store / State ---------- */
const DATA = {}; // key -> {times, pct, buckets, om, owm}
let HOUR_IDX = 0;
let VIEW = "24"; // 24|48|all
let REGION = "Punjab";
let MODE = "india"; // or "punjabDistrict"
let CURRENT_DISTRICT = null;

/* ---------- Table + Legend ---------- */
function buildCloudTableAndLegend(){
  const rows = [
    { cover: "0–10 %",  label: "Clear Sky",            type: "No Cloud" },
    { cover: "10–30 %", label: "Low Cloud Cover",      type: "Few Clouds" },
    { cover: "30–50 %", label: "Medium Cloud Cover",   type: "Scattered / Partly Cloudy" },
    { cover: "50–75 %", label: "High Cloud Cover",     type: "Broken / Mostly Cloudy" },
    { cover: "75–100 %",label: "Overcast Cloud Cover", type: "Cloudy / Overcast" }
  ];
  const tb = document.getElementById("cloudTbody"); if (tb) {
    tb.innerHTML = "";
    rows.forEach((r,i)=>{
      const tr = document.createElement("tr");
      tr.style.background = COLORS[r.label] || "#fff";
      tr.innerHTML = `<td class="px-3 py-2">${i+1}</td>
        <td class="px-3 py-2">${r.cover}</td>
        <td class="px-3 py-2 font-semibold">${r.label}</td>
        <td class="px-3 py-2">${r.type}</td>`;
      tb.appendChild(tr);
    });
  }

  // keep the "Index — Day 1" header; only (re)build legend items
  const legend = document.getElementById("mapLegend");
  if (legend){
    legend.querySelectorAll(".legend-item").forEach(n => n.remove());
    Object.entries(COLORS).forEach(([k,v])=>{
      const div = document.createElement("div");
      div.className = "legend-item";
      div.innerHTML = `<span class="legend-swatch" style="background:${v}"></span><span>${k}</span>`;
      legend.appendChild(div);
    });
  }
}

/* ---------- Charts ---------- */
function rangeForView(total){
  if (VIEW==="all") return {s:0,e:Math.min(MAX_HOURS,total)};
  if (VIEW==="48")  return {s:24,e:Math.min(48,total)};
  return {s:0,e:Math.min(24,total)};
}
function drawLineChart(sel, series, options){
  const svg = d3.select(sel);
  svg.selectAll("*").remove();
  const vb = svg.attr("viewBox").split(/\s+/).map(Number);
  const width = vb[2], height = vb[3], m = {t:18,r:12,b:28,l:36};
  const show = rangeForView(series.length);

  const xs = d3.scaleLinear().domain([show.s, show.e-1]).range([m.l, width-m.r]);
  const ys = d3.scaleLinear().domain([0, options.yMax||100]).nice().range([height-m.b, m.t]);

  const ax = g => g.attr("class","axis").call(d3.axisBottom(xs).ticks(8).tickFormat(i=>{
    const src = (MODE==="punjabDistrict" && CURRENT_DISTRICT) ? DATA[CURRENT_DISTRICT] : DATA[REGION];
    const t = src?.times?.[Math.round(i)];
    if (!t) return "";
    return new Date(t).toLocaleString("en-IN",{ hour:'2-digit', hour12:true, timeZone: IST_TZ });
  }));
  const ay = g => g.attr("class","axis").call(d3.axisLeft(ys).ticks(5));

  svg.append("g").attr("transform",`translate(0,${height-m.b})`).call(ax);
  svg.append("g").attr("transform",`translate(${m.l},0)`).call(ay);

  if (options.dayBand){
    const band = [[6,18],[30,42]];
    svg.append("g").selectAll("rect").data(band).join("rect")
      .attr("x", d => xs(Math.max(show.s, d[0])))
      .attr("y", m.t)
      .attr("width", d => Math.max(0, xs(Math.min(show.e, d[1])) - xs(Math.max(show.s, d[0]))))
      .attr("height", height-m.t-m.b).attr("fill", "#e5f0ff").attr("opacity", .4);
  }

  const line = d3.line()
    .x((_,i)=> xs(i)).y(v => ys(v))
    .defined((v,i)=> i>=show.s && i<show.e && Number.isFinite(v));

  svg.append("path")
    .attr("fill","none").attr("stroke", options.stroke || "#3b82f6").attr("stroke-width", 2.2)
    .attr("d", line(series));

  if (HOUR_IDX>=show.s && HOUR_IDX<show.e && Number.isFinite(series[HOUR_IDX])){
    svg.append("circle").attr("cx", xs(HOUR_IDX)).attr("cy", ys(series[HOUR_IDX])).attr("r", 4).attr("fill","#111827");
  }
}
function repaintCharts(){
  const src = (MODE==="punjabDistrict" && CURRENT_DISTRICT) ? DATA[CURRENT_DISTRICT] : DATA[REGION];
  if (!src) return;
  const sourceTxt = ["Open-Meteo", (src.owm ? "OpenWeatherMap" : null)].filter(Boolean).join(" + ");
  const tag = document.getElementById("sourceTags"); if (tag) tag.textContent = `Sources: ${sourceTxt}`;
  drawLineChart("#cloudChart", src.pct, { yMax:100, dayBand:true, stroke:"#0ea5e9" });
  const ghi = src.pct.map((p,i)=> ((i%24)>=6 && (i%24)<=18) ? (950*(1 - (p/100))) : 0);
  drawLineChart("#ghiChart", ghi, { yMax:1000, dayBand:true, stroke:"#10b981" });
  setSeriesName();
}

/* ---------- Maps (adaptive) ---------- */
const INDIA_GEO_URLS = [
  "indian_met_zones.geojson",
  "assets/indian_met_zones.geojson",
  "bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/bulletin_version_2/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/india.geojson",
  "https://rimtin.github.io/weather_bulletin/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/rimtin/weather_bulletin/main/indian_met_zones.geojson",
  "https://cdn.jsdelivr.net/gh/rimtin/weather_bulletin@main/indian_met_zones.geojson"
];

/* Punjab districts – try districts first; then your state outline; then local fallbacks */
const PUNJAB_DISTRICT_URLS = [
  "https://raw.githubusercontent.com/datameet/maps/master/State/Punjab/punjab_districts.geojson",
  "https://raw.githubusercontent.com/datameet/maps/master/State/Punjab/districts.geojson",
  "https://raw.githubusercontent.com/datameet/india-geojson/master/geojson/india_district.geojson",
  "https://raw.githubusercontent.com/datameet/india-geojson/master/geojson/india_districts.geojson",

  // your file (state outline)
  "/bulletin_version_2/app/punjab.geojson",

  // optional local copies
  "/bulletin_version_2/punjab_districts.geojson",
  "punjab_districts.geojson",
  "assets/punjab_districts.geojson"
];

/* Final fallback: clickable centroids for each Punjab district */
const PUNJAB_DISTRICT_POINTS = [
  { name:"Amritsar", lat:31.634, lon:74.873 },
  { name:"Tarn Taran", lat:31.451, lon:74.921 },
  { name:"Gurdaspur", lat:32.042, lon:75.405 },
  { name:"Pathankot", lat:32.273, lon:75.652 },
  { name:"Kapurthala", lat:31.379, lon:75.385 },
  { name:"Jalandhar", lat:31.326, lon:75.576 },
  { name:"Hoshiarpur", lat:31.532, lon:75.911 },
  { name:"SBS Nagar (Nawanshahr)", lat:31.120, lon:76.109 },
  { name:"Ludhiana", lat:30.901, lon:75.857 },
  { name:"Fatehgarh Sahib", lat:30.644, lon:76.401 },
  { name:"Rupnagar (Ropar)", lat:30.968, lon:76.525 },
  { name:"SAS Nagar (Mohali)", lat:30.704, lon:76.717 },
  { name:"Moga", lat:30.818, lon:75.174 },
  { name:"Faridkot", lat:30.676, lon:74.754 },
  { name:"Firozpur", lat:30.923, lon:74.613 },
  { name:"Sri Muktsar Sahib", lat:30.474, lon:74.516 },
  { name:"Fazilka", lat:30.407, lon:74.028 },
  { name:"Bathinda", lat:30.210, lon:74.945 },
  { name:"Mansa", lat:29.998, lon:75.401 },
  { name:"Barnala", lat:30.375, lon:75.546 },
  { name:"Sangrur", lat:30.246, lon:75.842 },
  { name:"Patiala", lat:30.339, lon:76.386 }
];

let mapSvg=null, mapIndex = new Map(), STATE_KEY="ST_NM";
let districtCentroidByName = new Map();

function ensureTooltip(){
  const ex = d3.select(".map-tooltip");
  return ex.empty() ? d3.select("body").append("div").attr("class","map-tooltip").style("opacity",0) : ex;
}
function detectKeys(features){
  const sample = features[0]?.properties||{};
  const sKeys=["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","stname","State","state"];
  const dKeys=["DISTRICT","district","dtname","name","NAME_2","Name","dist_name"];
  return { STATE_KEY: sKeys.find(k=>k in sample)||"ST_NM", NAME_KEY: dKeys.find(k=>k in sample)||"name" };
}
async function fetchFirst(urls){
  for (const u of urls){
    try{
      const r = await fetch(u,{cache:"no-store", mode:"cors"});
      if (r.ok) { console.log("[GeoJSON OK]", u); return await r.json(); }
      console.warn("[GeoJSON fail]", r.status, u);
    }catch(err){
      console.warn("[GeoJSON error]", u, err?.message || err);
    }
  }
  return null; // allow fallback to outline/points
}
function adaptiveProjection(fc){
  const [[minX,minY],[maxX,maxY]] = d3.geoBounds(fc);
  const isLonLat = (maxX-minX) < 200 && (maxY-minY) < 120;
  return isLonLat
    ? d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]],fc)
    : d3.geoIdentity().reflectY(true).fitExtent([[PAD,PAD],[W-PAD,H-PAD]],fc);
}

/* --------- India view --------- */
async function drawIndia(){
  MODE = "india"; CURRENT_DISTRICT = null;
  const back = document.getElementById("btnBack"); if (back) back.classList.add("hidden");
  const title = document.getElementById("mapTitle"); if (title) title.textContent = "India — selected hour";

  const svg = d3.select("#indiaMapHourly"); mapSvg = svg;
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diag").attr("patternUnits","userSpaceOnUse").attr("width",6).attr("height",6)
    .append("path").attr("d","M0,0 l6,6").attr("stroke","#9ca3af").attr("stroke-width",1);

  let features=[];
  try{
    const geo = await fetchFirst(INDIA_GEO_URLS);
    if (!geo) throw new Error("No India GeoJSON");
    features = (geo.type==="Topology") ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features : (geo.features||[]);
  }catch(e){ STATUS("India GeoJSON could not be loaded."); return; }
  if (!features.length){ STATUS("India GeoJSON has 0 features."); return; }

  ({STATE_KEY} = detectKeys(features));
  const fc = { type:"FeatureCollection", features };
  const projection = adaptiveProjection(fc);
  const path = d3.geoPath(projection);

  const allowed = new Set(["punjab","west rajasthan","east rajasthan"]);
  const tt = ensureTooltip();

  const g = svg.append("g");
  const paths = g.selectAll("path").data(features).join("path")
    .attr("class","subdiv").attr("d", path)
    .attr("fill","url(#diag)").attr("stroke","#666").attr("stroke-width",.7)
    .style("cursor","pointer")
    .on("pointermove", function(evt,d){
      const raw = d?.properties?.[STATE_KEY] ?? "";
      const key = norm(raw);
      if (!allowed.has(key)) { tt.style("opacity",0); return; }
      const pad=12, w=200, h=40, vw=innerWidth, vh=innerHeight;
      let x=evt.clientX+pad, y=evt.clientY+pad; if(x+w>vw)x=vw-w-pad; if(y+h>vh)y=vh-h-pad;
      tt.style("opacity",1).html(raw).style("left",x+"px").style("top",y+"px");
    }).on("pointerleave", ()=>tt.style("opacity",0))
    .on("click", (_,d)=>{
      const name = norm(d?.properties?.[STATE_KEY]||"");
      if (name==="punjab") drawPunjabDistricts();
    });

  mapIndex.clear();
  paths.each(function(d){
    const key = norm(String(d.properties?.[STATE_KEY]||""));
    (mapIndex.get(key) || mapIndex.set(key,[]).get(key)).push(this);
  });

  colorIndiaForHour();
}
function colorIndiaForHour(){
  if (!mapSvg) return;
  mapSvg.selectAll(".subdiv").attr("fill", "url(#diag)");
  const set = [
    ["punjab",         DATA["Punjab"]?.buckets?.[HOUR_IDX]],
    ["west rajasthan", DATA["West Rajasthan"]?.buckets?.[HOUR_IDX]],
    ["east rajasthan", DATA["East Rajasthan"]?.buckets?.[HOUR_IDX]],
  ];
  set.forEach(([k,b])=>{
    const nodes = mapIndex.get(k); if (!nodes || !b) return;
    nodes.forEach(n => n.setAttribute("fill", COLORS[b] || "#eee"));
  });
}

/* --------- Punjab districts (polygons if available; otherwise outline+points or points) --------- */
let districts=[], DKEY="name";

function filterToPunjab(features){
  if (!features?.length) return [];
  const { STATE_KEY: SKEY } = detectKeys(features);
  const isPunjab = v => String(v||"").toLowerCase() === "punjab";
  const stateVals = new Set(features.map(f => String(f.properties?.[SKEY]||"").toLowerCase()));
  if (stateVals.size === 1 && isPunjab([...stateVals][0])) return features;
  return features.filter(f => isPunjab(f.properties?.[SKEY]));
}

async function drawPunjabDistricts(){
  MODE = "punjabDistrict";
  const back = document.getElementById("btnBack"); if (back) back.classList.remove("hidden");
  const title = document.getElementById("mapTitle"); if (title) title.textContent = "Punjab districts — click a district";

  const svg = d3.select("#indiaMapHourly"); mapSvg = svg;
  svg.selectAll("*").remove();

  let feats = [];
  const raw = await fetchFirst(PUNJAB_DISTRICT_URLS);

  // Try to extract features if we got a GeoJSON/TopoJSON file
  if (raw){
    if (raw.type === "Topology"){
      const obj = raw.objects?.districts || raw.objects?.Districts || raw.objects[Object.keys(raw.objects)[0]];
      feats = topojson.feature(raw, obj).features || [];
    } else if (raw.type === "Feature"){
      feats = [raw]; // single state outline
    } else {
      feats = raw.features || [];
    }
  }

  // If this file is all-India districts, filter to just Punjab
  if (feats.length > 1) {
    feats = filterToPunjab(feats);
  }

  // District polygons available?
  if (feats && feats.length >= 5){
    const guess = detectKeys(feats);
    DKEY = guess.NAME_KEY;

    const fc = { type:"FeatureCollection", features: feats };
    const projection = adaptiveProjection(fc);
    const path = d3.geoPath(projection);
    const tt = ensureTooltip();
    districtCentroidByName.clear();

    const g = svg.append("g");
    const paths = g.selectAll("path").data(feats).join("path")
      .attr("class","district").attr("d", path)
      .attr("fill","#f3f4f6").attr("stroke","#666").attr("stroke-width",.8)
      .style("cursor","pointer")
      .on("pointermove", function(evt,d){
        const raw = String(d?.properties?.[DKEY]||"");
        const pad=12, w=240, h=40, vw=innerWidth, vh=innerHeight;
        let x=evt.clientX+pad, y=evt.clientY+pad; if(x+w>vw)x=vw-w-pad; if(y+h>vh)y=vh-h-pad;
        tt.style("opacity",1).html(raw).style("left",x+"px").style("top",y+"px");
      }).on("pointerleave", ()=>tt.style("opacity",0))
      .on("click", async (_,d)=>{
        const label = String(d?.properties?.[DKEY]||"").trim();
        if (!label) return;
        CURRENT_DISTRICT = label;
        const c = path.centroid(d), lonlat = projection.invert(c);
        if (!lonlat) return;
        await loadSeriesForPoint(label, lonlat[1], lonlat[0]);
        colorPunjabForHour();
        repaintCharts();
      });

    // cache centroids
    paths.each(function(d){
      const label = String(d?.properties?.[DKEY]||"").trim();
      const lonlat = projection.invert(path.centroid(d));
      if (label && lonlat) districtCentroidByName.set(label, {lat:lonlat[1], lon:lonlat[0]});
    });

    districts = feats;
    colorPunjabForHour();
    STATUS("");
    return;
  }

  // --- Outline or no polygons: render state outline (if present) + clickable points ---
  const outlineFC = (feats && feats.length)
      ? { type: "FeatureCollection", features: feats }
      : { type: "FeatureCollection", features: [] };

  const fcForFit = outlineFC.features.length
      ? outlineFC
      : { // no outline? fit to points instead
          type: "FeatureCollection",
          features: PUNJAB_DISTRICT_POINTS.map(p => ({
            type:"Feature",
            geometry:{ type:"Point", coordinates:[p.lon, p.lat] },
            properties:{}
          }))
        };

  const projection = d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fcForFit);
  const path = d3.geoPath(projection);
  districtCentroidByName.clear();

  // draw outline if we have it
  if (outlineFC.features.length){
    svg.append("g")
      .selectAll("path")
      .data(outlineFC.features)
      .join("path")
      .attr("d", path)
      .attr("fill", "#f8fafc")
      .attr("stroke", "#64748b")
      .attr("stroke-width", 1);
  }

  // points fallback (clickable districts)
  const g = svg.append("g");
  function paintPoints(){
    g.selectAll("g.pt").remove();
    PUNJAB_DISTRICT_POINTS.forEach(p=>{
      const series = DATA[p.name];
      const b = series?.buckets?.[HOUR_IDX];
      const clr = b ? (COLORS[b] || "#94a3b8") : "#94a3b8";
      const [x,y] = projection([p.lon, p.lat]);

      const node = g.append("g").attr("class","pt").attr("transform",`translate(${x},${y})`).style("cursor","pointer");
      node.append("circle").attr("r",8).attr("fill",clr).attr("stroke","#374151").attr("stroke-width",1);
      node.append("circle").attr("r",2).attr("fill","#111827");
      node.append("text").attr("x",12).attr("y",4).attr("font-size","11px").attr("font-weight","700").attr("fill","#111827").text(p.name);

      node.on("click", async ()=>{
        CURRENT_DISTRICT = p.name;
        await loadSeriesForPoint(p.name, p.lat, p.lon);
        paintPoints();
        repaintCharts();
      });
    });
  }

  paintPoints();
  (async ()=>{ for (const p of PUNJAB_DISTRICT_POINTS){ try{ await loadSeriesForPoint(p.name, p.lat, p.lon); }catch{} } paintPoints(); })();

  // when hour changes, repaint dots
  const obs = new MutationObserver(paintPoints);
  obs.observe(document.getElementById("hourLabel"), { childList:true });
}

function colorPunjabForHour(){
  if (MODE!=="punjabDistrict" || !mapSvg) return;
  mapSvg.selectAll(".district").attr("fill", d=>{
    const label = String(d?.properties?.[DKEY]||"").trim();
    const series = DATA[label];
    if (!series) return "#e5e7eb";
    const b = series.buckets?.[HOUR_IDX];
    return b ? (COLORS[b] || "#e5e7eb") : "#e5e7eb";
  });
}

/* ---------- Data load ---------- */
async function loadSeriesForPoint(keyName, lat, lon){
  if (DATA[keyName]) return DATA[keyName];
  try{
    const om = await fetchOpenMeteo(lat,lon);
    const owm = await fetchOpenWeatherMap(lat,lon); // optional
    const pct = ensembleSeries(om.vals, owm?.vals);
    DATA[keyName] = {
      times: om.times, om: om.vals, owm: owm?.vals || null,
      pct, buckets: pct.map(bucketFromPct)
    };
    return DATA[keyName];
  }catch(e){
    STATUS(`Data load failed for ${keyName}. Trying again later…`);
    throw e;
  }
}

async function refreshIndiaSeries(){
  const names = Object.keys(CENTROIDS);
  const results = await Promise.allSettled(names.map(async n=>{
    const c = CENTROIDS[n];
    return loadSeriesForPoint(n, c.lat, c.lon);
  }));
  if (!results.some(r=>r.status==="fulfilled")) throw new Error("All regions failed");

  // Rajasthan from W/E max
  const wr = DATA["West Rajasthan"], er = DATA["East Rajasthan"];
  if (wr && er){
    const len = Math.min(wr.pct.length, er.pct.length);
    const rz = Array.from({length:len}, (_,i)=> Math.max(wr.pct[i], er.pct[i]));
    DATA["Rajasthan"] = {
      times: (DATA["Punjab"]?.times || wr.times).slice(0,len),
      pct: rz,
      buckets: rz.map(bucketFromPct)
    };
  }
}

/* ---------- Repaint ---------- */
function repaintAll(){
  const src = (MODE==="punjabDistrict" && CURRENT_DISTRICT) ? DATA[CURRENT_DISTRICT] : DATA[REGION];
  setHourLabel(src?.times);
  if (MODE==="india") colorIndiaForHour(); else {
    try { colorPunjabForHour(); } catch {}
  }
  repaintCharts();
}

/* ---------- Startup & wiring ---------- */
async function startHourly(){
  try{
    updateNowIST(); setInterval(updateNowIST, 60000);
    buildCloudTableAndLegend();

    await drawIndia();

    try{
      await refreshIndiaSeries();
      STATUS("");
    }catch(e){
      STATUS("Could not load hourly data. (Open-Meteo may be unreachable.) The page will retry on Refresh.");
    }

    repaintAll();

    // controls
    const slider = document.getElementById("hourSlider");
    if (slider){
      let t=null;
      slider.addEventListener("input", e=>{
        HOUR_IDX = +e.target.value;
        clearTimeout(t); t=setTimeout(repaintAll,60);
      });
    }
    const btn24 = document.getElementById("btn24"); if (btn24) btn24.addEventListener("click", ()=>{ VIEW="24"; repaintCharts(); });
    const btn48 = document.getElementById("btn48"); if (btn48) btn48.addEventListener("click", ()=>{ VIEW="48"; repaintCharts(); });
    const btnAll = document.getElementById("btnAll"); if (btnAll) btnAll.addEventListener("click", ()=>{ VIEW="all"; repaintCharts(); });
    const regionSel = document.getElementById("regionSelect");
    if (regionSel) regionSel.addEventListener("change", e=>{ REGION = e.target.value; if (MODE==="india") repaintAll(); });
    const btnRefresh = document.getElementById("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", async ()=>{
      try{
        if (MODE==="india") await refreshIndiaSeries();
        else if (MODE==="punjabDistrict" && CURRENT_DISTRICT){
          const c = districtCentroidByName.get(CURRENT_DISTRICT);
          if (c) await loadSeriesForPoint(CURRENT_DISTRICT, c.lat, c.lon);
        }
        STATUS(""); repaintAll();
      }catch{ STATUS("Refresh failed. Please try again."); }
    });
    const satBtn = document.getElementById("satBtn");
    if (satBtn) satBtn.addEventListener("click", ()=> window.open("https://zoom.earth/#view=22.5,79.0,5z/layers=labels,clouds","_blank","noopener"));
    const backBtn = document.getElementById("btnBack");
    if (backBtn) backBtn.addEventListener("click", async ()=>{ await drawIndia(); repaintAll(); });

    // auto refresh hourly
    setInterval(async ()=>{
      try{
        if (MODE==="india") await refreshIndiaSeries();
        else if (MODE==="punjabDistrict" && CURRENT_DISTRICT){
          const c = districtCentroidByName.get(CURRENT_DISTRICT);
          if (c) await loadSeriesForPoint(CURRENT_DISTRICT, c.lat, c.lon);
        }
        STATUS(""); repaintAll();
      }catch{ STATUS("Auto-refresh failed; will try again next hour."); }
    }, 60*60*1000);
  }catch(err){
    STATUS("Init error: " + (err?.message || String(err)));
  }
}

/* Run whether DOM is ready or already parsed */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startHourly);
} else {
  startHourly();
}

/* --- error surfacing --- */
window.addEventListener("error", e => STATUS("Error: " + e.message));
window.addEventListener("unhandledrejection", e => STATUS("Error: " + (e.reason?.message || e.reason)));
