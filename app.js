// === Map + table app ===
const W = 860, H = 580, PAD = 18;
const MATCH_KEY = "ST_NM";
let STATE_KEY = "ST_NM";
let NAME_KEY  = "name";

// per-map stores
const indexByGroup  = { "#indiaMapDay1": new Map(), "#indiaMapDay2": new Map() };
const groupCentroid = { "#indiaMapDay1": {}, "#indiaMapDay2": {} };

// helpers
let mapTooltip = null;
const ensureTooltip = () => {
  if (!mapTooltip) mapTooltip = d3.select("body").append("div").attr("class","map-tooltip").style("opacity",0);
  return mapTooltip;
};
const norm = s => String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s*&\s*/g," and ").replace(/\s*\([^)]*\)\s*/g," ").replace(/[^a-z0-9]+/g," ")
  .replace(/\s+/g," ").trim();

function detectKeys(features){
  const s = ["ST_NM","st_nm","STATE","STATE_UT","NAME_1","state_name","State"];
  const d = ["DISTRICT","name","NAME_2","Name","district","dist_name"];
  const sample = features[0]?.properties || {};
  STATE_KEY = s.find(k=>k in sample) || STATE_KEY;
  NAME_KEY  = d.find(k=>k in sample) || NAME_KEY;
}
function pickProjection(fc){
  const [[minX,minY],[maxX,maxY]] = d3.geoBounds(fc);
  const w=maxX-minX, h=maxY-minY;
  const lonlat = w<200 && h<120 && minX>=-180 && maxX<=180 && minY>=-90 && maxY<=90;
  return lonlat ? d3.geoMercator().fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc)
                : d3.geoIdentity().reflectY(true).fitExtent([[PAD,PAD],[W-PAD,H-PAD]], fc);
}
function ensureLayer(svg, cls){ let g=svg.select("."+cls); if(g.empty()) g=svg.append("g").attr("class",cls); return g; }

// robust GeoJSON fallbacks (include your GH Pages path)
const GEO_URLS = [
  "indian_met_zones.geojson",
  "assets/indian_met_zones.geojson",
  "bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/bulletin_version_2/indian_met_zones.geojson",
  "https://rimtin.github.io/weather_bulletin/indian_met_zones.geojson",
  "https://raw.githubusercontent.com/rimtin/weather_bulletin/main/indian_met_zones.geojson",
  "https://cdn.jsdelivr.net/gh/rimtin/weather_bulletin@main/indian_met_zones.geojson"
];

async function fetchFirst(urls){
  for (const url of urls){
    try{
      const r=await fetch(url,{cache:"no-cache"});
      if(!r.ok) continue;
      const j=await r.json();
      console.log("[Map] Loaded:", url);
      return j;
    }catch{}
  }
  throw new Error("No GeoJSON found");
}

/* ----- build classification table ----- */
function buildCloudTable(){
  const tbody = document.querySelector("#cloudTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const pal  = window.cloudRowColors || window.forecastColors || {};
  const rows = window.cloudRows || [];
  rows.forEach((r,i)=>{
    const tr=document.createElement("tr");
    tr.style.background = pal[r.label] || "#fff";
    tr.innerHTML = `<td class="px-3 py-2">${i+1}</td>
      <td class="px-3 py-2">${r.cover}</td>
      <td class="px-3 py-2 font-semibold">${r.label}</td>
      <td class="px-3 py-2">${r.type}</td>`;
    tbody.appendChild(tr);
  });
}

/* ----- draw one map ----- */
async function drawMap(svgId){
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs.append("pattern").attr("id","diagonalHatch").attr("patternUnits","userSpaceOnUse")
    .attr("width",6).attr("height",6)
    .append("path").attr("d","M0,0 l6,6").attr("stroke","#999").attr("stroke-width",1);

  const fillLayer = ensureLayer(svg, "fill-layer");
  ensureLayer(svg, "icon-layer").style("pointer-events","none");

  let features=[];
  try{
    const geo = await fetchFirst(GEO_URLS);
    features = (geo.type==="Topology")
      ? topojson.feature(geo, geo.objects[Object.keys(geo.objects)[0]]).features
      : (geo.features||[]);
  }catch(e){ alert("Could not load GeoJSON"); console.error(e); return; }
  if(!features.length){ alert("GeoJSON has 0 features"); return; }

  detectKeys(features);
  const fc = {type:"FeatureCollection",features};
  const projection = pickProjection(fc);
  const path = d3.geoPath(projection);

  const paths = fillLayer.selectAll("path").data(features).join("path")
    .attr("class","subdiv")
    .attr("data-st", d=>d.properties?.[STATE_KEY] ?? "")
    .attr("data-d",  d=>d.properties?.[NAME_KEY]  ?? "")
    .attr("d", path)
    .attr("fill", "url(#diagonalHatch)")
    .attr("stroke", "#666").attr("stroke-width", 0.7);

  // tooltip (only for configured sub-divisions)
  const allowed = new Set((window.subdivisions||[]).map(r=>norm(r.name)));
  const tooltip = ensureTooltip();

  paths.on("pointerenter", function(){ d3.select(this).raise(); })
    .on("pointermove", function(evt, d){
      const raw = d?.properties?.[MATCH_KEY] ?? "";
      const key = norm(raw);
      if(!allowed.has(key)){ tooltip.style("opacity",0); return; }
      const pad=14, vw=innerWidth, vh=innerHeight, ttW=200, ttH=44;
      let x=evt.clientX+pad, y=evt.clientY+pad;
      if(x+ttW>vw) x = vw-ttW-pad;
      if(y+ttH>vh) y = vh-ttH-pad;
      tooltip.style("opacity",1).html(raw).style("left",x+"px").style("top",y+"px");
    })
    .on("pointerleave", ()=> tooltip.style("opacity",0))
    .style("cursor", d => allowed.has(norm(d?.properties?.[MATCH_KEY] ?? "")) ? "pointer" : "default");

  // group by ST_NM path nodes and features
  const idx = new Map(), groups = new Map();
  paths.each(function(d){
    const key = norm(String(d.properties?.[MATCH_KEY] ?? "")); // group by ST_NM
    if(!key) return;
    (idx.get(key)    || idx.set(key,[]).get(key)).push(this);
    (groups.get(key) || groups.set(key,[]).get(key)).push(d);
  });
  indexByGroup[svgId] = idx;

  // projected centroid per grouped region
  groupCentroid[svgId] = {};
  const gp = d3.geoPath(projection);
  groups.forEach((arr, key) => {
    const groupFC = { type: "FeatureCollection", features: arr };
    let [x, y] = gp.centroid(groupFC);
    if (Number.isFinite(x) && Number.isFinite(y)) groupCentroid[svgId][key] = [x,y];
  });

  // finally colorize (after table exists for day1/day2)
  if (svgId === "#indiaMapDay2"){
    buildFixedTable();
    document.querySelectorAll("#forecast-table-body select").forEach(sel=>{
      if (sel.options.length && sel.selectedIndex < 0) sel.selectedIndex = 0;
    });
    updateMapColors();
  }
}

/* ----- build forecast table ----- */
function buildFixedTable(){
  const tbody = document.getElementById("forecast-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const options = window.forecastOptions || [];
  const byState = new Map();
  (window.subdivisions || []).forEach(row => {
    if (!byState.has(row.state)) byState.set(row.state, []);
    byState.get(row.state).push(row);
  });

  let i=1;
  for (const [state, rows] of byState) {
    rows.forEach((row, j) => {
      const tr = document.createElement("tr");
      tr.dataset.state  = state;
      tr.dataset.subdiv = row.name;

      const tdNo = document.createElement("td"); tdNo.textContent = i++; tr.appendChild(tdNo);

      if (j===0){
        const tdState = document.createElement("td");
        tdState.textContent = state;
        tdState.rowSpan = rows.length;
        tdState.style.verticalAlign = "middle";
        tr.appendChild(tdState);
      }

      const tdSub = document.createElement("td");
      tdSub.textContent = row.name; tr.appendChild(tdSub);

      const td1 = document.createElement("td");
      const td2 = document.createElement("td");

      const s1 = document.createElement("select");
      const s2 = document.createElement("select");
      [s1,s2].forEach(sel=>{
        sel.className = "select-clean w-full";
        options.forEach(opt=>{
          const o=document.createElement("option");
          o.value=opt; o.textContent=opt; sel.appendChild(o);
        });
        // lock selects on daily page
        if (document.body.dataset.readonly === "true") sel.disabled = true;
        sel.addEventListener("change", updateMapColors);
      });

      td1.appendChild(s1); td2.appendChild(s2);
      tr.appendChild(td1); tr.appendChild(td2);

      tr.addEventListener("mouseenter", ()=>highlight(row.name,true));
      tr.addEventListener("mouseleave", ()=>highlight(row.name,false));

      tbody.appendChild(tr);
    });
  }

  // If daily page, you can auto-fill default values if desired:
  if (document.body.dataset.readonly === "true") {
    document.querySelectorAll('#forecast-table-body tr').forEach(tr=>{
      const [s1,s2] = tr.querySelectorAll('select');
      if (s1 && s1.options.length) s1.value = "Clear Sky";
      if (s2 && s2.options.length) s2.value = "Clear Sky";
    });
  }
}

/* hover highlight */
function highlight(label, on){
  const key = norm(label);
  ["#indiaMapDay1","#indiaMapDay2"].forEach(svgId=>{
    const nodes = indexByGroup[svgId]?.get(key);
    if (!nodes) return;
    nodes.forEach(n => {
      n.style.strokeWidth = on ? "2px" : "";
      n.style.filter = on ? "drop-shadow(0 0 4px rgba(0,0,0,0.4))" : "";
    });
  });
}

/* color maps + color selects */
function colorizeSelect(sel, label){
  const pal = window.forecastColors || {};
  const c   = pal[label] || "#fff";
  sel.style.backgroundColor = c;
  sel.style.color = "#111827";
  sel.style.borderColor = "#e5e7eb";
}
function updateMapColors(){
  const pal   = window.forecastColors || {};
  const icons = window.forecastIcons  || {};

  const rows = Array.from(document.querySelectorAll("#forecast-table-body tr")).map(tr=>{
    const subdiv = tr.dataset.subdiv;
    const day1Sel = tr.querySelectorAll('select')[0];
    const day2Sel = tr.querySelectorAll('select')[1];
    const day1 = day1Sel?.value || null;
    const day2 = day2Sel?.value || null;
    if (day1Sel) colorizeSelect(day1Sel, day1);
    if (day2Sel) colorizeSelect(day2Sel, day2);
    return { key:norm(subdiv), day1, day2, raw:subdiv };
  });

  ["#indiaMapDay1","#indiaMapDay2"].forEach((svgId, idx)=>{
    const dayKey = idx===0 ? "day1" : "day2";
    const svg = d3.select(svgId);
    const idxMap = indexByGroup[svgId] || new Map();

    svg.selectAll(".subdiv").attr("fill","url(#diagonalHatch)");
    const gIcons = ensureLayer(svg, "icon-layer").style("pointer-events","none");
    gIcons.raise(); gIcons.selectAll("*").remove();

    rows.forEach(rec=>{
      const nodes = idxMap.get(rec.key);
      if(!nodes) return;
      const color = pal[rec[dayKey]] || "#eee";
      nodes.forEach(n=>n.setAttribute("fill", color));

      const pos = groupCentroid[svgId][rec.key];
      if (!pos) return;
      const [x,y] = pos;

      gIcons.append("circle")
        .attr("cx",x).attr("cy",y).attr("r",5.5)
        .attr("fill","#f5a623").attr("stroke","#fff").attr("stroke-width",1.3)
        .attr("vector-effect","non-scaling-stroke");

      const emoji = icons[rec[dayKey]];
      if (emoji){
        gIcons.append("text")
          .attr("x",x).attr("y",y)
          .attr("text-anchor","middle").attr("dominant-baseline","central")
          .attr("font-size",18).attr("paint-order","stroke")
          .attr("stroke","white").attr("stroke-width",2)
          .text(emoji);
      }
    });
  });
}

/* init */
function init(){
  if (typeof updateISTDate === "function") updateISTDate();
  buildCloudTable();
  // draw maps (table is created inside Day2 draw)
  drawMap("#indiaMapDay1");
  drawMap("#indiaMapDay2");
}
document.addEventListener("DOMContentLoaded", init);
