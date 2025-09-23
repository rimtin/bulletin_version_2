/* ===== Cloud Bulletin — Hourly (Punjab zoom + icons + labels) =====
 * - Loads Punjab districts (or India districts → filters to Punjab)
 * - Shows district names + orange "sun" icon at centroid
 * - Click district → fetch Open-Meteo (next 48h) and plot DAYLIGHT (04–19 IST)
 * - Pure D3; safely creates missing containers; robust to 404s
 */

const IST_TZ = "Asia/Kolkata";
const DAYLIGHT_START = 4;   // 04:00
const DAYLIGHT_END   = 19;  // 19:00
const MAX_HOURS = 48;

let selectedDistrict = null;
let selectedLatLon   = null;

const LAYOUT = {
  mapHolderId: "punjabMapHolder", // <div id="punjabMapHolder">
  mapSvgId:    "punjabMap",       // <svg id="punjabMap">
  rightColSel: "#rightCol",       // charts area if present
  cloudDivId:  "cloudChart",
  ghiDivId:    "ghiChart",
  titleId:     "districtTitle"
};

/* ---------- DOM helpers ---------- */
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

/* ---------- GeoJSON sources ---------- */
const PUNJAB_DISTRICT_URLS = [
  "assets/punjab_districts.geojson",
  "punjab_districts.geojson",
  "https://rimtin.github.io/bulletin_version_2/punjab_districts.geojson",
];
const INDIA_DISTRICT_URLS = [
  "https://raw.githubusercontent.com/datameet/india-geojson/master/geojson/india_district.geojson",
  "https://raw.githubusercontent.com/geohacker/india/master/district/india_district.geojson",
  "https://raw.githubusercontent.com/iamsahebgiri/India-Districts-GeoJSON/master/india_districts.geojson",
  "https://raw.githubusercontent.com/vega/vega-datasets/main/data/india-districts.json"
];

async function fetchJsonFirst(urls){
  for(const url of urls){
    try{
      const r = await fetch(url, { cache:"no-store" });
      if(!r.ok) continue;
      return await r.json();
    }catch{}
  }
  return null;
}
function normalizeToFeatures(geo){
  if(!geo) return [];
  if(geo.type === "Topology"){
    const key = Object.keys(geo.objects||{})[0];
    if(!key || !window.topojson) return [];
    return topojson.feature(geo, geo.objects[key]).features || [];
  }
  return geo.features || [];
}
function keyIn(obj, candidates){ return candidates.find(k => k in (obj||{})) || null; }
function filterToPunjab(features){
  if(!features?.length) return [];
  const STATE_KEYS = ["ST_NM","st_nm","STATE","state","state_name","State_Name","STATE_UT","NAME_1","stname"];
  const props = features[0].properties || {};
  const sKey = keyIn(props, STATE_KEYS);
  if(!sKey){
    return features.filter(f => Object.values(f.properties||{})
      .some(v => String(v).toLowerCase()==="punjab"));
  }
  return features.filter(f => String(f.properties?.[sKey]).toLowerCase()==="punjab");
}
function guessDistrictNameKey(props){
  return keyIn(props, ["DISTRICT","district","dtname","district_name","NAME_2","NAME_3","name","DIST_NAME"]) || "name";
}

/* ---------- Data fetch (Open-Meteo) ---------- */
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

/* ---------- Charts (pure D3) ---------- */
function drawLineChart({ holderId, labels, values, yMax, title="", unit="", width=520, height=260 }){
  const holder = ensureEl({ id: holderId, parent: pickParent(LAYOUT.rightColSel) });
  holder.innerHTML = "";
  holder.style.background = "#fff";
  holder.style.borderRadius = "12px";
  holder.style.boxShadow = "0 10px 25px -5px rgba(0,0,0,.10), 0 10px 10px -5px rgba(0,0,0,.04)";
  holder.style.padding = "10px";

  const P={t:28,r:18,b:36,l:44};
  const svg = d3.select(holder).append("svg").attr("width",width).attr("height",height);

  svg.append("text").attr("x",12).attr("y",18).attr("font-weight",800).attr("font-size",13).text(title);

  const x = d3.scalePoint().domain(d3.range(labels.length)).range([P.l, width-P.r]);
  const y = d3.scaleLinear().domain([0,yMax]).nice().range([height-P.b, P.t+6]);

  svg.append("g").attr("transform",`translate(0,${height-P.b})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter(i=>i%2===0))
      .tickFormat(i => new Date(labels[i]).toLocaleTimeString("en-IN",{hour:"numeric"})));

  svg.append("g").attr("transform",`translate(${P.l},0)`).call(d3.axisLeft(y).ticks(5));

  const line = d3.line().x((d,i)=>x(i)).y(d=>y(d));
  svg.append("path").attr("d", line(values)).attr("fill","none").attr("stroke","#2563eb").attr("stroke-width",2);

  if(unit) svg.append("text").attr("x",P.l).attr("y",P.t-6).attr("font-size",11).attr("fill","#555").text(unit);
}
function setCharts(times, clouds, ghi){
  drawLineChart({ holderId: LAYOUT.cloudDivId, labels:times, values:clouds, yMax:100,  title:"Hourly Cloud % (daylight only)" });
  drawLineChart({ holderId: LAYOUT.ghiDivId,   labels:times, values:ghi,    yMax:1000, title:"GHI (proxy) — daylight only", unit:"W/m²" });
}

/* ---------- Map rendering (Punjab + icons + labels) ---------- */
async function loadPunjabFeatures(){
  let geo = await fetchJsonFirst(PUNJAB_DISTRICT_URLS);
  let feats = normalizeToFeatures(geo);
  if(feats?.length) return feats;

  geo = await fetchJsonFirst(INDIA_DISTRICT_URLS);
  feats = normalizeToFeatures(geo);
  const punjab = filterToPunjab(feats);
  if(punjab?.length) return punjab;

  throw new Error("Punjab GeoJSON not found (Punjab-only + India fallback failed).");
}

async function drawPunjabMap(){
  const mapHolder = ensureEl({ id: LAYOUT.mapHolderId });
  const svgEl = ensureEl({ id: LAYOUT.mapSvgId, tag:"svg", parent: mapHolder });
  svgEl.setAttribute("viewBox","0 0 860 580");
  svgEl.style.width="100%"; svgEl.style.height="420px";
  const svg = d3.select(svgEl); svg.selectAll("*").remove();

  // defs: orange sun gradient
  const defs = svg.append("defs");
  const grad = defs.append("radialGradient").attr("id","sunGrad").attr("fx","30%").attr("fy","30%");
  grad.append("stop").attr("offset","0%").attr("stop-color","#fff7cc");
  grad.append("stop").attr("offset","60%").attr("stop-color","#ffb347");
  grad.append("stop").attr("offset","100%").attr("stop-color","#ff9800");

  let features;
  try{
    features = await loadPunjabFeatures();
  }catch(e){
    console.error(e);
    svg.append("text").attr("x",12).attr("y",24).attr("font-weight",700).text("Punjab map data not found");
    return;
  }

  const nameKey = guessDistrictNameKey(features[0]?.properties || {});
  const fc = { type:"FeatureCollection", features };
  const proj = d3.geoMercator().fitExtent([[10,10],[850,570]], fc);
  const path = d3.geoPath(proj);

  // shapes
  const g = svg.append("g").attr("class","districts");
  g.selectAll("path").data(features).join("path")
    .attr("d", path)
    .attr("fill", "#bfe3ff")   // light blue like your mock
    .attr("stroke", "#2b5876")
    .attr("stroke-width", 0.9)
    .style("cursor","pointer")
    .on("pointerenter", function(){ d3.select(this).raise().attr("stroke-width",1.6); })
    .on("pointerleave", function(){ d3.select(this).attr("stroke-width",0.9); })
    .on("click", async (_ev, d) => {
      const name = d.properties?.[nameKey] ?? "District";
      const [lon, lat] = d3.geoCentroid(d);
      selectedDistrict = name; selectedLatLon = { lat, lon };
      await ensureDistrictAndPlot(name, lat, lon);
    });

  // labels + “sun” icons at centroids
  const overlay = svg.append("g").attr("class","labels-icons");
  features.forEach(f=>{
    const [cx, cy] = path.centroid(f);
    if(!isFinite(cx) || !isFinite(cy)) return;

    // sun icon (circle with radial gradient + subtle rim)
    overlay.append("circle")
      .attr("cx",cx).attr("cy",cy).attr("r",8)
      .attr("fill","url(#sunGrad)").attr("stroke","#f59e0b").attr("stroke-width",1);

    // name label with white halo (shorten if very long)
    const name = String(f.properties?.[nameKey] ?? "");
    const short = name.length > 16 ? name.replace(/ District/i,"").slice(0,16)+"…" : name;

    overlay.append("text")
      .attr("x",cx).attr("y",cy-14)
      .attr("text-anchor","middle").attr("dominant-baseline","baseline")
      .attr("font-size",10).attr("font-weight",700)
      .attr("stroke","#fff").attr("stroke-width",3).attr("paint-order","stroke")
      .text(short);

    overlay.append("text")
      .attr("x",cx).attr("y",cy-14)
      .attr("text-anchor","middle").attr("dominant-baseline","baseline")
      .attr("font-size",10).attr("font-weight",700).attr("fill","#1f2937")
      .text(short);
  });
}

/* ---------- Interactions ---------- */
const cache = new Map(); // district -> { times, clouds, ghi }

async function ensureDistrictAndPlot(name, lat, lon){
  if(!cache.has(name)){
    try{ cache.set(name, await fetchHourly(lat, lon)); }
    catch(e){ console.warn("Fetch failed:", name, e); return; }
  }
  const { times, clouds, ghi } = cache.get(name);
  setCharts(times, clouds, ghi);

  const titleEl = ensureEl({ id: LAYOUT.titleId, parent: pickParent(LAYOUT.rightColSel) });
  titleEl.textContent = `${name} — next 48 h (daylight only, 4:00–19:00 IST)`;
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  ensureEl({ id: LAYOUT.mapHolderId });
  ensureEl({ id: LAYOUT.cloudDivId, parent: pickParent(LAYOUT.rightColSel) });
  ensureEl({ id: LAYOUT.ghiDivId,   parent: pickParent(LAYOUT.rightColSel) });

  await drawPunjabMap();

  // Default: Punjab center (shows charts even before click)
  if(!selectedDistrict){
    await ensureDistrictAndPlot("Punjab", 31.0, 75.3);
  }

  const btn = document.getElementById("refreshNow");
  if(btn){
    btn.addEventListener("click", async ()=> {
      if(!selectedLatLon) return;
      cache.delete(selectedDistrict);
      await ensureDistrictAndPlot(selectedDistrict, selectedLatLon.lat, selectedLatLon.lon);
    });
  }
});
