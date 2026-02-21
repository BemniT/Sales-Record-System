// main.js — adds expenses support and a confirmation modal for submit_totals

document.addEventListener("DOMContentLoaded", function(){
  // Element refs
  const placeEl = document.getElementById("place");
  const itemsTable = document.getElementById("itemsTable");
  const computedTotalEl = document.getElementById("computed_total");
  const computedCratesEl = document.getElementById("computed_crates");
  const paidPreviewEl = document.getElementById("paid_preview");
  const messageEl = document.getElementById("message");
  const clearBtn = document.getElementById("clearBtn");
  const salesmanSelect = document.getElementById("salesman");

  // Bank elements
  const addBankBtn = document.getElementById("addBankBtn");
  const bankBank = document.getElementById("bankBank");
  const bankAmount = document.getElementById("bankAmount");
  const bankCustomer = document.getElementById("bankCustomer");
  const bankEntriesList = document.getElementById("bankEntriesList");
  const bankTotalDisplay = document.getElementById("bankTotalDisplay");
  const bankTotalInput = document.getElementById("bankTotalInput");

  // Expenses elements
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

  // Modal refs
  const confirmSubmitModalEl = document.getElementById("confirmSubmitModal");
  const modalDate = document.getElementById("modalDate");
  const modalPlace = document.getElementById("modalPlace");
  const modalTotalSales = document.getElementById("modalTotalSales");
  const modalBankTotal = document.getElementById("modalBankTotal");
  const modalExpensesTotal = document.getElementById("modalExpensesTotal");
  const modalCashTotal = document.getElementById("modalCashTotal");
  const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");

  let confirmModal; // bootstrap modal instance (created when needed)
  let PRICE_CONFIG = {};
  let SALES_MEN = [];
  let currentBankEntries = [];
  let currentExpenses = [];
  const CU = window.CURRENT_USER || {};

  function showMessage(text, isError){
    if (!messageEl) return;
    messageEl.style.display = "block";
    messageEl.innerText = text;
    if (isError){ messageEl.style.background = "#ffe9e9"; messageEl.style.color = "#7d1a1a"; }
    else { messageEl.style.background = "#e9f8ff"; messageEl.style.color = "#035a9c"; }
    setTimeout(()=> { if (messageEl) messageEl.style.display = "none"; }, 5000);
  }

    async function loadConfig(){
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to load config");
      const data = await res.json();
      PRICE_CONFIG = data.price_config || {};
      SALES_MEN = data.salesmen || [];
      populateSalesmen();

      // Role-specific adjustments
      if (CU && CU.role === "van"){
        // van behavior: preselect salesman and place and lock them
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
      } else if (CU && CU.role === "dataman"){
        // dataman can register sales only for Store, Dawa, Shet
        const allowedPlaces = ["Store","Dawa","Shet"];
        if (placeEl){
          // rebuild options to allowed subset
          const current = placeEl.value;
          placeEl.innerHTML = "";
          allowedPlaces.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p; opt.innerText = p;
            placeEl.appendChild(opt);
          });
          // preselect user's place if provided or default to Store
          placeEl.value = (CU.place && allowedPlaces.includes(CU.place)) ? CU.place : "Store";
          placeEl.disabled = false;
        }
        // dataman acts as 'Store' salesman contextually
        if (salesmanSelect){
          salesmanSelect.innerHTML = "";
          const opt = document.createElement("option");
          opt.value = "Store"; opt.innerText = "Store";
          salesmanSelect.appendChild(opt);
          salesmanSelect.value = "Store";
          salesmanSelect.disabled = true;
        }
      } else {
        // Other roles (owner or none) keep full list
        if (placeEl) placeEl.disabled = false;
      }

      if (placeEl) applyPricesForPlace(placeEl.value);
      loadBankEntries();
      loadExpenses();
    } catch (err) {
      console.error(err);
    }
  }
  function populateSalesmen(){
    if (!salesmanSelect) return;
    salesmanSelect.innerHTML = "";
    if (!SALES_MEN || SALES_MEN.length === 0){
      const opt = document.createElement("option"); opt.value = ""; opt.innerText = "No salesmen (add in DB)"; salesmanSelect.appendChild(opt); return;
    }
    const blank = document.createElement("option"); blank.value = ""; blank.innerText = "Select salesman"; salesmanSelect.appendChild(blank);
    SALES_MEN.forEach(s => { const opt = document.createElement("option"); opt.value = s; opt.innerText = s; salesmanSelect.appendChild(opt); });
  }

  // (snippet - replace applyPricesForPlace function body)
function applyPricesForPlace(place){
  if (!itemsTable) return;
  const rows = itemsTable.querySelectorAll("tbody tr");
  rows.forEach(row => {
    const name = row.dataset.name;
    const priceInput = row.querySelector(".price");
    const subtotalEl = row.querySelector(".item-subtotal");
    let defaultPrice = "";
    if (PRICE_CONFIG && PRICE_CONFIG["Store"] && PRICE_CONFIG["Store"][name] !== undefined) defaultPrice = PRICE_CONFIG["Store"][name];
    if (place && PRICE_CONFIG && PRICE_CONFIG[place] && PRICE_CONFIG[place][name] !== undefined && PRICE_CONFIG[place][name] !== null) defaultPrice = PRICE_CONFIG[place][name];
    priceInput.value = (defaultPrice !== undefined && defaultPrice !== null) ? defaultPrice : "";
    subtotalEl && (subtotalEl.innerText = "0.00");

    // Make price editable only for Dawa and Shet; readonly for Store and Vans
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
    let total = 0;
    let crates = 0;
    const rows = itemsTable.querySelectorAll("tbody tr");
    rows.forEach(row => {
      const cratesVal = parseInt(row.querySelector(".crates").value || 0);
      const priceVal = parseFloat(row.querySelector(".price").value || 0);
      const subtotal = cratesVal * priceVal;
      const subtotalEl = row.querySelector(".item-subtotal");
      subtotalEl && (subtotalEl.innerText = subtotal.toFixed(2));
      total += subtotal;
      crates += cratesVal;
    });
    computedTotalEl && (computedTotalEl.value = total.toFixed(2));
    computedCratesEl && (computedCratesEl.value = crates);
    if (totalSalesInput && (!totalSalesInput.value || totalSalesInput.value === "")) {
      totalSalesInput.value = total.toFixed(2);
    }
    const bankTotal = parseFloat(bankTotalInput ? (bankTotalInput.value || 0) : 0) || 0;
    const expensesTotal = parseFloat(expensesTotalDisplay ? (expensesTotalDisplay.innerText || 0) : 0) || 0;
    paidPreviewEl && (paidPreviewEl.value = (total - bankTotal - expensesTotal).toFixed(2));
  }

  // Bank entries functions (as before)
  async function loadBankEntries(){
    if (!bankEntriesList) return;
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    if (!date || !place) { bankEntriesList.innerHTML = "<div class='text-muted small'>Pick date & place</div>"; return; }
    try {
      bankEntriesList.innerHTML = "Loading...";
      const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/bank_entries`);
      const data = await res.json();
      currentBankEntries = data.bank_entries || [];
      renderBankEntries();
    } catch (err) {
      bankEntriesList.innerHTML = "<div class='text-danger small'>Error loading</div>";
      console.error(err);
    }
  }
  function renderBankEntries(){
    if (!bankEntriesList) return;
    if (!currentBankEntries || !currentBankEntries.length){ bankEntriesList.innerHTML = "<div class='text-muted small'>No bank entries</div>"; updateBankTotal(); return; }
    const frag = document.createDocumentFragment();
    currentBankEntries.forEach(e => {
      const div = document.createElement("div");
      div.className = "list-group-item d-flex justify-content-between align-items-start";
      const left = document.createElement("div");
      left.innerHTML = `<div><strong>${e.bank}</strong> — ${e.customer || ''}</div><div class="small text-muted">${e.created_by || ''} @ ${new Date(e.created_at).toLocaleTimeString()}</div>`;
      const right = document.createElement("div");
      right.innerHTML = `<div class="text-end"><div><strong>${(parseFloat(e.amount)||0).toFixed(2)}</strong></div><div class="mt-1 small">${e.id ? `<button class="btn btn-sm btn-link text-danger delete-be" data-id="${e.id}">Delete</button>` : ''}</div></div>`;
      div.appendChild(left); div.appendChild(right);
      frag.appendChild(div);
    });
    bankEntriesList.innerHTML = "";
    bankEntriesList.appendChild(frag);
    bankEntriesList.querySelectorAll(".delete-be").forEach(btn => {
      btn.addEventListener("click", async function(){
        const id = this.dataset.id;
        if (!confirm("Delete this bank entry?")) return;
        await deleteBankEntry(id);
      });
    });
    updateBankTotal();
  }
  function updateBankTotal(){
    const total = (currentBankEntries || []).reduce((s,e) => s + (parseFloat(e.amount) || 0), 0);
    bankTotalDisplay && (bankTotalDisplay.innerText = total.toFixed(2));
    bankTotalInput && (bankTotalInput.value = total.toFixed(2));
    const computed = parseFloat(computedTotalEl ? (computedTotalEl.value || 0) : 0) || 0;
    const expensesTotal = parseFloat(expensesTotalDisplay ? (expensesTotalDisplay.innerText || 0) : 0) || 0;
    paidPreviewEl && (paidPreviewEl.value = (computed - total - expensesTotal).toFixed(2));
    if (totalSalesInput && (!totalSalesInput.value || totalSalesInput.value === "")) {
      totalSalesInput.value = computed.toFixed(2);
    }
  }
  async function addBankEntry(){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    if (!date || !place){ showMessage("Pick date & place before adding bank entries", true); return; }
    const bank = bankBank.value || "";
    const amount = parseFloat(bankAmount.value || 0);
    const customer = bankCustomer.value || "";
    if (!bank || !amount || amount <= 0){ showMessage("Enter valid bank & amount", true); return; }
    try {
      const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/bank_entry`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ bank, amount, customer })
      });
      const data = await res.json();
      if (!res.ok){ showMessage((data && data.error) ? data.error : "Failed to add bank entry", true); return; }
      bankAmount.value = ""; bankCustomer.value = "";
      showMessage("Bank entry added");
      await loadBankEntries();
    } catch (err) { console.error(err); showMessage("Network error while adding bank entry", true); }
  }
  async function deleteBankEntry(id){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    try {
      const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/bank_entry/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok){ showMessage((data && data.error) ? data.error : "Failed to delete", true); return; }
      showMessage("Bank entry deleted");
      await loadBankEntries();
    } catch (err) { console.error(err); showMessage("Network error while deleting bank entry", true); }
  }

  // Expenses functions
  async function loadExpenses(){
    if (!expensesList) return;
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    if (!date || !place) { expensesList.innerHTML = "<div class='text-muted small'>Pick date & place</div>"; return; }
    expPlaceLabel && (expPlaceLabel.innerText = `${place} / ${date}`);
    try {
      expensesList.innerHTML = "Loading...";
      const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/expenses`);
      const data = await res.json();
      currentExpenses = data.expenses || [];
      renderExpenses();
    } catch (err) {
      expensesList.innerHTML = "<div class='text-danger small'>Error loading</div>";
      console.error(err);
    }
  }
  function renderExpenses(){
    if (!expensesList) return;
    if (!currentExpenses || !currentExpenses.length){ expensesList.innerHTML = "<div class='text-muted small'>No expenses</div>"; updateExpensesTotal(); return; }
    const frag = document.createDocumentFragment();
    currentExpenses.forEach(e => {
      const div = document.createElement("div");
      div.className = "list-group-item d-flex justify-content-between align-items-start";
      const left = document.createElement("div");
      left.innerHTML = `<div><strong>${e.amount.toFixed(2)}</strong> — ${e.description || ''}</div><div class="small text-muted">${e.created_by || ''} @ ${new Date(e.created_at).toLocaleTimeString()}</div>`;
      const right = document.createElement("div");
      right.innerHTML = `<div><button class="btn btn-sm btn-link text-danger delete-exp" data-id="${e.id}">Delete</button></div>`;
      div.appendChild(left); div.appendChild(right);
      frag.appendChild(div);
    });
    expensesList.innerHTML = "";
    expensesList.appendChild(frag);
    expensesList.querySelectorAll(".delete-exp").forEach(btn => {
      btn.addEventListener("click", async function(){
        const id = this.dataset.id;
        if (!confirm("Delete this expense?")) return;
        await deleteExpense(id);
      });
    });
    updateExpensesTotal();
  }
  function updateExpensesTotal(){
    const total = (currentExpenses || []).reduce((s,e) => s + (parseFloat(e.amount) || 0), 0);
    expensesTotalDisplay && (expensesTotalDisplay.innerText = total.toFixed(2));
    updateBankTotal();
  }
  async function addExpense(){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    if (!date || !place){ showMessage("Pick date & place before adding expense", true); return; }
    const amount = parseFloat(expAmount.value || 0);
    const description = (expDesc.value || "").trim();
    if (!amount || amount <= 0){ showMessage("Enter valid expense amount", true); return; }
    try {
      const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/expenses`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ amount, description })
      });
      const data = await res.json();
      if (!res.ok){ showMessage((data && data.error) ? data.error : "Failed to add expense", true); return; }
      expAmount.value = ""; expDesc.value = "";
      showMessage("Expense added");
      await loadExpenses();
    } catch (err) { console.error(err); showMessage("Network error while adding expense", true); }
  }
  async function deleteExpense(id){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    try {
      const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/expenses/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok){ showMessage((data && data.error) ? data.error : "Failed to delete expense", true); return; }
      showMessage("Expense deleted");
      await loadExpenses();
    } catch (err) { console.error(err); showMessage("Network error while deleting expense", true); }
  }

  // SUBMIT TOTALS with confirmation modal
  async function prepareSubmitTotals(){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    if (!date || !place){ showMessage("Pick date & place first", true); return; }

    // items map
    const items = {};
    if (itemsTable){
      const rows = itemsTable.querySelectorAll("tbody tr");
      rows.forEach(row => {
        const name = row.dataset.name;
        const crates = parseInt(row.querySelector(".crates").value || 0);
        if (crates > 0) items[name] = crates;
      });
    }

    // compute total from items locally (validate prices)
    let computedTotal = 0;
    let missingPrices = [];
    if (Object.keys(items).length){
      const placePrices = PRICE_CONFIG && PRICE_CONFIG[place] ? PRICE_CONFIG[place] : {};
      const storePrices = PRICE_CONFIG && PRICE_CONFIG["Store"] ? PRICE_CONFIG["Store"] : {};
      for (const [display, crates] of Object.entries(items)){
        let price = undefined;
        if (placePrices && (placePrices[display] !== undefined && placePrices[display] !== null)) price = placePrices[display];
        if ((price === undefined || price === null) && storePrices && (storePrices[display] !== undefined && storePrices[display] !== null)) price = storePrices[display];
        if (price === undefined || price === null){
          missingPrices.push(display);
        } else {
          computedTotal += crates * parseFloat(price);
        }
      }
      if (missingPrices.length){
        showMessage("Missing prices for: " + missingPrices.join(", ") + ". Please update prices or enter total manually.", true);
        return;
      }
    }

    let totalSalesToSend = parseFloat(totalSalesInput.value || 0) || computedTotal;
    if (!totalSalesToSend || totalSalesToSend <= 0) totalSalesToSend = computedTotal;
    if (!totalSalesToSend || totalSalesToSend <= 0){
      showMessage("Total sales computed is zero; please enter totals or item crates/prices.", true);
      return;
    }

    const bankTotal = parseFloat(bankTotalInput ? (bankTotalInput.value || 0) : 0) || 0;
    const expensesTotal = parseFloat(expensesTotalDisplay ? (expensesTotalDisplay.innerText || 0) : 0) || 0;
    const cashPreview = (totalSalesToSend - bankTotal - expensesTotal).toFixed(2);

    // Fill modal values
    modalDate && (modalDate.innerText = date);
    modalPlace && (modalPlace.innerText = place);
    modalTotalSales && (modalTotalSales.innerText = totalSalesToSend.toFixed(2));
    modalBankTotal && (modalBankTotal.innerText = bankTotal.toFixed(2));
    modalExpensesTotal && (modalExpensesTotal.innerText = expensesTotal.toFixed(2));
    modalCashTotal && (modalCashTotal.innerText = cashPreview);

    // Show modal
    if (!confirmModal){
      confirmModal = new bootstrap.Modal(confirmSubmitModalEl);
    }
    confirmModal.show();

    // on confirm click, perform actual submit
    confirmSubmitBtn.onclick = async function(){
      confirmSubmitBtn.disabled = true;
      await doSubmitTotals({ totalSalesToSend, items });
      confirmSubmitBtn.disabled = false;
      confirmModal.hide();
    };
  }

  async function doSubmitTotals({ totalSalesToSend, items }){
    const date = document.getElementById("date").value;
    const place = placeEl ? placeEl.value : "";
    const cashOverride = cashOverrideInput && cashOverrideInput.value ? parseFloat(cashOverrideInput.value) : null;
    try {
      submitTotalsBtn.disabled = true;
      const body = { total_sales: totalSalesToSend, items: items };
      if (cashOverride !== null && !isNaN(cashOverride)) body.cash_total = cashOverride;
      const res = await fetch(`/api/reports/${date}/${encodeURIComponent(place)}/submit_totals`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      const data = await res.json();
      submitTotalsBtn.disabled = false;
      if (!res.ok){ showMessage((data && data.error) ? data.error : "Failed to submit totals", true); return; }
      showMessage("Totals submitted (report version created)");
      await loadBankEntries();
      await loadExpenses();
      totalSalesInput.value = ""; cashOverrideInput.value = "";
      computedTotalEl.value = "0.00"; computedCratesEl.value = "0"; paidPreviewEl.value = "0.00";
      // reset item rows
      document.querySelectorAll("#itemsTable tbody tr").forEach(r => {
        r.querySelector(".crates").value = 0;
        r.querySelector(".item-subtotal").innerText = "0.00";
      });
    } catch (err) {
      submitTotalsBtn.disabled = false;
      console.error(err); showMessage("Network error while submitting totals", true);
    }
  }

  // UI wiring
  toggleExpensesBtn && toggleExpensesBtn.addEventListener("click", function(e){
    e.preventDefault();
    if (expensesBody.style.display === "none"){ expensesBody.style.display = "block"; toggleExpensesBtn.innerText = "Hide"; } 
    else { expensesBody.style.display = "none"; toggleExpensesBtn.innerText = "Show"; }
  });
  addBankBtn && addBankBtn.addEventListener("click", function(e){ e.preventDefault(); addBankEntry(); });
  addExpenseBtn && addExpenseBtn.addEventListener("click", function(e){ e.preventDefault(); addExpense(); });
  submitTotalsBtn && submitTotalsBtn.addEventListener("click", function(e){ e.preventDefault(); prepareSubmitTotals(); });
  document.getElementById("date") && document.getElementById("date").addEventListener("change", function(){ loadBankEntries(); loadExpenses(); });
  placeEl && placeEl.addEventListener("change", function(){ applyPricesForPlace(this.value); loadBankEntries(); loadExpenses(); });

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
    computedTotalEl.value = "0.00";
    computedCratesEl.value = "0";
    totalSalesInput.value = "";
    cashOverrideInput.value = "";
    paidPreviewEl.value = "0.00";
    showMessage("Cleared item inputs (bank entries & expenses preserved)");
  });

  async function init(){
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      PRICE_CONFIG = data.price_config || {};
      SALES_MEN = data.salesmen || [];
      populateSalesmen();
      if (placeEl) applyPricesForPlace(placeEl.value);
      loadBankEntries();
      loadExpenses();
    } catch (err) { console.error(err); }
  }
  init();
});