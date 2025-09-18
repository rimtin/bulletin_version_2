const DAILY_TZ = "Asia/Kolkata";
const INDIA_TOPO_URL = "https://raw.githubusercontent.com/udit-001/india-maps-data/refs/heads/main/topojson/india.json";

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
  tbody.innerHTML = subdivisions.map((s,i)=>`
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

  // fetch daily for each sub-division
  const dailyByKey = {}; // "State|Sub" -> {d1Pct, d2Pct, d1Bucket, d2Bucket}
  await Promise.allSettled(subdivisions.map(async (s, i) => {
    const key = `${s.state}|${s.name}`;
    const c = centroids[key];
    if (!c) return;

    try {
      const {values} = await fetchDaily(c.lat, c.lon); // [day1, day2]
      const d1 = Number(values?.[0]);
      const d2 = Number(values?.[1]);
      const b1 = pctToBucket(d1);
      const b2 = pctToBucket(d2);

      dailyByKey[key] = { d1Pct:d1, d2Pct:d2, d1Bucket:b1, d2Bucket:b2 };

      const tr = document.getElementById(`row-${i}`);
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
function drawBaseMap(svgId, features, projection, allowedStates) {
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

  const path = d3.geoPath(projection);

  svg.selectAll("path.state")
    .data(features)
    .join("path")
    .attr("class", "state")
    .attr("d", path)
    .attr("id", d => d.properties.st_nm)
    .attr("fill", d => allowedStates.includes(d.properties.st_nm) ? "#ccc" : "url(#diagonalHatch)")
    .attr("stroke", "#333")
    .attr("stroke-width", 1);
}

function colorStatesForDay(svgId, bucketsByState) {
  const svg = d3.select(svgId);
  Object.entries(bucketsByState).forEach(([state, bucket]) => {
    const sel = svg.select(`[id='${state}']`);
    if (!sel.empty()) sel.attr("fill", forecastColors[bucket] || "#ccc");
  });
}

// ---------- BOOT ----------
document.addEventListener("DOMContentLoaded", async () => {
  const dailyByKey = await buildDailyTableAndData();

  // Aggregate to state-level for coloring:
  // Punjab -> its own; Rajasthan -> cloudier (max) of W/E
  const day1ByState = {};
  const day2ByState = {};

  // Punjab
  const PB1 = dailyByKey["Punjab|Punjab"]?.d1Pct;
  const PB2 = dailyByKey["Punjab|Punjab"]?.d2Pct;
  day1ByState["Punjab"]    = pctToBucket(PB1);
  day2ByState["Punjab"]    = pctToBucket(PB2);

  // Rajasthan (max of East & West)
  const RJW1 = dailyByKey["Rajasthan|W-Raj"]?.d1Pct;
  const RJW2 = dailyByKey["Rajasthan|W-Raj"]?.d2Pct;
  const RJE1 = dailyByKey["Rajasthan|E-Raj"]?.d1Pct;
  const RJE2 = dailyByKey["Rajasthan|E-Raj"]?.d2Pct;

  const RJ1 = Math.max(
    Number.isFinite(RJW1) ? RJW1 : -1,
    Number.isFinite(RJE1) ? RJE1 : -1
  );
  const RJ2 = Math.max(
    Number.isFinite(RJW2) ? RJW2 : -1,
    Number.isFinite(RJE2) ? RJE2 : -1
  );

  day1ByState["Rajasthan"] = pctToBucket(RJ1 < 0 ? NaN : RJ1);
  day2ByState["Rajasthan"] = pctToBucket(RJ2 < 0 ? NaN : RJ2);

  // Draw maps
  const width = 860, height = 580;
  const data = await d3.json(INDIA_TOPO_URL);
  const features = topojson.feature(data, data.objects["states"]).features;
  const projection = d3.geoMercator().scale(850).center([89.8, 21.5]).translate([430, 290]);

  const allowedStates = ["Punjab", "Rajasthan"];
  drawBaseMap("#mapDay1", features, projection, allowedStates);
  drawBaseMap("#mapDay2", features, projection, allowedStates);

  colorStatesForDay("#mapDay1", day1ByState);
  colorStatesForDay("#mapDay2", day2ByState);
});
