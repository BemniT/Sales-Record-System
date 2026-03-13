document.addEventListener("DOMContentLoaded", function(){
  const placeEl = document.getElementById("place");
  const itemsTable = document.getElementById("itemsTable");
  const computedTotalEl = document.getElementById("computed_total");
  const computedCratesEl = document.getElementById("computed_crates");
  const paidPreviewEl = document.getElementById("paid_preview");
  const messageEl = document.getElementById("message");
  const clearBtn = document.getElementById("clearBtn");
  const salesmanSelect = document.getElementById("salesman");

  const addBankBtn = document.getElementById("addBankBtn");
  const bankBank = document.getElementById("bankBank");
  const bankAmount = document.getElementById("bankAmount");
  const bankCustomer = document.getElementById("bankCustomer");
  const bankEntriesList = document.getElementById("bankEntriesList");
  const bankTotalDisplay = document.getElementById("bankTotalDisplay");
  const bankTotalInput = document.getElementById("bankTotalInput");

  const toggleExpensesBtn = document.getElementById("toggleExpensesBtn");
  const expensesBody = document.getElementById("expensesBody");
  const addExpenseBtn = document.getElementById("addExpenseBtn");
  const expAmount = document.getElementById("expAmount");
  const expDesc = document.getElementById("expDesc");
  const expensesList = document.getElementById("expensesList");
  const expensesTotalDisplay = document.getElementById("expensesTotalDisplay");
  const expPlaceLabel = document.getElementById("expPlaceLabel");

  const totalSalesInput = document.getElementById("totalSalesInput");
  const cashOverrideInput = document.getElementById("cashOverride");
  const submitTotalsBtn = document.getElementById("submitTotalsBtn");

  const confirmSubmitModalEl = document.getElementById("confirmSubmitModal");
  const modalDate = document.getElementById("modalDate");
  const modalPlace = document.getElementById("modalPlace");
  const modalTotalSales = document.getElementById("modalTotalSales");
  const modalBankTotal = document.getElementById("modalBankTotal");
  const modalExpensesTotal = document.getElementById("modalExpensesTotal");
  const modalCashTotal = document.getElementById("modalCashTotal");
  const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");

  let confirmModal;
  let PRICE_CONFIG = {};
  let SALES_MEN = [];
  let currentBankEntries = [];
  let currentExpenses = [];
  const CU = window.CURRENT_USER || {};
  let totalManualOverride = false;

  function showMessage(text, isError){
    if (!messageEl) return;
    messageEl.style.display = "block";
    messageEl.innerText = text;
    if (isError){ messageEl.style.background = "#ffe9e9"; messageEl.style.color = "#7d1a1a"; }
    else { messageEl.style.background = "#e9f8ff"; messageEl.style.color = "#035a9c"; }
    setTimeout(()=> { if (messageEl) messageEl.style.display = "none"; }, 4500);
  }

  function populateSalesmen(){
    if (!salesmanSelect) return;
    salesmanSelect.innerHTML = "";
    if (!SALES_MEN || !SALES_MEN.length){
      const opt = document.createElement("option");
      opt.value = "";
      opt.innerText = "No salesmen";
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

  async function loadConfig(){
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to load config");
    const data = await res.json();
    PRICE_CONFIG = data.price_config || {};
    SALES_MEN = data.salesmen || [];
    populateSalesmen();

    if (CU.role === "van") {
      if (SALES_MEN.length){
        const found = SALES_MEN.find(x => x.toLowerCase().includes((CU.username||"").toLowerCase()));
        if (found) salesmanSelect.value = found;
      } else if (CU.username){
        salesmanSelect.value = CU.username;
      }
      if (salesmanSelect) salesmanSelect.disabled = true;
      if (placeEl){
        placeEl.value = CU.place || placeEl.value;
        placeEl.disabled = true;
      }
    } else if (CU.role === "dataman") {
  // Dataman can register Store, Dawa, Shet
  if (placeEl){
    placeEl.innerHTML = "";
    ["Store", "Dawa", "Shet"].forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.innerText = p;
      placeEl.appendChild(opt);
    });
    placeEl.value = "Store";
    placeEl.disabled = false; // allow switching among Store/Dawa/Shet
  }

  if (salesmanSelect){
    salesmanSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "Store";
    opt.innerText = "Store";
    salesmanSelect.appendChild(opt);
    salesmanSelect.value = "Store";
    salesmanSelect.disabled = true;
  }
}else {
      if (placeEl) placeEl.disabled = false;
    }

    if (placeEl) applyPricesForPlace(placeEl.value);
    await loadBankEntries();
    await loadExpenses();
  }

  function applyPricesForPlace(place){
    if (!itemsTable) return;
    const rows = itemsTable.querySelectorAll("tbody tr");
    rows.forEach(row => {
      const name = row.dataset.name;
      const priceInput = row.querySelector(".price");
      const subtotalEl = row.querySelector(".item-subtotal");

      const storeMap = (PRICE_CONFIG && PRICE_CONFIG["Store"]) ? PRICE_CONFIG["Store"] : {};
      const placeMap = (PRICE_CONFIG && PRICE_CONFIG[place]) ? PRICE_CONFIG[place] : {};

      let defaultPrice = "";
      if (placeMap[name] !== undefined && placeMap[name] !== null) defaultPrice = placeMap[name];
      else if (storeMap[name] !== undefined && storeMap[name] !== null) defaultPrice = storeMap[name];

      priceInput.value = (defaultPrice !== undefined && defaultPrice !== null) ? defaultPrice : "";
      if (subtotalEl) subtotalEl.innerText = "0.00";

      if (place === "Dawa" || place === "Shet") {
        priceInput.readOnly = false;
        priceInput.classList.remove("price-readonly");
      } else {
        priceInput.readOnly = true;
        priceInput.classList.add("price-readonly");
      }
    });
    recomputeItemsSummary();
  }

  function recomputeItemsSummary(){
    if (!itemsTable) return;
    let total = 0, crates = 0;
    itemsTable.querySelectorAll("tbody tr").forEach(row => {
      const cratesVal = parseInt(row.querySelector(".crates").value || 0, 10);
      const priceVal = parseFloat(row.querySelector(".price").value || 0);
      const subtotal = cratesVal * priceVal;
      const subtotalEl = row.querySelector(".item-subtotal");
      if (subtotalEl) subtotalEl.innerText = subtotal.toFixed(2);
      total += subtotal;
      crates += cratesVal;
    });

    if (computedTotalEl) computedTotalEl.value = total.toFixed(2);
    if (computedCratesEl) computedCratesEl.value = String(crates);

    if (totalSalesInput && !totalManualOverride) totalSalesInput.value = total.toFixed(2);

    const bankTotal = parseFloat(bankTotalInput ? (bankTotalInput.value || 0) : 0) || 0;
    const expensesTotal = parseFloat(expensesTotalDisplay ? (expensesTotalDisplay.innerText || 0) : 0) || 0;
    const suggestedCash = total - bankTotal - expensesTotal;
    if (paidPreviewEl) paidPreviewEl.value = suggestedCash.toFixed(2);
  }

  async function loadBankEntries(){
    if (!bankEntriesList) return;
    const dateEl = document.getElementById("date");
    const date = dateEl ? dateEl.value : "";
    const place = placeEl ? placeEl.value : "";
    if (!date || !place) return;
    const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/bank_entries`);
    const data = await res.json();
    currentBankEntries = data.bank_entries || [];
    renderBankEntries();
  }

  function renderBankEntries(){
    if (!bankEntriesList) return;
    if (!currentBankEntries.length){
      bankEntriesList.innerHTML = "<div class='text-muted small'>No bank entries</div>";
      updateBankTotal();
      return;
    }
    const frag = document.createDocumentFragment();
    currentBankEntries.forEach(e => {
      const div = document.createElement("div");
      div.className = "list-group-item d-flex justify-content-between align-items-start";
      div.innerHTML = `
        <div>
          <div><strong>${e.bank || ""}</strong> — ${e.customer || ""}</div>
          <div class="small text-muted">${e.created_by || ""} @ ${new Date(e.created_at).toLocaleTimeString()}</div>
        </div>
        <div class="text-end">
          <div><strong>${(parseFloat(e.amount)||0).toFixed(2)}</strong></div>
          <div class="mt-1 small">${e.id ? `<button class="btn btn-sm btn-link text-danger delete-be" data-id="${e.id}">Delete</button>` : ""}</div>
        </div>`;
      frag.appendChild(div);
    });
    bankEntriesList.innerHTML = "";
    bankEntriesList.appendChild(frag);

    bankEntriesList.querySelectorAll(".delete-be").forEach(btn => {
      btn.addEventListener("click", async function(){
        if (!confirm("Delete this bank entry?")) return;
        await deleteBankEntry(this.dataset.id);
      });
    });
    updateBankTotal();
  }

  function updateBankTotal(){
    const total = currentBankEntries.reduce((s,e) => s + (parseFloat(e.amount) || 0), 0);
    if (bankTotalDisplay) bankTotalDisplay.innerText = total.toFixed(2);
    if (bankTotalInput) bankTotalInput.value = total.toFixed(2);

    const computed = parseFloat(computedTotalEl ? (computedTotalEl.value || 0) : 0) || 0;
    const expensesTotal = parseFloat(expensesTotalDisplay ? (expensesTotalDisplay.innerText || 0) : 0) || 0;
    if (paidPreviewEl) paidPreviewEl.value = (computed - total - expensesTotal).toFixed(2);
  }

  async function addBankEntry(){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    const bank = bankBank.value || "";
    const amount = parseFloat(bankAmount.value || 0);
    const customer = bankCustomer.value || "";

    if (!date || !place) return showMessage("Pick date & place first", true);
    if (!bank || !amount || amount <= 0) return showMessage("Enter valid bank & amount", true);

    const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/bank_entry`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ bank, amount, customer })
    });
    const data = await res.json();
    if (!res.ok) return showMessage(data.error || "Failed to add bank entry", true);

    bankAmount.value = "";
    bankCustomer.value = "";
    showMessage("Bank entry added");
    await loadBankEntries();
  }

  async function deleteBankEntry(id){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/bank_entry/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return showMessage(data.error || "Failed to delete bank entry", true);
    showMessage("Bank entry deleted");
    await loadBankEntries();
  }

  async function loadExpenses(){
    if (!expensesList) return;
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    if (!date || !place) return;
    if (expPlaceLabel) expPlaceLabel.innerText = `${place} / ${date}`;

    const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/expenses`);
    const data = await res.json();
    currentExpenses = data.expenses || [];
    renderExpenses();
  }

  function renderExpenses(){
    if (!expensesList) return;
    if (!currentExpenses.length){
      expensesList.innerHTML = "<div class='text-muted small'>No expenses</div>";
      updateExpensesTotal();
      return;
    }
    const frag = document.createDocumentFragment();
    currentExpenses.forEach(e => {
      const div = document.createElement("div");
      div.className = "list-group-item d-flex justify-content-between align-items-start";
      div.innerHTML = `
        <div>
          <div><strong>${(Number(e.amount)||0).toFixed(2)}</strong> — ${e.description || ""}</div>
          <div class="small text-muted">${e.created_by || ""} @ ${new Date(e.created_at).toLocaleTimeString()}</div>
        </div>
        <div><button class="btn btn-sm btn-link text-danger delete-exp" data-id="${e.id}">Delete</button></div>`;
      frag.appendChild(div);
    });
    expensesList.innerHTML = "";
    expensesList.appendChild(frag);

    expensesList.querySelectorAll(".delete-exp").forEach(btn => {
      btn.addEventListener("click", async function(){
        if (!confirm("Delete this expense?")) return;
        await deleteExpense(this.dataset.id);
      });
    });
    updateExpensesTotal();
  }

  function updateExpensesTotal(){
    const total = currentExpenses.reduce((s,e) => s + (parseFloat(e.amount) || 0), 0);
    if (expensesTotalDisplay) expensesTotalDisplay.innerText = total.toFixed(2);
    updateBankTotal();
  }

  async function addExpense(){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    const amount = parseFloat(expAmount.value || 0);
    const description = (expDesc.value || "").trim();

    if (!date || !place) return showMessage("Pick date & place first", true);
    if (!amount || amount <= 0) return showMessage("Enter valid expense amount", true);

    const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/expenses`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ amount, description })
    });
    const data = await res.json();
    if (!res.ok) return showMessage(data.error || "Failed to add expense", true);

    expAmount.value = "";
    expDesc.value = "";
    showMessage("Expense added");
    await loadExpenses();
  }

  async function deleteExpense(id){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/expenses/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return showMessage(data.error || "Failed to delete expense", true);
    showMessage("Expense deleted");
    await loadExpenses();
  }

  if (totalSalesInput) {
    totalSalesInput.addEventListener("input", function () {
      totalManualOverride = !!this.value && this.value.toString().trim() !== "";
    });
  }

  if (cashOverrideInput) {
    cashOverrideInput.addEventListener("input", function () {
      const cashVal = parseFloat(this.value || 0) || 0;
      if (paidPreviewEl) paidPreviewEl.value = cashVal.toFixed(2);
    });
  }

  async function prepareSubmitTotals(){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    if (!date || !place) return showMessage("Pick date & place first", true);

    const items = {};
    if (itemsTable){
      itemsTable.querySelectorAll("tbody tr").forEach(row => {
        const name = row.dataset.name;
        const crates = parseInt(row.querySelector(".crates").value || 0, 10);
        if (crates > 0) items[name] = crates;
      });
    }

    let computedTotal = 0;
    let missingPrices = [];
    if (Object.keys(items).length){
      const placePrices = PRICE_CONFIG[place] || {};
      const storePrices = PRICE_CONFIG["Store"] || {};
      for (const [display, crates] of Object.entries(items)){
        let price = (placePrices[display] !== undefined && placePrices[display] !== null) ? placePrices[display] : storePrices[display];
        if (price === undefined || price === null) missingPrices.push(display);
        else computedTotal += crates * parseFloat(price);
      }
      if (missingPrices.length){
        return showMessage("Missing prices for: " + missingPrices.join(", "), true);
      }
    }

    let totalSalesToSend = parseFloat(totalSalesInput.value || 0) || computedTotal;
    if (!totalSalesToSend || totalSalesToSend <= 0) return showMessage("Total sales cannot be zero", true);

    const bankTotal = parseFloat(bankTotalInput ? (bankTotalInput.value || 0) : 0) || 0;
    const expensesTotal = parseFloat(expensesTotalDisplay ? (expensesTotalDisplay.innerText || 0) : 0) || 0;

    const cashValRaw = (cashOverrideInput && cashOverrideInput.value) ? cashOverrideInput.value : null;
    if (cashValRaw === null || cashValRaw.toString().trim() === "") {
      return showMessage("Please enter cash amount (required)", true);
    }
    const cashProvided = parseFloat(cashValRaw || 0) || 0;

    if (modalDate) modalDate.innerText = date;
    if (modalPlace) modalPlace.innerText = place;
    if (modalTotalSales) modalTotalSales.innerText = totalSalesToSend.toFixed(2);
    if (modalBankTotal) modalBankTotal.innerText = bankTotal.toFixed(2);
    if (modalExpensesTotal) modalExpensesTotal.innerText = expensesTotal.toFixed(2);
    if (modalCashTotal) modalCashTotal.innerText = cashProvided.toFixed(2);

    if (!confirmModal) confirmModal = new bootstrap.Modal(confirmSubmitModalEl);
    confirmModal.show();

    confirmSubmitBtn.onclick = async function(){
      confirmSubmitBtn.disabled = true;
      await doSubmitTotals({ totalSalesToSend, items, cashProvided });
      confirmSubmitBtn.disabled = false;
      confirmModal.hide();
    };
  }

  async function doSubmitTotals({ totalSalesToSend, items, cashProvided }){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    submitTotalsBtn.disabled = true;

    const body = { total_sales: totalSalesToSend, items };
    if (!isNaN(cashProvided)) body.cash_total = cashProvided;

    const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/submit_totals`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    submitTotalsBtn.disabled = false;

    if (!res.ok) return showMessage(data.error || "Failed to submit totals", true);

    showMessage("Totals submitted (version created)");
    await loadBankEntries();
    await loadExpenses();

    totalSalesInput.value = "";
    cashOverrideInput.value = "";
    totalManualOverride = false;
    if (computedTotalEl) computedTotalEl.value = "0.00";
    if (computedCratesEl) computedCratesEl.value = "0";
    if (paidPreviewEl) paidPreviewEl.value = "0.00";

    document.querySelectorAll("#itemsTable tbody tr").forEach(r => {
      r.querySelector(".crates").value = 0;
      r.querySelector(".item-subtotal").innerText = "0.00";
    });
  }

  toggleExpensesBtn && toggleExpensesBtn.addEventListener("click", function(e){
    e.preventDefault();
    if (expensesBody.style.display === "none"){
      expensesBody.style.display = "block";
      toggleExpensesBtn.innerText = "Hide";
    } else {
      expensesBody.style.display = "none";
      toggleExpensesBtn.innerText = "Show";
    }
  });

  addBankBtn && addBankBtn.addEventListener("click", e => { e.preventDefault(); addBankEntry(); });
  addExpenseBtn && addExpenseBtn.addEventListener("click", e => { e.preventDefault(); addExpense(); });
  submitTotalsBtn && submitTotalsBtn.addEventListener("click", e => { e.preventDefault(); prepareSubmitTotals(); });

  const dateEl = document.getElementById("date");
  dateEl && dateEl.addEventListener("change", async function(){ await loadBankEntries(); await loadExpenses(); });

  placeEl && placeEl.addEventListener("change", async function(){
    applyPricesForPlace(this.value);
    await loadBankEntries();
    await loadExpenses();
  });

  if (itemsTable){
    itemsTable.addEventListener("input", function(e){
      if (e.target && (e.target.classList.contains("crates") || e.target.classList.contains("price"))){
        recomputeItemsSummary();
      }
    });
  }

  clearBtn && clearBtn.addEventListener("click", function(){
    document.querySelectorAll("#itemsTable tbody tr").forEach(r => {
      r.querySelector(".crates").value = 0;
      r.querySelector(".item-subtotal").innerText = "0.00";
    });
    if (computedTotalEl) computedTotalEl.value = "0.00";
    if (computedCratesEl) computedCratesEl.value = "0";
    if (totalSalesInput) totalSalesInput.value = "";
    if (cashOverrideInput) cashOverrideInput.value = "";
    if (paidPreviewEl) paidPreviewEl.value = "0.00";
    showMessage("Cleared item inputs (bank/expenses preserved)");
  });

  (async function init(){
    try {
      await loadConfig();
    } catch (err) {
      console.error(err);
      showMessage("Failed loading configuration", true);
    }
  })();
});