// daily.js — uses app.js for all map work

const DAILY_TZ = "Asia/Kolkata";

// --- Open-Meteo daily API ---
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
    d1: Number(data?.daily?.cloud_cover_mean?.[0]),
    d2: Number(data?.daily?.cloud_cover_mean?.[1]),
  };
}

// --- same bucket logic used across the app ---
function pctToBucket(pct){
  if (!Number.isFinite(pct)) return "Overcast Cloud Cover"; // safe fallback
  if (pct < 10) return "Clear Sky";
  if (pct < 30) return "Low Cloud Cover";
  if (pct < 60) return "Medium Cloud Cover";
  if (pct < 85) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}

// Fill the selects that app.js created (buildFixedTable) with auto values
async function populateSelectsWithAutoForecast() {
  const subs = window.subdivisions || [];
  const cents = window.centroids || {};
  const results = {};

  await Promise.allSettled(subs.map(async (s) => {
    const key = `${s.state}|${s.name}`;
    const c = cents[key];
    if (!c) return;
    try {
      const { d1, d2 } = await fetchDaily(c.lat, c.lon);
      results[key] = { b1: pctToBucket(d1), b2: pctToBucket(d2) };
    } catch (e) {
      console.warn("Auto daily fetch failed:", key, e);
    }
  }));

  // Put values into the selects that app.js built
  const rows = document.querySelectorAll("#forecast-table-body tr");
  rows.forEach(tr => {
    const subdiv = tr.dataset.subdiv;
    const state  = tr.dataset.state;
    const rec = results[`${state}|${subdiv}`];
    if (!rec) return;

    const sel1 = tr.querySelector('td[data-col="day1"] select');
    const sel2 = tr.querySelector('td[data-col="day2"] select');

    if (sel1) {
      sel1.value = rec.b1;
      if (typeof colorizeSelect === "function") colorizeSelect(sel1, rec.b1);
    }
    if (sel2) {
      sel2.value = rec.b2;
      if (typeof colorizeSelect === "function") colorizeSelect(sel2, rec.b2);
    }
  });

  // Recolor both maps using app.js helper
  if (typeof updateMapColors === "function") updateMapColors();
}

function updateISTDateTo(elId){
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = new Intl.DateTimeFormat("en-IN", {
    timeZone: DAILY_TZ, day:"2-digit", month:"long", year:"numeric"
  }).format(new Date());
}

document.addEventListener("DOMContentLoaded", async () => {
  // mark navbar (defensive)
  document.querySelectorAll(".nav-btns a[href='daily.html']").forEach(a => a.classList.add("active"));

  // date in header
  updateISTDateTo("dateEl");

  // Build maps via app.js (it will also build the forecast table with selects)
  // Make sure daily.html includes: <tbody id="forecast-table-body"></tbody>
  if (typeof drawMap === "function") {
    await drawMap("#indiaMapDay1");
    await drawMap("#indiaMapDay2");
  } else {
    console.error("drawMap not found. Did you include app.js before daily.js?");
  }

  // Now fetch auto forecast for every sub-division and set the selects accordingly
  await populateSelectsWithAutoForecast();
});
