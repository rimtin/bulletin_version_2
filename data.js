// === 19 sub-divisions (Bihar removed) ===
window.subdivisions = [
  { state: "Punjab",             name: "Punjab" },
  { state: "Rajasthan",          name: "West Rajasthan" },
  { state: "Rajasthan",          name: "East Rajasthan" },
  { state: "Gujarat",            name: "Saurashtra & Kachh" },
  { state: "Gujarat",            name: "Gujarat region" },
  { state: "Uttar Pradesh",      name: "West Uttar Pradesh" },
  { state: "Uttar Pradesh",      name: "East Uttar Pradesh" },
  { state: "Madhya Pradesh",     name: "West Madhya Pradesh" },
  { state: "Madhya Pradesh",     name: "East Madhya Pradesh" },
  { state: "Chhattisgarh",       name: "Chhattisgarh" },
  { state: "Maharashtra",        name: "Madhya Maharashtra" },
  { state: "Maharashtra",        name: "Marathwada" },
  { state: "Maharashtra",        name: "Vidarbha" },
  { state: "Telangana",          name: "Telangana" },
  { state: "Andhra Pradesh",     name: "Coastal Andhra Pradesh" },
  { state: "Andhra Pradesh",     name: "Rayalaseema" },
  { state: "Karnataka",          name: "N.I. Karnataka" },
  { state: "Karnataka",          name: "S.I. Karnataka" },
  { state: "Tamil Nadu",         name: "Tamil Nadu & Puducherry" }
];

/* Bright palette (maps, legend, and SELECT backgrounds) */
window.forecastColors = {
  "Clear Sky":            "#66CCFF",  // bright sky blue
  "Low Cloud Cover":      "#57E66D",  // bright green
  "Medium Cloud Cover":   "#FFF500",  // vivid yellow
  "High Cloud Cover":     "#FF8A00",  // orange
  "Overcast Cloud Cover": "#FF0000"   // red
};
window.forecastOptions = Object.keys(window.forecastColors);

/* Classification table rows (bright) */
window.cloudRowColors = {
  "Clear Sky":            "#66CCFF",
  "Low Cloud Cover":      "#57E66D",
  "Medium Cloud Cover":   "#FFF500",
  "High Cloud Cover":     "#FF8A00",
  "Overcast Cloud Cover": "#FF0000"
};

/* Icons */
window.forecastIcons = {
  "Clear Sky": "☀️",
  "Low Cloud Cover": "🌤️",
  "Medium Cloud Cover": "⛅",
  "High Cloud Cover": "🌥️",
  "Overcast Cloud Cover": "☁️"
};

/* Classification rows */
window.cloudRows = [
  { cover: "0–10 %",   label: "Clear Sky",            type: "No Cloud" },
  { cover: "10–30 %",  label: "Low Cloud Cover",      type: "Few Clouds" },
  { cover: "30–50 %",  label: "Medium Cloud Cover",   type: "Scattered Clouds/Partly Cloudy" },
  { cover: "50–75 %",  label: "High Cloud Cover",     type: "Broken Clouds/Mostly Cloudy" },
  { cover: "75–100 %", label: "Overcast Cloud Cover", type: "Cloudy/ Overcast" }
];

/* IST date */
function updateISTDate() {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'long', year: 'numeric'
  }).format(now);
  const el = document.getElementById('forecast-date');
  if (el) el.textContent = formatted;
}
