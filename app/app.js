// === App logic for forecast ===

// Centroids for each state (in pixels after projection)
window.stateCentroids = {};
// States used for the table (comes from data.js -> states)
window.actualStateList = [];

/* ------------------ EXISTING MAP DRAW (unchanged) ------------------ */
function drawMap(svgId) {
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  // Pattern for states we don't forecast (hatch)
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

  const projection = d3.geoMercator()
    .scale(850)
    .center([89.8, 21.5])
    .translate([430, 290]);

  const path = d3.geoPath().projection(projection);

  // Load India states TopoJSON (public)
  d3.json("https://raw.githubusercontent.com/udit-001/india-maps-data/refs/heads/main/topojson/india.json")
    .then(data => {
      const features = topojson.feature(data, data.objects["states"]).features;
      const nameProp = "st_nm";

      // Use the list from data.js
      const allowedStates = states.slice();
      actualStateList = allowedStates;

      // Draw states
      svg.selectAll("path.state")
        .data(features)
        .enter()
        .append("path")
        .attr("class", "state")
        .attr("d", path)
        .attr("id", d => {
          const stateName = d.properties[nameProp];
          const centroid = path.centroid(d);
          window.stateCentroids[stateName] = centroid;
          return stateName;
        })
        .attr("data-map", svgId.replace("#", "")) // indiaMapDay1 | indiaMapDay2
        .attr("fill", d => {
          const stateName = d.properties[nameProp];
          return allowedStates.includes(stateName) ? "#ccc" : "url(#diagonalHatch)";
        })
        .attr("stroke", "#333")
        .attr("stroke-width", 1)
        .on("mouseover", function () { d3.select(this).attr("stroke-width", 2.5); })
        .on("mouseout", function () { d3.select(this).attr("stroke-width", 1); });

      // After both maps draw, build tables + sync
      if (svgId === "#indiaMapDay2") {
        initializeForecastTable();
        renderSubdivisionTable();    // chart-only subdivision table
        addTableHoverSync();         // hover a row -> highlight map state
        updateMapColors();           // initial fills from selects (we will auto-set them below)

        // NEW: start hourly automation once DOM exists
        initHourlyAutomation().catch(console.error);
      }
    })
    .catch(err => {
      console.error("Map loading error:", err);
      alert("Could not load map. Please check the TopoJSON path or object key.");
    });
}

window.drawMap = drawMap;

/** Build the Day1/Day2 forecast dropdown table (unchanged UI) */
function initializeForecastTable() {
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  actualStateList.forEach((state, index) => {
    const row = document.createElement("tr");
    row.setAttribute("data-state", state);
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${state}</td>
      <td>
        <select onchange="updateMapColors()">
          ${forecastOptions.map(opt => `<option>${opt}</option>`).join("")}
        </select>
      </td>
      <td>
        <select onchange="updateMapColors()">
          ${forecastOptions.map(opt => `<option>${opt}</option>`).join("")}
        </select>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/** Sync table row hover with map: bold the state outline on both maps (unchanged) */
function addTableHoverSync() {
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;

  const newTbody = tbody.cloneNode(true);
  tbody.parentNode.replaceChild(newTbody, tbody);

  newTbody.querySelectorAll("tr").forEach(tr => {
    const state = tr.getAttribute("data-state");
    tr.addEventListener("mouseenter", () => {
      d3.selectAll(`[id='${state}']`).attr("stroke-width", 2.5);
    });
    tr.addEventListener("mouseleave", () => {
      d3.selectAll(`[id='${state}']`).attr("stroke-width", 1);
    });

    tr.querySelectorAll("select").forEach(sel => {
      sel.addEventListener("change", updateMapColors);
    });
  });
}

/** Apply selected colors to states on Day 1 and Day 2 maps (unchanged) */
function updateMapColors() {
  const rows = document.querySelectorAll("#forecast-table-body tr");
  rows.forEach(row => {
    const state = row.children[1]?.textContent?.trim();
    const forecast1 = row.children[2]?.querySelector("select")?.value;
    const forecast2 = row.children[3]?.querySelector("select")?.value;

    const color1 = forecastColors[forecast1] || "#ccc";
    const color2 = forecastColors[forecast2] || "#ccc";

    const region1 = d3.select(`[id='${state}'][data-map='indiaMapDay1']`);
    const region2 = d3.select(`[id='${state}'][data-map='indiaMapDay2']`);

    if (!region1.empty()) region1.attr("fill", color1);
    if (!region2.empty()) region2.attr("fill", color2);
  });

  updateMapIcons();
}

/** Emoji icons at state centroids for both days (unchanged) */
function updateMapIcons() {
  const iconSize = 18;

  d3.selectAll(".forecast-icon").remove();

  document.querySelectorAll("#forecast-table-body tr").forEach(row => {
    const state = row.children[1]?.textContent?.trim();
    const forecast1 = row.children[2]?.querySelector("select")?.value;
    const forecast2 = row.children[3]?.querySelector("select")?.value;

    const coords = window.stateCentroids[state];
    const icon1 = forecastIcons[forecast1];
    const icon2 = forecastIcons[forecast2];

    if (coords && icon1) {
      d3.select("#indiaMapDay1")
        .append("text")
        .attr("class", "forecast-icon")
        .attr("x", coords[0])
        .attr("y", coords[1])
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle")
        .attr("font-size", iconSize)
        .text(icon1);
    }

    if (coords && icon2) {
      d3.select("#indiaMapDay2")
        .append("text")
        .attr("class", "forecast-icon")
        .attr("x", coords[0])
        .attr("y", coords[1])
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle")
        .attr("font-size", iconSize)
        .text(icon2);
    }
  });
}

/** Subdivision (chart) table (unchanged structure) */
function renderSubdivisionTable() {
  const tbody = document.getElementById("subdivision-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  let serial = 1;
  states.forEach(state => {
    const rows = (window.subdivisions || []).filter(s => s.state === state);
    rows.forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${serial++}</td>
        <td>${state}</td>
        <td>${row.subNo}</td>
        <td>${row.name}</td>
        <td contenteditable="true"></td>
      `;
      tbody.appendChild(tr);
    });
  });
}

/* ------------------ NEW: HOURLY AUTOMATION ------------------ */

// 1) Config for the three regions we care about (centroids in lat/lon)
const HOURLY_REGIONS = {
  "Punjab|Punjab":            { lat: 31.0000, lon: 75.0000 },
  "Rajasthan|W-Raj":          { lat: 26.9000, lon: 71.0000 }, // West Rajasthan approx
  "Rajasthan|E-Raj":          { lat: 26.0000, lon: 75.6000 }  // East Rajasthan approx
};

// % → bucket mapping
function pctToBucket(pct) {
  if (!Number.isFinite(pct)) return "Clear Sky";
  if (pct <= 10) return "Clear Sky";
  if (pct <= 35) return "Low Cloud Cover";
  if (pct <= 65) return "Medium Cloud Cover";
  if (pct <= 85) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}

const IST_TZ = "Asia/Kolkata";
const MAX_HOURS = 48;
const hourlyStore = {}; // key -> { times:[], values:[] }

async function fetchHourly(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "cloud_cover");
  url.searchParams.set("timezone", IST_TZ);
  url.searchParams.set("forecast_days", "2");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Open-Meteo error: " + res.status);
  const data = await res.json();
  return {
    times: (data.hourly?.time || []).slice(0, MAX_HOURS),
    values: (data.hourly?.cloud_cover || []).slice(0, MAX_HOURS)
  };
}

async function refreshAllHourly() {
  const tasks = Object.entries(HOURLY_REGIONS).map(async ([key, {lat, lon}]) => {
    try {
      const {times, values} = await fetchHourly(lat, lon);
      hourlyStore[key] = {times, values};
    } catch (e) { console.warn("Hourly fetch failed:", key, e); }
  });
  await Promise.allSettled(tasks);
}

function getPct(key, hourIdx) {
  const entry = hourlyStore[key];
  if (!entry || !entry.values?.length) return NaN;
  const i = Math.max(0, Math.min(entry.values.length - 1, hourIdx));
  return entry.values[i];
}

// Aggregate East + West into a single Rajasthan bucket for the state view
function getRajasthanBucket(hourIdx) {
  const west = getPct("Rajasthan|W-Raj", hourIdx);
  const east = getPct("Rajasthan|E-Raj", hourIdx);
  const worstPct = Math.max(
    Number.isFinite(west) ? west : -1,
    Number.isFinite(east) ? east : -1
  );
  if (worstPct < 0) return "Clear Sky"; // fallback
  return pctToBucket(worstPct);
}

// Apply the chosen hour to the UI by **setting the selects** (keeps your UI the same)
function applyHourToUI(hourIdx) {
  const any = hourlyStore["Punjab|Punjab"] || hourlyStore["Rajasthan|W-Raj"] || hourlyStore["Rajasthan|E-Raj"];
  const label = (any && any.times && any.times[hourIdx]) ? any.times[hourIdx] : `T+${hourIdx}h`;
  const hourLabel = document.getElementById("hourLabel");
  if (hourLabel) hourLabel.textContent = label + " IST";

  // Punjab
  const pbPct = getPct("Punjab|Punjab", hourIdx);
  const pbBucket = pctToBucket(pbPct);
  setStateRowSelects("Punjab", pbBucket);

  // Rajasthan (aggregate W/E to a single state color)
  const rjBucket = getRajasthanBucket(hourIdx);
  setStateRowSelects("Rajasthan", rjBucket);

  // Repaint maps/icons via your existing flow
  updateMapColors();
}

// Helper: set both Day1 and Day2 selects for a given state
function setStateRowSelects(stateName, bucket) {
  const row = [...document.querySelectorAll("#forecast-table-body tr")]
    .find(tr => (tr.children[1]?.textContent?.trim() === stateName));
  if (!row) return;
  const sel1 = row.children[2]?.querySelector("select");
  const sel2 = row.children[3]?.querySelector("select");
  if (sel1) sel1.value = bucket;
  if (sel2) sel2.value = bucket;
}

// Wire up controls and auto-refresh
async function initHourlyAutomation() {
  const hourInput = document.getElementById("hourSelect");
  const refreshBtn = document.getElementById("refreshNow");

  // fetch once
  await refreshAllHourly();

  const setHour = (h) => {
    const idx = Math.max(0, Math.min(MAX_HOURS - 1, Number(h)||0));
    if (hourInput) hourInput.value = String(idx);
    applyHourToUI(idx);
  };

  if (hourInput) hourInput.addEventListener("input", e => setHour(e.target.value));
  if (refreshBtn) refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    await refreshAllHourly();
    setHour(hourInput?.value ?? 0);
    refreshBtn.disabled = false;
  });

  // default to current hour index 0
  setHour(0);

  // optional: refresh every hour to keep live
  setInterval(async () => {
    await refreshAllHourly();
    setHour(hourInput?.value ?? 0);
  }, 60 * 60 * 1000);
}

/* ------------------ INIT ------------------ */
window.onload = () => {
  if (typeof updateISTDate === "function") updateISTDate();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
};
