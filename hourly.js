/* ===== Cloud Bulletin — HOURLY (India → Punjab; table, legend, charts) ===== */

const W = 860, H = 520, PAD = 18;          // bigger map
let STATE_KEY = "ST_NM";                   // detected from data
let NAME_KEY  = "name";

const IST_TZ = "Asia/Kolkata";
const DAYLIGHT_START = 4, DAYLIGHT_END = 19;
const MAX_HOURS = 48;

const LAYOUT = {
  mapWrapSel:  "#hourlyMapWrap",  // parent for maps
  indiaSvgId:  "indiaMapHourly",
  punjabSvgId: "punjabMapHourly",
  backBtnId:   "mapBackBtn",
  legendCls:   "map-legend",
  cloudDivId:  "cloudChart",
  ghiDivId:    "ghiChart",
  titleId:     "districtTitle",
  cloudTableId:"cloudTable"
};

/* -------------------- helpers -------------------- */
function q(sel){ return document.querySelector(sel); }
function ensureEl({ id, tag="div", parent=null, className="" }){
  let el = document.getElementById(id);
  if(!el){ el = document.createElement(tag); el.id = id; if(className) el.className = className; (parent||document.body).appendChild(el); }
  return el;
}
function pickParent(selector){ return selector ? (q(selector) || document.body) : document.body; }
function norm(s){ return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\s*&\s*/g," and ").replace(/\s*\([^)]*\)\s*/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }

function detectKeys(features){
  const sKeys = ["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","State"];
  const dKeys = ["DISTRICT","name","NAME_2","Name","district","dist_name"];
  const p = features[0]?.properties || {};
  STATE_KEY = sKeys.find(k => k in p) || STATE_KEY;
  NAME_KEY  = dKeys.find(k => k in p) || NAME_KEY;
}
function pickProjection(fc){
  const [[minX,minY],[maxX,maxY]] = d3.geoBounds(fc);
  const w = maxX-minX, h = maxY-minY;
  const lonlat = w<200 && h<120 && minX>=-180 && maxX<=180 && minY>=-90 && maxY<=90;
  return lonlat ? d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc)
                : d3.geoIdentity().reflectY(true).fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc);
}

/* -------------------- classification table -------------------- */
function buildCloudTable(){
  const table = document.getElementById(LAYOUT.cloudTableId);
  if (!table) return;
  const tbody = table.querySelector("tbody") || table.appendChild(document.createElement("tbody"));
  tbody.innerHTML = "";

  const pal  = window.cloudRowColors || window.forecastColors || {};
  const rows = window.cloudRows     || [];
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${r.cover}</td>
      <td><span class="inline-block w-3 h-3 mr-2 align-middle" style="background:${pal[r.label] || "#eee"};border:1px solid #9ca3af;border-radius:2px"></span><strong>${r.label}</strong></td>
      <td>${r.type}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* -------------------- legend (Index) -------------------- */
function drawLegend(svg, title="Index — Day 1"){
  svg.selectAll(`.${LAYOUT.legendCls}`).remove();
  const pal = window.forecastColors || {
    "Clear Sky":"#A7D8EB",
    "Low Cloud Cover":"#C4E17F",
    "Medium Cloud Cover":"#FFF952",
    "High Cloud Cover":"#E69536",
    "Overcast Cloud Cover":"#FF4D4D"
  };
  const labels = window.forecastOptions || Object.keys(pal);

  const pad=10, sw=18, gap=18, width=210;
  const height = pad + 18 + labels.length*gap + 44;

  const g = svg.append("g").attr("class", LAYOUT.legendCls)
    .attr("transform", `translate(${W - width - 14}, ${14})`);

  g.append("rect").attr("width",width).attr("height",height)
    .attr("rx",12).attr("ry",12)
    .attr("fill","rgba(255,255,255,0.95)").attr("stroke","#d1d5db");

  g.append("text").attr("x",pad).attr("y",pad+14)
    .attr("font-weight",800).attr("font-size",13).text(title);

  labels.forEach((lab,i)=>{
    const y = pad + 28 + i*gap;
    g.append("rect").attr("x",pad).attr("y",y-12).attr("width",sw).attr("height",12)
      .attr("fill", pal[lab]||"#eee").attr("stroke","#9ca3af");
    g.append("text").attr("x",pad+sw+8).attr("y",y-2).attr("font-size",12).text(lab);
  });

  // View satellite
  const btnW = width - pad*2, btnH=28, btnY = height - pad - btnH;
  const btn = g.append("g").style("cursor","pointer")
    .on("click",()=>window.open("https://zoom.earth/#view=22.5,79.0,5z/layers=labels,clouds","_blank","noopener"));
  btn.append("rect").attr("x",pad).attr("y",btnY).attr("width",btnW).attr("height",btnH)
    .attr("rx",8).attr("ry",8).attr("fill","#2563eb");
  btn.append("text").attr("x",pad+btnW/2).attr("y",btnY+btnH/2+4)
    .attr("text-anchor","middle").attr("font-size",12).attr("font-weight",700).attr("fill","#fff")
    .text("View satellite");
}

/* -------------------- data sources (no local 404s) -------------------- */
// India subdivisions (same spirit as daily.js)
const INDIA_SUBDIV_URLS = [
  "https://rimtin.github.io/bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/weather_bulletin/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/rimtin/weather_bulletin/main/indian_met_zones.geojson",
  "https://cdn.jsdelivr.net/gh/rimtin/weather_bulletin@main/indian_met_zones.geojson"
];
// Punjab districts: CDNs only; we filter India-wide to Punjab
const PUNJAB_DISTRICT_URLS = [
  "https://cdn.jsdelivr.net/gh/iamsahebgiri/India-Districts-GeoJSON@main/india_districts.geojson",
  "https://cdn.jsdelivr.net/npm/vega-datasets@2.9.0/data/india-districts.json",
  "https://raw.githubusercontent.com/iamsahebgiri/India-Districts-GeoJSON/refs/heads/main/india_districts.geojson"
];

async function fetchFirst(urls){
  for(const u of urls){
    try{ const r = await fetch(u,{cache:"no-store"}); if(r.ok) return await r.json(); }catch{}
  }
  return null;
}
function toFeatures(geo){
  if(!geo) return [];
  if(geo.type==="Topology"){
    const key = Object.keys(geo.objects||{})[0];
    if(!key || !window.topojson) return [];
    return topojson.feature(geo, geo.objects[key]).features || [];
  }
  return geo.features || [];
}
function filterPunjab(features){
  if(!features?.length) return [];
  const STATE_KEYS = ["ST_NM","st_nm","STATE","state","state_name","State_Name","STATE_UT","NAME_1","stname"];
  const sKey = STATE_KEYS.find(k => k in (features[0]?.properties||{}));
  if(!sKey) return features; // already Punjab-only
  return features.filter(f => String(f.properties?.[sKey]).toLowerCase()==="punjab");
}
function guessDistrictNameKey(props){
  const c = ["DISTRICT","district","dtname","district_name","NAME_2","NAME_3","name","DIST_NAME"];
  return c.find(k => k in (props||{})) || "name";
}

/* -------------------- tooltip -------------------- */
let tooltip;
function ensureTip(){
  if(!tooltip){
    tooltip = d3.select("body").append("div").attr("class","map-tooltip")
      .style("position","fixed").style("z-index",50).style("opacity",0)
      .style("background","rgba(255,255,255,.95)").style("border","1px solid #e5e7eb")
      .style("padding","6px 8px").style("border-radius","8px").style("font","12px system-ui");
  }
  return tooltip;
}

/* ==================== INDIA MAP (default) ==================== */
async function drawIndia(){
  const holder = pickParent(LAYOUT.mapWrapSel);
  const svgEl = ensureEl({ id: LAYOUT.indiaSvgId, tag:"svg", parent: holder });
  const svg = d3.select(svgEl);
  svg.attr("viewBox",`0 0 ${W} ${H}`).style("width","100%").style("height","520px");
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diagonalHatch").attr("patternUnits","userSpaceOnUse")
    .attr("width",6).attr("height",6).append("path").attr("d","M0,0 l6,6").attr("stroke","#999").attr("stroke-width",1);

  const geo = await fetchFirst(INDIA_SUBDIV_URLS);
  const feats = toFeatures(geo);
  if(!feats.length){ svg.append("text").attr("x",12).attr("y",24).attr("font-weight",700).text("Map data not found"); return; }

  detectKeys(feats);
  const fc  = { type:"FeatureCollection", features: feats };
  const prj = pickProjection(fc);
  const path = d3.geoPath(prj);

  const g = svg.append("g").attr("class","fill-layer");
  const t = ensureTip();

  const paths = g.selectAll("path").data(feats).join("path")
    .attr("d", path)
    .attr("fill","url(#diagonalHatch)")
    .attr("stroke","#666").attr("stroke-width",0.7)
    .style("cursor","pointer")
    .on("pointermove",(ev,d)=>{
      const st = d.properties?.[STATE_KEY] ?? "";
      t.style("opacity",1).style("left",(ev.clientX+10)+"px").style("top",(ev.clientY+10)+"px").text(st);
    })
    .on("pointerleave",()=> t.style("opacity",0))
    .on("click", async (_ev,d)=>{
      const st = String(d.properties?.[STATE_KEY]||"");
      if (norm(st)==="punjab") await drawPunjab();
    });

  // Hint: color Punjab lightly
  paths.filter(d => norm(String(d.properties?.[STATE_KEY]||""))==="punjab")
    .attr("fill","#bfe3ff");

  drawLegend(svg, "Index — Day 1");
}

/* ==================== PUNJAB MAP (detail) ==================== */
async function loadPunjabFeatures(){
  const geo = await fetchFirst(PUNJAB_DISTRICT_URLS);
  let feats = toFeatures(geo);
  feats = filterPunjab(feats);
  return feats;
}

async function drawPunjab(){
  const india = document.getElementById(LAYOUT.indiaSvgId);
  if (india) india.style.display = "none";

  const holder = pickParent(LAYOUT.mapWrapSel);
  const svgEl  = ensureEl({ id: LAYOUT.punjabSvgId, tag:"svg", parent: holder });
  const svg    = d3.select(svgEl);
  svg.attr("viewBox",`0 0 ${W} ${H}`).style("width","100%").style("height","520px");
  svg.selectAll("*").remove();

  const back = ensureEl({ id: LAYOUT.backBtnId, tag:"button", parent: holder });
  back.textContent = "← Back to India";
  Object.assign(back.style,{ margin:"8px 0 6px", padding:"6px 12px", borderRadius:"9999px", border:"1px solid #d1d5db", background:"#fff" });
  back.onclick = () => { svg.style.display = "none"; if (india) india.style.display = "block"; back.remove(); };

  // sun gradient
  const defs = svg.append("defs");
  const grad = defs.append("radialGradient").attr("id","sunGrad").attr("fx","30%").attr("fy","30%");
  grad.append("stop").attr("offset","0%").attr("stop-color","#fff7cc");
  grad.append("stop").attr("offset","60%").attr("stop-color","#ffb347");
  grad.append("stop").attr("offset","100%").attr("stop-color","#ff9800");

  const feats = await loadPunjabFeatures();
  if(!feats.length){ svg.append("text").attr("x",12).attr("y",24).attr("font-weight",700).text("Punjab districts not found"); return; }

  const nameKey = guessDistrictNameKey(feats[0]?.properties || {});
  const fc  = { type:"FeatureCollection", features: feats };
  const prj = d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc);
  const path = d3.geoPath(prj);

  const t = ensureTip();
  const g = svg.append("g").attr("class","districts");

  g.selectAll("path").data(feats).join("path")
    .attr("d", path)
    .attr("fill","#bfe3ff")
    .attr("stroke","#2b5876").attr("stroke-width",0.9)
    .style("cursor","pointer")
    .on("pointermove",(ev,d)=>{ const nm=d.properties?.[nameKey]??"District"; t.style("opacity",1).style("left",(ev.clientX+10)+"px").style("top",(ev.clientY+10)+"px").text(nm); })
    .on("pointerleave",()=> t.style("opacity",0))
    .on("click", async (_ev,d)=>{ const nm=d.properties?.[nameKey]??"District"; const [lon,lat]=d3.geoCentroid(d); await ensureDistrictAndPlot(nm, lat, lon); });

  // labels + sun icons
  const overlay = svg.append("g").attr("class","labels-icons");
  feats.forEach(f=>{
    const [cx,cy] = path.centroid(f); if(!isFinite(cx)||!isFinite(cy)) return;
    overlay.append("circle").attr("cx",cx).attr("cy",cy).attr("r",8).attr("fill","url(#sunGrad)").attr("stroke","#f59e0b").attr("stroke-width",1);
    const nm = String(f.properties?.[nameKey]||""); const short = nm.length>16? nm.replace(/ District/i,"").slice(0,16)+"…" : nm;
    overlay.append("text").attr("x",cx).attr("y",cy-14).attr("text-anchor","middle").attr("font-size",10).attr("font-weight",700).attr("stroke","#fff").attr("stroke-width",3).attr("paint-order","stroke").text(short);
    overlay.append("text").attr("x",cx).attr("y",cy-14).attr("text-anchor","middle").attr("font-size",10).attr("font-weight",700).attr("fill","#1f2937").text(short);
  });

  drawLegend(svg, "Index — Day 1");
}

/* ==================== Open-Meteo + charts ==================== */
async function fetchHourly(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "cloud_cover");
  url.searchParams.set("timezone", IST_TZ);
  url.searchParams.set("forecast_hours", String(MAX_HOURS));
  const r = await fetch(url.toString(), { cache:"no-store" });
  if(!r.ok) throw new Error("Open-Meteo "+r.status);
  const j = await r.json();

  const times  = (j.hourly?.time || []).slice(0, MAX_HOURS);
  const clouds = (j.hourly?.cloud_cover || []).slice(0, MAX_HOURS);
  const T=[], V=[];
  for(let i=0;i<times.length;i++){
    const h = new Date(times[i]).getHours(); // already IST
    if(h>=DAYLIGHT_START && h<=DAYLIGHT_END){ T.push(times[i]); V.push(clouds[i]); }
  }
  const ghi = V.map(p => 950 * Math.max(0, 1 - (p||0)/100)); // proxy
  return { times:T, clouds:V, ghi };
}

function drawLineChart({ holderId, labels, values, yMax, title="", unit="", width=520, height=260 }){
  const holder = ensureEl({ id: holderId, parent: pickParent("#rightCol") });
  holder.innerHTML = "";
  Object.assign(holder.style,{ background:"#fff", borderRadius:"12px", boxShadow:"0 10px 25px -5px rgba(0,0,0,.10), 0 10px 10px -5px rgba(0,0,0,.04)", padding:"10px" });

  const P={t:28,r:18,b:36,l:44};
  const svg=d3.select(holder).append("svg").attr("width",width).attr("height",height);
  svg.append("text").attr("x",12).attr("y",18).attr("font-weight",800).attr("font-size",13).text(title);

  const x=d3.scalePoint().domain(d3.range(labels.length)).range([P.l,width-P.r]);
  const y=d3.scaleLinear().domain([0,yMax]).nice().range([height-P.b,P.t+6]);

  svg.append("g").attr("transform",`translate(0,${height-P.b})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter(i=>i%2===0))
      .tickFormat(i=>new Date(labels[i]).toLocaleTimeString("en-IN",{hour:"numeric"})));
  svg.append("g").attr("transform",`translate(${P.l},0)`).call(d3.axisLeft(y).ticks(5));

  const line=d3.line().x((d,i)=>x(i)).y(d=>y(d));
  svg.append("path").attr("d",line(values)).attr("fill","none").attr("stroke","#2563eb").attr("stroke-width",2);
  if(unit) svg.append("text").attr("x",P.l).attr("y",P.t-6).attr("font-size",11).attr("fill","#555").text(unit);
}

async function ensureDistrictAndPlot(name, lat, lon){
  try{
    const { times, clouds, ghi } = await fetchHourly(lat, lon);
    drawLineChart({ holderId: LAYOUT.cloudDivId, labels: times, values: clouds, yMax: 100,  title: "Hourly Cloud % (ensemble)" });
    drawLineChart({ holderId: LAYOUT.ghiDivId,   labels: times, values: ghi,    yMax: 1000, title: "GHI (proxy) — daylight only", unit: "W/m²" });
    const titleEl = ensureEl({ id: LAYOUT.titleId, parent: pickParent("#rightCol") });
    titleEl.textContent = `${name} — next 48 h (daylight only, 4:00–19:00 IST)`;
  }catch(e){ console.warn("Fetch failed:", name, e); }
}

/* ==================== init ==================== */
document.addEventListener("DOMContentLoaded", async () => {
  // Build the Cloud Classification table (uses data.js)
  buildCloudTable();

  // Ensure chart holders exist
  ensureEl({ id: LAYOUT.cloudDivId, parent: pickParent("#rightCol") });
  ensureEl({ id: LAYOUT.ghiDivId,   parent: pickParent("#rightCol") });

  // Draw India map (legend included)
  await drawIndia();

  // Preload Punjab center so charts aren’t empty
  await ensureDistrictAndPlot("Punjab", 31.0, 75.3);
});
