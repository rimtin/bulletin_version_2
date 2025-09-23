/* ========= Cloud Bulletin — Hourly (robust, no Chart.js) =========
 * - Punjab district map (labels + tooltip)
 * - If Punjab-only GeoJSON missing, auto-load INDIA districts and filter to Punjab
 * - Click a district → fetch Open-Meteo hourly cloud (next 48h)
 * - Charts (SVG) show daylight only (04:00–19:00 IST)
 * - Creates missing containers so it never null-crashes
 */

const IST_TZ = "Asia/Kolkata";
const DAYLIGHT_START = 4;   // 04:00
const DAYLIGHT_END   = 19;  // 19:00
const MAX_HOURS = 48;

let selectedDistrict = null;
let selectedLatLon   = null;
let mapProjection    = null;

const LAYOUT = {
  mapHolderId: "punjabMapHolder", // <div id="punjabMapHolder">
  mapSvgId:    "punjabMap",       // <svg id="punjabMap">
  rightColSel: "#rightCol",       // where charts go, if present
  cloudDivId:  "cloudChart",
  ghiDivId:    "ghiChart",
  titleId:     "districtTitle"
};

/* ------------------------------------------------------------------ */
/* Safe DOM helpers                                                    */
/* ------------------------------------------------------------------ */
function q(sel) { return document.querySelector(sel); }
function ensureEl({ id, tag="div", parent=null, className="" }) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    if (className) el.className = className;
    (parent || document.body).appendChild(el);
  }
  return el;
}
function pickParent(selector) { return selector ? (q(selector) || document.body) : document.body; }

/* ------------------------------------------------------------------ */
/* GeoJSON sources                                                     */
/* ------------------------------------------------------------------ */
// 1) Punjab-only (use these if you add/host a file in your repo)
const PUNJAB_DISTRICT_URLS = [
  "assets/punjab_districts.geojson",
  "punjab_districts.geojson",
  "https://rimtin.github.io/bulletin_version_2/punjab_districts.geojson",
];

// 2) India districts (we’ll load one and filter to state='Punjab')
const INDIA_DISTRICT_URLS = [
  // Common community fallbacks (raw paths)
  "https://raw.githubusercontent.com/datameet/india-geojson/master/geojson/india_district.geojson",
  "https://raw.githubusercontent.com/geohacker/india/master/district/india_district.geojson",
  "https://raw.githubusercontent.com/iamsahebgiri/India-Districts-GeoJSON/master/india_districts.geojson",
  "https://raw.githubusercontent.com/vega/vega-datasets/main/data/india-districts.json"
];

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */
async function fetchJsonFirst(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      console.log("[GeoJSON] Loaded:", url);
      return j;
    } catch(_) { /* try next */ }
  }
  return null;
}

/* Guess keys in various datasets */
function keyIn(obj, list) { return list.find(k => k in (obj || {})) || null; }

function normalizeGeoToFeatures(geo) {
  if (!geo) return [];
  if (geo.type === "Topology") {
    // Needs topojson-client
    const objKey = Object.keys(geo.objects || {})[0];
    if (!objKey || !window.topojson) return [];
    return topojson.feature(geo, geo.objects[objKey]).features || [];
  }
  return geo.features || [];
}

function filterToPunjab(features) {
  if (!features?.length) return [];
  // Common state keys we might see:
  const STATE_KEYS = ["ST_NM","st_nm","STATE","state","state_name","State_Name","NAME_1","NAME_0","STATE_UT","stname"];
  const districtProps = features[0]?.properties || {};
  const stateKey = keyIn(districtProps, STATE_KEYS);
  if (!stateKey) {
    // Some datasets nest state name under different naming – try case-insensitive scan
    return features.filter(f => {
      const props = f.properties || {};
      return Object.values(props).some(v => String(v).toLowerCase() === "punjab");
    });
  }
  return features.filter(f => String(f.properties?.[stateKey]).toLowerCase() === "punjab");
}

function guessDistrictNameKey(props) {
  return keyIn(props, ["DISTRICT","district","dtname","district_name","NAME_2","NAME_3","name","DIST_NAME"]) || "name";
}

/* ------------------------------------------------------------------ */
/* Open-Meteo fetch + series utils                                    */
/* ------------------------------------------------------------------ */
async function fetchHourly(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "cloud_cover");
  url.searchParams.set("timezone", IST_TZ);
  url.searchParams.set("forecast_hours", String(MAX_HOURS));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error("Open-Meteo " + res.status);
  const data = await res.json();

  const times  = (data.hourly?.time || []).slice(0, MAX_HOURS);
  const clouds = (data.hourly?.cloud_cover || []).slice(0, MAX_HOURS);

  const T=[], V=[];
  for (let i=0;i<times.length;i++){
    const h = new Date(times[i]).getHours(); // already IST per timezone= parameter
    if (h >= DAYLIGHT_START && h <= DAYLIGHT_END) { T.push(times[i]); V.push(clouds[i]); }
  }
  const ghi = V.map(p => 950 * Math.max(0, 1 - (p || 0)/100)); // proxy
  return { times: T, clouds: V, ghi };
}

/* ------------------------------------------------------------------ */
/* D3 charts (pure SVG)                                               */
/* ------------------------------------------------------------------ */
function drawLineChart({ holderId, labels, values, yMax, title="", unit="", width=520, height=260 }) {
  const holder = ensureEl({ id: holderId, parent: pickParent(LAYOUT.rightColSel) });
  holder.innerHTML = "";
  holder.style.background = "#fff";
  holder.style.borderRadius = "12px";
  holder.style.boxShadow = "0 10px 25px -5px rgba(0,0,0,.10), 0 10px 10px -5px rgba(0,0,0,.04)";
  holder.style.padding = "10px";

  const P = { t: 28, r: 18, b: 36, l: 44 };
  const svg = d3.select(holder).append("svg").attr("width", width).attr("height", height);

  svg.append("text").attr("x", 12).attr("y", 18).attr("font-weight", 800).attr("font-size", 13).text(title);

  const x = d3.scalePoint().domain(d3.range(labels.length)).range([P.l, width-P.r]);
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([height-P.b, P.t+6]);

  svg.append("g").attr("transform", `translate(0,${height-P.b})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter(i=>i%2===0))
      .tickFormat(i => new Date(labels[i]).toLocaleTimeString("en-IN", { hour:"numeric" })));

  svg.append("g").attr("transform", `translate(${P.l},0)`).call(d3.axisLeft(y).ticks(5));

  const line = d3.line().x((d,i)=>x(i)).y(d=>y(d));
  svg.append("path").attr("d", line(values)).attr("fill","none").attr("stroke","#2563eb").attr("stroke-width",2);

  if (unit) svg.append("text").attr("x", P.l).attr("y", P.t-6).attr("font-size", 11).attr("fill","#555").text(unit);
}

function setCharts(times, clouds, ghi) {
  drawLineChart({ holderId: LAYOUT.cloudDivId, labels: times, values: clouds, yMax: 100,  title:"Hourly Cloud % (daylight only)" });
  drawLineChart({ holderId: LAYOUT.ghiDivId,   labels: times, values: ghi,    yMax: 1000, title:"GHI (proxy) — daylight only", unit:"W/m²" });
}

/* ------------------------------------------------------------------ */
/* Map rendering                                                       */
/* ------------------------------------------------------------------ */
async function loadPunjabDistrictFeatures() {
  // 1) Try Punjab-only files first
  let geo = await fetchJsonFirst(PUNJAB_DISTRICT_URLS);
  let features = normalizeGeoToFeatures(geo);

  if (features?.length) return features; // already Punjab districts

  // 2) Fallback: load India districts and filter state==Punjab
  geo = await fetchJsonFirst(INDIA_DISTRICT_URLS);
  features = normalizeGeoToFeatures(geo);
  const punjab = filterToPunjab(features);
  if (punjab?.length) {
    console.log(`[GeoJSON] Using India districts → filtered to Punjab (${punjab.length})`);
    return punjab;
  }

  throw new Error("No Punjab GeoJSON found (Punjab-only and India-wide fallbacks failed).");
}

async function drawPunjabMap() {
  // Ensure holders exist
  const mapHolder = ensureEl({ id: LAYOUT.mapHolderId });
  const svgEl = ensureEl({ id: LAYOUT.mapSvgId, tag: "svg", parent: mapHolder });
  svgEl.setAttribute("viewBox","0 0 860 580"); svgEl.style.width="100%"; svgEl.style.height="420px";
  const svg = d3.select(svgEl); svg.selectAll("*").remove();

  // Load features (with filter fallback)
  let features;
  try { features = await loadPunjabDistrictFeatures(); }
  catch (e) {
    console.error(e);
    svg.append("text").attr("x",12).attr("y",24).attr("font-weight",700).text("Punjab map data not found");
    return;
  }

  const nameKey = guessDistrictNameKey(features[0]?.properties || {});
  const fc = { type:"FeatureCollection", features };
  mapProjection = d3.geoMercator().fitExtent([[10,10],[850,570]], fc);
  const path = d3.geoPath(mapProjection);

  const tooltip = d3.select("body").append("div")
    .attr("class","map-tooltip")
    .style("position","fixed").style("z-index",50).style("opacity",0)
    .style("background","rgba(255,255,255,.95)").style("border","1px solid #e5e7eb")
    .style("padding","6px 8px").style("border-radius","8px").style("font","12px system-ui");

  const g = svg.append("g").attr("class","districts");
  g.selectAll("path").data(features).join("path")
    .attr("d", path)
    .attr("fill","#e5f2ff").attr("stroke","#666").attr("stroke-width",0.8)
    .style("cursor","pointer")
    .on("pointerenter", function(){ d3.select(this).raise().attr("stroke-width",1.8); })
    .on("pointermove", (ev,d)=>{
      tooltip.style("opacity",1).style("left",(ev.clientX+10)+"px").style("top",(ev.clientY+10)+"px")
        .text(d.properties?.[nameKey] ?? "District");
    })
    .on("pointerleave", function(){ d3.select(this).attr("stroke-width",0.8); tooltip.style("opacity",0); })
    .on("click", async (_ev, d) => {
      const name = d.properties?.[nameKey] ?? "District";
      const [lon, lat] = d3.geoCentroid(d); // [λ, φ]
      selectedDistrict = name; selectedLatLon = { lat, lon };
      await ensureDistrictAndPlot(name, lat, lon);
    });

  // Labels
  const labels = svg.append("g").attr("class","labels").style("pointer-events","none");
  features.forEach(f=>{
    const [cx,cy] = path.centroid(f);
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      labels.append("text")
        .attr("x",cx).attr("y",cy)
        .attr("text-anchor","middle").attr("dominant-baseline","central")
        .attr("font-size",10).attr("font-weight",700)
        .attr("stroke","#fff").attr("stroke-width",2).attr("paint-order","stroke")
        .text(f.properties?.[nameKey] ?? "");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Interactions                                                        */
/* ------------------------------------------------------------------ */
const cache = new Map(); // district -> { times, clouds, ghi }

async function ensureDistrictAndPlot(name, lat, lon) {
  if (!cache.has(name)) {
    try { cache.set(name, await fetchHourly(lat, lon)); }
    catch (e) { console.warn("Fetch failed:", name, e); return; }
  }
  const { times, clouds, ghi } = cache.get(name);
  setCharts(times, clouds, ghi);

  const titleEl = ensureEl({ id: LAYOUT.titleId, parent: pickParent(LAYOUT.rightColSel) });
  titleEl.textContent = `${name} — next 48 h (daylight only)`;
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  // Make sure containers exist so we never hit null
  ensureEl({ id: LAYOUT.mapHolderId });
  ensureEl({ id: LAYOUT.cloudDivId, parent: pickParent(LAYOUT.rightColSel) });
  ensureEl({ id: LAYOUT.ghiDivId,   parent: pickParent(LAYOUT.rightColSel) });

  // Draw map
  await drawPunjabMap();

  // Default selection (Punjab center) if user hasn’t clicked
  if (!selectedDistrict) {
    await ensureDistrictAndPlot("Punjab", 31.0, 75.3);
  }

  // Optional: manual refresh button
  const btn = document.getElementById("refreshNow");
  if (btn) btn.addEventListener("click", async () => {
    if (!selectedLatLon) return;
    cache.delete(selectedDistrict); // force refetch
    await ensureDistrictAndPlot(selectedDistrict, selectedLatLon.lat, selectedLatLon.lon);
  });
});
