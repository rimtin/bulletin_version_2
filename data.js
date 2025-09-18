// --- States shown on maps (only these two are colorable) ---
const states = ["Punjab", "Rajasthan"];

// --- Palette / options / icons (used by table + legend colors) ---
const forecastColors = {
  "Clear Sky": "#A7D8EB",
  "Low Cloud Cover": "#C4E17F",
  "Medium Cloud Cover": "#FFF952",
  "High Cloud Cover": "#E69536",
  "Overcast Cloud Cover": "#FF4D4D"
};
const forecastOptions = Object.keys(forecastColors);
const forecastIcons = {
  "Clear Sky": "☀️",
  "Low Cloud Cover": "🌤️",
  "Medium Cloud Cover": "⛅",
  "High Cloud Cover": "☁️",
  "Overcast Cloud Cover": "🌫️"
};

// --- Sub-divisions (Home is manual entry) ---
const subdivisions = [
  { subNo: 1, state: "Punjab",    name: "Punjab" },
  { subNo: 2, state: "Rajasthan", name: "W-Raj" },
  { subNo: 3, state: "Rajasthan", name: "E-Raj" }
];

// --- Date helper (IST) ---
function updateISTDate() {
  const istDate = new Date(Date.now() + 330 * 60 * 1000);
  const s = istDate.toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" });
  const el = document.getElementById("forecast-date");
  if (el) el.textContent = s;
}
