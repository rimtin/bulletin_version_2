<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>☁️ Cloud Bulletin – Hourly</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <!-- Tailwind -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- Fonts / helpers -->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;600;700;800&display=swap');
    body { font-family: 'Nunito', sans-serif; }
    .shadow-soft { box-shadow: 0 10px 25px -5px rgba(0,0,0,.10), 0 10px 10px -5px rgba(0,0,0,.04); }
    .gradient-text { background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);
      -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
    .map-tooltip{
      position:fixed; z-index:9999; pointer-events:none; background:#fff; color:#000;
      border-radius:12px; padding:8px 10px; box-shadow:0 10px 20px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.12);
      border:1px solid rgba(0,0,0,.18); font-size:13px; font-weight:700; line-height:1.2; white-space:nowrap;
    }
    .axis text{ font-size:11px; fill:#111827 }
    .axis path,.axis line{ stroke:#9ca3af }
    .legend-item { display:flex; align-items:center; gap:.5rem; font-size:.8rem; }
    .legend-swatch { width:14px; height:14px; border-radius:3px; border:1px solid rgba(0,0,0,.25); }
  </style>

  <!-- D3 + TopoJSON -->
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="https://unpkg.com/topojson-client@3"></script>
</head>

<body class="bg-gray-50 text-gray-800 min-h-screen">
  <!-- Nav -->
  <nav class="max-w-6xl mx-auto px-4 mt-6">
    <div class="bg-white shadow-soft rounded-2xl px-5 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-2xl">☁️</span>
        <span class="text-lg font-extrabold gradient-text">Cloud Bulletin</span>
      </div>
      <div class="flex gap-2">
        <a href="index.html"  class="px-4 py-2 rounded-xl bg-white shadow-sm font-semibold">home</a>
        <a href="daily.html"  class="px-4 py-2 rounded-xl bg-white shadow-sm font-semibold">daily</a>
        <a href="hourly.html" class="px-4 py-2 rounded-xl font-semibold text-white" style="background:linear-gradient(135deg,#667eea,#764ba2)">hourly</a>
      </div>
    </div>
  </nav>

  <main class="max-w-6xl mx-auto px-4 py-8">
    <!-- Header -->
    <header class="bg-white shadow-soft rounded-3xl p-6 mb-8">
      <h1 class="text-3xl md:text-4xl font-extrabold gradient-text">Hourly Cloud Cover (Ensemble, next 48 h)</h1>
      <p class="text-gray-500 mt-1">IST now: <span id="now-ist">—</span></p>
      <p id="status" class="text-xs text-amber-600 mt-2 hidden"></p>
      <p class="text-xs text-gray-500 mt-1">
        Ensemble: Open-Meteo (always) + OpenWeatherMap (optional — add <code>?owm=YOUR_API_KEY</code> to the URL).
      </p>
    </header>

    <!-- Cloud Cover Classification -->
    <section class="bg-white shadow-soft rounded-3xl p-6 mb-8">
      <h3 class="text-xl font-bold mb-4">Cloud Cover Classification</h3>
      <div class="overflow-x-auto">
        <table id="cloudTable" class="min-w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="text-left px-3 py-2">S. No.</th>
              <th class="text-left px-3 py-2">Sky Covered by Clouds</th>
              <th class="text-left px-3 py-2">Cloud Cover</th>
              <th class="text-left px-3 py-2">Cloud Type</th>
            </tr>
          </thead>
          <tbody id="cloudTbody" class="text-gray-800"></tbody>
        </table>
      </div>
      <p class="mt-3 text-gray-500 text-sm"><strong>Note:</strong> This terminology is for local use only.</p>
    </section>

    <!-- Main layout: Map (left) + Charts (right) -->
    <section class="grid md:grid-cols-2 gap-6">
      <!-- Map -->
      <div class="bg-white shadow-soft rounded-3xl p-4">
        <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-bold">
              <span id="mapTitle">India — selected hour</span>
            </h3>
            <button id="btnBack" class="px-3 py-1.5 rounded-lg bg-gray-100 font-semibold hidden">⬅ Back to India</button>
          </div>
          <!-- Controls are hidden by JS to match the wireframe (slider only) -->
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <label class="text-sm text-gray-600">Region:</label>
              <select id="regionSelect" class="px-3 py-1.5 rounded-lg border border-gray-200 bg-white">
                <option value="Punjab">Punjab</option>
                <option value="West Rajasthan">West Rajasthan</option>
                <option value="East Rajasthan">East Rajasthan</option>
                <option value="Rajasthan">Rajasthan (W/E max)</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-sm text-gray-600">Hour:</label>
              <input id="hourSlider" type="range" min="0" max="47" value="0" class="w-44">
              <span id="hourLabel" class="text-sm text-gray-700">—</span>
            </div>
            <button id="btn24" class="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-semibold">Next 24 h</button>
            <button id="btn48" class="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-semibold">Hours 25–48</button>
            <button id="btnAll" class="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-semibold">All 48 h</button>
            <button id="btnRefresh" class="px-3 py-1.5 rounded-lg text-white" style="background:linear-gradient(135deg,#667eea,#764ba2)">Refresh</button>
            <button id="satBtn" class="px-3 py-1.5 rounded-lg text-white" style="background:#2563eb">View satellite</button>
          </div>
        </div>

        <!-- Bigger map -->
        <div class="relative">
          <svg id="indiaMapHourly" viewBox="0 0 860 620" class="w-full h-[560px] rounded-2xl bg-gray-50 border border-gray-100"></svg>

          <!-- Legend -->
          <div id="mapLegend" class="absolute left-3 bottom-3 bg-white/90 backdrop-blur rounded-xl p-3 shadow-sm space-y-1">
            <div class="text-[12px] font-bold text-gray-800 mb-1">Index — Day 1</div>
          </div>
        </div>
      </div>

      <!-- Charts -->
      <div class="space-y-6">
        <div class="bg-white shadow-soft rounded-3xl p-4">
          <h3 class="text-lg font-bold mb-2">Hourly Cloud % (<span id="seriesName">ensemble</span>)</h3>
          <svg id="cloudChart" viewBox="0 0 600 300" class="w-full h-[260px]"></svg>
          <div id="sourceTags" class="text-xs text-gray-500 mt-1"></div>
        </div>
        <div class="bg-white shadow-soft rounded-3xl p-4">
          <h3 class="text-lg font-bold mb-2">GHI (proxy) — daylight only</h3>
          <svg id="ghiChart" viewBox="0 0 600 300" class="w-full h-[260px]"></svg>
          <p class="text-[11px] text-gray-500 mt-1">Placeholder: GHI≈(1−cloud%)×950 (0 at night). We’ll replace with a proper model later.</p>
        </div>
      </div>
    </section>
  </main>

<!-- Shared palette/icons + hourly logic -->
<script src="./data.js?v=3"></script>
<script src="./hourly.js?v=3"></script>

</body>
</html>
