// static/js/reports.js
// Reports UI for owner / dataman pages.
//
// - Loads role-aware summary from /api/reports/view
// - Renders per-date / per-place cards with details
// - Shows Versions modal (with Edit/Finalize for dataman)
// - Adds an aggregate per-item crates table (Store, Van 2, Van 3, Dawa, Shet, Total)
// - Allows downloading the aggregate as CSV (Excel-friendly) and printing as PDF
//
// Notes:
// - Defensive: checks DOM nodes exist before wiring listeners to avoid "addEventListener of null" errors.
// - PDF generation uses a printable window approach (works on desktop & mobile via browser Print -> Save as PDF).
// - CSV download is plain text CSV; Excel will open it without issue.
//
// Assumes presence of Bootstrap 5 on page and the API endpoints implemented server-side.

document.addEventListener("DOMContentLoaded", function () {
  // Elements (may be missing on some pages; be defensive)
  const startEl = document.getElementById("start");
  const endEl = document.getElementById("end");
  const loadBtn = document.getElementById("loadSummary") || document.getElementById("loadSales");
  const summaryArea = document.getElementById("summaryArea") || document.getElementById("salesResults");
  const topSummary = document.getElementById("topSummary");
  const CURRENT_USER = window.CURRENT_USER || {};

  // Early exit if neither summary area nor load button exist
  if (!summaryArea) {
    console.warn("reports.js: summaryArea not found; aborting reports.js initialization.");
    return;
  }

  // Utility helpers
  function safeText(s) { return (s === null || s === undefined) ? "" : String(s); }
  function escapeHtml(s) { return safeText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtMoney(n) { return (Number(n) || 0).toFixed(2); }
  function toList(maybe) {
    if (!maybe) return [];
    if (Array.isArray(maybe)) return maybe;
    if (typeof maybe === "object") return Object.values(maybe);
    return [maybe];
  }
  function formatDateTime(iso) {
    if (!iso) return "";
    try { const d = new Date(iso); return d.toLocaleString(); } catch (e) { return iso; }
  }

  // ---------------------
  // Load & render summary
  // ---------------------
  async function loadSummary(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!startEl || !endEl) {
      // If there are no date filters, still try to load using today's date
    }
    const start = startEl ? startEl.value : "";
    const end = endEl ? endEl.value : "";

    if (startEl && endEl && (!start || !end)) {
      alert("Choose start and end dates");
      return;
    }

    summaryArea.innerHTML = `<div class="col-12"><div class="card p-3">Loading...</div></div>`;
    if (topSummary) topSummary.innerHTML = "";

    try {
      const qs = new URLSearchParams();
      if (start) qs.set("start", start);
      if (end) qs.set("end", end);
      // respect optional places param input; API will decide places based on role if none provided
      const url = `/api/reports/view?${qs.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const payload = await res.json().catch(()=>({error: "unknown"}));
        throw new Error(payload && payload.error ? payload.error : `HTTP ${res.status}`);
      }
      const data = await res.json();
      renderSummaryAdaptively(data);
    } catch (err) {
      console.error("Failed loading reports:", err);
      summaryArea.innerHTML = `<div class="col-12"><div class="alert alert-danger">Error loading reports: ${escapeHtml(err.message || err)}</div></div>`;
    }
  }

  function normalizeEntry(raw) {
    const v = Object.assign({}, raw || {});
    v.bank_entries = toList(v.bank_entries);
    v.expenses = toList(v.expenses);
    v.total_sales = Number(v.total_sales || 0);
    v.crates_total = Number(v.crates_total || 0);
    v.bank_total_calculated = Number(v.bank_total_calculated || v.bank_total || 0);
    v.expenses_total_calculated = Number(v.expenses_total_calculated || v.expenses_total || 0);
    v.cash_total_computed = Number(v.cash_total_computed || v.cash_total || 0);
    v.version = (v.version && typeof v.version === "object") ? (function(ver){ ver.bank_entries = toList(ver.bank_entries); ver.expenses = toList(ver.expenses); ver.items = ver.items || {}; return ver; })(v.version) : v.version;
    v.sales = toList(v.sales || []);
    return v;
  }

  function renderSummaryAdaptively(apiData) {
    // API returns { summary: { date: { place: summary } } } for the patched endpoint
    const summary = apiData && apiData.summary ? apiData.summary : apiData || {};
    if (!summary || Object.keys(summary).length === 0) {
      summaryArea.innerHTML = `<div class="col-12"><div class="card-report empty-state"><i class="bi bi-inbox me-2" style="font-size:1.4rem"></i>No report data found for the selected range.</div></div>`;
      renderAggregateTable({}, []); // empty aggregate
      return;
    }
    // Normalize structure to summary[date][place] => normalized entry
    const normalized = {};
    for (const [date, places] of Object.entries(summary)) {
      normalized[date] = {};
      for (const [place, raw] of Object.entries(places || {})) {
        normalized[date][place] = normalizeEntry(raw);
      }
    }
    renderSummary({ summary: normalized });
  }

  function renderSummary(data) {
    summaryArea.innerHTML = "";
    const dates = Object.keys(data.summary || {}).sort().reverse();
    if (!dates.length) {
      summaryArea.innerHTML = `<div class="col-12"><div class="card-report empty-state">No data for selected range.</div></div>`;
      renderAggregateTable({}, []);
      return;
    }

    // Build aggregate matrix source while rendering cards
    const aggregateSource = {}; // aggregateSource[place][item] = crates

    // Toolbar: export buttons and aggregate title (inserted once above summary cards)
    const toolbarRow = document.createElement("div");
    toolbarRow.className = "d-flex align-items-center justify-content-between mb-3";
    toolbarRow.innerHTML = `
      <div class="d-flex align-items-center gap-3">
        <div class="h5 mb-0">Reports</div>
        <div class="small text-muted">Range: ${escapeHtml(dates[dates.length-1])} → ${escapeHtml(dates[0])}</div>
      </div>
      <div class="d-flex gap-2">
        <button id="downloadCsvBtn" class="btn btn-outline-secondary btn-sm"><i class="bi bi-file-earmark-spreadsheet me-1"></i>Download Excel</button>
        <button id="downloadPdfBtn" class="btn btn-outline-primary btn-sm"><i class="bi bi-file-earmark-pdf me-1"></i>Download PDF</button>
      </div>
    `;
    summaryArea.appendChild(toolbarRow);

    // Render each date block
    for (const date of dates) {
      const places = data.summary[date] || {};
      const dateCol = document.createElement("div");
      dateCol.className = "col-12";
      dateCol.innerHTML = `
        <div class="card-report mb-3">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <div>
              <div class="text-muted small">${escapeHtml(date)}</div>
              <div class="h5 mb-0"><i class="bi bi-calendar-check me-2"></i> ${escapeHtml(date)}</div>
            </div>
          </div>
          <div class="row g-3" id="places-${date}"></div>
        </div>`;
      summaryArea.appendChild(dateCol);
      const placesContainer = dateCol.querySelector(`#places-${date}`);

      for (const [place, vRaw] of Object.entries(places)) {
        const v = normalizeEntry(vRaw);
        // populate aggregateSource from v: prefer version.items if present, otherwise sum from v.sales
        if (!aggregateSource[place]) aggregateSource[place] = {};

        // If version exists and has items (dbk-> {display_name, crates})
        if (v.version && v.version.items && Object.keys(v.version.items).length) {
          for (const [dbk, it] of Object.entries(v.version.items)) {
            const display = it.display_name || dbk;
            const crates = Number(it.crates || 0);
            aggregateSource[place][display] = (aggregateSource[place][display] || 0) + crates;
          }
        } else {
          // Aggregate from individual sales if available
          for (const s of v.sales || []) {
            const items = s.items || {};
            for (const [k, idet] of Object.entries(items)) {
              let display = k;
              let crates = 0;
              if (typeof idet === "object") {
                display = idet.display_name || DBKeyToDisplayFallback(k);
                crates = Number(idet.crates || 0);
              } else {
                crates = Number(idet || 0);
              }
              aggregateSource[place][display] = (aggregateSource[place][display] || 0) + crates;
            }
          }
        }

        // Render place card
        const cardCol = document.createElement("div");
        cardCol.className = "col-md-6";
        const salesFmt = fmtMoney(v.total_sales || 0);
        cardCol.innerHTML = `
          <div class="card-report">
            <div class="d-flex align-items-start justify-content-between">
              <div style="display:flex;align-items:center;gap:0.75rem;">
                <div class="icon-circle"><i class="bi bi-shop"></i></div>
                <div>
                  <div class="place-title">${escapeHtml(place)}</div>
                  <div class="small-muted">${v.source === 'report_version' ? `Versioned — ${escapeHtml(v.status || '')}` : 'Aggregated from sales'}</div>
                </div>
              </div>
              <div class="text-end">
                <div class="mb-1"><small class="small-muted">Sales</small> <div class="totals-badge">${salesFmt}</div></div>
                <div class="mb-1"><small class="small-muted">Bank</small> <div class="totals-badge">${fmtMoney(v.bank_total_calculated)}</div></div>
                <div class="mb-1"><small class="small-muted">Expenses</small> <div class="totals-badge">${fmtMoney(v.expenses_total_calculated)}</div></div>
                <div class="mb-1"><small class="small-muted">Cash</small> <div class="totals-badge">${fmtMoney(v.cash_total_computed)}</div></div>
              </div>
            </div>
            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-ghost btn-sm view-details-btn" data-date="${escapeHtml(date)}" data-place="${escapeHtml(place)}"><i class="bi bi-eye me-1"></i>Details</button>
              <button class="btn btn-outline-secondary btn-sm view-versions-btn" data-date="${escapeHtml(date)}" data-place="${escapeHtml(place)}"><i class="bi bi-stack me-1"></i>Versions</button>
              <button class="btn btn-outline-info btn-sm export-csv-btn" data-date="${escapeHtml(date)}" data-place="${escapeHtml(place)}"><i class="bi bi-download me-1"></i>CSV</button>
            </div>
            <div class="details-area" style="display:none;margin-top:12px;"></div>
          </div>`;
        placesContainer.appendChild(cardCol);

        // Wire details toggle
        const viewBtn = cardCol.querySelector('.view-details-btn');
        const detailsArea = cardCol.querySelector('.details-area');
        viewBtn && viewBtn.addEventListener('click', function () {
          if (detailsArea.style.display === 'none' || detailsArea.style.display === '') {
            renderDetails(detailsArea, date, place, v);
            detailsArea.style.display = 'block';
            viewBtn.innerHTML = '<i class="bi bi-eye-slash me-1"></i>Hide';
          } else {
            detailsArea.style.display = 'none';
            viewBtn.innerHTML = '<i class="bi bi-eye me-1"></i>Details';
          }
        });

        // Wire Versions button
        const versionsBtn = cardCol.querySelector('.view-versions-btn');
        versionsBtn && versionsBtn.addEventListener('click', function () {
          showVersionsModal(date, place);
        });

        // Wire export per-place CSV
        const perCsv = cardCol.querySelector('.export-csv-btn');
        perCsv && perCsv.addEventListener('click', function () {
          exportPlaceCSV(place, date, date, data.summary);
        });
      }
    } // end for dates

    // After cards, render aggregate table for full range
    renderAggregateTable(aggregateSource, Object.keys(data.summary || {}));

    // Wire global export buttons (if present)
    const downloadCsvBtn = document.getElementById("downloadCsvBtn");
    const downloadPdfBtn = document.getElementById("downloadPdfBtn");
    if (downloadCsvBtn) downloadCsvBtn.addEventListener("click", () => downloadAggregateCSV());
    if (downloadPdfBtn) downloadPdfBtn.addEventListener("click", () => downloadAggregatePDF());
  }

  // Fallback mapping helper (best-effort display name)
  function DBKeyToDisplayFallback(k) { return String(k).replace(/_/g, " "); }

  // ------------------------
  // Details renderer (cards)
  // ------------------------
  function renderDetails(container, date, place, v) {
    container.innerHTML = "";
    const header = document.createElement("div");
    header.className = "mb-3";
    const submitter = v.version && v.version.created_by ? v.version.created_by : (v.created_by || "");
    const createdAt = v.version && v.version.created_at ? formatDateTime(v.version.created_at) : "";
    const status = v.status || (v.version && v.version.status) || "";
    header.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <div class="small-muted">Source</div>
          <div><strong>${v.source === 'report_version' ? 'Submitted aggregate (version)' : 'Aggregated from sales'}</strong></div>
          ${submitter ? `<div class="small-muted">By: ${escapeHtml(submitter)}${createdAt ? ' • ' + escapeHtml(createdAt) : ''}</div>` : ""}
        </div>
        <div class="text-end">
          <div class="small-muted">Status</div>
          <div><span class="badge bg-secondary">${escapeHtml(status)}</span></div>
          <div class="mt-2 small-muted">Totals</div>
          <div class="h5 mb-0">${fmtMoney(v.total_sales || 0)}</div>
          <div class="small-muted">Crates: ${v.crates_total || 0}</div>
        </div>
      </div>`;
    container.appendChild(header);

    // Per-item breakdown
    const itemsCard = document.createElement("div");
    itemsCard.className = "mb-3";
    itemsCard.innerHTML = `<h6 class="mb-2"><i class="bi bi-box-seam me-1"></i>Per-item breakdown</h6>`;
    const itemsTableWrap = document.createElement("div");
    itemsTableWrap.className = "table-responsive";

    let itemsRows = "";
    // Prefer version snapshot items
    if (v.version && v.version.items && Object.keys(v.version.items).length) {
      for (const [dbk, it] of Object.entries(v.version.items)) {
        const display = it.display_name || dbk;
        const crates = Number(it.crates || 0);
        itemsRows += `<tr><td>${escapeHtml(display)}</td><td class="text-end">${crates}</td></tr>`;
      }
      itemsTableWrap.innerHTML = `<table class="table table-sm"><thead><tr><th>Item</th><th class="text-end">Crates</th></tr></thead><tbody>${itemsRows}</tbody></table>`;
    } else {
      // build aggregated by item from v.item_sales_by_salesman if present
      const map = v.item_sales_by_salesman || {};
      if (Object.keys(map).length) {
        itemsRows = "";
        for (const [item, salesmap] of Object.entries(map)) {
          let total = 0;
          const details = Object.entries(salesmap).map(([sman, c]) => { total += Number(c || 0); return `${escapeHtml(sman)}: ${Number(c||0)}`; }).join(", ");
          itemsRows += `<tr><td>${escapeHtml(item)}<div class="small text-muted">${details}</div></td><td class="text-end">${total}</td></tr>`;
        }
        itemsTableWrap.innerHTML = `<table class="table table-sm"><thead><tr><th>Item</th><th class="text-end">Total crates</th></tr></thead><tbody>${itemsRows}</tbody></table>`;
      } else {
        itemsTableWrap.innerHTML = `<div class="small-muted">No per-item breakdown available</div>`;
      }
    }
    itemsCard.appendChild(itemsTableWrap);
    container.appendChild(itemsCard);

    // Bank entries
    const beCard = document.createElement("div");
    beCard.className = "mb-3";
    beCard.innerHTML = `<h6 class="mb-2"><i class="bi bi-bank2 me-1"></i>Bank entries</h6>`;
    if (v.bank_entries && v.bank_entries.length) {
      let beRows = v.bank_entries.map(b => {
        const bank = escapeHtml(b.bank || b.display || "");
        const amt = fmtMoney(b.amount || 0);
        const cust = escapeHtml(b.customer || "");
        const by = escapeHtml(b.created_by || "");
        const at = formatDateTime(b.created_at || "");
        return `<tr><td>${bank}</td><td class="text-end">${amt}</td><td>${cust}</td><td>${by}</td><td>${at}</td></tr>`;
      }).join("");
      beCard.innerHTML += `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Bank</th><th class="text-end">Amount</th><th>Customer</th><th>By</th><th>At</th></tr></thead><tbody>${beRows}</tbody></table></div>`;
    } else {
      beCard.innerHTML += `<div class="small-muted">No bank entries</div>`;
    }
    container.appendChild(beCard);

    // Expenses
    const exCard = document.createElement("div");
    exCard.className = "mb-3";
    exCard.innerHTML = `<h6 class="mb-2"><i class="bi bi-receipt me-1"></i>Expenses</h6>`;
    if (v.expenses && v.expenses.length) {
      let exRows = v.expenses.map(e => {
        const amt = fmtMoney(e.amount || 0);
        const desc = escapeHtml(e.description || "");
        const by = escapeHtml(e.created_by || "");
        const at = formatDateTime(e.created_at || "");
        return `<tr><td class="text-end">${amt}</td><td>${desc}</td><td>${by}</td><td>${at}</td></tr>`;
      }).join("");
      exCard.innerHTML += `<div class="table-responsive"><table class="table table-sm"><thead><tr><th class="text-end">Amount</th><th>Description</th><th>By</th><th>At</th></tr></thead><tbody>${exRows}</tbody></table></div>`;
    } else {
      exCard.innerHTML += `<div class="small-muted">No expenses</div>`;
    }
    container.appendChild(exCard);

    // Version summary card
    if (v.version) {
      const ver = v.version;
      const verCard = document.createElement("div");
      verCard.className = "version-card mt-2";
      const note = ver.note ? `<div class="mt-2"><strong>Note:</strong> ${escapeHtml(ver.note)}</div>` : "";
      verCard.innerHTML = `
        <div class="d-flex justify-content-between align-items-center"><div><strong>ID:</strong> ${escapeHtml(ver.id)}</div><div class="small-muted">${escapeHtml(ver.status || '')}</div></div>
        <div class="small-muted mt-1">Submitted by <strong>${escapeHtml(ver.created_by || '')}</strong> at ${escapeHtml(formatDateTime(ver.created_at || ''))}</div>
        <div class="mt-2 small-muted">Totals: Sales <strong>${fmtMoney(ver.total_sales||v.total_sales||0)}</strong> — Crates <strong>${ver.crates_total||v.crates_total||0}</strong> — Cash <strong>${fmtMoney(ver.cash_total||v.cash_total_computed||0)}</strong></div>
        ${note}
      `;
      container.appendChild(verCard);
    }
  }

  // ---------------------
  // Versions modal logic
  // ---------------------
  async function showVersionsModal(date, place) {
    const modalTitle = document.getElementById('versionsModalTitle');
    const listArea = document.getElementById('versionsListArea');
    if (!modalTitle || !listArea) {
      alert("Versions modal not available on this page.");
      return;
    }
    modalTitle.innerText = `Versions — ${place} / ${date}`;
    listArea.innerHTML = "Loading...";
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}`);
      if (!res.ok) throw new Error("Failed to load versions");
      const j = await res.json();
      const versions = j.versions || [];
      const role = CURRENT_USER && CURRENT_USER.role;
      if (!versions.length) {
        listArea.innerHTML = `<div class="text-muted p-3">No versions found</div>`;
      } else {
        listArea.innerHTML = versions.map(v => {
          const bankEntries = toList(v.bank_entries);
          const expenses = toList(v.expenses);
          const items = v.items || {};
          const bankTotal = (Number(v.bank_total) || bankEntries.reduce((s,b)=> s + (Number(b.amount)||0),0)).toFixed(2);
          const expensesTotal = (Number(v.expenses_total) || expenses.reduce((s,e)=> s + (Number(e.amount)||0),0)).toFixed(2);
          const itemsHtml = (() => {
            const rows = [];
            if (items && typeof items === 'object' && Object.keys(items).length) {
              for (const [k,it] of Object.entries(items)) {
                const display = (it && it.display_name) ? it.display_name : k;
                const crates = Number(it.crates||0);
                rows.push(`<tr><td>${escapeHtml(display)}</td><td class="text-end">${crates}</td></tr>`);
              }
              return `<div class="table-responsive"><table class="table table-sm mb-2"><thead><tr><th>Item</th><th class="text-end">Crates</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
            }
            return `<div class="small-muted mb-2">No per-item breakdown</div>`;
          })();

          const datamanActions = (role === 'dataman') ? `
            <div class="mt-2 d-flex gap-2">
              <button class="btn btn-sm btn-outline-primary edit-version-btn" data-id="${escapeHtml(v.id)}">Edit</button>
              <button class="btn btn-sm btn-success finalize-version-btn" data-id="${escapeHtml(v.id)}">Finalize</button>
            </div>` : "";

          return `
            <div class="mb-3 p-3 version-block" data-version-id="${escapeHtml(v.id)}" style="border-left:4px solid rgba(124,58,237,0.6); background:linear-gradient(90deg, rgba(124,58,237,0.03), transparent); border-radius:8px;">
              <div class="d-flex justify-content-between">
                <div><strong>${escapeHtml(v.id)}</strong> <span class="small-muted">(${escapeHtml(v.status||'')})</span></div>
                <div class="small-muted">${escapeHtml(v.created_by||'')} • ${escapeHtml(formatDateTime(v.created_at))}</div>
              </div>
              <div class="mt-2 small-muted">Totals: Sales <strong>${fmtMoney(v.total_sales||0)}</strong> — Bank <strong>${bankTotal}</strong> — Expenses <strong>${expensesTotal}</strong></div>
              ${itemsHtml}
              <div class="mb-2">
                <div class="small fw-600">Bank entries</div>
                ${bankEntries.length ? `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Bank</th><th class="text-end">Amount</th><th>Customer</th><th>By</th></tr></thead><tbody>${bankEntries.map(b=>`<tr><td>${escapeHtml(b.bank||b.display||"")}</td><td class="text-end">${fmtMoney(b.amount||0)}</td><td>${escapeHtml(b.customer||"")}</td><td>${escapeHtml(b.created_by||"")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="small-muted">No bank entries</div>`}
              </div>
              <div>
                <div class="small fw-600">Expenses</div>
                ${expenses.length ? `<div class="table-responsive"><table class="table table-sm"><thead><tr><th class="text-end">Amount</th><th>Description</th><th>By</th></tr></thead><tbody>${expenses.map(e=>`<tr><td class="text-end">${fmtMoney(e.amount||0)}</td><td>${escapeHtml(e.description||"")}</td><td>${escapeHtml(e.created_by||"")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="small-muted">No expenses</div>`}
              </div>
              ${v.note ? `<div class="mt-2"><strong>Note:</strong> ${escapeHtml(v.note)}</div>` : ""}
              ${datamanActions}
            </div>`;
        }).join('');
      }

      // Small delay to ensure innerHTML is placed then attach handlers
      setTimeout(() => {
        document.querySelectorAll('.edit-version-btn').forEach(btn => {
          btn.addEventListener('click', function () {
            const vid = this.dataset.id;
            openEditVersionModal(date, place, vid);
          });
        });
        document.querySelectorAll('.finalize-version-btn').forEach(btn => {
          btn.addEventListener('click', async function () {
            const vid = this.dataset.id;
            if (!confirm("Finalize this version? This cannot be edited afterwards.")) return;
            try {
              const res = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}/versions/${encodeURIComponent(vid)}/finalize`, { method: "POST" });
              const j = await res.json();
              if (!res.ok) { alert("Error finalizing: " + (j.error || JSON.stringify(j))); return; }
              showToast("Version finalized");
              // reload after finalize
              if (typeof loadSummary === "function") loadSummary();
              new bootstrap.Modal(document.getElementById('versionsModal')).hide();
            } catch (err) {
              alert("Network error: " + err.message);
            }
          });
        });
      }, 30);

    } catch (err) {
      listArea.innerHTML = `<div class="alert alert-danger">Error loading versions</div>`;
      console.error(err);
    }
    new bootstrap.Modal(document.getElementById('versionsModal')).show();
  }

  // Edit modal for a version (dataman)
  async function openEditVersionModal(date, place, versionId) {
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(date)}/${encodeURIComponent(place)}`);
      if (!res.ok) throw new Error("Failed to load versions");
      const j = await res.json();
      const version = (j.versions || []).find(v => v.id === versionId);
      if (!version) { alert("Version not found"); return; }

      const modalWrapper = document.createElement("div");
      modalWrapper.innerHTML = `
        <div class="modal fade" id="editVersionModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Edit version ${escapeHtml(version.id)}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="mb-2 small-muted">Submitted by ${escapeHtml(version.created_by||'')} at ${escapeHtml(formatDateTime(version.created_at||''))}</div>
                <div class="table-responsive mb-2">
                  <table class="table table-sm" id="editItemsTable">
                    <thead><tr><th>Item</th><th style="width:120px">Crates</th></tr></thead>
                    <tbody>
                      ${(function(){
                        const rows = [];
                        const items = version.items || {};
                        if (items && typeof items === 'object' && Object.keys(items).length) {
                          for (const [k, it] of Object.entries(items)) {
                            const display = it.display_name || k;
                            const crates = Number(it.crates || 0);
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
                  <div class="col-md-6"><label class="form-label small">Total sales (override)</label><input id="edit_total_sales" class="form-control form-control-sm" value="${fmtMoney(version.total_sales||0)}"></div>
                  <div class="col-md-6"><label class="form-label small">Cash (override)</label><input id="edit_cash_total" class="form-control form-control-sm" value="${fmtMoney(version.cash_total||version.cash_total_computed||0)}"></div>
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
      document.body.appendChild(modalWrapper);
      const editModalEl = document.getElementById('editVersionModal');
      const editModal = new bootstrap.Modal(editModalEl);
      editModal.show();

      document.getElementById('saveVersionBtn').addEventListener('click', async function () {
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const j2 = await r.json();
          if (!r.ok) { alert("Update error: " + (j2.error || JSON.stringify(j2))); return; }
          showToast("Version updated");
          editModal.hide();
          // reload summary
          if (typeof loadSummary === "function") loadSummary();
          setTimeout(() => { modalWrapper.remove(); }, 500);
        } catch (err) {
          alert("Network error: " + err.message);
        }
      });

      editModalEl.addEventListener('hidden.bs.modal', () => { modalWrapper.remove(); });

    } catch (err) {
      alert("Failed to load version for edit");
      console.error(err);
    }
  }

  // --------------------------
  // Aggregate table rendering
  // --------------------------
  // We'll render a compact, professional table showing per-item crates by place plus totals.
  // Input: aggregateSource: { place: { itemDisplay: crates, ... }, ... }
  // datesList used for title context (not used to calculate totals here since aggregateSource already sums across dates)
  function renderAggregateTable(aggregateSource, datesList) {
    // Remove existing aggregate area if present
    const existing = document.getElementById("aggregateTableWrap");
    if (existing) existing.remove();

    // Build set of all items across places
    const places = ["Store", "Van 2", "Van 3", "Dawa", "Shet"];
    const itemSet = new Set();
    for (const p of places) {
      const map = aggregateSource[p] || {};
      for (const it of Object.keys(map)) itemSet.add(it);
    }
    const items = Array.from(itemSet).sort();

    // Build table
    const wrap = document.createElement("div");
    wrap.id = "aggregateTableWrap";
    wrap.className = "mt-4";
    wrap.innerHTML = `
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div><strong>Aggregate per-item crates</strong><div class="small-muted">Crates summed across places in selected range</div></div>
            <div class="d-flex gap-2">
              <button id="aggDownloadCsv" class="btn btn-outline-secondary btn-sm"><i class="bi bi-file-earmark-spreadsheet me-1"></i>Excel</button>
              <button id="aggDownloadPdf" class="btn btn-outline-primary btn-sm"><i class="bi bi-file-earmark-pdf me-1"></i>PDF</button>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-sm table-hover" id="aggregateTable">
              <thead>
                <tr>
                  <th>Item</th>
                  ${places.map(p => `<th class="text-end">${escapeHtml(p)}</th>`).join("")}
                  <th class="text-end">Total</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => {
                  const rowCells = places.map(p => {
                    const v = (aggregateSource[p] && aggregateSource[p][item]) ? Number(aggregateSource[p][item]) : 0;
                    return `<td class="text-end">${v}</td>`;
                  }).join("");
                  const total = places.reduce((s, p) => s + ((aggregateSource[p] && aggregateSource[p][item]) ? Number(aggregateSource[p][item]) : 0), 0);
                  return `<tr><td>${escapeHtml(item)}</td>${rowCells}<td class="text-end">${total}</td></tr>`;
                }).join("")}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  ${places.map(p => {
                    const colTotal = Object.keys(aggregateSource[p] || {}).reduce((s, it) => s + Number(aggregateSource[p][it] || 0), 0);
                    return `<th class="text-end">${colTotal}</th>`;
                  }).join("")}
                  <th class="text-end">${places.reduce((s, p) => s + Object.keys(aggregateSource[p] || {}).reduce((ss, it) => ss + Number(aggregateSource[p][it] || 0), 0), 0)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    `;
    // Append aggregate wrap after the summaryArea content
    summaryArea.appendChild(wrap);

    // Wire aggregate download buttons
    const aggCsv = document.getElementById("aggDownloadCsv");
    const aggPdf = document.getElementById("aggDownloadPdf");
    if (aggCsv) aggCsv.addEventListener("click", () => downloadAggregateCSV(aggregateSource, items));
    if (aggPdf) aggPdf.addEventListener("click", () => downloadAggregatePDF(aggregateSource, items));
  }

  // -------------------------
  // Download helpers
  // -------------------------
  function downloadAggregateCSV(aggregateSource, itemsList) {
    // If aggregateSource/itemsList are missing, try to read from DOM table
    const table = document.getElementById("aggregateTable");
    if (!aggregateSource || !itemsList || !itemsList.length) {
      if (!table) { alert("Nothing to export"); return; }
      // Serialize DOM table
      const rows = [];
      for (const tr of table.querySelectorAll("thead tr, tbody tr, tfoot tr")) {
        const cols = Array.from(tr.querySelectorAll("th,td")).map(td => td.innerText.trim().replace(/"/g,'""'));
        rows.push(cols.map(c => `"${c}"`).join(","));
      }
      const csv = rows.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aggregate_${(startEl?startEl.value:'')}_${(endEl?endEl.value:'')}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      return;
    }

    const places = ["Store", "Van 2", "Van 3", "Dawa", "Shet"];
    const rows = [];
    rows.push(["Item", ...places, "Total"]);
    for (const item of itemsList) {
      const row = [item];
      let tot = 0;
      for (const p of places) {
        const v = (aggregateSource[p] && aggregateSource[p][item]) ? Number(aggregateSource[p][item]) : 0;
        row.push(v);
        tot += v;
      }
      row.push(tot);
      rows.push(row);
    }
    // footer totals
    const footer = ["Total"];
    let grand = 0;
    for (const p of places) {
      const colTotal = Object.keys(aggregateSource[p] || {}).reduce((s, it) => s + Number(aggregateSource[p][it] || 0), 0);
      footer.push(colTotal);
      grand += colTotal;
    }
    footer.push(grand);
    rows.push(footer);

    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aggregate_${(startEl?startEl.value:'')}_${(endEl?endEl.value:'')}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function downloadAggregatePDF(aggregateSource, itemsList) {
    // Create a printable window with table and call print()
    const w = window.open("", "_blank");
    if (!w) { alert("Popup blocked — allow popups or use your browser print"); return; }
    const title = `Aggregate per-item crates ${(startEl?startEl.value:'')} → ${(endEl?endEl.value:'')}`;
    const style = `
      <style>
        body{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial; padding:20px; color:#111;}
        h2{ font-size:18px; margin-bottom:8px;}
        table{ border-collapse: collapse; width:100%; font-size:12px; }
        th,td{ border:1px solid #ddd; padding:6px 8px; }
        th{ background:#f8f9fa; text-align:right; }
        td { text-align:right; }
        td.item { text-align:left; }
        .meta { margin-bottom:12px; color:#666; font-size:12px; }
      </style>
    `;
    // Build table HTML based on DOM table if available otherwise aggregateSource
    const domTable = document.getElementById("aggregateTable");
    let tableHtml = "";
    if (domTable) {
      tableHtml = domTable.outerHTML;
      // make first column left-aligned
      tableHtml = tableHtml.replace(/<th>Item<\/th>/, '<th style="text-align:left">Item</th>');
      tableHtml = tableHtml.replace(/<td>/g, '<td style="text-align:right">').replace(/<td style="text-align:right">/,'<td class="item" style="text-align:left">');
    } else if (aggregateSource && itemsList && itemsList.length) {
      const places = ["Store", "Van 2", "Van 3", "Dawa", "Shet"];
      tableHtml = '<table><thead><tr><th style="text-align:left">Item</th>' + places.map(p => `<th>${escapeHtml(p)}</th>`).join('') + '<th>Total</th></tr></thead><tbody>';
      for (const item of itemsList) {
        let tot = 0;
        tableHtml += `<tr><td class="item">${escapeHtml(item)}</td>`;
        for (const p of places) {
          const v = (aggregateSource[p] && aggregateSource[p][item]) ? Number(aggregateSource[p][item]) : 0;
          tableHtml += `<td>${v}</td>`; tot += v;
        }
        tableHtml += `<td>${tot}</td></tr>`;
      }
      // footer
      tableHtml += `<tfoot><tr><th style="text-align:left">Total</th>`;
      let grand = 0;
      for (const p of places) {
        const colTotal = Object.keys(aggregateSource[p] || {}).reduce((s, it) => s + Number(aggregateSource[p][it] || 0), 0);
        tableHtml += `<th>${colTotal}</th>`; grand += colTotal;
      }
      tableHtml += `<th>${grand}</th></tr></tfoot></table>`;
    } else {
      tableHtml = `<div class="small-muted">No aggregate data to print</div>`;
    }

    w.document.write(`<html><head><title>${escapeHtml(title)}</title>${style}</head><body><h2>${escapeHtml(title)}</h2><div class="meta">Generated: ${new Date().toLocaleString()}</div>${tableHtml}</body></html>`);
    w.document.close();
    // Wait a brief moment for rendering then call print
    setTimeout(() => {
      w.focus();
      w.print();
      // optionally close window after printing - keep it open to let user cancel save
      // w.close();
    }, 250);
  }

  // -----------------
  // Small utilities
  // -----------------
  function showToast(msg, ms = 1800) {
    const el = document.createElement('div');
    el.className = 'toast align-items-center text-white bg-success border-0';
    el.style.position = 'fixed'; el.style.right = '20px'; el.style.bottom = '20px'; el.style.zIndex = 9999;
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(msg)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    document.body.appendChild(el);
    const b = new bootstrap.Toast(el, { delay: ms });
    b.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  // Expose a simple helper to export CSV for a given place & date (used by cards)
  function exportPlaceCSV(place, start, end, dataSummary) {
    // Build rows using the summary object passed (data.summary)
    const rows = [['date', 'place', 'status', 'created_by', 'created_at', 'crates_total', 'total_sales', 'cash_total', 'bank_total', 'expenses_total']];
    const dates = Object.keys(dataSummary || {}).sort();
    for (const date of dates) {
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
      rows.push([date, place, status, cb, created_at, crates, Number(total_sales).toFixed(2), Number(cash).toFixed(2), Number(bank).toFixed(2), Number(exp).toFixed(2)]);
    }
    if (rows.length === 1) { alert("No data to export for this place/range"); return; }
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${place}_${start}_${end}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Attach exportPlaceCSV to global so card handlers can call it (older code uses it)
  window.exportPlaceCSV = exportPlaceCSV;
  window.showToast = showToast;

  // wire top-level load button(s)
  if (loadBtn) {
    try {
      loadBtn.addEventListener("click", loadSummary);
    } catch (e) {
      console.warn("reports.js: failed to attach loadSummary listener", e);
    }
  }

  // initial load attempt (if start/end present or if user wants immediate load)
  if (typeof loadBtn === "undefined" || loadBtn === null) {
    // no load button on page — attempt to load once (useful for pages that expect immediate display)
    loadSummary();
  } else {
    // optionally auto-load once on page ready
    // only auto-load if start & end have values
    if ((!startEl || startEl.value) && (!endEl || endEl.value)) {
      loadSummary();
    }
  }
});