// ---------- CONFIG ----------
const DAILY_TZ = "Asia/Kolkata";
// Robust CDN path (kept separate so you can swap easily if you mirror it)
const INDIA_TOPO_URL = "https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@main/topojson/india.json";

// If your data.js didn’t define these helpers, make minimal no-op fallbacks:
window.forecastColors = window.forecastColors || {
  "Clear Sky": "#A7D8EB",
  "Low Cloud Cover": "#C4E17F",
  "Medium Cloud Cover": "#FFF952",
  "High Cloud Cover": "#E69536",
  "Overcast Cloud Cover": "#FF4D4D"
};
window.forecastOptions = window.forecastOptions || Object.keys(window.forecastColors);

function pctToBucket(pct){
  if (!Number.isFinite(pct)) return "No Forecast";
  if (pct < 10) return "Clear Sky";
  if (pct < 30) return "Low Cloud Cover";
  if (pct < 60) return "Medium Cloud Cover";
  if (pct < 85) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}
function classForBucket(b){
  return {
    "Clear Sky": "cell-clear",
    "Low Cloud Cover": "cell-low",
    "Medium Cloud Cover": "cell-medium",
    "High Cloud Cover": "cell-high",
    "Overcast Cloud Cover": "cell-overcast",
    "No Forecast": "cell-noforecast"
  }[b] || "";
}
function updateISTDate(id){
  try{
    const el = document.getElementById(id);
    const fmt = new Intl.DateTimeFormat("en-IN", {
      timeZone: DAILY_TZ, weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
    el.textContent = fmt.format(new Date());
  }catch(e){}
}

// ---------- DAILY API ----------
async function fetchDaily(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("daily", "cloud_cover_mean");
  url.searchParams.set("timezone", DAILY_TZ);
  url.searchParams.set("forecast_days", "2");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Open-Meteo daily " + res.status);
  const data = await res.json();
  return {
    times: data?.daily?.time || [],
    values: data?.daily?.cloud_cover_mean || []
  };
}

// ---------- TABLE FILL ----------
async function buildDailyTableAndData() {
  updateISTDate("dateEl");
  const tbody = document.querySelector("#dailyTable tbody");
  const rows = (window.subdivisions || []).map((s,i)=>`
    <tr id="row-${i}">
      <td>${i+1}</td>
      <td>${s.state}</td>
      <td>${s.name}</td>
      <td class="d1-bucket">Loading…</td>
      <td class="d1-pct">—</td>
      <td class="d2-bucket">Loading…</td>
      <td class="d2-pct">—</td>
    </tr>
  `).join("");
  tbody.innerHTML = rows;

  const dailyByKey = {}; // "State|Sub" -> {d1Pct, d2Pct, d1Bucket, d2Bucket}
  await Promise.allSettled((window.subdivisions || []).map(async (s, i) => {
    const key = `${s.state}|${s.name}`;
    const c = (window.centroids || {})[key];
    if (!c) return;

    try {
      const {values} = await fetchDaily(c.lat, c.lon); // [day1, day2]
      const d1 = Number(values?.[0]);
      const d2 = Number(values?.[1]);
      const b1 = pctToBucket(d1);
      const b2 = pctToBucket(d2);

      dailyByKey[key] = { d1Pct:d1, d2Pct:d2, d1Bucket:b1, d2Bucket:b2 };

      const tr = document.getElementById(`row-${i}`);
      if (!tr) return;
      const d1b = tr.querySelector(".d1-bucket"); const d1p = tr.querySelector(".d1-pct");
      const d2b = tr.querySelector(".d2-bucket"); const d2p = tr.querySelector(".d2-pct");

      d1b.textContent = b1; d1b.classList.add(classForBucket(b1));
      d1p.textContent = Number.isFinite(d1) ? d1.toFixed(0) + "%" : "—";
      d2b.textContent = b2; d2b.classList.add(classForBucket(b2));
      d2p.textContent = Number.isFinite(d2) ? d2.toFixed(0) + "%" : "—";
    } catch(e){
      console.warn("Daily fetch failed for", key, e);
    }
  }));

  return dailyByKey;
}

// ---------- MAP DRAW ----------
function findIndiaObjectName(topology){
  // Pick the first object that looks like "states" (has st_nm / STATE_NAME)
  const candidates = Object.keys(topology.objects || {});
  for (const k of candidates){
    try{
      const f = topojson.feature(topology, topology.objects[k]).features || [];
      if (!f.length) continue;
      const p = f[0].properties || {};
      if ("st_nm" in p || "ST_NM" in p || "state" in p || "STATE" in p || "NAME_1" in p) return k;
    }catch(e){}
  }
  // fallback to first
  return candidates[0];
}
function getStateName(props){
  return props.st_nm || props.ST_NM || props.state || props.STATE || props.NAME_1 || props.name || "";
}
function drawBaseMap(svgId, features, allowedStates) {
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs.append("pattern")
    .attr("id", "diagonalHatch")
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6)
    .attr("height", 6)
    .append("path")
    .attr("d", "M0,0 l6,6")
    .attr("stroke", "#999")
    .attr("stroke-width", 1);

  // Fit projection to the features and the current SVG viewBox
  const vb = svg.attr("viewBox").split(" ").map(Number); // [0,0,860,580]
  const width = vb[2], height = vb[3];
  const projection = d3.geoMercator();
  const path = d3.geoPath(projection);
  projection.fitSize([width, height], {type:"FeatureCollection", features});

  svg.selectAll("path.state")
    .data(features)
    .join("path")
    .attr("class", "state")
    .attr("d", path)
    .attr("id", d => getStateName(d.properties))
    .attr("fill", d => allowedStates.has(getStateName(d.properties)) ? "#ccc" : "url(#diagonalHatch)")
    .attr("stroke", "#333")
    .attr("stroke-width", 0.8);
}

function colorStatesForDay(svgId, bucketsByState) {
  const svg = d3.select(svgId);
  Object.entries(bucketsByState).forEach(([state, bucket]) => {
    const sel = svg.select(`[id='${CSS.escape(state)}']`);
    if (!sel.empty()) sel.attr("fill", forecastColors[bucket] || "#ccc");
  });
}

// ---------- BOOT ----------
document.addEventListener("DOMContentLoaded", async () => {
  const dailyByKey = await buildDailyTableAndData();

  // Aggregate to state-level (max = "cloudier")
  const day1ByState = {};
  const day2ByState = {};
  const statesInTable = new Set((window.subdivisions || []).map(s => s.state));

  for (const s of (window.subdivisions || [])) {
    const key = `${s.state}|${s.name}`;
    const rec = dailyByKey[key];
    if (!rec) continue;
    const d1 = Number.isFinite(rec.d1Pct) ? rec.d1Pct : -1;
    const d2 = Number.isFinite(rec.d2Pct) ? rec.d2Pct : -1;

    if (!day1ByState[s.state] || d1 > day1ByState[s.state].pct) day1ByState[s.state] = { pct: d1 };
    if (!day2ByState[s.state] || d2 > day2ByState[s.state].pct) day2ByState[s.state] = { pct: d2 };
  }

  // convert pct -> bucket (keep missing as No Forecast)
  const day1BucketByState = {};
  const day2BucketByState = {};
  for (const st of statesInTable) {
    const p1 = day1ByState[st]?.pct;
    const p2 = day2ByState[st]?.pct;
    day1BucketByState[st] = pctToBucket(Number.isFinite(p1) ? p1 : NaN);
    day2BucketByState[st] = pctToBucket(Number.isFinite(p2) ? p2 : NaN);
  }

  // Load TopoJSON and draw maps
  const topo = await d3.json(INDIA_TOPO_URL);
  const objName = findIndiaObjectName(topo);
  const features = topojson.feature(topo, topo.objects[objName]).features;

  // Keep only the states we actually use (others get hatch)
  drawBaseMap("#mapDay1", features, statesInTable);
  drawBaseMap("#mapDay2", features, statesInTable);

  colorStatesForDay("#mapDay1", day1BucketByState);
  colorStatesForDay("#mapDay2", day2BucketByState);
});
