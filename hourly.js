/* ====== Hourly (India → Punjab districts) ======
 * - Loads Punjab district GeoJSON (several fallbacks)
 * - Labels districts, hover tooltip
 * - Click district -> fetch Open-Meteo hourly cloud (48h)
 * - Charts show DAYLIGHT ONLY (04:00–19:00 IST)
 * - Uses Chart.js if available, otherwise builds simple SVG lines
 */

const IST_TZ = "Asia/Kolkata";
const DAYLIGHT_START = 4;   // 4:00
const DAYLIGHT_END   = 19;  // 19:00
const MAX_HOURS = 48;

let selectedDistrict = null;
let selectedLatLon   = null;
let mapProjection    = null;

const geoUrlsPunjab = [
  // Put a copy in your repo for fastest load:
  "assets/punjab_districts.geojson",
  "punjab_districts.geojson",
  // GitHub project fallbacks (works if you add the file later):
  "https://rimtin.github.io/bulletin_version_2/punjab_districts.geojson",
  // Community datasets (safe fallbacks if you update to real URLs in your repo)
  "https://raw.githubusercontent.com/datameet/maps/master/Districts/geojson/punjab_districts.geojson",
  "https://raw.githubusercontent.com/plotfile/india-geo/master/punjab_districts.geojson"
];

const hourlyStore = new Map(); // key=district -> {times:[], clouds:[], ghi:[]}

/* ---------- helpers ---------- */
const fmtIST = s => new Date(s); // Open-Meteo returns ISOZ; we only show clock labels

function hourIST(iso) {
  const d = new Date(iso);
  // Convert to IST by using locale string; safer to slice hour from ISO then adjust 5:30
  // but Open-Meteo supports timezone=Asia/Kolkata so hours are already IST.
  return d.getHours();
}
function filterDaylight(times, values) {
  const t=[], v=[];
  for (let i = 0; i < times.length; i++) {
    const h = hourIST(times[i]);
    if (h >= DAYLIGHT_START && h <= DAYLIGHT_END) { t.push(times[i]); v.push(values[i]); }
  }
  return { t, v };
}
function ghiProxyFromCloud(pct) {
  // simple placeholder model like we discussed: 950 * (1 - cloud%)
  // (clamped ≥0). You can swap with real GHI later.
  const ghi = 950 * Math.max(0, 1 - (pct||0)/100);
  return Number.isFinite(ghi) ? ghi : 0;
}
function seriesToGHI(values) {
  return values.map(v => ghiProxyFromCloud(v));
}

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

  const { t, v } = filterDaylight(times, clouds);   // daylight only
  const ghi = seriesToGHI(v);

  return { times: t, clouds: v, ghi };
}

/* ---------- charts (Chart.js first, else SVG) ---------- */
let cloudChart = null, ghiChart = null;

function ensureCanvas(id, wrapId) {
  let c = document.getElementById(id);
  if (c) return c;
  // if there isn't a canvas, create one inside wrap
  const wrap = document.getElementById(wrapId) || document.body;
  c = document.createElement("canvas");
  c.id = id;
  wrap.innerHTML = "";
  wrap.appendChild(c);
  return c;
}

function upsertChartJs(id, label, labels, data, yMax, colorIdx=0) {
  const canvas = ensureCanvas(id, id+"Wrap");
  const ctx = canvas.getContext("2d");
  const cfg = {
    type: "line",
    data: {
      labels: labels.map(s => new Date(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })),
      datasets: [{
        label, data,
        fill: false, tension: 0.25, pointRadius: 0, borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, suggestedMax: yMax },
        x: { ticks: { autoSkip: true, maxTicksLimit: 12 } }
      },
      plugins: { legend: { display: false } }
    }
  };
  if (id === "cloudChart") {
    if (cloudChart) { cloudChart.data = cfg.data; cloudChart.update(); }
    else cloudChart = new Chart(ctx, cfg);
  } else {
    if (ghiChart) { ghiChart.data = cfg.data; ghiChart.update(); }
    else ghiChart = new Chart(ctx, cfg);
  }
}

function simpleSvgLine(wrapId, labels, data, yMax, unit) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = "";
  const W=480, H=240, P=28;
  const svg = d3.select(wrap).append("svg").attr("width", W).attr("height", H);
  const x = d3.scalePoint().domain(d3.range(labels.length)).range([P, W-P]);
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([H-P, P]);

  svg.append("g").attr("transform",`translate(0,${H-P})`).call(d3.axisBottom(x).tickValues(x.domain().filter(i=>i%3===0)).tickFormat(i=>{
    return new Date(labels[i]).toLocaleTimeString("en-IN", { hour: "numeric" });
  }));
  svg.append("g").attr("transform",`translate(${P},0)`).call(d3.axisLeft(y).ticks(5));

  const line = d3.line().x((d,i)=>x(i)).y(d=>y(d));
  svg.append("path").attr("d", line(data)).attr("fill","none").attr("stroke","#2563eb").attr("stroke-width",2);
}

function setCharts(times, clouds, ghi){
  if (window.Chart) {
    upsertChartJs("cloudChart", "Hourly Cloud %", times, clouds, 100);
    upsertChartJs("ghiChart",   "GHI (proxy)",   times, ghi,    1000);
  } else {
    simpleSvgLine("cloudChartWrap", times, clouds, 100, "%");
    simpleSvgLine("ghiChartWrap",   times, ghi,    1000, "W/m²");
  }
}

/* ---------- Map (Punjab districts) ---------- */
function detectDistrictKey(sampleProps) {
  const keys = ["DISTRICT","district","NAME_2","name","dtname","District","Dist_Name"];
  return keys.find(k => k in sampleProps) || "name";
}

async function fetchFirst(urls){
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      console.log("[Punjab map] Loaded:", url);
      return j;
    } catch {}
  }
  throw new Error("No Punjab GeoJSON found.");
}

function drawLabels(svg, features, path, districtKey){
  const g = svg.append("g").attr("class","labels").style("pointer-events","none");
  const f = { type:"FeatureCollection", features: [] };
  features.forEach(feat=>{
    const [cx, cy] = path.centroid(feat);
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      g.append("text")
        .attr("x", cx).attr("y", cy)
        .attr("text-anchor","middle").attr("dominant-baseline","central")
        .attr("font-size", 10).attr("font-weight", 700)
        .attr("stroke","#fff").attr("stroke-width",2).attr("paint-order","stroke")
        .text(feat.properties[districtKey]);
    }
  });
}

async function drawPunjabMap(){
  const svg = d3.select("#punjabMap");
  if (svg.empty()) return;
  svg.selectAll("*").remove();

  // Load GeoJSON (FeatureCollection)
  let features = [];
  try{
    const geo = await fetchFirst(geoUrlsPunjab);
    features = (geo.type === "Topology")
      ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features
      : (geo.features || []);
  }catch(e){
    console.error(e);
    svg.append("text").attr("x",12).attr("y",24).attr("font-weight",700).text("Punjab map not found");
    return;
  }
  if (!features.length){ svg.append("text").attr("x",12).attr("y",24).text("No features"); return; }

  const districtKey = detectDistrictKey(features[0].properties || {});
  const fc = { type:"FeatureCollection", features };

  mapProjection = d3.geoMercator().fitExtent([[10,10],[850,570]], fc);
  const path = d3.geoPath(mapProjection);

  // base layer
  const g = svg.append("g").attr("class","districts");
  const tooltip = d3.select("body")
    .append("div").attr("class","map-tooltip")
    .style("position","fixed").style("z-index",50).style("opacity",0)
    .style("background","rgba(255,255,255,.95)").style("border","1px solid #e5e7eb")
    .style("padding","6px 8px").style("border-radius","8px").style("font", "12px system-ui");

  g.selectAll("path").data(features).join("path")
    .attr("d", path)
    .attr("fill", "#e5f2ff")
    .attr("stroke", "#666")
    .attr("stroke-width", 0.8)
    .style("cursor","pointer")
    .on("pointerenter", function(){ d3.select(this).raise().attr("stroke-width",1.8); })
    .on("pointermove", (ev, d)=>{
      tooltip.style("opacity",1).style("left",(ev.clientX+10)+"px").style("top",(ev.clientY+10)+"px")
        .text(d.properties[districtKey]);
    })
    .on("pointerleave", function(){ d3.select(this).attr("stroke-width",0.8); tooltip.style("opacity",0); })
    .on("click", async (ev, d) => {
      const name = d.properties[districtKey];
      // geographic centroid for fetch (lon,lat)
      const [lon, lat] = d3.geoCentroid(d);   // returns [λ, φ]
      selectedDistrict = name;
      selectedLatLon   = { lat, lon };
      await ensureDistrictDataAndPlot(name, lat, lon);
    });

  drawLabels(svg, features, path, districtKey);
}

/* ---------- interactions ---------- */
async function ensureDistrictDataAndPlot(name, lat, lon){
  if (!hourlyStore.has(name)) {
    try {
      const { times, clouds, ghi } = await fetchHourly(lat, lon);
      hourlyStore.set(name, { times, clouds, ghi });
    } catch (e) {
      console.warn("Fetch failed:", name, e);
      return;
    }
  }
  const { times, clouds, ghi } = hourlyStore.get(name);
  setCharts(times, clouds, ghi);

  const titleEl = document.getElementById("districtTitle");
  if (titleEl) titleEl.textContent = `${name} — next 48 h (daylight only)`;
}

/* ---------- init ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  // 1) Map
  await drawPunjabMap();

  // 2) Default selection: center of Punjab (if user hasn’t clicked)
  if (!selectedDistrict) {
    const fallback = { name: "Punjab", lat: 31.0, lon: 75.3 };
    await ensureDistrictDataAndPlot(fallback.name, fallback.lat, fallback.lon);
  }

  // 3) Refresh button (if present)
  const btn = document.getElementById("refreshNow");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!selectedLatLon) return;
      hourlyStore.delete(selectedDistrict); // force refetch
      await ensureDistrictDataAndPlot(selectedDistrict, selectedLatLon.lat, selectedLatLon.lon);
    });
  }
});
