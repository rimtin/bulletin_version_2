// === States shown in the main forecast (reduced to Punjab & Rajasthan) ===
const states = [
  "Punjab",
  "Rajasthan"
];

// Excel-style palette
const forecastColors = {
  "Clear Sky": "#A7D8EB",           // 0–10%
  "Low Cloud Cover": "#C4E17F",     // 10–30%
  "Medium Cloud Cover": "#FFF952",  // 30–50%
  "High Cloud Cover": "#E69536",    // 50–75%
  "Overcast Cloud Cover": "#FF4D4D" // 75–100%
};
const forecastOptions = Object.keys(forecastColors);

const forecastIcons = {
  "Clear Sky": "☀️",
  "Low Cloud Cover": "🌤️",
  "Medium Cloud Cover": "⛅",
  "High Cloud Cover": "☁️",
  "Overcast Cloud Cover": "🌫️"
};

// === Subdivision master list (only the requested three) ===
const subdivisions = [
  { subNo: 1, state: "Punjab",    name: "Punjab" },
  { subNo: 2, state: "Rajasthan", name: "W-Raj" }, // West Rajasthan
  { subNo: 3, state: "Rajasthan", name: "E-Raj" }  // East Rajasthan
];

function updateISTDate() {
  const istDate = new Date(Date.now() + (330 * 60 * 1000)); // IST = UTC+5:30
  const formattedDate = istDate.toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric"
  });
  document.getElementById("forecast-date").textContent = formattedDate;
}
