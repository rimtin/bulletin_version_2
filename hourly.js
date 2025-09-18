const IST_TZ = "Asia/Kolkata";
const MAX_HOURS = 48;
const hourlyStore = {}; // "State|Sub" -> { times:[], values:[] }

// Fetch 48h hourly cloud_cover from Open-Meteo
async function fetchHourly(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "cloud_cover");
  url.searchParams.set("timezone", IST_TZ);
  url.searchParams.set("forecast_days", "2");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Open-Meteo " + res.status);
  const data = await res.json();
  return {
    times: (data.hourly?.time || []).slice(0, MAX_HOURS),
    values: (data.hourly?.cloud_cover || []).slice(0, MAX_HOURS)
  };
}

async function refreshAllHourly() {
  const tasks = subdivisions.map(async s => {
    const key = `${s.state}|${s.name}`;
    const c = hourlyCentroids[key];
    if (!c) return;
    try {
      const {times, values} = await fetchHourly(c.lat, c.lon);
      hourlyStore[key] = {times, values};
    } catch (e) { console.warn("Fetch failed:", key, e); }
  });
  await Promise.allSettled(tasks);
}

function getPct(key, hourIdx) {
  const e = hourlyStore[key];
  if (!e || !e.values?.length) return NaN;
  const i = Math.max(0, Math.min(e.values.length - 1, hourIdx));
  return e.values[i];
}

function setHourLabel(hourIdx) {
  const anyKey = Object.keys(hourlyStore)[0];
  let label = `T+${hourIdx}h`;
  if (anyKey && hourlyStore[anyKey]?.times?.[hourIdx]) {
    label = hourlyStore[anyKey].times[hourIdx];
  }
  const el = document.getElementById("hourLabel");
  if (el) el.textContent = `${label} IST`;
}

function populateTable(hourIdx) {
  setHourLabel(hourIdx);
  const tbody = document.querySelector("#hourlyTable tbody");
  tbody.innerHTML = "";
  let i = 1;

  subdivisions.forEach(s => {
    const key = `${s.state}|${s.name}`;
    const pct = getPct(key, hourIdx);
    const bucket = pctToBucket(pct);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i++}</td>
      <td>${s.state}</td>
      <td>${s.name}</td>
      <td class="swatch ${classFor(bucket)}">${bucket}</td>
      <td>${Number.isFinite(pct) ? pct.toFixed(0)+"%" : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function classFor(bucket){
  switch(bucket){
    case "Clear Sky": return "swatch-clear";
    case "Low Cloud Cover": return "swatch-low";
    case "Medium Cloud Cover": return "swatch-medium";
    case "High Cloud Cover": return "swatch-high";
    case "Overcast Cloud Cover": return "swatch-overcast";
    default: return "";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  updateISTDate("dateEl");

  // Prepare empty table once
  const tbody = document.querySelector("#hourlyTable tbody");
  tbody.innerHTML = subdivisions.map((s,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${s.state}</td>
      <td>${s.name}</td>
      <td>Loading…</td>
      <td>—</td>
    </tr>
  `).join("");

  // Wire controls
  const input = document.getElementById("hourSelect");
  const btn = document.getElementById("refreshNow");
  const setHour = (h)=> populateTable(Math.max(0, Math.min(MAX_HOURS-1, Number(h)||0)));
  input.addEventListener("input", e => setHour(e.target.value));
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    await refreshAllHourly();
    setHour(input.value);
    btn.disabled = false;
  });

  // First load
  await refreshAllHourly();
  setHour(0);

  // Optional: refresh every hour
  setInterval(async () => {
    await refreshAllHourly();
    setHour(input.value);
  }, 60*60*1000);
});
