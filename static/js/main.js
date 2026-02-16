document.addEventListener("DOMContentLoaded", function(){
  const placeEl = document.getElementById("place");
  const itemsTable = document.getElementById("itemsTable");
  const totalCratesEl = document.getElementById("totalCrates");
  const salesTotalEl = document.getElementById("salesTotal");
  const paidTotalEl = document.getElementById("paidTotal");
  const differenceEl = document.getElementById("difference");
  const saleForm = document.getElementById("saleForm");
  const cashEl = document.getElementById("cash");
  const invoiceEl = document.getElementById("invoice_total");
  const messageEl = document.getElementById("message");
  const clearBtn = document.getElementById("clearBtn");
  const salesmanSelect = document.getElementById("salesman");
  const bankInputs = document.querySelectorAll(".bank-amt");
  let PRICE_CONFIG = {}; // will be populated from /api/config
  let SALES_MEN = [];

  // Fetch config (salesmen & price_config) from server
  async function loadConfig(){
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to load config");
      const data = await res.json();
      PRICE_CONFIG = data.price_config || {};
      SALES_MEN = data.salesmen || [];
      populateSalesmen();
      applyPricesForPlace(placeEl.value);
    } catch (err) {
      console.error("Error loading config:", err);
      // fallback: clear salesman select to allow manual typing (if we had allowed that)
      salesmanSelect.innerHTML = '<option value="">(no salesmen loaded)</option>';
      applyPricesForPlace(placeEl.value);
    }
  }

  function populateSalesmen(){
    salesmanSelect.innerHTML = "";
    if (SALES_MEN.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.innerText = "No salesmen (add in DB)";
      salesmanSelect.appendChild(opt);
      return;
    }
    const blank = document.createElement("option");
    blank.value = "";
    blank.innerText = "Select salesman";
    salesmanSelect.appendChild(blank);
    SALES_MEN.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.innerText = s;
      salesmanSelect.appendChild(opt);
    });
  }

  function applyPricesForPlace(place){
    const rows = itemsTable.querySelectorAll("tbody tr");
    rows.forEach(row => {
      const name = row.dataset.name;
      const priceInput = row.querySelector(".price");
      let defaultPrice = "";
      if (PRICE_CONFIG && PRICE_CONFIG["Main Store"] && PRICE_CONFIG["Main Store"][name] !== undefined){
        defaultPrice = PRICE_CONFIG["Main Store"][name];
      }
      if (PRICE_CONFIG && PRICE_CONFIG[place] && PRICE_CONFIG[place][name] !== undefined && PRICE_CONFIG[place][name] !== null){
        defaultPrice = PRICE_CONFIG[place][name];
      }
      priceInput.value = (defaultPrice !== undefined && defaultPrice !== null) ? defaultPrice : "";
      // Dawa/Shet: allow editing (flexible). Others: set readOnly so user must use configured price.
      if (place === "Dawa" || place === "Shet"){
        priceInput.readOnly = false;
        priceInput.classList.remove("readonly");
      } else {
        priceInput.readOnly = true;
        priceInput.classList.add("readonly");
      }
    });
    recalcTotals();
  }

  function recalcTotals(){
    let totalCrates = 0;
    let salesTotal = 0;
    const rows = itemsTable.querySelectorAll("tbody tr");
    rows.forEach(row => {
      const crates = parseInt(row.querySelector(".crates").value || 0);
      const price = parseFloat(row.querySelector(".price").value || 0);
      totalCrates += crates;
      salesTotal += crates * price;
    });
    const cash = parseFloat(cashEl.value || 0);
    let banksTotal = 0;
    bankInputs.forEach(b => banksTotal += parseFloat(b.value || 0));
    const paidTotal = cash + banksTotal;
    totalCratesEl.innerText = totalCrates;
    salesTotalEl.innerText = salesTotal.toFixed(2);
    paidTotalEl.innerText = paidTotal.toFixed(2);
    differenceEl.innerText = (paidTotal - salesTotal).toFixed(2);
  }

  // attach event listeners
  itemsTable.addEventListener("input", recalcTotals);
  cashEl.addEventListener("input", recalcTotals);
  bankInputs.forEach(b => b.addEventListener("input", recalcTotals));
  placeEl.addEventListener("change", function(){
    applyPricesForPlace(this.value);
  });

  // initial load
  loadConfig();

  saleForm.addEventListener("submit", async function(e){
    e.preventDefault();
    const items = [];
    const rows = itemsTable.querySelectorAll("tbody tr");
    rows.forEach(row => {
      const name = row.dataset.name;
      const crates = parseInt(row.querySelector(".crates").value || 0);
      const price = parseFloat(row.querySelector(".price").value || 0);
      if (crates > 0){
        items.push({name, crates, price});
      }
    });
    if (items.length === 0){
      showMessage("Please enter at least one item with crates > 0", true);
      return;
    }

    const banks = {};
    bankInputs.forEach(b => banks[b.dataset.bank] = parseFloat(b.value || 0));
    const payload = {
      salesman: salesmanSelect.value,
      date: document.getElementById("date").value,
      place: placeEl.value,
      items: items,
      payments: {
        cash: parseFloat(cashEl.value || 0),
        banks: banks
      },
      invoice_total: parseFloat(invoiceEl.value || 0)
    };

    try {
      const res = await fetch("/submit", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok){
        const msg = data && data.error ? data.error : "Failed to save sale";
        showMessage("Error: " + msg, true);
        console.error("Save error details:", data);
        return;
      }
      // success
      showMessage("Sale saved successfully");
      // Reset and reapply default prices
      saleForm.reset();
      applyPricesForPlace(placeEl.value);
    } catch (err) {
      console.error("Submit exception:", err);
      showMessage("Network or server error while saving sale", true);
    }
  });

  clearBtn.addEventListener("click", function(){
    saleForm.reset();
    applyPricesForPlace(placeEl.value);
    showMessage("Cleared form");
  });

  function showMessage(text, isError){
    messageEl.style.display = "block";
    messageEl.innerText = text;
    if (isError){
      messageEl.style.background = "#ffe9e9";
      messageEl.style.color = "#7d1a1a";
    } else {
      messageEl.style.background = "#e9f8ff";
      messageEl.style.color = "#035a9c";
    }
    setTimeout(()=> messageEl.style.display = "none", 5000);
  }

  // Sales list & report functionality (unchanged)
  const loadSalesBtn = document.getElementById("loadSales");
  const salesResults = document.getElementById("salesResults");
  const startEl = document.getElementById("start");
  const endEl = document.getElementById("end");
  const downloadPdf = document.getElementById("downloadPdf");

  if (loadSalesBtn){
    loadSalesBtn.addEventListener("click", loadSales);
    downloadPdf.addEventListener("click", function(e){
      e.preventDefault();
      const start = startEl.value;
      const end = endEl.value;
      if (!start || !end){ alert("Choose start and end date"); return; }
      downloadPdf.href = `/report/pdf?start=${start}&end=${end}`;
      window.location = downloadPdf.href;
    });
  }

  async function loadSales(){
    const start = startEl.value;
    const end = endEl.value;
    if (!start || !end){ alert("Please select start and end dates"); return; }
    salesResults.innerHTML = "Loading...";
    const res = await fetch(`/api/get_sales?start=${start}&end=${end}`);
    const data = await res.json();
    renderSales(data);
  }

  function renderSales(data){
    salesResults.innerHTML = "";
    for (const [date, sales] of Object.entries(data)){
      const h = document.createElement("h3");
      h.innerText = date;
      salesResults.appendChild(h);
      if (!sales || sales.length === 0){
        const p = document.createElement("p"); p.innerText = "No sales";
        salesResults.appendChild(p);
        continue;
      }
      sales.forEach(s => {
        const div = document.createElement("div");
        div.className = "sale-card";
        const meta = document.createElement("div");
        meta.className = "sale-meta";
        meta.innerText = `${s.salesman} — ${s.place} — Crates: ${s.crates_total} — Sales: ${s.sales_total}`;
        const details = document.createElement("pre");
        details.innerText = JSON.stringify(s.items, null, 2);
        div.appendChild(meta);
        div.appendChild(details);
        salesResults.appendChild(div);
      });
    }
  }
});