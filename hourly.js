/* ========= Hourly page logic (ensemble + map + charts) ========= */
const IST_TZ = "Asia/Kolkata";
const MAX_HOURS = 48;
const W = 860, H = 580, PAD = 18;

// --- Regions (centroids used for API queries) ---
const CENTROIDS = {
  "Punjab":         { lat: 30.84284696845263, lon: 75.41854251284677 },
  "West Rajasthan": { lat: 27.1589259099715,  lon: 72.70218563309521 },
  "East Rajasthan": { lat: 25.810727217600284,lon: 75.39163711411086 }
};
// derived Rajasthan = max(West, East) is computed after fetch

// --- helpers ---
const COLORS = (window.forecastColors || {
  "Clear Sky":"#66CCFF","Low Cloud Cover":"#57E66D","Medium Cloud Cover":"#FFF500","High Cloud Cover":"#FF8A00","Overcast Cloud Cover":"#FF0000"
});
const ICONS = (window.forecastIcons || {"Clear Sky":"☀️","Low Cloud Cover":"🌤️","Medium Cloud Cover":"⛅","High Cloud Cover":"🌥️","Overcast Cloud Cover":"☁️"});

const fmtIST = s => {
  const d = new Date(s);
  return d.toLocaleString("en-IN", {hour:"2-digit", minute:"2-digit", weekday:"short", day:"2-digit", month:"short", hour12:true, timeZone: IST_TZ});
};
const bucketFromPct = p => (p<10)?"Clear Sky":(p<30)?"Low Cloud Cover":(p<50)?"Medium Cloud Cover":(p<75)?"High Cloud Cover":"Overcast Cloud Cover";
const norm = s => String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const getParam = k => new URLSearchParams(location.search).get(k);

// ---------- Data fetchers ----------
function buildOMUrl(lat,lon,parts="hourly=cloud_cover&forecast_hours=48"){
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${parts}&timezone=${encodeURIComponent(IST_TZ)}`;
}
async function fetchOpenMeteo(lat, lon){
  const uHours = buildOMUrl(lat,lon,"hourly=cloud_cover&forecast_hours=48");
  const uSun   = buildOMUrl(lat,lon,"daily=sunrise,sunset&forecast_days=3");
  const [rh, rs] = await Promise.all([fetch(uHours,{cache:"no-store"}), fetch(uSun,{cache:"no-store"})]);
  if(!rh.ok) throw new Error("Open-Meteo hourly failed");
  if(!rs.ok) throw new Error("Open-Meteo sunrise/sunset failed");
  const jh = await rh.json(); const js = await rs.json();
  const times = (jh.hourly?.time || []).slice(0,MAX_HOURS);
  const vals  = (jh.hourly?.cloud_cover || []).slice(0,MAX_HOURS).map(v=>+v||0);
  const sunrise = js?.daily?.sunrise || [];
  const sunset  = js?.daily?.sunset  || [];
  return { times, vals, sunrise, sunset };
}

// Optional: OpenWeatherMap OneCall (needs ?owm=KEY). Uses clouds% from hourly.
async function fetchOpenWeatherMap(lat, lon){
  const key = getParam("owm") || window.OWM_KEY;
  if (!key) return null;
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=current,minutely,daily,alerts&appid=${key}`;
  const r = await fetch(url, { cache:"no-store" });
  if (!r.ok) throw new Error("OpenWeatherMap failed");
  const j = await r.json();
  const hours = (j.hourly||[]).slice(0,MAX_HOURS);
  // OWM times are UNIX seconds (UTC). We keep only the order; OM is our time axis.
  const vals = hours.map(h => Number(h.clouds)||0);
  return { vals };
}

// Merge sources by index (both are hourly series). OM is the master time axis.
function ensembleSeries(omVals, owmVals){
  const out = [];
  for (let i=0;i<Math.min(MAX_HOURS, omVals.length);i++){
    const a = omVals[i];
    const b = (owmVals && Number.isFinite(owmVals[i])) ? owmVals[i] : null;
    if (b==null) { out.push(a); continue; }
    out.push((a + b) / 2);
  }
  return out;
}

// ---------- Store ----------
const DATA = {}; // name -> {times[], pct[], om[], owm[], buckets[]}
let HOUR_IDX = 0;
let VIEW = "24"; // "24" | "48" | "all"
let REGION = "Punjab";

// ---------- UI bits ----------
function updateNowIST(){ document.getElementById("now-ist").textContent =
  new Date().toLocaleString("en-IN",{ timeZone: IST_TZ, hour:'2-digit', minute:'2-digit', weekday:'long', year:'numeric', month:'long', day:'numeric', hour12:true }); }

function setHourLabel(){
  const t = DATA["Punjab"]?.times?.[HOUR_IDX];
  document.getElementById("hourLabel").textContent = t ? fmtIST(t) : "—";
}

// ---------- Table (classification) ----------
function buildCloudTable(){
  const rows = [
    { cover: "0–10 %",  label: "Clear Sky",            type: "No Cloud" },
    { cover: "10–30 %", label: "Low Cloud Cover",      type: "Few Clouds" },
    { cover: "30–50 %", label: "Medium Cloud Cover",   type: "Scattered / Partly Cloudy" },
    { cover: "50–75 %", label: "High Cloud Cover",     type: "Broken / Mostly Cloudy" },
    { cover: "75–100 %",label: "Overcast Cloud Cover", type: "Cloudy / Overcast" }
  ];
  const tb = document.getElementById("cloudTbody"); tb.innerHTML = "";
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

// ---------- Charts ----------
function drawLineChart(sel, values, options){
  const svg = d3.select(sel);
  svg.selectAll("*").remove();
  const vb = svg.attr("viewBox").split(/\s+/).map(Number);
  const width = vb[2], height = vb[3], m = {t:18,r:12,b:28,l:36};

  const show = rangeForView(values.length);
  const xs = d3.scaleLinear().domain([show.s, show.e-1]).range([m.l, width-m.r]);
  const ys = d3.scaleLinear().domain([0, options.yMax||100]).nice().range([height-m.b, m.t]);

  // axes
  const ax = g => g.attr("class","axis").call(d3.axisBottom(xs).ticks(8).tickFormat(i=>{
    const t = DATA[REGION]?.times?.[Math.round(i)];
    if (!t) return "";
    const d = new Date(t);
    return d.toLocaleString("en-IN",{ hour:'2-digit', hour12:true, timeZone: IST_TZ });
  }));
  const ay = g => g.attr("class","axis").call(d3.axisLeft(ys).ticks(5));
  svg.append("g").attr("transform",`translate(0,${height-m.b})`).call(ax);
  svg.append("g").attr("transform",`translate(${m.l},0)`).call(ay);

  // optional daytime band (approx 06–18 IST each day)
  if (options.dayBand){
    const dWidth = 24; // hours
    const band = [[6,18],[30,42]]; // day1 + day2 indexes
    svg.append("g").selectAll("rect").data(band).join("rect")
      .attr("x", d => xs(Math.max(show.s, d[0])))
      .attr("y", m.t)
      .attr("width", d => Math.max(0, xs(Math.min(show.e, d[1])) - xs(Math.max(show.s, d[0]))))
      .attr("height", height-m.t-m.b)
      .attr("fill", "#e5f0ff")
      .attr("opacity", .4);
  }

  // line
  const line = d3.line()
    .x((_,i)=> xs(i))
    .y(v => ys(v))
    .defined((v,i)=> i>=show.s && i<show.e && Number.isFinite(v));

  svg.append("path")
    .attr("fill","none")
    .attr("stroke", options.stroke || "#3b82f6")
    .attr("stroke-width", 2.2)
    .attr("d", line(values));

  // current hour marker
  if (HOUR_IDX>=show.s && HOUR_IDX<show.e){
    const cx = xs(HOUR_IDX), cy = ys(values[HOUR_IDX]);
    if (Number.isFinite(cy)) {
      svg.append("circle").attr("cx",cx).attr("cy",cy).attr("r",4).attr("fill","#111827");
    }
  }
}

function rangeForView(total){
  if (VIEW==="all") return {s:0,e:Math.min(MAX_HOURS,total)};
  if (VIEW==="48")  return {s:24,e:Math.min(48,total)};
  return {s:0,e:Math.min(24,total)};
}

function repaintCharts(){
  const d = DATA[REGION];
  if (!d) return;
  const sourceTxt = ["Open-Meteo", (d.owm ? "OpenWeatherMap" : null)].filter(Boolean).join(" + ");
  document.getElementById("sourceTags").textContent = `Sources: ${sourceTxt}`;
  drawLineChart("#cloudChart", d.pct, { yMax:100, dayBand:true, stroke:"#0ea5e9" });

  // very simple GHI proxy (daylight hours only)
  const ghi = d.pct.map((p,i)=> ((i%24)>=6 && (i%24)<=18) ? (950*(1 - (p/100))) : 0);
  drawLineChart("#ghiChart", ghi, { yMax:1000, dayBand:true, stroke:"#10b981" });
}

// ---------- Map (color only 3 sub-divisions at selected hour) ----------
const GEO_URLS = [
  "indian_met_zones.geojson",
  "assets/indian_met_zones.geojson",
  "bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/weather_bulletin/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/rimtin/weather_bulletin/main/indian_met_zones.geojson",
  "https://cdn.jsdelivr.net/gh/rimtin/weather_bulletin@main/indian_met_zones.geojson"
];
let mapIndex = new Map(), mapSvg=null;
function ensureTooltip(){
  const ex = d3.select(".map-tooltip");
  return ex.empty() ? d3.select("body").append("div").attr("class","map-tooltip").style("opacity",0) : ex;
}
function detectKeys(features){
  const sample = features[0]?.properties||{};
  const sKeys=["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","State"];
  const dKeys=["DISTRICT","name","NAME_2","Name","district","dist_name"];
  return { STATE_KEY: sKeys.find(k=>k in sample)||"ST_NM", NAME_KEY: dKeys.find(k=>k in sample)||"name" };
}
async function fetchFirst(urls){
  for (const u of urls){ try{ const r=await fetch(u,{cache:"no-store"}); if(r.ok) return await r.json(); }catch{} }
  throw new Error("GeoJSON not found");
}
async function drawMap(){
  const svg = d3.select("#indiaMapHourly"); mapSvg = svg;
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diag").attr("patternUnits","userSpaceOnUse").attr("width",6).attr("height",6)
    .append("path").attr("d","M0,0 l6,6").attr("stroke","#9ca3af").attr("stroke-width",1);

  let features=[]; let STATE_KEY="ST_NM", NAME_KEY="name";
  try{
    const geo = await fetchFirst(GEO_URLS);
    features = (geo.type==="Topology") ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features : (geo.features||[]);
  }catch(e){ alert("Could not load GeoJSON"); console.error(e); return; }
  if (!features.length){ alert("GeoJSON has 0 features"); return; }

  ({STATE_KEY, NAME_KEY} = detectKeys(features));
  const fc = { type:"FeatureCollection", features };
  const projection = (()=> {
    const [[minX,minY],[maxX,maxY]]=d3.geoBounds(fc);
    const lonlat = (maxX-minX)<200 && (maxY-minY)<120;
    return lonlat ? d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]],fc)
                  : d3.geoIdentity().reflectY(true).fitExtent([[PAD,PAD],[W-PAD,H-PAD]],fc);
  })();
  const path = d3.geoPath(projection);

  const allowed = new Set(["punjab","west rajasthan","east rajasthan"]);
  const tt = ensureTooltip();
  const paths = svg.append("g").selectAll("path").data(features).join("path")
    .attr("class","subdiv")
    .attr("d", path)
    .attr("fill","url(#diag)")
    .attr("stroke","#666").attr("stroke-width",.7)
    .on("pointermove", function(evt,d){
      const raw = d?.properties?.[STATE_KEY] ?? "";
      const key = norm(raw);
      if (!allowed.has(key)) { tt.style("opacity",0); return; }
      const pad=12, w=200, h=40, vw=innerWidth, vh=innerHeight;
      let x=evt.clientX+pad, y=evt.clientY+pad; if(x+w>vw)x=vw-w-pad; if(y+h>vh)y=vh-h-pad;
      tt.style("opacity",1).html(raw).style("left",x+"px").style("top",y+"px");
    }).on("pointerleave", ()=>tt.style("opacity",0));

  // index by normalized state
  mapIndex.clear();
  paths.each(function(d){
    const key = norm(String(d.properties?.[STATE_KEY]||""));
    if (!key) return;
    (mapIndex.get(key) || mapIndex.set(key,[]).get(key)).push(this);
  });
}
function colorMapForHour(){
  if (!mapSvg) return;
  mapSvg.selectAll(".subdiv").attr("fill", "url(#diag)");
  const set = [
    ["punjab",         DATA["Punjab"]?.buckets?.[HOUR_IDX]],
    ["west rajasthan", DATA["West Rajasthan"]?.buckets?.[HOUR_IDX]],
    ["east rajasthan", DATA["East Rajasthan"]?.buckets?.[HOUR_IDX]],
  ];
  set.forEach(([k,b])=>{
    const nodes = mapIndex.get(k); if (!nodes || !b) return;
    const c = COLORS[b] || "#eee";
    nodes.forEach(n => n.setAttribute("fill", c));
  });
}

// ---------- Load + wire ----------
async function loadRegion(name){
  const c = CENTROIDS[name];
  const [om, owm] = await Promise.allSettled([fetchOpenMeteo(c.lat,c.lon), fetchOpenWeatherMap(c.lat,c.lon)]);
  if (om.status!=="fulfilled") throw om.reason;

  const omVals = om.value.vals;
  const owmVals = (owm.status==="fulfilled" && owm.value) ? owm.value.vals : null;
  const pct = ensembleSeries(omVals, owmVals);

  DATA[name] = {
    times: om.value.times,
    om: omVals,
    owm: owmVals,
    pct,
    buckets: pct.map(bucketFromPct)
  };
}

async function refreshAll(){
  const keys = Object.keys(CENTROIDS);
  await Promise.all(keys.map(loadRegion));
  // Derived Rajasthan = per-hour max of W/E
  const wr = DATA["West Rajasthan"], er = DATA["East Rajasthan"];
  const len = Math.min(wr.pct.length, er.pct.length);
  const rz = new Array(len).fill(0).map((_,i)=> Math.max(wr.pct[i], er.pct[i]));
  DATA["Rajasthan"] = {
    times: DATA["Punjab"].times.slice(0,len),
    pct: rz,
    buckets: rz.map(bucketFromPct)
  };
}

function repaintAll(){
  setHourLabel();
  colorMapForHour();
  repaintCharts();
}

document.addEventListener("DOMContentLoaded", async ()=>{
  updateNowIST(); setInterval(updateNowIST, 60000);
  buildCloudTable();
  await drawMap();

  // first load
  try{ await refreshAll(); }catch(e){
    console.error(e);
    alert("Could not load hourly data. If you added ?owm=… and it still fails, remove it to use Open-Meteo only.");
    return;
  }
  repaintAll();

  // controls
  const slider = document.getElementById("hourSlider");
  slider.addEventListener("input", e=>{ HOUR_IDX = +e.target.value; repaintAll(); });

  document.getElementById("btn24").addEventListener("click", ()=>{ VIEW="24"; repaintCharts(); });
  document.getElementById("btn48").addEventListener("click", ()=>{ VIEW="48"; repaintCharts(); });
  document.getElementById("btnAll").addEventListener("click", ()=>{ VIEW="all"; repaintCharts(); });

  document.getElementById("regionSelect").addEventListener("change", e=>{
    REGION = e.target.value; repaintAll();
  });

  document.getElementById("btnRefresh").addEventListener("click", async ()=>{
    document.getElementById("btnRefresh").disabled = true;
    try{ await refreshAll(); repaintAll(); } finally { document.getElementById("btnRefresh").disabled = false; }
  });

  document.getElementById("satBtn").addEventListener("click", ()=>{
    window.open("https://zoom.earth/#view=22.5,79.0,5z/layers=labels,clouds","_blank","noopener");
  });

  // auto refresh every hour
  setInterval(async ()=>{ await refreshAll(); repaintAll(); }, 60*60*1000);
});
