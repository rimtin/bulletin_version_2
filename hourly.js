/* ========= Cloud Bulletin — Hourly (robust, no Chart.js) =========
 * - Punjab district map (labels + tooltip)
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

// Where to put things if the page doesn't have them already
const DEFAULT_LAYOUT = {
  mapHolderSelector: "#punjabMapHolder", // a div that should hold the SVG
  rightColSelector:  "#rightCol",        // a div where charts live
  mapSvgId:          "punjabMap",
  cloudDivId:        "cloudChart",
  ghiDivId:          "ghiChart",
  titleId:           "districtTitle"
};

// ---- Helpers to safely create elements ----
function ensureElement({ id, tag="div", parent=null, className="" }) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    if (className) el.className = className;
    (parent || document.body).appendChild(el);
  }
  return el;
}
function pickParent(selectorFallback) {
  const el = selectorFallback ? document.querySelector(selectorFallback) : null;
  return el || document.body;
}

// ---- Punjab districts GeoJSON (multiple fallbacks) ----
const geoUrlsPunjab = [
  "assets/punjab_districts.geojson",
  "punjab_districts.geojson",
  "https://rimtin.github.io/bulletin_version_2/punjab_districts.geojson",
  "https://raw.githubusercontent.com/datameet/maps/master/Districts/geojson/punjab_districts.geojson",
  "https://raw.githubusercontent.com/plotfile/india-geo/master/punjab_districts.geojson"
];

async function fetchFirstJson(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      console.log("[Punjab map] Loaded:", url);
      return j;
    } catch { /* try next */ }
  }
  throw new Error("No Punjab GeoJSON found (all fallbacks failed).");
}

// ---- Time + series helpers ----
function hourFromISO_IST(iso) {
  // Open-Meteo returns times already in IST when timezone=Asia/Kolkata
  return new Date(iso).getHours();
}
function filterDaylight(times, values) {
  const T = [], V = [];
  for (let i = 0; i < times.length; i++) {
    const h = hourFromISO_IST(times[i]);
    if (h >= DAYLIGHT_START && h <= DAYLIGHT_END) { T.push(times[i]); V.push(values[i]); }
  }
  return { T, V };
}
function ghiFromCloudPct(p) {
  // Placeholder model: GHI ≈ 950 * (1 - cloud%)
  return 950 * Math.max(0, 1 - (p || 0) / 100);
}
function seriesToGHI(values) {
  return values.map(ghiFromCloudPct);
}

// ---- Open-Meteo hourly fetch ----
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

  const { T, V } = filterDaylight(times, clouds);
  const ghi = seriesToGHI(V);
  return { times: T, clouds: V, ghi };
}

// ---- SVG charts (pure D3) ----
function drawLineChart(opts) {
  const {
    holderId, labels, values, yMax,
    title = "", unit = "", height = 260, width = 520
  } = opts;

  const holder = ensureElement({
    id: holderId,
    tag: "div",
    parent: pickParent(DEFAULT_LAYOUT.rightColSelector),
    className: "card"
  });
  holder.innerHTML = "";
  holder.style.background = "#fff";
  holder.style.borderRadius = "12px";
  holder.style.boxShadow = "0 10px 25px -5px rgba(0,0,0,.10), 0 10px 10px -5px rgba(0,0,0,.04)";
  holder.style.padding = "10px";

  const P = { t: 28, r: 18, b: 36, l: 44 };
  const W = width, H = height;

  const svg = d3.select(holder).append("svg")
    .attr("width", W).attr("height", H);

  svg.append("text")
    .attr("x", 12).attr("y", 18)
    .attr("font-weight", 800).attr("font-size", 13)
    .text(title);

  const x = d3.scalePoint()
    .domain(d3.range(labels.length))
    .range([P.l, W - P.r]);

  const y = d3.scaleLinear()
    .domain([0, yMax]).nice()
    .range([H - P.b, P.t + 6]);

  const xAxis = d3.axisBottom(x)
    .tickValues(x.domain().filter(i => i % 2 === 0))
    .tickFormat(i => new Date(labels[i]).toLocaleTimeString("en-IN", { hour: "numeric" }));

  const yAxis = d3.axisLeft(y).ticks(5);

  svg.append("g")
    .attr("transform", `translate(0,${H - P.b})`)
    .call(xAxis);

  svg.append("g")
    .attr("transform", `translate(${P.l},0)`)
    .call(yAxis);

  const line = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d));

  svg.append("path")
    .attr("d", line(values))
    .attr("fill", "none")
    .attr("stroke", "#2563eb")
    .attr("stroke-width", 2);

  if (unit) {
    svg.append("text")
      .attr("x", P.l).attr("y", P.t - 6)
      .attr("font-size", 11).attr("fill", "#555")
      .text(unit);
  }
}

function setCharts(times, clouds, ghi) {
  drawLineChart({
    holderId: DEFAULT_LAYOUT.cloudDivId,
    labels: times, values: clouds, yMax: 100,
    title: "Hourly Cloud % (daylight only)"
  });
  drawLineChart({
    holderId: DEFAULT_LAYOUT.ghiDivId,
    labels: times, values: ghi, yMax: 1000,
    title: "GHI (proxy) — daylight only", unit: "W/m²"
  });
}

// ---- Map (Punjab districts) ----
function guessDistrictKey(props) {
  const keys = ["DISTRICT", "district", "NAME_2", "name", "dtname", "District", "Dist_Name"];
  return keys.find(k => k in (props || {})) || "name";
}

async function drawPunjabMap() {
  // Ensure a holder and an SVG exist (so we never get null)
  const mapHolder = ensureElement({
    id: DEFAULT_LAYOUT.mapHolderSelector.replace("#",""),
    parent: pickParent(null)
  });
  const svg = ensureElement({
    id: DEFAULT_LAYOUT.mapSvgId,
    tag: "svg",
    parent: mapHolder
  });
  // Size (similar to your India SVGs)
  svg.setAttribute("viewBox", "0 0 860 580");
  svg.style.width = "100%";
  svg.style.height = "420px";
  const d3svg = d3.select(svg);
  d3svg.selectAll("*").remove();

  // Load GeoJSON
  let features = [];
  try {
    const geo = await fetchFirstJson(geoUrlsPunjab);
    features = (geo.type === "Topology")
      ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features
      : (geo.features || []);
  } catch (e) {
    console.error(e);
    d3svg.append("text").attr("x", 12).attr("y", 24).attr("font-weight", 700).text("Punjab map not found");
    return;
  }
  if (!features.length) {
    d3svg.append("text").attr("x", 12).attr("y", 24).text("No features"); return;
  }

  const districtKey = guessDistrictKey(features[0].properties || {});
  const fc = { type: "FeatureCollection", features };
  mapProjection = d3.geoMercator().fitExtent([[10, 10], [850, 570]], fc);
  const path = d3.geoPath(mapProjection);

  // Tooltip
  const tooltip = d3.select("body").append("div")
    .attr("class", "map-tooltip")
    .style("position", "fixed").style("z-index", 50).style("opacity", 0)
    .style("background", "rgba(255,255,255,.95)").style("border", "1px solid #e5e7eb")
    .style("padding", "6px 8px").style("border-radius", "8px").style("font", "12px system-ui");

  // District shapes
  const g = d3svg.append("g").attr("class", "districts");
  g.selectAll("path").data(features).join("path")
    .attr("d", path)
    .attr("fill", "#e5f2ff")
    .attr("stroke", "#666")
    .attr("stroke-width", 0.8)
    .style("cursor", "pointer")
    .on("pointerenter", function(){ d3.select(this).raise().attr("stroke-width", 1.8); })
    .on("pointermove", (ev, d)=>{
      tooltip.style("opacity", 1)
        .style("left", (ev.clientX + 10) + "px")
        .style("top", (ev.clientY + 10) + "px")
        .text(d.properties[districtKey]);
    })
    .on("pointerleave", function(){ d3.select(this).attr("stroke-width", 0.8); tooltip.style("opacity", 0); })
    .on("click", async (ev, d) => {
      const name = d.properties[districtKey];
      const [lon, lat] = d3.geoCentroid(d); // [λ, φ]
      selectedDistrict = name;
      selectedLatLon   = { lat, lon };
      await ensureDistrictAndPlot(name, lat, lon);
    });

  // Labels
  const labels = d3svg.append("g").attr("class", "labels").style("pointer-events", "none");
  features.forEach(f => {
    const [cx, cy] = path.centroid(f);
    if (isFinite(cx) && isFinite(cy)) {
      labels.append("text")
        .attr("x", cx).attr("y", cy)
        .attr("text-anchor", "middle").attr("dominant-baseline", "central")
        .attr("font-size", 10).attr("font-weight", 700)
        .attr("stroke", "#fff").attr("stroke-width", 2).attr("paint-order", "stroke")
        .text(f.properties[districtKey]);
    }
  });
}

// ---- Interactions ----
const hourlyCache = new Map(); // district -> { times, clouds, ghi }

async function ensureDistrictAndPlot(name, lat, lon) {
  if (!hourlyCache.has(name)) {
    try {
      const { times, clouds, ghi } = await fetchHourly(lat, lon);
      hourlyCache.set(name, { times, clouds, ghi });
    } catch (e) {
      console.warn("Fetch failed:", name, e);
      return;
    }
  }
  const { times, clouds, ghi } = hourlyCache.get(name);
  setCharts(times, clouds, ghi);

  const titleEl = ensureElement({
    id: DEFAULT_LAYOUT.titleId,
    parent: pickParent(DEFAULT_LAYOUT.rightColSelector)
  });
  titleEl.textContent = `${name} — next 48 h (daylight only)`;
}

// ---- Init ----
document.addEventListener("DOMContentLoaded", async () => {
  // Make sure holders exist so we never get null
  ensureElement({
    id: DEFAULT_LAYOUT.mapHolderSelector.replace("#",""),
    parent: pickParent(null)
  });
  ensureElement({
    id: DEFAULT_LAYOUT.cloudDivId,
    parent: pickParent(DEFAULT_LAYOUT.rightColSelector)
  });
  ensureElement({
    id: DEFAULT_LAYOUT.ghiDivId,
    parent: pickParent(DEFAULT_LAYOUT.rightColSelector)
  });

  // Draw map
  await drawPunjabMap();

  // Default district (if user hasn’t clicked yet)
  if (!selectedDistrict) {
    const fallback = { name: "Punjab", lat: 31.0, lon: 75.3 };
    await ensureDistrictAndPlot(fallback.name, fallback.lat, fallback.lon);
  }

  // Optional refresh button
  const btn = document.getElementById("refreshNow");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!selectedLatLon) return;
      hourlyCache.delete(selectedDistrict); // force a refetch
      await ensureDistrictAndPlot(selectedDistrict, selectedLatLon.lat, selectedLatLon.lon);
    });
  }
});
