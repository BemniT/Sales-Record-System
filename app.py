from flask import Flask, render_template, request, jsonify, send_file
import os
import uuid
import datetime
import io
import logging

# Optional PDF dependency (reportlab). If missing, PDF route is disabled with a helpful message.
try:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import cm
    REPORTLAB_AVAILABLE = True
except Exception:
    REPORTLAB_AVAILABLE = False

import firebase_admin
from firebase_admin import credentials, db

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

# Make a "now()" helper available to templates so they can call now().year or now().date()
@app.context_processor
def inject_now():
    from datetime import datetime as _dt
    return {"now": lambda: _dt.utcnow()}

# ---------- Static defaults (fallbacks) ----------
ITEMS = [
    "HARAR RB CRATE 20X50CL XLN ET LRM",
    "HEINEKEN RB Crate 24x33cl K2 ET LRM",
    "HARAR RB Crate 24x33cl XLN ET LRM",
    "BEDELE Special RB Crt 20x50cl XLN ET LRM",
    "BEDELE Special RB Crt 24x33cl XLN ET LRM",
    "WALIA RB Crate 20x50cl XLN ET LRM",
    "WALIA RB Crate 24x33cl XLN ET LRM",
    "SOFI RB CRATE 24X33CL XLN ET",
    "BUCKLER 0.0% RB CRATE 24X33CL XLN ET"
]

# Minimal fallback price config (only used if DB has none)
PRICE_CONFIG = {
    "Main Store": {name: 0.0 for name in ITEMS}
}

BANKS = ["C.B.E", "Awash", "Dashen", "Oromia"]

# Firebase initialization (require env var or serviceAccountKey.json)
FIREBASE_DB_URL = os.environ.get("FIREBASE_DB_URL", "https://ethiostore-17d9f-default-rtdb.firebaseio.com/")
cred_path = os.environ.get("FIREBASE_CREDENTIAL_PATH", "serviceAccountKey.json")
if not os.path.exists(cred_path):
    raise FileNotFoundError(
        f"Firebase credential not found at {cred_path}. Set FIREBASE_CREDENTIAL_PATH or place serviceAccountKey.json."
    )

cred = credentials.Certificate(cred_path)
firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
root_ref = db.reference("Sales record")


# ---------- Helpers ----------
def get_config_from_db():
    """Read config from the DB: price_config and salesmen"""
    cfg_ref = root_ref.child("config")
    cfg = cfg_ref.get() or {}
    price_cfg = cfg.get("price_config") or PRICE_CONFIG
    salesmen = cfg.get("salesmen") or []  # expected as list of strings
    return {"price_config": price_cfg, "salesmen": salesmen}


def set_price_config_in_db(price_config):
    root_ref.child("config").child("price_config").set(price_config)


def set_salesmen_in_db(salesmen_list):
    # Accepts list of strings
    root_ref.child("config").child("salesmen").set(salesmen_list)


def compute_sale_totals(items):
    crates_total = 0
    sales_total = 0.0
    for it in items:
        crates = int(it.get("crates", 0) or 0)
        price = float(it.get("price", 0) or 0)
        crates_total += crates
        sales_total += crates * price
    return crates_total, round(sales_total, 2)


def save_sale_to_db(sale):
    date_str = sale["date"]
    ref = root_ref.child("sales").child(date_str).child(sale["id"])
    ref.set(sale)


def query_sales_between(start_date, end_date):
    sales_ref = root_ref.child("sales")
    result = {}
    cur = start_date
    while cur <= end_date:
        key = cur.strftime("%Y-%m-%d")
        day_ref = sales_ref.child(key)
        day_data = day_ref.get() or {}
        result[key] = list(day_data.values())
        cur += datetime.timedelta(days=1)
    return result


def aggregate_crates(sales_by_date):
    item_totals = {name: 0 for name in ITEMS}
    for date, sales in sales_by_date.items():
        for s in sales:
            items = s.get("items", {})
            for name, details in items.items():
                crates = int(details.get("crates", 0) or 0)
                item_totals[name] = item_totals.get(name, 0) + crates
    return item_totals


def generate_pdf_report(sales_by_date, start_date, end_date):
    if not REPORTLAB_AVAILABLE:
        raise RuntimeError("reportlab not installed")
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=landscape(A4))
    width, height = landscape(A4)
    margin = 2 * cm

    c.setFont("Helvetica-Bold", 18)
    c.drawString(margin, height - margin, f"Sales Report ({start_date} to {end_date})")
    c.setFont("Helvetica", 10)
    y = height - margin - 1 * cm

    c.setFont("Helvetica-Bold", 11)
    c.drawString(margin, y, "Item")
    c.drawString(margin + 10 * cm, y, "Crates Sold")
    y -= 0.6 * cm
    c.setFont("Helvetica", 10)

    item_totals = aggregate_crates(sales_by_date)
    for name, crates in item_totals.items():
        if y < margin + 2 * cm:
            c.showPage()
            y = height - margin
        c.drawString(margin, y, name)
        c.drawString(margin + 10 * cm, y, str(crates))
        y -= 0.5 * cm

    y -= 0.7 * cm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin, y, "Daily Summaries")
    y -= 0.6 * cm
    c.setFont("Helvetica", 10)
    for date, sales in sales_by_date.items():
        if y < margin + 2 * cm:
            c.showPage()
            y = height - margin
        day_crates = sum(int(s.get("crates_total", 0) or 0) for s in sales)
        day_sales = sum(float(s.get("sales_total", 0) or 0) for s in sales)
        c.drawString(margin, y, f"{date}: Crates={day_crates}  Sales={day_sales:.2f}  Transactions={len(sales)}")
        y -= 0.5 * cm

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer


# ---------- Routes ----------
@app.route("/")
def index():
    # Render with ITEMS; price config and salesmen will be fetched by the client via /api/config
    return render_template("index.html", items=ITEMS, banks=BANKS)


@app.route("/api/config", methods=["GET"])
def api_get_config():
    """
    Returns:
    {
      "price_config": { "Main Store": { itemName: price, ... }, ... },
      "salesmen": ["Alice", "Bob", ...]
    }
    """
    cfg = get_config_from_db()
    # Ensure main store price includes all items (fallback to PRICE_CONFIG defaults)
    price_cfg = cfg.get("price_config") or PRICE_CONFIG
    # Fill missing items in main store pricing with zero or fallback
    main_prices = price_cfg.get("Main Store", {})
    for name in ITEMS:
        if name not in main_prices:
            main_prices[name] = PRICE_CONFIG.get("Main Store", {}).get(name, 0.0)
    price_cfg["Main Store"] = main_prices
    return jsonify({"price_config": price_cfg, "salesmen": cfg.get("salesmen", [])})


@app.route("/api/config/salesmen", methods=["POST"])
def api_add_salesman():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    cfg = get_config_from_db()
    salesmen = cfg.get("salesmen", []) or []
    if name in salesmen:
        return jsonify({"status": "exists", "salesmen": salesmen})
    salesmen.append(name)
    set_salesmen_in_db(salesmen)
    return jsonify({"status": "ok", "salesmen": salesmen})


@app.route("/api/config/prices", methods=["POST"])
def api_set_prices():
    """
    Payload: { "place": "Main Store", "prices": { itemName: price, ... } }
    """
    data = request.json or {}
    place = data.get("place")
    prices = data.get("prices")
    if not place or not isinstance(prices, dict):
        return jsonify({"error": "place and prices required"}), 400
    cfg = get_config_from_db()
    price_cfg = cfg.get("price_config") or {}
    price_cfg[place] = prices
    set_price_config_in_db(price_cfg)
    return jsonify({"status": "ok", "price_config": price_cfg})


@app.route("/submit", methods=["POST"])
def submit_sale():
    """
    Expected JSON:
    {
      salesman, date (YYYY-MM-DD), place,
      items: [{name, crates, price}], payments: {cash, banks: {C.B.E: 10, ...}}, invoice_total
    }
    """
    data = request.json or {}
    # Basic validation
    salesman = (data.get("salesman") or "").strip()
    place = data.get("place")
    items = data.get("items", [])
    payments = data.get("payments", {})
    invoice_total = float(data.get("invoice_total") or 0)

    if not salesman:
        return jsonify({"error": "salesman is required"}), 400
    if not place:
        return jsonify({"error": "place is required"}), 400
    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"error": "items is required and must be a non-empty list"}), 400

    # Ensure each item has name and crates; fill price from DB/main store if not provided (except Dawa/Shet allow override)
    cfg = get_config_from_db()
    price_cfg = cfg.get("price_config", {})
    main_prices = price_cfg.get("Main Store", {})

    normalized_items = []
    for it in items:
        name = it.get("name")
        crates = int(it.get("crates") or 0)
        provided_price = it.get("price")
        if name not in ITEMS:
            return jsonify({"error": f"unknown item: {name}"}), 400
        if crates < 0:
            return jsonify({"error": f"invalid crates for {name}"}), 400
        # price selection logic:
        if place in ("Dawa", "Shet"):
            # flexible: if provided price use it, else fallback to main store price
            price = float(provided_price) if provided_price not in (None, "", []) else float(main_prices.get(name, 0) or 0)
        else:
            # non-flexible: use main store price if provided_price is empty; otherwise use provided_price too (allow override)
            price = float(provided_price) if provided_price not in (None, "", []) else float(main_prices.get(name, 0) or 0)
        normalized_items.append({"name": name, "crates": crates, "price": price})

    crates_total, sales_total = compute_sale_totals(normalized_items)
    cash_total = float(payments.get("cash", 0) or 0)
    bank_dict = payments.get("banks", {}) or {}
    bank_total = sum(float(bank_dict.get(b, 0) or 0) for b in BANKS)
    paid_total = cash_total + bank_total
    difference = round(paid_total - sales_total, 2)

    sale = {
        "id": str(uuid.uuid4()),
        "salesman": salesman,
        "date": data.get("date") or datetime.date.today().strftime("%Y-%m-%d"),
        "place": place,
        "items": {it["name"]: {"crates": int(it["crates"]), "price": float(it["price"])} for it in normalized_items},
        "crates_total": crates_total,
        "sales_total": sales_total,
        "payments": {"cash": cash_total, "banks": bank_dict},
        "paid_total": paid_total,
        "invoice_total": invoice_total,
        "difference": difference,
        "timestamp": datetime.datetime.utcnow().isoformat(),
    }

    try:
        save_sale_to_db(sale)
    except Exception as e:
        logging.exception("Error saving sale to Firebase")
        return jsonify({"error": "failed to save sale", "details": str(e)}), 500

    return jsonify({"status": "ok", "sale": sale})


@app.route("/sales")
def sales_list():
    today = datetime.date.today().strftime("%Y-%m-%d")
    return render_template("sales_list.html", today=today)


@app.route("/api/get_sales")
def api_get_sales():
    start = request.args.get("start")
    end = request.args.get("end")
    if not start or not end:
        return jsonify({"error": "start and end required"}), 400
    start_date = datetime.datetime.strptime(start, "%Y-%m-%d").date()
    end_date = datetime.datetime.strptime(end, "%Y-%m-%d").date()
    sales_by_date = query_sales_between(start_date, end_date)
    return jsonify(sales_by_date)


@app.route("/report/pdf")
def report_pdf():
    if not REPORTLAB_AVAILABLE:
        return (
            "PDF generation is disabled because the reportlab package is not installed. Install it with: python -m pip install reportlab",
            503,
        )

    start = request.args.get("start")
    end = request.args.get("end")
    if not start or not end:
        return "start and end required (YYYY-MM-DD)", 400
    start_date = datetime.datetime.strptime(start, "%Y-%m-%d").date()
    end_date = datetime.datetime.strptime(end, "%Y-%m-%d").date()
    sales_by_date = query_sales_between(start_date, end_date)
    pdf_buf = generate_pdf_report(sales_by_date, start, end)
    return send_file(pdf_buf, mimetype="application/pdf", as_attachment=True, download_name=f"sales_report_{start}_to_{end}.pdf")


if __name__ == "__main__":
    app.run(debug=True, port=5000)