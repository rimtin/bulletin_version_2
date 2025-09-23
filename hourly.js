/* ========= Hourly page (robust fetch + adaptive map + Punjab drill-down) ========= */
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
  "Clear Sky":"#66CCFF","Low Cloud Cover":"#57E66D","Medium Cloud Cover":"#FFF500","High Cloud Cover":"#FF8A00","Overcast Cloud Cover":"#FF0000"
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

/* ---------- Fetchers (robust) ---------- */
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

  // sunrise/sunset optional
  let sunrise=[], sunset=[];
  if (rs.status==="fulfilled" && rs.value.ok){
    const js = await rs.value.json();
    sunrise = js?.daily?.sunrise || []; sunset = js?.daily?.sunset || [];
  }

  const times = (jh.hourly?.time || []).slice(0,MAX_HOURS);
  const vals  = (jh.hourly?.cloud_cover || []).slice(0,MAX_HOURS).map(v=>+v||0);
  return { times, vals, sunrise, sunset };
}

// Optional: OpenWeatherMap OneCall (needs ?owm=KEY). Uses clouds% from hourly.
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
  }catch{ return null; } // silently ignore OWM problems
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
  const legend = document.getElementById("mapLegend"); if (legend){
    legend.innerHTML = "";
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

/* Punjab districts: try state-only files first, then fall back to all-India districts */
const PUNJAB_DISTRICT_URLS = [
  "punjab_districts.geojson",
  "assets/punjab_districts.geojson",
  "https://raw.githubusercontent.com/datameet/india-geojson/master/state/punjab/punjab_districts.geojson",
  "https://raw.githubusercontent.com/datameet/maps/master/State/Punjab/punjab_districts.geojson",
  "https://raw.githubusercontent.com/nisrulz/india-geojson/master/india_districts.geojson" // full India -> we'll filter
];

let mapSvg=null, mapIndex = new Map(), STATE_KEY="ST_NM";
let districtCentroidByName = new Map();

function ensureTooltip(){
  const ex = d3.select(".map-tooltip");
  return ex.empty() ? d3.select("body").append("div").attr("class","map-tooltip").style("opacity",0) : ex;
}
function detectKeys(features){
  const sample = features[0]?.properties||{};
  const sKeys=["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","stname","State"];
  const dKeys=["DISTRICT","district","dtname","name","NAME_2","Name","dist_name"];
  return { STATE_KEY: sKeys.find(k=>k in sample)||"ST_NM", NAME_KEY: dKeys.find(k=>k in sample)||"name" };
}
async function fetchFirst(urls){
  for (const u of urls){
    try{
      const r = await fetch(u,{cache:"no-store", mode:"cors"});
      if (r.ok) return await r.json();
    }catch{}
  }
  throw new Error("GeoJSON not found");
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

/* --------- Punjab districts (robust) --------- */
let districts=[], DKEY="name";

function filterToPunjab(features){
  if (!features?.length) return [];
  const { STATE_KEY: SKEY } = detectKeys(features);
  const isPunjab = v => String(v||"").toLowerCase().includes("punjab");
  const allStates = new Set(features.map(f => String(f.properties?.[SKEY]||"").toLowerCase()));
  if (allStates.size === 1 && isPunjab([...allStates][0])) return features;
  return features.filter(f => isPunjab(f.properties?.[SKEY]));
}

async function drawPunjabDistricts(){
  MODE = "punjabDistrict";
  const back = document.getElementById("btnBack"); if (back) back.classList.remove("hidden");
  const title = document.getElementById("mapTitle"); if (title) title.textContent = "Punjab districts — click a district";

  const svg = d3.select("#indiaMapHourly"); mapSvg = svg;
  svg.selectAll("*").remove();

  let raw=null;
  try{ raw = await fetchFirst(PUNJAB_DISTRICT_URLS); }
  catch(e){ STATUS("Punjab districts GeoJSON could not be loaded."); return; }

  let feats = [];
  if (raw.type==="Topology"){
    const obj = raw.objects[Object.keys(raw.objects)[0]];
    feats = topojson.feature(raw, obj).features || [];
  }else{
    feats = raw.features || [];
  }

  feats = filterToPunjab(feats);
  if (!feats.length){ STATUS("No districts matched Punjab in the loaded file."); return; }
  STATUS("");

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
  if (MODE==="india") colorIndiaForHour(); else colorPunjabForHour();
  repaintCharts();
}

/* ---------- Wire ---------- */
document.addEventListener("DOMContentLoaded", async ()=>{
  updateNowIST(); setInterval(updateNowIST, 60000);
  buildCloudTableAndLegend();

  await drawIndia();

  // initial data
  try{
    await refreshIndiaSeries();
    STATUS("");
  }catch(e){
    STATUS("Could not load hourly data. (Open-Meteo may be unreachable.) The page will retry on Refresh.");
  }
  repaintAll();

  // controls
  const slider = document.getElementById("hourSlider");
  if (slider) slider.addEventListener("input", e=>{ HOUR_IDX = +e.target.value; repaintAll(); });
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
});
