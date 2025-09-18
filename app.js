/* helper: color the select controls */
function colorizeSelect(sel, label){
  const pal = window.forecastColors || {};
  const c   = pal[label] || "#fff";
  sel.style.backgroundColor = c;
  sel.style.color       = "#111827";  // darker text
  sel.style.borderColor = "#e5e7eb";  // subtle border, not bold black
}

/* ---------- Forecast table with merged State cells ---------- */
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

  let i = 1;
  for (const [state, rows] of byState) {
    rows.forEach((row, j) => {
      const tr = document.createElement("tr");
      tr.dataset.state  = state;
      tr.dataset.subdiv = row.name;

      const tdNo = document.createElement("td"); tdNo.textContent = i++; tr.appendChild(tdNo);

      if (j === 0) {
        const tdState = document.createElement("td");
        tdState.setAttribute("data-col", "state");
        tdState.textContent = state;
        tdState.rowSpan = rows.length;
        tdState.style.verticalAlign = "middle";
        tr.appendChild(tdState);
      }

      const tdSub = document.createElement("td");
      tdSub.setAttribute("data-col", "subdiv");
      tdSub.textContent = row.name;
      tr.appendChild(tdSub);

      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      td1.setAttribute("data-col","day1");
      td2.setAttribute("data-col","day2");

      const s1 = document.createElement("select");
      const s2 = document.createElement("select");
      [s1, s2].forEach(sel=>{
        sel.className = "select-clean w-full";   // <<< tiny chevron + nice border
        options.forEach(opt => {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          sel.appendChild(o);
        });
        sel.addEventListener("change", updateMapColors);
        if (sel.options.length && sel.selectedIndex < 0) sel.selectedIndex = 0;
      });

      td1.appendChild(s1); td2.appendChild(s2);
      tr.appendChild(td1); tr.appendChild(td2);

      tr.addEventListener("mouseenter", () => highlight(row.name, true));
      tr.addEventListener("mouseleave", () => highlight(row.name, false));

      tbody.appendChild(tr);
    });
  }
}
