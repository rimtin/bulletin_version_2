// === Focus only on these sub-divisions ===
window.subdivisions = [
  { subNo: 1, state: "Punjab",    name: "Punjab" },
  { subNo: 2, state: "Rajasthan", name: "W-Raj" }, // West Rajasthan
  { subNo: 3, state: "Rajasthan", name: "E-Raj" }  // East Rajasthan
];

// State list (for Daily table header/state label usage if needed)
window.states = ["Punjab", "Rajasthan"];

// Excel-style palette
window.forecastColors = {
  "Clear Sky": "#A7D8EB",           // 0–10%
  "Low Cloud Cover": "#C4E17F",     // 11–35%
  "Medium Cloud Cover": "#FFF952",  // 36–65%
  "High Cloud Cover": "#E69536",    // 66–85%
  "Overcast Cloud Cover": "#FF4D4D" // >85%
};
window.forecastOptions = Object.keys(window.forecastColors);

// Optional icons if you want them later
window.forecastIcons = {
  "Clear Sky": "☀️",
  "Low Cloud Cover": "🌤️",
  "Medium Cloud Cover": "⛅",
  "High Cloud Cover": "☁️",
  "Overcast Cloud Cover": "🌫️"
};

// Open-Meteo centroids for hourly
window.hourlyCentroids = {
  "Punjab|Punjab":   { lat: 31.0000, lon: 75.0000 },
  "Rajasthan|W-Raj": { lat: 26.9000, lon: 71.0000 },
  "Rajasthan|E-Raj": { lat: 26.0000, lon: 75.6000 }
};

// Helpers
window.pctToBucket = function(pct){
  if (!Number.isFinite(pct)) return "Clear Sky";
  if (pct <= 10) return "Clear Sky";
  if (pct <= 35) return "Low Cloud Cover";
  if (pct <= 65) return "Medium Cloud Cover";
  if (pct <= 85) return "High Cloud Cover";
  return "Overcast Cloud Cover";
};

window.updateISTDate = function(elId="dateEl"){
  const ist = new Date(Date.now() + 330*60*1000);
  const s = ist.toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" });
  const el = document.getElementById(elId); if (el) el.textContent = s;
};
