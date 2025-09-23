/* ================= Cloud Bulletin — HOURLY (India → Punjab) =================
 * - India map uses the SAME loader/projection pattern as daily.js
 * - Legend (Index) shown on map
 * - Click state "Punjab" → zoomed district map with labels + sun icons
 * - Back button to return to India view
 * - Click a district → fetch Open-Meteo, plot DAYLIGHT ONLY (04–19 IST) for 48h
 * - Pure D3 (no Chart.js). Creates missing containers automatically.
 */

/* ---------- shared sizes (match daily.js feel, but taller) ---------- */
const W = 860, H = 620, PAD = 18;     // H bigger than daily to “increase the size”
const MATCH_KEY = "ST_NM";
let STATE_KEY = "ST_NM";
let NAME_KEY  = "name";

/* ---------- hourly specifics ---------- */
const IST_TZ = "Asia/Kolkata";
const DAYLIGHT_START = 4, DAYLIGHT_END = 19;
const MAX_HOURS = 48;

const LAYOUT = {
  mapWrapSel:  "#hourlyMapWrap",  // if absent, we append to body
  indiaSvgId:  "indiaMapHourly",
  punjabSvgId: "punjabMapHourly",
  backBtnId:   "mapBackBtn",
  legendCls:   "map-legend",
  cloudDivId:  "cloudChart",
  ghiDivId:    "ghiChart",
  titleId:     "districtTitle"
};

/* ---------- palette from daily.js (fallback if missing) ---------- */
const DEFAULT_COLORS = {
  "Clear Sky": "#A7D8EB",
  "Low Cloud Cover": "#C4E17F",
  "Medium Cloud Cover": "#FFF952",
  "High Cloud Cover": "#E69536",
  "Overcast Cloud Cover": "#FF4D4D"
};
const PALETTE = window.forecastColors || DEFAULT_COLORS;
const ORDER   = window.forecastOptions || Object.keys(PALETTE);

/* ---------- small utils ---------- */
function q(sel){ return document.querySelector(sel); }
function ensureEl({ id, tag="div", parent=null, className="" }){
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement(tag);
    el.id = id;
    if(className) el.className = className;
    (parent || document.body).appendChild(el);
  }
  return el;
}
function pickParent(selector){ return selector ? (q(selector) || document.body) : document.body; }

const norm = s => String(s||"").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").replace(/\s*&\s*/g," and ")
  .replace(/\s*\([^)]*\)\s*/g," ").replace(/[^a-z0-9]+/g," ")
  .replace(/\s+/g," ").trim();

/* ---------- key detection like daily.js ---------- */
function detectKeys(features){
  const sKeys = ["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","State"];
  const dKeys = ["DISTRICT","name","NAME_2","Name","district","dist_name"];
  const sample = features[0]?.properties || {};
  STATE_KEY = sKeys.find(k => k in sample) || STATE_KEY;
  NAME_KEY  = dKeys.find(k => k in sample) || NAME_KEY;
}

/* ---------- projection chooser (lon/lat or identity) ---------- */
function pickProjection(fc){
  const [[minX,minY],[maxX,maxY]] = d3.geoBounds(fc);
  const w = maxX - minX, h = maxY - minY;
  const isLonLat = w < 200 && h < 120 && minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
  return isLonLat
    ? d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc)
    : d3.geoIdentity().reflectY(true).fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc);
}

/* ---------- map legend (Index) ---------- */
function drawLegend(svg){
  svg.selectAll(`.${LAYOUT.legendCls}`).remove();
  const pad = 10, sw = 14, gap = 16, width = 180;
  const height = pad + 16 + ORDER.length * gap;

  const g = svg.append("g")
    .attr("class", LAYOUT.legendCls)
    .attr("transform", `translate(${W - width - 14}, ${14})`);

  g.append("rect").attr("width", width).attr("height", height)
    .attr("rx", 10).attr("ry", 10)
    .attr("fill", "rgba(255,255,255,0.95)")
    .attr("stroke", "#d1d5db");

  g.append("text").attr("x", pad).attr("y", pad + 12)
    .attr("font-weight", 800).attr("font-size", 12).text("Index — Day 1");

  ORDER.forEach((label,i)=>{
    const y = pad + 24 + i*gap;
    g.append("rect").attr("x", pad).attr("y", y - 10)
      .attr("width", sw).attr("height", 10)
      .attr("fill", PALETTE[label] || "#eee").attr("stroke","#9ca3af");
    g.append("text").attr("x", pad + sw + 6).attr("y", y - 1)
      .attr("font-size", 11).text(label);
  });

  // “View satellite” button shell (non-functional placeholder)
  const btn = g.append("g").attr("transform", `translate(${pad}, ${height-12-28})`);
  btn.append("rect").attr("width", 120).attr("height", 28).attr("rx", 14).attr("ry", 14)
    .attr("fill", "#2563eb");
  btn.append("text").attr("x", 60).attr("y", 18).attr("text-anchor","middle")
    .attr("font-size", 12).attr("fill","#fff").text("View satellite");
}

/* ---------- geo fallbacks (same spirit as daily.js) ---------- */
const INDIA_SUBDIV_URLS = [
  "indian_met_zones.geojson",
  "assets/indian_met_zones.geojson",
  "bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/weather_bulletin/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/rimtin/weather_bulletin/main/indian_met_zones.geojson",
  "https://cdn.jsdelivr.net/gh/rimtin/weather_bulletin@main/indian_met_zones.geojson"
];

const PUNJAB_DISTRICT_URLS = [
  "assets/punjab_districts.geojson",
  "punjab_districts.geojson",
  "https://raw.githubusercontent.com/datameet/india-geojson/master/geojson/india_district.geojson", // India-wide; filter
  "https://raw.githubusercontent.com/geohacker/india/master/district/india_district.geojson",
  "https://raw.githubusercontent.com/iamsahebgiri/India-Districts-GeoJSON/master/india_districts.geojson",
  "https://raw.githubusercontent.com/vega/vega-datasets/main/data/india-districts.json"
];

async function fetchFirst(urls){
  for(const url of urls){
    try{
      const r = await fetch(url, { cache: "no-store" });
      if(!r.ok) continue;
      return await r.json();
    }catch{}
  }
  return null;
}
function toFeatures(geo){
  if(!geo) return [];
  if(geo.type === "Topology"){
    const key = Object.keys(geo.objects||{})[0];
    if(!key || !window.topojson) return [];
    return topojson.feature(geo, geo.objects[key]).features || [];
  }
  return geo.features || [];
}
function filterPunjab(features){
  if(!features?.length) return [];
  const STATE_KEYS = ["ST_NM","st_nm","STATE","state","state_name","State_Name","STATE_UT","NAME_1","stname"];
  const sKey = STATE_KEYS.find(k => k in (features[0]?.properties||{}));
  if(!sKey){
    // fallback: scan any prop for “punjab”
    return features.filter(f => Object.values(f.properties||{}).some(v => String(v).toLowerCase()==="punjab"));
  }
  return features.filter(f => String(f.properties?.[sKey]).toLowerCase()==="punjab");
}
function guessDistrictNameKey(props){
  const cand = ["DISTRICT","district","dtname","district_name","NAME_2","NAME_3","name","DIST_NAME"];
  return cand.find(k => k in (props||{})) || "name";
}

/* ---------- tooltip ---------- */
let tip;
function ensureTip(){
  if(!tip){
    tip = d3.select("body").append("div").attr("class","map-tooltip")
      .style("position","fixed").style("z-index",50).style("opacity",0)
      .style("background","rgba(255,255,255,.95)").style("border","1px solid #e5e7eb")
      .style("padding","6px 8px").style("border-radius","8px").style("font","12px system-ui");
  }
  return tip;
}

/* ======================================================================
   INDIA MAP (default view)
   ====================================================================== */
async function drawIndia(){
  const holder = pickParent(LAYOUT.mapWrapSel);
  const svgId = LAYOUT.indiaSvgId;
  const svg = d3.select(ensureEl({ id: svgId, tag:"svg", parent: holder }));
  svg.attr("viewBox", `0 0 ${W} ${H}`).style("width","100%").style("height","520px"); // bigger height
  svg.selectAll("*").remove();

  // hatch like daily
  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diagonalHatch").attr("patternUnits","userSpaceOnUse")
    .attr("width",6).attr("height",6).append("path")
    .attr("d","M0,0 l6,6").attr("stroke","#999").attr("stroke-width",1);

  // Load
  let feats = [];
  try{
    const geo = await fetchFirst(INDIA_SUBDIV_URLS);
    feats = toFeatures(geo);
  }catch(e){ console.error(e); }
  if(!feats.length){
    svg.append("text").attr("x",12).attr("y",24).attr("font-weight",700).text("Map data not found");
    return;
  }

  detectKeys(feats);
  const fc  = { type:"FeatureCollection", features: feats };
  const prj = pickProjection(fc);
  const path = d3.geoPath(prj);

  const g = svg.append("g").attr("class","fill-layer");
  const t = ensureTip();

  const paths = g.selectAll("path").data(feats).join("path")
    .attr("d", path)
    .attr("fill","url(#diagonalHatch)")
    .attr("stroke","#666").attr("stroke-width",0.7)
    .style("cursor","pointer")
    .on("pointermove",(ev,d)=>{
      const st = d.properties?.[STATE_KEY] ?? "";
      t.style("opacity",1).style("left",(ev.clientX+10)+"px").style("top",(ev.clientY+10)+"px").text(st);
    })
    .on("pointerleave",()=> t.style("opacity",0))
    .on("click", async (_ev, d) => {
      const st = String(d.properties?.[STATE_KEY]||"");
      if (norm(st) === "punjab"){
        await drawPunjab(); // switch view
      }
    });

  drawLegend(svg);

  // hide Punjab hover confusion: fill Punjab lightly to hint it’s clickable
  paths.filter(d => norm(String(d.properties?.[STATE_KEY]||""))==="punjab")
    .attr("fill","#bfe3ff");
}

/* ======================================================================
   PUNJAB MAP (detail view; add labels + sun icons + Back)
   ====================================================================== */
async function drawPunjab(){
  // hide India svg, show/create Punjab svg
  const holder = pickParent(LAYOUT.mapWrapSel);
  const indiaSvg = document.getElementById(LAYOUT.indiaSvgId);
  if (indiaSvg) indiaSvg.style.display = "none";

  const svgEl = ensureEl({ id: LAYOUT.punjabSvgId, tag:"svg", parent: holder });
  svgEl.style.display = "block";
  const svg = d3.select(svgEl);
  svg.attr("viewBox", `0 0 ${W} ${H}`).style("width","100%").style("height","520px");
  svg.selectAll("*").remove();

  // Back button
  const back = ensureEl({ id: LAYOUT.backBtnId, tag:"button", parent: holder });
  back.textContent = "← Back to India";
  back.style.margin = "8px 0 6px";
  back.style.padding = "6px 12px";
  back.style.borderRadius = "9999px";
  back.style.border = "1px solid #d1d5db";
  back.style.background = "#fff";
  back.onclick = () => {
    svg.style.display = "none";
    if (indiaSvg) indiaSvg.style.display = "block";
    back.remove();
  };

  // defs: sun icon gradient
  const defs = svg.append("defs");
  const grad = defs.append("radialGradient").attr("id","sunGrad").attr("fx","30%").attr("fy","30%");
  grad.append("stop").attr("offset","0%").attr("stop-color","#fff7cc");
  grad.append("stop").attr("offset","60%").attr("stop-color","#ffb347");
  grad.append("stop").attr("offset","100%").attr("stop-color","#ff9800");

  // Load Punjab districts (or India districts → filter)
  let feats = [];
  try{
    let geo = await fetchFirst(PUNJAB_DISTRICT_URLS);
    let all = toFeatures(geo);
    // if India-wide, filter
    if (all.length && !all.every(f => Object.values(f.properties||{}).some(v => String(v).toLowerCase()==="punjab"))){
      all = filterPunjab(all);
    }
    feats = all;
  }catch(e){ console.error(e); }
  if(!feats.length){
    svg.append("text").attr("x",12).attr("y",24).attr("font-weight",700).text("Punjab districts not found");
    return;
  }

  const nameKey = guessDistrictNameKey(feats[0]?.properties || {});
  const fc  = { type:"FeatureCollection", features: feats };
  const prj = d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc);
  const path = d3.geoPath(prj);

  const t = ensureTip();
  const g = svg.append("g").attr("class","districts");

  g.selectAll("path").data(feats).join("path")
    .attr("d", path)
    .attr("fill", "#bfe3ff")
    .attr("stroke", "#2b5876")
    .attr("stroke-width", 0.9)
    .style("cursor","pointer")
    .on("pointermove",(ev,d)=>{
      const nm = d.properties?.[nameKey] ?? "District";
      t.style("opacity",1).style("left",(ev.clientX+10)+"px").style("top",(ev.clientY+10)+"px").text(nm);
    })
    .on("pointerleave",()=> t.style("opacity",0))
    .on("click", async (_ev,d)=>{
      const nm = d.properties?.[nameKey] ?? "District";
      const [lon, lat] = d3.geoCentroid(d);
      await ensureDistrictAndPlot(nm, lat, lon);
    });

  // labels + sun icons
  const overlay = svg.append("g").attr("class","labels-icons");
  feats.forEach(f=>{
    const [cx, cy] = path.centroid(f);
    if(!isFinite(cx) || !isFinite(cy)) return;
    // icon
    overlay.append("circle")
      .attr("cx",cx).attr("cy",cy).attr("r",8)
      .attr("fill","url(#sunGrad)").attr("stroke","#f59e0b").attr("stroke-width",1);
    // name (with white halo)
    const nm = String(f.properties?.[nameKey]||"");
    const short = nm.length>16 ? nm.replace(/ District/i,"").slice(0,16)+"…" : nm;
    overlay.append("text")
      .attr("x",cx).attr("y",cy-14).attr("text-anchor","middle")
      .attr("font-size",10).attr("font-weight",700)
      .attr("stroke","#fff").attr("stroke-width",3).attr("paint-order","stroke").text(short);
    overlay.append("text")
      .attr("x",cx).attr("y",cy-14).attr("text-anchor","middle")
      .attr("font-size",10).attr("font-weight",700).attr("fill","#1f2937").text(short);
  });

  // Legend also on Punjab view
  drawLegend(svg);
}

/* ======================================================================
   DATA: Open-Meteo + charts (pure D3)
   ====================================================================== */
async function fetchHourly(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "cloud_cover");
  url.searchParams.set("timezone", IST_TZ);
  url.searchParams.set("forecast_hours", String(MAX_HOURS));

  const r = await fetch(url.toString(), { cache:"no-store" });
  if(!r.ok) throw new Error("Open-Meteo "+r.status);
  const d = await r.json();

  const times  = (d.hourly?.time || []).slice(0, MAX_HOURS);
  const clouds = (d.hourly?.cloud_cover || []).slice(0, MAX_HOURS);

  const T=[], V=[];
  for(let i=0;i<times.length;i++){
    const h = new Date(times[i]).getHours(); // already IST
    if(h>=DAYLIGHT_START && h<=DAYLIGHT_END){ T.push(times[i]); V.push(clouds[i]); }
  }
  const ghi = V.map(p => 950 * Math.max(0, 1 - (p||0)/100)); // proxy
  return { times:T, clouds:V, ghi };
}

function drawLineChart({ holderId, labels, values, yMax, title="", unit="", width=520, height=260 }){
  const holder = ensureEl({ id: holderId, parent: pickParent("#rightCol") });
  holder.innerHTML = "";
  holder.style.background = "#fff";
  holder.style.borderRadius = "12px";
  holder.style.boxShadow = "0 10px 25px -5px rgba(0,0,0,.10), 0 10px 10px -5px rgba(0,0,0,.04)";
  holder.style.padding = "10px";

  const P={t:28,r:18,b:36,l:44}, svg=d3.select(holder).append("svg").attr("width",width).attr("height",height);
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

async function ensureDistrictAndPlot(name, lat, lon){
  try{
    const { times, clouds, ghi } = await fetchHourly(lat, lon);
    drawLineChart({ holderId: LAYOUT.cloudDivId, labels: times, values: clouds, yMax: 100,  title: "Hourly Cloud % (ensemble)" });
    drawLineChart({ holderId: LAYOUT.ghiDivId,   labels: times, values: ghi,    yMax: 1000, title: "GHI (proxy) — daylight only", unit: "W/m²" });
    const titleEl = ensureEl({ id: LAYOUT.titleId, parent: pickParent("#rightCol") });
    titleEl.textContent = `${name} — next 48 h (daylight only, 4:00–19:00 IST)`;
  }catch(e){
    console.warn("Fetch failed:", name, e);
  }
}

/* ======================================================================
   INIT
   ====================================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  // Make sure chart holders exist so nothing is null
  ensureEl({ id: LAYOUT.cloudDivId, parent: pickParent("#rightCol") });
  ensureEl({ id: LAYOUT.ghiDivId,   parent: pickParent("#rightCol") });

  // 1) Draw India first (with legend, larger size)
  await drawIndia();

  // 2) Optional: preload Punjab center so charts aren’t empty
  await ensureDistrictAndPlot("Punjab", 31.0, 75.3);
});
