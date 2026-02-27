// static/js/owner.js
// Owner dashboard script — loads role-aware summaries and computes top totals.
// Fixed behavior:
// - Uses /api/reports/view (role-aware) to compute totals (previous version used a missing endpoint).
// - Correctly aggregates total sales and total crates across the selected date range.
// - Renders detail table rows and provides CSV export for the shown range.
//
// Usage: place this file as static/js/owner.js and ensure owner_dashboard.html includes it.

document.addEventListener("DOMContentLoaded", function () {
  const loadBtn = document.getElementById("loadSummary");
  const startEl = document.getElementById("start");
  const endEl = document.getElementById("end");
  const exportCsv = document.getElementById("exportCsv");
  const exportPdf = document.getElementById("exportPdf");
  const ownerTotalSalesEl = document.getElementById("ownerTotalSales");
  const ownerTotalCratesEl = document.getElementById("ownerTotalCrates");
  const detailTableBody = document.querySelector("#detailTable tbody");

  function fmtMoney(n) {
    return (Number(n) || 0).toFixed(2);
  }

  function safe(s) {
    return s === null || s === undefined ? "" : String(s);
  }

  async function loadSummary(e) {
    if (e && e.preventDefault) e.preventDefault();
    const start = startEl && startEl.value;
    const end = endEl && endEl.value;
    if (!start || !end) {
      alert("Please choose start and end dates.");
      return;
    }

    // Call the role-aware report view endpoint
    const url = `/api/reports/view?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    try {
      loadBtn && (loadBtn.disabled = true);
      const res = await fetch(url);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error((payload && payload.error) ? payload.error : `HTTP ${res.status}`);
      }
      const data = await res.json();
      const summary = data && data.summary ? data.summary : data || {};
      renderOwnerSummary(summary, start, end);
    } catch (err) {
      console.error("Failed to load owner summary:", err);
      alert("Failed to load summary: " + (err.message || err));
    } finally {
      loadBtn && (loadBtn.disabled = false);
    }
  }

  function renderOwnerSummary(summary, start, end) {
    // summary expected: { date: { place: { ...summary... } } }
    let totalSales = 0;
    let totalCrates = 0;

    // Clear existing detail rows
    if (detailTableBody) detailTableBody.innerHTML = "";

    const dates = Object.keys(summary || {}).sort();
    for (const date of dates) {
      const placesObj = summary[date] || {};
      for (const [place, v] of Object.entries(placesObj)) {
        // v may be summary object returned by compute_place_day_summary:
        // look for v.total_sales, v.sales_total, v.crates_total, crates_total
        const salesVal = Number(v && (v.total_sales ?? v.sales_total ?? v.sales_total_computed) || v.total_sales || 0);
        const cratesVal = Number(v && (v.crates_total ?? v.crates_total_computed) || 0);

        totalSales += salesVal;
        totalCrates += cratesVal;

        if (detailTableBody) {
          const tr = document.createElement("tr");
          // keep cells: date, place, status, crates_total, total_sales, cash_total, bank_total, created_by
          const status = safe(v.status || (v.version && v.version.status) || "");
          const createdBy = safe(v.created_by || (v.version && v.version.created_by) || "");
          const cash = Number(v.cash_total ?? v.cash_total_computed ?? 0);
          const bank = Number(v.bank_total ?? v.bank_total_calculated ?? 0);
          tr.innerHTML = `
            <td>${safe(date)}</td>
            <td>${safe(place)}</td>
            <td>${escapeHtml(status)}</td>
            <td class="text-end">${Number(cratesVal || 0)}</td>
            <td class="text-end">${fmtMoney(salesVal)}</td>
            <td class="text-end">${fmtMoney(cash)}</td>
            <td class="text-end">${fmtMoney(bank)}</td>
            <td>${escapeHtml(createdBy)}</td>
          `;
          detailTableBody.appendChild(tr);
        }
      }
    }

    // Update top totals
    if (ownerTotalSalesEl) ownerTotalSalesEl.textContent = fmtMoney(totalSales);
    if (ownerTotalCratesEl) ownerTotalCratesEl.textContent = String(Math.round(totalCrates));
  }

  // CSV export for owner top button. Exports the details currently visible (uses same summary fetch).
  async function exportCsvTop() {
    const start = startEl && startEl.value;
    const end = endEl && endEl.value;
    if (!start || !end) {
      alert("Please choose start and end dates before exporting.");
      return;
    }
    // Fetch same data and serialize
    const url = `/api/reports/view?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load summary for export");
      const data = await res.json();
      const summary = data && data.summary ? data.summary : data || {};
      const rows = [];
      // header
      rows.push(["date","place","status","created_by","crates_total","total_sales","cash_total","bank_total"]);
      const dates = Object.keys(summary || {}).sort();
      for (const date of dates) {
        const placesObj = summary[date] || {};
        for (const [place, v] of Object.entries(placesObj)) {
          const status = v.status || (v.version && v.version.status) || "";
          const createdBy = v.created_by || (v.version && v.version.created_by) || "";
          const crates = Number(v.crates_total || 0);
          const sales = Number(v.total_sales || v.sales_total || 0);
          const cash = Number(v.cash_total ?? v.cash_total_computed ?? 0);
          const bank = Number(v.bank_total ?? v.bank_total_calculated ?? 0);
          rows.push([date, place, status, createdBy, crates, fmtMoney(sales), fmtMoney(cash), fmtMoney(bank)]);
        }
      }
      if (rows.length <= 1) { alert("No data to export for selected range."); return; }
      const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const urlObj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = urlObj;
      a.download = `owner_summary_${start}_to_${end}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlObj);
    } catch (err) {
      console.error(err);
      alert("Export failed: " + (err.message || err));
    }
  }

  // small helper for safely escaping (used in table content where innerText not used)
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Wire events
  if (loadBtn) loadBtn.addEventListener("click", loadSummary);
  const exportCsvTopBtn = document.getElementById("exportCsvTop") || exportCsv;
  if (exportCsvTopBtn) exportCsvTopBtn.addEventListener("click", exportCsvTop);

  // Auto-load once if dates are present
  if (startEl && endEl && startEl.value && endEl.value) {
    loadSummary();
  }
});