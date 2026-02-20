// owner.js — minimal client to load summary, draw charts and export PDFs/CSV
document.addEventListener("DOMContentLoaded", function(){
  const loadBtn = document.getElementById("loadSummary");
  const startEl = document.getElementById("start");
  const endEl = document.getElementById("end");
  const periodEl = document.getElementById("period");
  const topCards = document.getElementById("topCards");
  const detailTable = document.querySelector("#detailTable tbody");
  const exportPdf = document.getElementById("exportPdf");
  const exportCsv = document.getElementById("exportCsv");

  let placeChart = null;
  let paymentsChart = null;

  async function loadSummary(e){
    if (e) e.preventDefault();
    const start = startEl.value;
    const end = endEl.value;
    const period = periodEl.value;
    if (!start || !end) { alert("Choose start and end"); return; }
    const res = await fetch(`/api/reports/summary?start=${start}&end=${end}&period=${period}`);
    const data = await res.json();
    renderSummary(data);
  }

  function renderSummary(data){
    topCards.innerHTML = "";
    detailTable.innerHTML = "";
    // data.summary: { date: { place: {...}, ... } }
    // Build aggregated numbers per place across range
    const places = {};
    let totalSales = 0, totalCash = 0, totalBank = 0, totalCrates = 0;
    for (const [date, placesObj] of Object.entries(data.summary || {})){
      for (const [place, v] of Object.entries(placesObj)){
        if (!v) continue;
        places[place] = places[place] || {sales:0,cash:0,bank:0,crates:0,rows:[]};
        places[place].sales += v.sales_total || 0;
        places[place].cash += v.cash_total || 0;
        places[place].bank += v.bank_total || 0;
        places[place].crates += v.crates_total || 0;
        places[place].rows.push({date, ...v});
        totalSales += v.sales_total || 0;
        totalCash += v.cash_total || 0;
        totalBank += v.bank_total || 0;
        totalCrates += v.crates_total || 0;
      }
    }

    // top cards
    const fragment = document.createDocumentFragment();
    fragment.appendChild(cardEl("Total Sales", totalSales.toFixed(2)));
    fragment.appendChild(cardEl("Total Crates", totalCrates));
    fragment.appendChild(cardEl("Total Cash", totalCash.toFixed(2)));
    fragment.appendChild(cardEl("Total Bank", totalBank.toFixed(2)));
    topCards.appendChild(fragment);

    // detail table rows
    for (const [place, p] of Object.entries(places)){
      for (const r of p.rows){
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${r.date}</td><td>${place}</td><td>${r.status||''}</td><td>${r.crates_total||0}</td><td>${(r.total_sales||0).toFixed(2)}</td><td>${(r.cash_total||0).toFixed(2)}</td><td>${(r.bank_total||0).toFixed(2)}</td><td>${r.created_by||''}</td>`;
        detailTable.appendChild(tr);
      }
    }

    // place chart
    const placeLabels = Object.keys(places);
    const placeData = placeLabels.map(p => places[p].sales || 0);
    renderBarChart("placeChart", placeLabels, placeData, "Sales by place");

    // payments chart
    const payLabels = placeLabels;
    const cashData = placeLabels.map(p => places[p].cash || 0);
    const bankData = placeLabels.map(p => places[p].bank || 0);
    renderStackedBar("paymentsChart", payLabels, [cashData, bankData], ["Cash","Bank"]);
  }

  function cardEl(label, value){
    const col = document.createElement("div");
    col.className = "col-md-3";
    col.innerHTML = `<div class="card p-3 h-100"><div class="top-number">${value}</div><div class="top-label">${label}</div></div>`;
    return col;
  }

  function renderBarChart(canvasId, labels, data, title){
    const ctx = document.getElementById(canvasId).getContext("2d");
    if (window[canvasId+"Chart"]) window[canvasId+"Chart"].destroy();
    window[canvasId+"Chart"] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets:[{ label:title, data, backgroundColor: '#0d6efd'}] },
      options:{ responsive:true, plugins:{ legend:{display:false} } }
    });
  }

  function renderStackedBar(canvasId, labels, datasetsData, datasetsLabels){
    const ctx = document.getElementById(canvasId).getContext("2d");
    if (window[canvasId+"Chart"]) window[canvasId+"Chart"].destroy();
    const datasets = datasetsData.map((d,i)=>({ label: datasetsLabels[i], data: d, backgroundColor: i===0 ? '#198754' : '#ffc107' }));
    window[canvasId+"Chart"] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options:{ responsive:true, plugins:{ legend:{position:'bottom'} }, scales:{ x:{ stacked:true }, y:{ stacked:true } } }
    });
  }

  // Export handlers
  exportPdf.addEventListener("click", ()=>{
    const start = startEl.value, end = endEl.value, period = periodEl.value;
    if (!start || !end) { alert("Pick dates"); return; }
    window.location = `/report/pdf?start=${start}&end=${end}&period=${period}`;
  });
  exportCsv.addEventListener("click", ()=>{
    const start = startEl.value, end = endEl.value, period = periodEl.value;
    if (!start || !end) { alert("Pick dates"); return; }
    window.location = `/report/csv?start=${start}&end=${end}&period=${period}`;
  });

  loadBtn.addEventListener("click", loadSummary);
  // initial load
  loadSummary();
});