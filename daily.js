async function fetchForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloudcover&forecast_days=2&timezone=Asia/Kolkata`;
  const res = await fetch(url);
  const data = await res.json();
  return data.hourly.cloudcover; // array of hourly %
}

// classify % → bucket
function classifyCloud(cc) {
  if (cc <= 10) return "Clear Sky";
  if (cc <= 30) return "Low Cloud Cover";
  if (cc <= 50) return "Medium Cloud Cover";
  if (cc <= 75) return "High Cloud Cover";
  return "Overcast Cloud Cover";
}

// example centroids
const centroids = {
  Punjab: [31.0, 75.0],
  "W-Raj": [27.0, 72.0],
  "E-Raj": [26.0, 75.5],
};

async function updateDaily() {
  const tbody = document.getElementById("forecast-table-body");
  tbody.innerHTML = "";

  const results = {};
  for (const [name, [lat, lon]] of Object.entries(centroids)) {
    const cover = await fetchForecast(lat, lon);
    // take avg for day1 (0–23h), day2 (24–47h)
    const avg1 = cover.slice(0, 24).reduce((a,b)=>a+b,0)/24;
    const avg2 = cover.slice(24, 48).reduce((a,b)=>a+b,0)/24;
    results[name] = [classifyCloud(avg1), classifyCloud(avg2)];
  }

  // aggregate Rajasthan
  const rajDay1 = [results["W-Raj"][0], results["E-Raj"][0]];
  const rajDay2 = [results["W-Raj"][1], results["E-Raj"][1]];
  const pickCloudier = arr =>
    arr.includes("Overcast Cloud Cover") ? "Overcast Cloud Cover" :
    arr.includes("High Cloud Cover") ? "High Cloud Cover" :
    arr.includes("Medium Cloud Cover") ? "Medium Cloud Cover" :
    arr.includes("Low Cloud Cover") ? "Low Cloud Cover" : "Clear Sky";

  results["Rajasthan"] = [pickCloudier(rajDay1), pickCloudier(rajDay2)];

  // render table
  let i = 1;
  for (const state of Object.keys(results)) {
    const [d1, d2] = results[state];
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i++}</td><td>${state}</td><td>${d1}</td><td>${d2}</td>`;
    tbody.appendChild(tr);
  }

  // finally, color maps
  updateMapColorsAuto(results);
}

// apply fills/icons based on results
function updateMapColorsAuto(results) {
  for (const [state, [day1, day2]] of Object.entries(results)) {
    const c1 = forecastColors[day1] || "#ccc";
    const c2 = forecastColors[day2] || "#ccc";

    d3.select(`#indiaMapDay1 [id='${state}']`).attr("fill", c1);
    d3.select(`#indiaMapDay2 [id='${state}']`).attr("fill", c2);
  }
}

// init
window.onload = () => {
  updateISTDate();
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
  updateDaily();
};
