// sales_list.js — updated to support aggregate-only (version) reports
// and to allow dataman edit/finalize of versions from Sales page.
document.addEventListener("DOMContentLoaded", function () {
  const startEl = document.getElementById("start");
  const endEl = document.getElementById("end");
  const loadBtn = document.getElementById("loadSales");
  const placeSel = document.getElementById("filterPlace");
  const salesResults = document.getElementById("salesResults");
  const topSummary = document.getElementById("topSummary");

  function escapeHtml(s){ if (!s && s !== 0) return ""; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmt(n){ return (Number(n)||0).toFixed(2); }

  async function load() {
    const start = startEl.value;
    const end = endEl.value;
    if (!start || !end) return alert("Choose start and end dates");

    const role = window.CURRENT_USER && window.CURRENT_USER.role;
    const userPlace = window.CURRENT_USER && window.CURRENT_USER.place;
    let placesParam = "";
    if (role === "van" && userPlace) {
      placesParam = `&places=${encodeURIComponent(userPlace)}`;
      if (placeSel) placeSel.value = userPlace;
    } else if (placeSel && placeSel.value) {
      placesParam = `&places=${encodeURIComponent(placeSel.value)}`;
    }

    salesResults.innerHTML = `<div class="col-12"><div class="card-report p-3">Loading...</div></div>`;
    topSummary.innerHTML = "";
    try {
      const res = await fetch(`/api/reports/view?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${placesParam}`);
      if (!res.ok) throw new Error("Failed to load reports");
      const data = await res.json();
      render(data);
    } catch (err) {
      console.error(err);
      salesResults.innerHTML = `<div class="col-12"><div class="alert alert-danger">Error loading reports: ${escapeHtml(err.message)}</div></div>`;
    }
  }

  function _toList(maybe){
    if (!maybe) return [];
    if (Array.isArray(maybe)) return maybe;
    if (typeof maybe === 'object') return Object.values(maybe);
    return [maybe];
  }

  function normalize(vRaw){
    const v = Object.assign({}, vRaw || {});
    v.bank_entries = _toList(v.bank_entries);
    v.expenses = _toList(v.expenses);
    v.total_sales = Number(v.total_sales || 0);
    v.crates_total = Number(v.crates_total || 0);
    v.bank_total_calculated = Number(v.bank_total_calculated || v.bank_total || 0);
    v.expenses_total_calculated = Number(v.expenses_total_calculated || v.expenses_total || 0);
    v.cash_total_computed = Number(v.cash_total_computed || v.cash_total || 0);
    v.sales = v.sales || [];
    return v;
  }

  function render(apiData){
    const summary = apiData && apiData.summary ? apiData.summary : {};
    let overallSales = 0, overallCrates = 0, overallBank = 0, overallExpenses = 0, overallCash = 0;
    salesResults.innerHTML = "";

    const dates = Object.keys(summary).sort().reverse();
    if (!dates.length){
      salesResults.innerHTML = `<div class="col-12"><div class="card-report empty-state">No data for selected range.</div></div>`;
      topSummary.innerHTML = `<div class="col-12"><div class="card-report p-3">No totals</div></div>`;
      return;
    }

    dates.forEach(date => {
      const places = summary[date] || {};
      const dateCol = document.createElement("div");
      dateCol.className = "col-12";
      dateCol.innerHTML = `
        <div class="card-report mb-3">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div><strong>${escapeHtml(date)}</strong></div>
            <div class="small-muted">Date</div>
          </div>
          <div class="row g-3" id="places-${date}"></div>
        </div>`;
      salesResults.appendChild(dateCol);
      const placesContainer = dateCol.querySelector(`#places-${date}`);

      for (const [place, vRaw] of Object.entries(places)){
        const v = normalize(vRaw);
        overallSales += v.total_sales;
        overallCrates += v.crates_total;
        overallBank += v.bank_total_calculated;
        overallExpenses += v.expenses_total_calculated;
        overallCash += v.cash_total_computed;

        const col = document.createElement("div");
        col.className = "col-md-6";
        col.innerHTML = `
          <div class="card p-3">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="h6 mb-1">${escapeHtml(place)}</div>
                <div class="small-muted">${escapeHtml(v.source || '')} ${v.version ? `(submitted by ${escapeHtml(v.version.created_by || '')})` : ''}</div>
              </div>
              <div class="text-end">
                <div class="small-muted">Sales</div>
                <div class="h5 mb-1">${fmt(v.total_sales)}</div>
                <div class="small-muted">Crates</div>
                <div>${v.crates_total}</div>
              </div>
            </div>
            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-sm btn-outline-primary view-sales" data-date="${date}" data-place="${escapeHtml(place)}">View Aggregate</button>
              <button class="btn btn-sm btn-outline-secondary view-bank" data-date="${date}" data-place="${escapeHtml(place)}">Bank</button>
              <button class="btn btn-sm btn-outline-danger view-expenses" data-date="${date}" data-place="${escapeHtml(place)}">Expenses</button>
            </div>
          </div>`;
        placesContainer.appendChild(col);

        const viewSalesBtn = col.querySelector(".view-sales");
        if (viewSalesBtn) viewSalesBtn.addEventListener("click", () => showAggregateOrSales(date, place, v));
        const viewBankBtn = col.querySelector(".view-bank");
        if (viewBankBtn) viewBankBtn.addEventListener("click", () => showBankEntries(date, place, v));
        const viewExpBtn = col.querySelector(".view-expenses");
        if (viewExpBtn) viewExpBtn.addEventListener("click", () => showExpenses(date, place, v));
      }
    });

    topSummary.innerHTML = `
      <div class="col-12">
        <div class="card-report d-flex justify-content-between align-items-center p-3">
          <div>
            <div class="small-muted">Overall total sales</div>
            <div class="h3 mb-0">${fmt(overallSales)}</div>
            <div class="small-muted">Crates sold: ${overallCrates}</div>
          </div>
          <div class="text-end">
            <div class="small-muted">Bank</div><div>${fmt(overallBank)}</div>
            <div class="small-muted">Expenses</div><div>${fmt(overallExpenses)}</div>
            <div class="small-muted">Cash</div><div>${fmt(overallCash)}</div>
          </div>
        </div>
      </div>`;
  }

  async function showAggregateOrSales(date, place, v){
    // Prefer showing aggregate version if no individual sales exist
    if (v.sales && v.sales.length){
      showSalesList(date, place, v.sales);
      return;
    }
    // Else show version snapshot (aggregated submit)
    // fetch versions to get id and allow edit/finalize (if dataman)
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}`);
      const j = await res.json();
      const versions = j.versions || [];
      const top = versions && versions.length ? versions[0] : null;
      let html = `<div class="mb-2"><strong>${escapeHtml(place)} — ${escapeHtml(date)}</strong></div>`;
      if (top){
        html += `<div class="mb-2 small-muted">Submitted by: <strong>${escapeHtml(top.created_by || '')}</strong> at ${escapeHtml(top.created_at || '')}</div>`;
        html += `<div class="mb-3"><strong>Totals</strong><div>Sales: ${fmt(top.total_sales || v.total_sales)}</div><div>Crates: ${top.crates_total || v.crates_total}</div></div>`;
        // per-item
        const items = top.items || {};
        let rows = "";
        for (const k of Object.keys(items || {})){
          const it = items[k] || {};
          const display = it.display_name || k;
          rows += `<tr><td>${escapeHtml(display)}</td><td class="text-end">${Number(it.crates||0)}</td></tr>`;
        }
        if (rows) html += `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Item</th><th class="text-end">Crates</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        if (top.note) html += `<div class="mt-2"><strong>Note:</strong> ${escapeHtml(top.note)}</div>`;
        // dataman actions: Edit & Finalize
        const role = window.CURRENT_USER && window.CURRENT_USER.role;
        if (role === "dataman"){
          html += `<div class="mt-3 d-flex gap-2"><button id="editVersionBtn" class="btn btn-sm btn-outline-primary">Edit</button><button id="finalizeVersionBtn" class="btn btn-sm btn-success">Finalize</button></div>`;
        }
      } else {
        html += `<div class="text-muted">No aggregated submission/version found for this place/date.</div>`;
      }
      showModal(`Aggregate — ${place} / ${date}`, html);

      // wire edit/finalize
      if (top){
        const role = window.CURRENT_USER && window.CURRENT_USER.role;
        if (role === "dataman"){
          const editBtn = document.getElementById("editVersionBtn");
          if (editBtn) editBtn.addEventListener("click", ()=> openEditModalForVersion(date, place, top.id));
          const finalizeBtn = document.getElementById("finalizeVersionBtn");
          if (finalizeBtn) finalizeBtn.addEventListener("click", async ()=> {
            if (!confirm("Finalize this version? This cannot be edited afterwards.")) return;
            try {
              const r = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}/versions/${encodeURIComponent(top.id)}/finalize`, { method: "POST" });
              const jj = await r.json();
              if (!r.ok) return alert("Error finalizing: " + (jj.error||JSON.stringify(jj)));
              alert("Finalized");
              load();
            } catch (err){ alert("Network error"); }
          });
        }
      }
    } catch (err){
      alert("Error fetching version: " + err.message);
    }
  }

  function showSalesList(date, place, salesArr){
    let html = `<div class="mb-2"><strong>${escapeHtml(place)} — ${escapeHtml(date)}</strong></div>`;
    if (!salesArr.length) { html += `<div class="text-muted">No sales</div>`; showModal(`Sales — ${place} / ${date}`, html); return; }
    html += `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Salesman</th><th>Items</th><th class="text-end">Crates</th><th class="text-end">Total</th></tr></thead><tbody>`;
    for (const s of salesArr){
      const itemsSummary = itemsSummaryForSale(s);
      html += `<tr><td>${escapeHtml(s.salesman || '')}</td><td>${escapeHtml(itemsSummary)}</td><td class="text-end">${Number(s.crates_total||0)}</td><td class="text-end">${fmt(s.sales_total||0)}</td></tr>`;
    }
    html += `</tbody></table></div>`;
    showModal(`Sales — ${place} / ${date}`, html);
  }

  function itemsSummaryForSale(s){
    try {
      const items = s.items || {};
      const parts = [];
      for (const k of Object.keys(items)){
        const it = items[k];
        let display = (it && it.display_name) ? it.display_name : k;
        let crates = (it && it.crates) ? Number(it.crates) : (typeof it === 'number' ? it : 0);
        parts.push(`${display}:${crates}`);
      }
      return parts.join(", ");
    } catch (e) {
      return "";
    }
  }

  function showBankEntries(date, place, v){
    const be = v.bank_entries || [];
    let html = `<div class="mb-2"><strong>${escapeHtml(place)} — ${escapeHtml(date)}</strong></div>`;
    if (!be.length) html += `<div class="text-muted">No bank entries</div>`;
    else {
      html += `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Bank</th><th class="text-end">Amount</th><th>Customer</th><th>By</th><th>At</th></tr></thead><tbody>`;
      for (const b of be) html += `<tr><td>${escapeHtml(b.bank||b.display||"")}</td><td class="text-end">${fmt(b.amount)}</td><td>${escapeHtml(b.customer||"")}</td><td>${escapeHtml(b.created_by||"")}</td><td>${escapeHtml(b.created_at||"")}</td></tr>`;
      html += `</tbody></table></div>`;
    }
    showModal(`Bank Entries — ${place} / ${date}`, html);
  }

  function showExpenses(date, place, v){
    const ex = v.expenses || [];
    let html = `<div class="mb-2"><strong>${escapeHtml(place)} — ${escapeHtml(date)}</strong></div>`;
    if (!ex.length) html += `<div class="text-muted">No expenses</div>`;
    else {
      html += `<div class="table-responsive"><table class="table table-sm"><thead><tr><th class="text-end">Amount</th><th>Description</th><th>By</th><th>At</th></tr></thead><tbody>`;
      for (const e of ex) html += `<tr><td class="text-end">${fmt(e.amount)}</td><td>${escapeHtml(e.description||"")}</td><td>${escapeHtml(e.created_by||"")}</td><td>${escapeHtml(e.created_at||"")}</td></tr>`;
      html += `</tbody></table></div>`;
    }
    showModal(`Expenses — ${place} / ${date}`, html);
  }

  function showModal(title, html){
    const modalTitle = document.getElementById("salesModalTitle");
    const modalBody = document.getElementById("salesModalBody");
    if (!modalTitle || !modalBody) return alert("Modal not found");
    modalTitle.innerText = title;
    modalBody.innerHTML = html;
    const m = new bootstrap.Modal(document.getElementById("salesModal"));
    m.show();
  }

  // Open edit modal for a specific version (dataman). This uses the PATCH endpoint.
  async function openEditModalForVersion(date, place, versionId){
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}`);
      const j = await res.json();
      const version = (j.versions || []).find(v=>v.id===versionId);
      if (!version) { alert("Version not found"); return; }

      // Build simple edit form modal
      const modalHtml = document.createElement("div");
      modalHtml.innerHTML = `
        <div class="modal fade" id="editVersionModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Edit version ${escapeHtml(version.id)}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="mb-2 small-muted">Submitted by ${escapeHtml(version.created_by||'')} at ${escapeHtml(version.created_at||'')}</div>
                <div class="table-responsive mb-2">
                  <table class="table table-sm" id="editItemsTable">
                    <thead><tr><th>Item</th><th style="width:120px">Crates</th></tr></thead>
                    <tbody>
                      ${(function(){
                        const rows = [];
                        const items = version.items || {};
                        if (items && typeof items === 'object' && Object.keys(items).length){
                          for (const [k,it] of Object.entries(items)){
                            const display = it.display_name || k;
                            const crates = Number(it.crates||0);
                            rows.push(`<tr data-dbkey="${escapeHtml(k)}"><td>${escapeHtml(display)}</td><td><input type="number" min="0" class="form-control form-control-sm edit-item-crates" value="${crates}"></td></tr>`);
                          }
                        } else {
                          rows.push(`<tr><td colspan="2" class="small-muted">No per-item data</td></tr>`);
                        }
                        return rows.join('');
                      })()}
                    </tbody>
                  </table>
                </div>
                <div class="row g-2 mb-2">
                  <div class="col-md-6"><label class="form-label small">Total sales (override)</label><input id="edit_total_sales" class="form-control form-control-sm" value="${Number(version.total_sales||0).toFixed(2)}"></div>
                  <div class="col-md-6"><label class="form-label small">Cash (override)</label><input id="edit_cash_total" class="form-control form-control-sm" value="${Number(version.cash_total||version.cash_total_computed||0).toFixed(2)}"></div>
                </div>
                <div class="mb-2"><label class="form-label small">Note</label><textarea id="edit_version_note" class="form-control form-control-sm">${escapeHtml(version.note||'')}</textarea></div>
              </div>
              <div class="modal-footer">
                <button id="saveVersionBtn" class="btn btn-primary">Save changes</button>
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modalHtml);
      const editModalEl = document.getElementById('editVersionModal');
      const editModal = new bootstrap.Modal(editModalEl);
      editModal.show();

      const saveBtn = document.getElementById('saveVersionBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', async function(){
          const rows = document.querySelectorAll('#editItemsTable tbody tr[data-dbkey]');
          const itemsPayload = {};
          rows.forEach(r => {
            const dbk = r.dataset.dbkey;
            const crates = Number(r.querySelector('.edit-item-crates').value || 0);
            const display = (version.items && version.items[dbk] && version.items[dbk].display_name) ? version.items[dbk].display_name : dbk;
            itemsPayload[display] = crates;
          });
          const totalSalesVal = document.getElementById('edit_total_sales').value;
          const cashVal = document.getElementById('edit_cash_total').value;
          const noteVal = document.getElementById('edit_version_note').value || '';
          const payload = { items: itemsPayload, note: noteVal };
          if (totalSalesVal !== '') payload.total_sales = parseFloat(totalSalesVal);
          if (cashVal !== '') payload.cash_total = parseFloat(cashVal);

          try {
            const r = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}/versions/${encodeURIComponent(version.id)}`, {
              method: 'PATCH',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify(payload)
            });
            const j2 = await r.json();
            if (!r.ok) { alert("Update error: " + (j2.error||JSON.stringify(j2))); return; }
            alert("Version updated");
            editModal.hide();
            load();
            setTimeout(()=> { modalHtml.remove(); }, 500);
          } catch (err){
            alert("Network error: " + err.message);
          }
        });
      }

      if (editModalEl) editModalEl.addEventListener('hidden.bs.modal', ()=> { modalHtml.remove(); });
    } catch (err) {
      alert("Failed to load version for edit");
      console.error(err);
    }
  }

  if (loadBtn) loadBtn.addEventListener("click", load);
  load();
});