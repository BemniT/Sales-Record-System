// reports.js — updated to:
//  - use apiData.role to hide correction for owner
//  - compute and show overall total sales and crates for owner
//  - render per-item per-salesman breakdown inside details

document.addEventListener("DOMContentLoaded", function(){
  const loadBtn = document.getElementById("loadSummary");
  const startEl = document.getElementById("start");
  const endEl = document.getElementById("end");
  const summaryArea = document.getElementById("summaryArea");
  const ownerTotalSalesEl = document.getElementById("ownerTotalSales");
  const ownerTotalCratesEl = document.getElementById("ownerTotalCrates");

  async function loadSummary(e){
    if (e) e.preventDefault();
    const start = startEl.value;
    const end = endEl.value;
    if (!start || !end){ alert("Choose start and end"); return; }
    summaryArea.innerHTML = `<div class="col-12"><div class="card p-3">Loading...</div></div>`;
    try {
      const res = await fetch(`/api/reports/view?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      const data = await res.json();
      console.debug("reports.view response:", data);
      renderSummaryAdaptively(data, start, end);
    } catch (err) {
      console.error("Failed loading reports:", err);
      summaryArea.innerHTML = `<div class="col-12"><div class="alert alert-danger">Error loading reports: ${err.message}</div></div>`;
    }
  }

  function _toList(maybe){
    if (!maybe) return [];
    if (Array.isArray(maybe)) return maybe;
    if (typeof maybe === "object") return Object.values(maybe);
    return [maybe];
  }

  function normalizeEntry(raw){
    if (!raw || typeof raw !== 'object') raw = {};
    const v = Object.assign({}, raw);
    v.bank_entries = _toList(v.bank_entries);
    v.expenses = _toList(v.expenses);
    v.item_sales_by_salesman = v.item_sales_by_salesman || {};
    v.total_sales = Number(v.total_sales || 0);
    v.crates_total = Number(v.crates_total || 0);
    v.bank_total_calculated = Number(v.bank_total_calculated || v.bank_total || 0);
    v.expenses_total_calculated = Number(v.expenses_total_calculated || v.expenses_total || 0);
    v.cash_total_computed = Number(v.cash_total_computed || v.cash_total || 0);
    return v;
  }

  function renderSummaryAdaptively(apiData, start, end){
    const role = apiData && apiData.role ? apiData.role : '';
    let summary = apiData && apiData.summary ? apiData.summary : null;
    if (!summary && apiData){
      const possibleDates = Object.keys(apiData).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
      if (possibleDates.length){
        summary = {};
        possibleDates.forEach(d => summary[d] = apiData[d]);
      }
    }
    if (!summary || Object.keys(summary).length === 0){
      summaryArea.innerHTML = `<div class="col-12"><div class="card-report empty-state"><i class="bi bi-inbox me-2" style="font-size:1.4rem"></i>No report data found for the selected range.</div></div>`;
      if (ownerTotalSalesEl) ownerTotalSalesEl.innerText = "0.00";
      if (ownerTotalCratesEl) ownerTotalCratesEl.innerText = "0";
      return;
    }

    // normalize
    const normalized = {};
    for (const [date, places] of Object.entries(summary)){
      normalized[date] = {};
      for (const [place, raw] of Object.entries(places || {})){
        normalized[date][place] = normalizeEntry(raw);
      }
    }

    // compute overall total and crates (owner view)
    let overallSales = 0;
    let overallCrates = 0;
    for (const [date, places] of Object.entries(normalized)){
      for (const [place, v] of Object.entries(places)){
        overallSales += Number(v.total_sales || 0);
        overallCrates += Number(v.crates_total || 0);
      }
    }
    if (ownerTotalSalesEl) ownerTotalSalesEl.innerText = overallSales.toFixed(2);
    if (ownerTotalCratesEl) ownerTotalCratesEl.innerText = overallCrates;

    renderSummary({ summary: normalized, start, end, role });
  }

  function renderSummary(data){
    const role = data.role || (window.CURRENT_USER && window.CURRENT_USER.role) || '';
    summaryArea.innerHTML = "";
    const dates = Object.keys(data.summary || {}).sort().reverse();
    if (!dates.length){
      summaryArea.innerHTML = `<div class="col-12"><div class="card-report empty-state"><i class="bi bi-inbox me-2" style="font-size:1.2rem"></i>No data for selected range.</div></div>`;
      return;
    }
    for (const date of dates){
      const places = data.summary[date] || {};
      const dateCol = document.createElement("div");
      dateCol.className = "col-12";
      dateCol.innerHTML = `
        <div class="card-report mb-3">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <div>
              <div class="text-muted small">${date}</div>
              <div class="h5 mb-0"><i class="bi bi-calendar-check me-2"></i> ${date}</div>
            </div>
          </div>
          <div class="row g-3" id="places-${date}"></div>
        </div>`;
      summaryArea.appendChild(dateCol);
      const placesContainer = dateCol.querySelector(`#places-${date}`);
      for (const [place, v] of Object.entries(places)){
        const col = document.createElement("div");
        col.className = "col-md-6";
        const card = document.createElement("div");
        card.className = "card-report";
        const bank = (v.bank_total_calculated || 0).toFixed(2);
        const exp = (v.expenses_total_calculated || 0).toFixed(2);
        const sales = (v.total_sales || 0).toFixed(2);
        const cash = (v.cash_total_computed || 0).toFixed(2);
        // owner cannot see correction button — only dataman can
        const showCorrection = (role !== 'owner'); // dataman and others can see
        card.innerHTML = `
          <div class="d-flex align-items-start justify-content-between">
            <div style="display:flex;align-items:center;">
              <div class="icon-circle"><i class="bi bi-shop"></i></div>
              <div>
                <div class="place-title">${place}</div>
                <div class="small-muted">${v.source === 'report_version' ? `Versioned — ${v.status || ''}` : 'Aggregated from sales'}</div>
              </div>
            </div>
            <div class="text-end">
              <div class="mb-1"><small class="small-muted">Sales</small> <div class="totals-badge">${sales}</div></div>
              <div class="mb-1"><small class="small-muted">Bank</small> <div class="totals-badge">${bank}</div></div>
              <div class="mb-1"><small class="small-muted">Expenses</small> <div class="totals-badge">${exp}</div></div>
              <div class="mb-1"><small class="small-muted">Cash</small> <div class="totals-badge">${cash}</div></div>
            </div>
          </div>

          <div class="mt-3 d-flex gap-2 actions-bar">
            <button class="btn btn-ghost btn-sm view-details-btn" data-date="${date}" data-place="${place}"><i class="bi bi-eye me-1"></i>Details</button>
            <button class="btn btn-outline-secondary btn-sm view-versions-btn" data-date="${date}" data-place="${place}"><i class="bi bi-stack me-1"></i>Versions</button>
            ${showCorrection ? `<button class="btn btn-outline-success btn-sm create-correction-btn" data-date="${date}" data-place="${place}"><i class="bi bi-pencil-square me-1"></i>Correction</button>` : ""}
            <button class="btn btn-outline-info btn-sm export-csv-btn" data-date="${date}" data-place="${place}"><i class="bi bi-download me-1"></i>CSV</button>
            ${role === 'owner' ? `<button class="btn btn-outline-dark btn-sm finalize-btn" data-date="${date}" data-place="${place}"><i class="bi bi-check2-square me-1"></i>Finalize</button>` : ""}
          </div>

          <div class="details-area" style="display:none;margin-top:12px;"></div>
        `;
        col.appendChild(card);
        placesContainer.appendChild(col);

        const viewBtn = card.querySelector('.view-details-btn');
        const detailsArea = card.querySelector('.details-area');
        viewBtn.addEventListener('click', function(){
          if (detailsArea.style.display === 'none'){
            renderDetails(detailsArea, date, place, v);
            detailsArea.style.display = 'block';
            viewBtn.innerHTML = '<i class="bi bi-eye-slash me-1"></i>Hide';
          } else {
            detailsArea.style.display = 'none';
            viewBtn.innerHTML = '<i class="bi bi-eye me-1"></i>Details';
          }
        });

        card.querySelector('.view-versions-btn').addEventListener('click', function(){
          showVersionsModal(date, place);
        });

        if (showCorrection){
          card.querySelector('.create-correction-btn').addEventListener('click', function(){
            openCorrectionModal(date, place, v);
          });
        }

        card.querySelector('.export-csv-btn').addEventListener('click', function(){
          exportPlaceCSV(place, date, date, data.summary);
        });

        const finalizeBtn = card.querySelector('.finalize-btn');
        if (finalizeBtn){
          finalizeBtn.addEventListener('click', function(){
            if (!confirm(`Finalize latest version for ${place} on ${date}? This action is final.`)) return;
            fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}/finalize`, { method: "POST" })
              .then(r => r.json()).then(j => {
                if (j && j.error) alert("Error: " + j.error);
                else { showToast("Finalized"); loadSummary(); }
              }).catch(err => alert("Network error"));
          });
        }
      }
    }
  }

  function renderDetails(container, date, place, v){
    container.innerHTML = "";
    // per-item per-salesman table (if present)
    const itemSales = v.item_sales_by_salesman || {};
    let itemSalesHtml = '<div class="mb-3"><h6 class="mb-2"><i class="bi bi-people me-1"></i>Per-item sales by salesman</h6>';
    if (Object.keys(itemSales).length === 0){
      itemSalesHtml += '<div class="small-muted">No item-level sales available</div>';
    } else {
      // build table with item rows and salesman columns
      // collect all salesman names
      const salesmanSet = new Set();
      for (const item of Object.keys(itemSales)){
        for (const s of Object.keys(itemSales[item] || {})) salesmanSet.add(s);
      }
      const salesmen = Array.from(salesmanSet);
      itemSalesHtml += '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Item</th>';
      salesmen.forEach(s => itemSalesHtml += `<th class="text-end">${escapeHtml(s)}</th>`);
      itemSalesHtml += '<th class="text-end">Total</th></tr></thead><tbody>';
      for (const item of Object.keys(itemSales)){
        let row = `<tr><td>${escapeHtml(item)}</td>`;
        let itemTotal = 0;
        for (const s of salesmen){
          const val = Number(itemSales[item][s] || 0);
          itemTotal += val;
          row += `<td class="text-end">${val || ''}</td>`;
        }
        row += `<td class="text-end"><strong>${itemTotal}</strong></td></tr>`;
        itemSalesHtml += row;
      }
      itemSalesHtml += '</tbody></table></div>';
    }
    itemSalesHtml += '</div>';

    const beRows = (v.bank_entries || []).map(be => `<tr><td>${escapeHtml(be.bank||be.display||'')}</td><td class="text-end">${(parseFloat(be.amount)||0).toFixed(2)}</td><td>${escapeHtml(be.customer||'')}</td><td>${escapeHtml(be.created_by||'')}</td><td>${escapeHtml(formatDateTime(be.created_at||''))}</td></tr>`).join("");
    const exRows = (v.expenses || []).map(ex => `<tr><td class="text-end">${(parseFloat(ex.amount)||0).toFixed(2)}</td><td>${escapeHtml(ex.description||'')}</td><td>${escapeHtml(ex.created_by||'')}</td><td>${escapeHtml(formatDateTime(ex.created_at||''))}</td></tr>`).join("");
    const ver = v.version;
    const verHtml = ver ? `<div class="version-card"><div class="d-flex justify-content-between"><div><strong>${escapeHtml(ver.id)}</strong> <span class="small-muted">(${escapeHtml(ver.status||'')})</span></div><div class="small-muted">${escapeHtml(ver.created_by||'')} at ${escapeHtml(formatDateTime(ver.created_at||''))}</div></div><pre class="mt-2 bg-light p-2">${escapeHtml(JSON.stringify(ver, null, 2))}</pre></div>` : `<div class="small-muted">No version — aggregated from sales</div>`;

    container.innerHTML = `
      ${itemSalesHtml}
      <div class="mb-3">
        <h6 class="mb-2"><i class="bi bi-bank2 me-1"></i>Bank entries</h6>
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Bank</th><th class="text-end">Amount</th><th>Customer</th><th>By</th><th>At</th></tr></thead><tbody>${beRows || '<tr><td colspan="5" class="text-muted">No bank entries</td></tr>'}</tbody></table></div>
      </div>
      <div class="mb-3">
        <h6 class="mb-2"><i class="bi bi-receipt me-1"></i>Expenses</h6>
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th class="text-end">Amount</th><th>Description</th><th>By</th><th>At</th></tr></thead><tbody>${exRows || '<tr><td colspan="4" class="text-muted">No expenses</td></tr>'}</tbody></table></div>
      </div>
      <div class="mb-3">
        <h6 class="mb-2"><i class="bi bi-file-earmark-text me-1"></i>Latest version</h6>
        ${verHtml}
      </div>
    `;
  }

  // other helper functions unchanged (showVersionsModal, openCorrectionModal, exportPlaceCSV, etc.)
  // ... reuse existing functions from previous reports.js implementation (copy them in if needed) ...

  // minimal implementations for helper functions used above:
  async function showVersionsModal(date, place){
    const modalTitle = document.getElementById('versionsModalTitle');
    const listArea = document.getElementById('versionsListArea');
    modalTitle.innerText = `Versions — ${place} / ${date}`;
    listArea.innerHTML = "Loading...";
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}`);
      const j = await res.json();
      const versions = j.versions || [];
      if (!versions.length) listArea.innerHTML = `<div class="text-muted p-3">No versions found</div>`;
      else {
        listArea.innerHTML = versions.map(v => {
          const bankEntries = v.bank_entries && !Array.isArray(v.bank_entries) ? Object.keys(v.bank_entries).map(k => v.bank_entries[k]) : (v.bank_entries || []);
          const bankTotal = ((bankEntries || []).reduce((s,b)=> s + (parseFloat(b.amount||0)),0)||0).toFixed(2);
          return `<div class="version-card">
            <div class="d-flex justify-content-between"><div><strong>${escapeHtml(v.id)}</strong> <span class="small-muted">(${escapeHtml(v.status||'')})</span></div><div class="small-muted">${escapeHtml(v.created_by||'')} @ ${formatDateTime(v.created_at)}</div></div>
            <div class="mt-2"><small>${escapeHtml(v.note||'')}</small></div>
            <div class="mt-2 small">Crates: ${v.crates_total||0} — Sales: ${(v.total_sales||0).toFixed(2)} — Cash: ${(v.cash_total||0).toFixed(2)} — Bank: ${bankTotal}</div>
            <pre class="mt-2 bg-light p-2">${escapeHtml(JSON.stringify(v, null, 2))}</pre>
          </div>`;
        }).join('');
      }
    } catch (err) {
      listArea.innerHTML = `<div class="alert alert-danger">Error loading versions</div>`;
      console.error(err);
    }
    new bootstrap.Modal(document.getElementById('versionsModal')).show();
  }

  function openCorrectionModal(date, place, summary){
    // Correction modal logic (unchanged) — visible only when dataman sees it (we hide for owner)
    const corrDate = document.getElementById('corr_date');
    const corrPlace = document.getElementById('corr_place');
    const corrPrev = document.getElementById('corr_prev');
    const corrTotal = document.getElementById('corr_total_sales');
    const corrCash = document.getElementById('corr_cash_total');
    const corrNote = document.getElementById('corr_note');
    const corrBankEntries = document.getElementById('corr_bank_entries');

    corrDate.value = date;
    corrPlace.value = place;
    corrPrev.value = (summary.version && summary.version.id) ? summary.version.id : '';
    corrTotal.value = (summary.total_sales || summary.total_sales === 0) ? (summary.total_sales || 0).toFixed(2) : '';
    corrCash.value = (summary.cash_total || summary.cash_total_computed || 0).toFixed(2);
    corrNote.value = summary.version && summary.version.note ? summary.version.note : '';
    corrBankEntries.value = summary.version && summary.version.bank_entries ? JSON.stringify(summary.version.bank_entries, null, 2) : '';

    const corrModalEl = document.getElementById('correctionModal');
    const corrModal = new bootstrap.Modal(corrModalEl);
    corrModal.show();

    const submitBtn = document.getElementById('submitCorrectionBtn');
    submitBtn.onclick = async function(evt){
      evt.preventDefault();
      submitBtn.disabled = true;
      const body = {
        prev_version: corrPrev.value,
        total_sales: parseFloat(corrTotal.value || 0),
        cash_total: parseFloat(corrCash.value || 0),
        note: corrNote.value || '',
      };
      try {
        try {
          const be = corrBankEntries.value ? JSON.parse(corrBankEntries.value) : null;
          if (Array.isArray(be)) body.bank_entries = be;
        } catch (err) {
          alert("Bank entries JSON invalid");
          submitBtn.disabled = false;
          return;
        }
        const res = await fetch(`/api/reports/${encodeURIComponent(corrDate.value)}/${encodeURIComponent(corrPlace.value)}/correction`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body)
        });
        const j = await res.json();
        if (!res.ok) alert("Error: " + (j.error || JSON.stringify(j)));
        else { showToast("Correction created"); corrModal.hide(); loadSummary(); }
      } catch (err) {
        alert("Network error");
      } finally {
        submitBtn.disabled = false;
      }
    };
  }

  function exportPlaceCSV(place, start, end, dataSummary){
    const rows = [['date','place','status','created_by','created_at','crates_total','total_sales','cash_total','bank_total','expenses_total']];
    const dates = Object.keys(dataSummary || {}).sort();
    for (const date of dates){
      const p = (dataSummary[date] || {})[place];
      if (!p) continue;
      const status = p.status || '';
      const cb = p.created_by || '';
      const created_at = p.created_at || '';
      const crates = p.crates_total || 0;
      const total_sales = p.total_sales || 0;
      const cash = (p.cash_total !== undefined ? p.cash_total : p.cash_total_computed) || 0;
      const bank = (p.bank_total || p.bank_total_calculated) || 0;
      const exp = (p.expenses_total || p.expenses_total_calculated) || 0;
      rows.push([date, place, status, cb, created_at, crates, total_sales.toFixed(2), cash.toFixed(2), bank.toFixed(2), exp.toFixed(2)]);
    }
    if (rows.length === 1){ alert("No data to export for this place/range"); return; }
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${place}_${start}_${end}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(s){ if (!s && s !== 0) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function formatDateTime(iso){ if (!iso) return ''; try{ const d = new Date(iso); return d.toLocaleString(); } catch(e){ return iso; } }
  function showToast(msg){
    const el = document.createElement('div');
    el.className = 'toast align-items-center text-white bg-success border-0';
    el.style.position = 'fixed'; el.style.right = '20px'; el.style.bottom = '20px'; el.style.zIndex = 9999;
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    document.body.appendChild(el);
    const b = new bootstrap.Toast(el, { delay: 2000 });
    b.show();
    el.addEventListener('hidden.bs.toast', ()=> el.remove());
  }

  if (loadBtn) loadBtn.addEventListener('click', loadSummary);
  // auto-load once
  loadSummary();
});