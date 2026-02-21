#!/usr/bin/env python3
"""
Final app.py — consolidated, non-blocking RTDB probe, dataman edit/finalize & correction support.

Highlights:
- Non-blocking background root detection (app responds immediately).
- Endpoints for creating/editing/finalizing report versions:
  - POST /api/reports/<date>/<place>/submit_totals  (create version)
  - POST /api/reports/<date>/<place>/correction     (create correction/version manually)
  - GET  /api/reports/<date>/<place>                (list versions)
  - PATCH /api/reports/<date>/<place>/versions/<id> (dataman edit)
  - POST  /api/reports/<date>/<place>/versions/<id>/finalize (dataman finalize)
- Dataman dashboard includes "Register Sales" link (so dataman can register store/shet/dawa).
- Login/Setup behavior: /login always renders login page; /setup_user only creates initial user when none exist.
- Reloader disabled on run to avoid double-initialization delays.
- Bootstrap-based frontend is mobile-responsive already.

Configure FIREBASE_DB_URL and FIREBASE_CREDENTIAL_PATH or place serviceAccountKey.json in project root.
"""
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import os, uuid, datetime, logging, re, threading
from typing import Optional
from werkzeug.security import generate_password_hash, check_password_hash

# Optional PDF dependency (not used here)
try:
    import reportlab  # noqa: F401
    REPORTLAB_AVAILABLE = True
except Exception:
    REPORTLAB_AVAILABLE = False

import firebase_admin
from firebase_admin import credentials, db

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24))
logging.basicConfig(level=logging.INFO)

# ---------- Firebase init ----------
FIREBASE_DB_URL = os.environ.get("FIREBASE_DB_URL", "https://bale-house-rental-default-rtdb.firebaseio.com/")
CRED_PATH = os.environ.get("FIREBASE_CREDENTIAL_PATH")
if not CRED_PATH:
    try:
        candidates = [f for f in os.listdir('.') if f.endswith('.json') and ('firebase-adminsdk' in f or 'serviceAccount' in f or 'serviceAccountKey' in f)]
    except Exception:
        candidates = []
    CRED_PATH = candidates[0] if candidates else "serviceAccountKey.json"
if not os.path.exists(CRED_PATH):
    raise FileNotFoundError(f"Firebase credential not found at {CRED_PATH}. Set FIREBASE_CREDENTIAL_PATH or place JSON in project root.")
cred = credentials.Certificate(CRED_PATH)
firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})

# Start with a safe provisional root so app responds immediately.
root_ref = db.reference("Sales Record")
logging.info("Assigned provisional RTDB root: 'Sales Record' (background probe will try to locate actual root).")

def _detect_root_in_background():
    """Background probe: switch root_ref if a better root key is found."""
    try:
        probe_root = db.reference()
        try:
            data = probe_root.get() or {}
        except Exception as e:
            logging.warning("Background root probe failed: %s", e)
            return
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, dict) and ("config" in v or "price_config" in v or "sales" in v):
                    logging.info("Background detection: found root candidate '%s' — switching root_ref.", k)
                    globals()['root_ref'] = db.reference(k)
                    return
        for c in ("Sales record","Sales Record","Sales_Record","SalesRecord","sales","sales_record","Sales"):
            if isinstance(data, dict) and c in data:
                logging.info("Background detection: found top-level '%s' — switching root_ref.", c)
                globals()['root_ref'] = db.reference(c)
                return
        logging.info("Background detection: no special root found; keeping 'Sales Record'.")
    except Exception as e:
        logging.exception("Background root detection crashed: %s", e)

threading.Thread(target=_detect_root_in_background, daemon=True).start()

# ---------- Static defaults ----------
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
PLACES = ["Store", "Van 2", "Van 3", "Dawa", "Shet"]
BANKS = ["C.B.E", "Awash", "Dashen", "Oromia"]

DB_KEY_TO_DISPLAY = {
    "harar_20x50": "HARAR RB CRATE 20X50CL XLN ET LRM",
    "heineken_24x33_k2": "HEINEKEN RB Crate 24x33cl K2 ET LRM",
    "harar_24x33": "HARAR RB Crate 24x33cl XLN ET LRM",
    "bedele_20x50": "BEDELE Special RB Crt 20x50cl XLN ET LRM",
    "bedele_24x33": "BEDELE Special RB Crt 24x33cl XLN ET LRM",
    "walia_20x50": "WALIA RB Crate 20x50cl XLN ET LRM",
    "walia_24x33": "WALIA RB Crate 24x33cl XLN ET LRM",
    "sofi_24x33": "SOFI RB CRATE 24X33CL XLN ET",
    "buckler_0_0_24x33": "BUCKLER 0.0% RB CRATE 24X33CL XLN ET",
}
DISPLAY_TO_DB_KEY = {v: k for k, v in DB_KEY_TO_DISPLAY.items()}
FORBIDDEN_RE = re.compile(r'[.#$\[\]/]')

def make_safe_key(display_name: str) -> str:
    if not display_name:
        return uuid.uuid4().hex
    if display_name in DISPLAY_TO_DB_KEY:
        return DISPLAY_TO_DB_KEY[display_name]
    key = FORBIDDEN_RE.sub("_", display_name)
    key = key.replace(" ", "_")
    key = re.sub(r'[^0-9A-Za-z_]', '', key)
    return key.lower() if key else uuid.uuid4().hex

def safe_bank_key(bank_display: str) -> str:
    if not bank_display:
        return uuid.uuid4().hex
    key = FORBIDDEN_RE.sub("_", bank_display)
    key = key.replace(" ", "_")
    key = re.sub(r'[^0-9A-Za-z_]', '', key)
    return key.lower() if key else uuid.uuid4().hex

def normalize_place_name(p: Optional[str]) -> Optional[str]:
    if not p: return p
    pn = str(p).strip()
    low = pn.lower().replace("_", " ").replace("-", " ").strip()
    if low in ("main store","mainstore","store"): return "Store"
    if low in ("van2","van 2","van_2","van-2"): return "Van 2"
    if low in ("van3","van 3","van_3","van-3"): return "Van 3"
    return pn

# ---------- Auth helpers ----------
def users_ref():
    return root_ref.child("config").child("users")

def get_user(username: str) -> Optional[dict]:
    if not username: return None
    return users_ref().child(username).get()

def set_user_password_hash(username: str, password_hash: str) -> None:
    try:
        users_ref().child(username).update({"password_hash": password_hash})
    except Exception:
        logging.exception("Failed to update password_hash for user %s", username)

def create_user(username: str, password: str, role: str) -> dict:
    ph = generate_password_hash(password)
    obj = {"password_hash": ph, "role": role, "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    users_ref().child(username).set(obj)
    return obj

def verify_user(username: str, password: str) -> bool:
    u = get_user(username)
    if not u: return False
    ph = u.get("password_hash")
    if ph is None: return False
    ph_str = str(ph)
    if "$" in ph_str:
        try:
            return check_password_hash(ph_str, password)
        except Exception:
            logging.exception("check_password_hash failed for user %s", username)
            return False
    if ph_str == password:
        # migrate plaintext to hash
        try:
            new_hash = generate_password_hash(password)
            set_user_password_hash(username, new_hash)
            logging.info("Auto-migrated plaintext password to hash for user %s", username)
        except Exception:
            logging.exception("Failed to auto-migrate password for user %s", username)
        return True
    return False

def current_user() -> Optional[dict]:
    uname = session.get("user")
    if not uname: return None
    u = get_user(uname)
    if not u: return None
    return {"username": uname, "role": u.get("role"), "full_name": u.get("full_name"), "place": u.get("place")}

def login_required(f):
    from functools import wraps
    @wraps(f)
    def inner(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error":"authentication required"}), 401
        return f(*args, **kwargs)
    return inner

def role_required(roles):
    from functools import wraps
    allowed = {roles} if isinstance(roles, str) else set(roles)
    def deco(f):
        @wraps(f)
        def inner(*args, **kwargs):
            u = current_user()
            if not u: return jsonify({"error":"authentication required"}), 401
            if u.get("role") not in allowed: return jsonify({"error":"forbidden - insufficient role"}), 403
            return f(*args, **kwargs)
        return inner
    return deco

# ---------- Template helpers ----------
@app.context_processor
def inject_template_helpers():
    def now_callable():
        return datetime.datetime.now(datetime.timezone.utc)
    return {"now": now_callable, "today": now_callable().date().isoformat(), "tmpl_user": current_user()}

# ---------- Auth routes ----------
@app.route("/setup_user", methods=["GET","POST"])
def setup_user_page():
    existing = users_ref().get() or {}
    if existing:
        # If users already exist, hide setup form (do not expose to regular users)
        # Still render a simple message linking to login.
        return render_template("login.html", error="Initial setup already completed. Please sign in.")
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = (request.form.get("password") or "").strip()
        role = (request.form.get("role") or "owner").strip()
        if not username or not password:
            return render_template("setup_user.html", error="username & password required")
        create_user(username, password, role)
        return redirect(url_for("login_page"))
    return render_template("setup_user.html")

@app.route("/login", methods=["GET"])
def login_page():
    # Always render login page. Setup is only allowed if no users exist.
    return render_template("login.html")

@app.route("/login", methods=["POST"])
def login_submit():
    username = (request.form.get("username") or "").strip()
    password = (request.form.get("password") or "").strip()
    if not username or not password:
        return render_template("login.html", error="username & password required")
    if not verify_user(username, password):
        return render_template("login.html", error="invalid credentials")
    session["user"] = username
    u = get_user(username) or {}
    role = u.get("role")
    if role == "owner": return redirect(url_for("owner_dashboard"))
    if role == "dataman": return redirect(url_for("dataman_dashboard"))
    return redirect(url_for("van_dashboard"))

@app.route("/logout", methods=["GET"])
def logout():
    session.pop("user", None)
    return redirect(url_for("login_page"))

# ---------- Dashboards ----------
@app.route("/owner")
@login_required
@role_required("owner")
def owner_dashboard():
    return render_template("owner_dashboard.html")

@app.route("/dataman")
@login_required
@role_required("dataman")
def dataman_dashboard():
    # Dataman can register sales for Store/Dawa/Shet -> link to 'index' (register sales)
    return render_template("dataman_dashboard.html", places=PLACES)

@app.route("/van")
@login_required
@role_required("van")
def van_dashboard():
    return render_template("index.html", items=ITEMS, banks=BANKS, places=PLACES)

# ---------- Price translation ----------
def translate_price_dict_from_db(db_price_dict):
    result = {}
    if not db_price_dict:
        db_price_dict = {}
    for key, val in db_price_dict.items():
        if key in DB_KEY_TO_DISPLAY:
            display = DB_KEY_TO_DISPLAY[key]
            try:
                result[display] = float(val) if val is not None and val != "" else None
            except Exception:
                result[display] = None
        else:
            try:
                result[key] = float(val) if val is not None and val != "" else None
            except Exception:
                result[key] = None
    for name in ITEMS:
        result.setdefault(name, None)
    return result

# ---------- API: config ----------
@app.route("/api/config", methods=["GET"])
def api_get_config():
    cfg = root_ref.child("config").get() or {}
    price_cfg_db = cfg.get("price_config") or {}
    translated = {}
    for db_place, db_prices in price_cfg_db.items():
        place_name = "Store" if db_place == "Main Store" else db_place
        translated[place_name] = translate_price_dict_from_db(db_prices)
    for p in PLACES:
        if p not in translated:
            translated[p] = {name:(0.0 if p=="Store" else None) for name in ITEMS}
        else:
            for name in ITEMS:
                translated[p].setdefault(name, 0.0 if p=="Store" else None)

    cfg_salesmen = cfg.get("salesmen") or []
    u = current_user()
    salesmen_for_user = cfg_salesmen
    if u:
        role = u.get("role")
        user_db = get_user(u.get("username")) or {}
        user_place = user_db.get("place")
        user_full = (user_db.get("full_name") or "").strip()
        if role == "van":
            filtered = []
            for s in cfg_salesmen:
                if not s: continue
                sl = s.lower()
                if user_full and user_full.lower() in sl:
                    filtered.append(s); continue
                if user_place and user_place.lower() in sl:
                    filtered.append(s)
            if not filtered:
                filtered = [user_full] if user_full else [u.get("username")]
            salesmen_for_user = filtered
        elif role == "dataman":
            salesmen_for_user = ["Store"]
        else:
            salesmen_for_user = cfg_salesmen

    return jsonify({"price_config": translated, "salesmen": salesmen_for_user})

# ---------- Sale normalization ----------
def normalize_sale_record(s: dict) -> dict:
    if not isinstance(s, dict): return s
    ns = dict(s)
    ns["place"] = normalize_place_name(ns.get("place"))
    items = ns.get("items") or {}
    norm_items = {}
    for k, v in items.items():
        if isinstance(v, dict) and v.get("display_name"):
            display = v.get("display_name"); norm_items[display] = v
        else:
            display = DB_KEY_TO_DISPLAY.get(k, k)
            if isinstance(v, dict): norm_items[display] = v
            else:
                try: crates = int(v or 0)
                except Exception: crates = 0
                norm_items[display] = {"crates": crates}
    ns["items"] = norm_items
    payments = ns.get("payments") or {}
    banks = payments.get("banks") or {}
    norm_banks = {}
    if isinstance(banks, dict):
        for bk, bv in banks.items():
            if isinstance(bv, dict) and ("amount" in bv or "display" in bv):
                try: amt = float(bv.get("amount") or 0)
                except Exception: amt = 0.0
                norm_banks[safe_bank_key(bk)] = {"display": bv.get("display") or bk, "amount": amt}
            else:
                try: amt = float(bv or 0)
                except Exception: amt = 0.0
                norm_banks[safe_bank_key(bk)] = {"display": bk, "amount": amt}
    ns["payments"] = {"cash": float(payments.get("cash") or 0), "banks": norm_banks}
    try: ns["crates_total"] = int(ns.get("crates_total") or 0)
    except Exception: ns["crates_total"] = 0
    try: ns["sales_total"] = float(ns.get("sales_total") or 0)
    except Exception: ns["sales_total"] = 0.0
    return ns

# ---------- Sales endpoints ----------
def compute_sale_totals(items):
    crates_total = 0; sales_total = 0.0
    for it in items:
        crates = int(it.get("crates",0) or 0)
        price = float(it.get("price",0) or 0)
        crates_total += crates; sales_total += crates * price
    return crates_total, round(sales_total, 2)

def save_sale_to_db(sale: dict) -> None:
    date_str = sale["date"]
    ref = root_ref.child("sales").child(date_str).child(sale["id"])
    ref.set(sale)

@app.route("/submit", methods=["POST"])
@login_required
# (snippet - replace the submit_sale function and the api_reports_view role==dataman block)
def submit_sale():
    u = current_user()
    if not u: return jsonify({"error":"auth required"}), 401
    data = request.json or {}
    salesman = (data.get("salesman") or u.get("username") or "").strip()
    place = normalize_place_name(data.get("place"))
    items = data.get("items", [])
    payments = data.get("payments", {})
    customer = (data.get("customer") or "").strip()
    invoice_total = float(data.get("invoice_total") or 0)
    if not salesman: return jsonify({"error":"salesman required"}), 400
    if not place: return jsonify({"error":"place required"}), 400
    if not isinstance(items, list) or not items: return jsonify({"error":"items required"}), 400

    if u.get("role") == "van":
        uname = u.get("username") or ""
        full = u.get("full_name") or ""
        if salesman.lower() != uname.lower() and (full and salesman.lower() != full.lower()):
            return jsonify({"error":"van users may only submit sales for themselves"}), 403
        assigned = normalize_place_name(u.get("place"))
        if assigned != place:
            return jsonify({"error":"van users may only submit for their assigned place"}), 403

    # ----- fetch price map for this place (server-side authoritative) -----
    cfg = root_ref.child("config").get() or {}
    price_cfg_db = cfg.get("price_config") or {}
    def get_price_map_for_place(place_name):
        db_place = "Main Store" if place_name == "Store" else place_name
        db_prices = price_cfg_db.get(db_place) or {}
        return translate_price_dict_from_db(db_prices)
    place_price_map = get_price_map_for_place(place)
    store_price_map = get_price_map_for_place("Store")

    # If place is Store or Van 2/Van 3, server will use configured prices rather than client-supplied ones.
    editable_price_places = {"Dawa", "Shet"}  # only these allow client-provided prices
    normalized_items = []
    for it in items:
        name = it.get("name")
        try:
            crates = int(it.get("crates") or 0)
        except Exception:
            return jsonify({"error": f"invalid crates for {name}"}), 400
        provided_price = it.get("price")
        if name not in ITEMS:
            return jsonify({"error":f"unknown item {name}"}), 400
        if crates < 0:
            return jsonify({"error":f"invalid crates for {name}"}), 400

        # determine final price to store:
        if place in editable_price_places:
            price = float(provided_price or 0)
        else:
            # use place price if present, else fallback to store price, else 0
            p = None
            if isinstance(place_price_map, dict):
                p = place_price_map.get(name)
            if p is None and isinstance(store_price_map, dict):
                p = store_price_map.get(name)
            price = float(p or 0)

        normalized_items.append({"name": name, "crates": crates, "price": price})

    crates_total, sales_total = compute_sale_totals(normalized_items)
    cash_total = float((payments.get("cash") or 0) or 0)
    bank_dict = payments.get("banks", {}) or {}
    banks_safe = {}
    for bk, bv in bank_dict.items():
        try: amt = float(bv or 0)
        except: amt = 0.0
        banks_safe[safe_bank_key(bk)] = {"display": bk, "amount": amt}
    items_for_db = {}
    for it in normalized_items:
        dbk = make_safe_key(it["name"])
        items_for_db[dbk] = {"display_name": it["name"], "crates": int(it["crates"]), "price": float(it["price"])}
    sale = {
        "id": str(uuid.uuid4()),
        "salesman": salesman,
        "date": data.get("date") or datetime.date.today().strftime("%Y-%m-%d"),
        "place": place,
        "customer": customer,
        "items": items_for_db,
        "crates_total": crates_total,
        "sales_total": sales_total,
        "payments": {"cash": cash_total, "banks": banks_safe},
        "paid_total": cash_total + sum(v.get("amount", 0) for v in banks_safe.values()),
        "invoice_total": invoice_total,
        "difference": round((cash_total + sum(v.get("amount",0) for v in banks_safe.values())) - sales_total, 2),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    try:
        save_sale_to_db(sale)
    except Exception as e:
        logging.exception("Error saving sale")
        return jsonify({"error":"failed to save sale","details":str(e)}), 500
    return jsonify({"status":"ok","sale":sale})

@app.route("/api/get_sales")
def api_get_sales():
    start = request.args.get("start"); end = request.args.get("end")
    if not start or not end: return jsonify({"error":"start and end required"}), 400
    try:
        start_date = datetime.datetime.strptime(start, "%Y-%m-%d").date()
        end_date = datetime.datetime.strptime(end, "%Y-%m-%d").date()
    except Exception:
        return jsonify({"error":"bad date format"}), 400
    result = {}; cur = start_date
    while cur <= end_date:
        dstr = cur.strftime("%Y-%m-%d")
        day_sales = root_ref.child("sales").child(dstr).get() or {}
        normalized = []
        for sid, s in (day_sales.items()):
            try: ns = normalize_sale_record(dict(s))
            except: ns = s
            normalized.append(ns)
        result[dstr] = normalized
        cur += datetime.timedelta(days=1)
    return jsonify(result)

@app.route("/api/get_bank_payments")
def api_get_bank_payments():
    start = request.args.get("start"); end = request.args.get("end")
    if not start or not end: return jsonify({"error":"start and end required"}), 400
    try:
        start_date = datetime.datetime.strptime(start, "%Y-%m-%d").date()
        end_date = datetime.datetime.strptime(end, "%Y-%m-%d").date()
    except Exception:
        return jsonify({"error":"bad date format"}), 400
    payments = []; cur = start_date
    while cur <= end_date:
        dstr = cur.strftime("%Y-%m-%d")
        sales = root_ref.child("sales").child(dstr).get() or {}
        for sid, s in sales.items():
            payments_obj = s.get("payments") or {}
            banks = payments_obj.get("banks", {}) or {}
            for _, v in banks.items():
                if isinstance(v, dict):
                    display = v.get("display") or ""
                    amt = float(v.get("amount") or 0)
                    if amt:
                        payments.append({"date": s.get("date"), "place": normalize_place_name(s.get("place")), "bank": display, "amount": amt, "customer": s.get("customer", ""), "salesman": s.get("salesman"), "id": s.get("id")})
            if not banks:
                legacy = payments_obj.get("banks_display") or {}
                for b, amt in legacy.items():
                    if float(amt or 0) != 0:
                        payments.append({"date": s.get("date"), "place": normalize_place_name(s.get("place")), "bank": b, "amount": float(amt or 0), "customer": s.get("customer",""), "salesman": s.get("salesman"), "id": s.get("id")})
        cur += datetime.timedelta(days=1)
    payments.sort(key=lambda x: (x["date"], x["amount"]), reverse=False)
    return jsonify({"payments": payments})

@app.route("/api/my_sales")
@login_required
@role_required(["van","dataman","owner"])
def api_my_sales():
    u = current_user() or {}
    date = request.args.get("date") or datetime.date.today().strftime("%Y-%m-%d")
    sales_for_day = root_ref.child("sales").child(date).get() or {}
    result = []; username = (u.get("username") or "").strip()
    user_record = get_user(username) or {}
    full_name = (user_record.get("full_name") or "").strip()
    uname_l = username.lower(); full_l = full_name.lower()
    cfg_salesmen = (root_ref.child("config").child("salesmen").get() or []) or []
    cfg_salesmen_l = [str(x).lower() for x in cfg_salesmen if x]
    for sid, s in sales_for_day.items():
        try: ns = normalize_sale_record(dict(s))
        except: ns = s
        if u.get("role") in ("owner","dataman"):
            result.append(ns); continue
        salesman_field = (ns.get("salesman") or "").strip(); sf_l = salesman_field.lower()
        matched = False
        if uname_l and uname_l in sf_l: matched = True
        if not matched and full_l and full_l in sf_l: matched = True
        if not matched:
            for entry in cfg_salesmen_l:
                if uname_l and uname_l in entry and entry in sf_l:
                    matched = True; break
        if matched: result.append(ns)
    return jsonify({"date": date, "sales": result})

# ---------- Versioned reports base ----------
def reports_base_ref():
    return root_ref.child("daily_reports")

def make_version_id():
    return uuid.uuid4().hex

def save_report_version(date: str, place: str, version_obj: dict):
    ref = reports_base_ref().child(date).child(place).child("versions").child(version_obj["id"])
    ref.set(version_obj)

# ---------- Bank-entry endpoints ----------
@app.route("/api/reports/<date>/<place>/bank_entry", methods=["POST"])
@login_required
@role_required(["van","dataman","owner"])
def add_bank_entry(date, place):
    user = current_user()
    data = request.json or {}
    bank = (data.get("bank") or "").strip()
    try:
        amount = float(data.get("amount") or 0)
    except Exception:
        return jsonify({"error": "invalid amount"}), 400
    if not bank or amount <= 0:
        return jsonify({"error": "bank and positive amount required"}), 400
    place = normalize_place_name(place)
    if user.get("role") == "van":
        if normalize_place_name(user.get("place")) != place:
            return jsonify({"error": "van users may only add entries for their assigned place"}), 403
    entry_id = uuid.uuid4().hex
    entry_obj = {
        "id": entry_id,
        "created_by": user["username"],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "bank": bank,
        "amount": round(amount, 2),
        "customer": data.get("customer", ""),
        "items": data.get("items") or {},
        "consumed_by": ""
    }
    ref = reports_base_ref().child(date).child(place).child("bank_entries").child(entry_id)
    try:
        ref.set(entry_obj)
    except Exception as e:
        logging.exception("Failed to save bank entry")
        return jsonify({"error": "failed to save bank entry", "details": str(e)}), 500
    return jsonify({"status": "ok", "entry": entry_obj})

@app.route("/api/reports/<date>/<place>/bank_entries", methods=["GET"])
@login_required
def list_bank_entries(date, place):
    place = normalize_place_name(place)
    node = reports_base_ref().child(date).child(place).child("bank_entries")
    data = node.get() or {}
    entries = sorted(list(data.values()), key=lambda x: x.get("created_at",""))
    return jsonify({"date": date, "place": place, "bank_entries": entries})

@app.route("/api/reports/<date>/<place>/bank_entry/<entry_id>", methods=["DELETE"])
@login_required
def delete_bank_entry(date, place, entry_id):
    user = current_user()
    place = normalize_place_name(place)
    node = reports_base_ref().child(date).child(place).child("bank_entries").child(entry_id)
    entry = node.get()
    if not entry:
        return jsonify({"error": "entry not found"}), 404
    if entry.get("consumed_by"):
        return jsonify({"error": "entry already consumed by a report version"}), 400
    if user.get("role") == "van":
        if normalize_place_name(user.get("place")) != place:
            return jsonify({"error": "van users may only delete entries for their assigned place"}), 403
        if entry.get("created_by") != user["username"]:
            return jsonify({"error": "van may only delete their own entries"}), 403
    try:
        node.delete()
    except Exception as e:
        logging.exception("Failed to delete bank entry")
        return jsonify({"error": "failed to delete", "details": str(e)}), 500
    return jsonify({"status": "ok"})

# ---------- Expenses endpoints ----------
@app.route("/api/reports/<date>/<place>/expenses", methods=["POST"])
@login_required
@role_required(["van","dataman","owner"])
def add_expense(date, place):
    user = current_user()
    data = request.json or {}
    try:
        amount = float(data.get("amount") or 0)
    except Exception:
        return jsonify({"error": "invalid amount"}), 400
    if amount <= 0:
        return jsonify({"error": "positive amount required"}), 400
    description = (data.get("description") or "").strip()
    place = normalize_place_name(place)
    if user.get("role") == "van":
        if normalize_place_name(user.get("place")) != place:
            return jsonify({"error": "van users may only add expenses for their assigned place"}), 403
    exp_id = uuid.uuid4().hex
    exp_obj = {
        "id": exp_id,
        "created_by": user["username"],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "amount": round(amount, 2),
        "description": description,
        "consumed_by": ""
    }
    ref = reports_base_ref().child(date).child(place).child("expenses").child(exp_id)
    try:
        ref.set(exp_obj)
    except Exception as e:
        logging.exception("Failed to save expense")
        return jsonify({"error": "failed to save expense", "details": str(e)}), 500
    return jsonify({"status": "ok", "expense": exp_obj})

@app.route("/api/reports/<date>/<place>/expenses", methods=["GET"])
@login_required
def list_expenses(date, place):
    place = normalize_place_name(place)
    node = reports_base_ref().child(date).child(place).child("expenses")
    data = node.get() or {}
    exps = sorted(list(data.values()), key=lambda x: x.get("created_at",""))
    return jsonify({"date": date, "place": place, "expenses": exps})

@app.route("/api/reports/<date>/<place>/expenses/<exp_id>", methods=["DELETE"])
@login_required
def delete_expense(date, place, exp_id):
    user = current_user()
    place = normalize_place_name(place)
    node = reports_base_ref().child(date).child(place).child("expenses").child(exp_id)
    exp = node.get()
    if not exp:
        return jsonify({"error": "expense not found"}), 404
    if exp.get("consumed_by"):
        return jsonify({"error": "expense already consumed by a report version"}), 400
    if user.get("role") == "van":
        if normalize_place_name(user.get("place")) != place:
            return jsonify({"error": "van users may only delete expenses for their assigned place"}), 403
        if exp.get("created_by") != user["username"]:
            return jsonify({"error": "van may only delete their own expenses"}), 403
    try:
        node.delete()
    except Exception as e:
        logging.exception("Failed to delete expense")
        return jsonify({"error": "failed to delete", "details": str(e)}), 500
    return jsonify({"status": "ok"})

# ---------- submit_totals (create version) ----------
@app.route("/api/reports/<date>/<place>/submit_totals", methods=["POST"])
@login_required
@role_required(["van","dataman","owner"])
def submit_totals(date, place):
    """
    Snapshot current bank_entries & expenses into a version.
    Dataman can later edit that version (PATCH) and finalize (POST finalize).
    """
    user = current_user()
    place = normalize_place_name(place)
    if user.get("role") == "van" and normalize_place_name(user.get("place")) != place:
        return jsonify({"error":"van users may only submit for their assigned place"}), 403

    data = request.json or {}
    items = data.get("items") or {}
    note = data.get("note", "")

    # If items provided, try compute total_sales using price config; otherwise accept total_sales override
    computed_total_sales = None
    if isinstance(items, dict) and items:
        cfg = root_ref.child("config").get() or {}
        price_cfg_db = cfg.get("price_config") or {}
        def get_price_map_for_place(place_name):
            db_place = "Main Store" if place_name == "Store" else place_name
            db_prices = price_cfg_db.get(db_place) or {}
            return translate_price_dict_from_db(db_prices)
        place_price_map = get_price_map_for_place(place)
        store_price_map = get_price_map_for_place("Store")
        total = 0.0
        missing_prices = []
        for display_name, crates in items.items():
            try:
                crates_i = int(crates or 0)
            except Exception:
                return jsonify({"error": f"invalid crates for item {display_name}"}), 400
            price = None
            if isinstance(place_price_map, dict):
                p = place_price_map.get(display_name)
                if p is not None: price = p
            if price is None and isinstance(store_price_map, dict):
                p = store_price_map.get(display_name)
                if p is not None: price = p
            if price is None:
                missing_prices.append(display_name)
            else:
                total += crates_i * float(price)
        if missing_prices:
            return jsonify({"error":"missing prices for items", "missing": missing_prices}), 400
        computed_total_sales = round(total, 2)

    if computed_total_sales is None:
        try:
            total_sales = float(data.get("total_sales") or 0)
        except Exception:
            return jsonify({"error":"invalid total_sales"}), 400
    else:
        total_sales = computed_total_sales

    # snapshot bank entries & expenses
    be_node = reports_base_ref().child(date).child(place).child("bank_entries")
    entries_map = be_node.get() or {}
    bank_entries_list = list(entries_map.values())
    bank_total = round(sum(float(e.get("amount") or 0) for e in bank_entries_list), 2)

    exp_node = reports_base_ref().child(date).child(place).child("expenses")
    exps_map = exp_node.get() or {}
    expenses_list = list(exps_map.values())
    expenses_total = round(sum(float(e.get("amount") or 0) for e in expenses_list), 2)

    # cash override optional
    cash_override = data.get("cash_total")
    if cash_override is not None:
        try: cash_total = round(float(cash_override), 2)
        except Exception: return jsonify({"error":"invalid cash_total override"}), 400
    else:
        cash_total = round(total_sales - bank_total - expenses_total, 2)

    # build items_for_db
    items_for_db = {}
    crates_total = 0
    if isinstance(items, dict) and items:
        for display_name, crates in items.items():
            try: crates_i = int(crates or 0)
            except Exception: crates_i = 0
            dbk = make_safe_key(display_name)
            items_for_db[dbk] = {"display_name": display_name, "crates": crates_i}
            crates_total += crates_i

    version_id = make_version_id()
    version_obj = {
        "id": version_id,
        "created_by": user["username"],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "prev_version": data.get("prev_version", ""),
        "status": "pending_verification",
        "bank_entries": bank_entries_list,
        "bank_total": bank_total,
        "expenses": expenses_list,
        "expenses_total": expenses_total,
        "cash_total": cash_total,
        "items": items_for_db,
        "crates_total": crates_total,
        "total_sales": round(total_sales, 2),
        "note": note
    }

    try:
        versions_node = reports_base_ref().child(date).child(place).child("versions")
        versions_node.child(version_id).set(version_obj)
        # mark bank entries/expenses consumed by this version
        for eid in entries_map.keys():
            try: be_node.child(eid).update({"consumed_by": version_id})
            except Exception: logging.exception("Failed to mark bank entry consumed: %s", eid)
        for exid in exps_map.keys():
            try: exp_node.child(exid).update({"consumed_by": version_id})
            except Exception: logging.exception("Failed to mark expense consumed: %s", exid)
    except Exception as e:
        logging.exception("Failed to save report version")
        return jsonify({"error":"failed to save version", "details": str(e)}), 500

    return jsonify({"status":"ok", "version": version_obj, "computed_total_sales": computed_total_sales})

# ---------- Create correction (dataman) ----------
@app.route("/api/reports/<date>/<place>/correction", methods=["POST"])
@login_required
@role_required("dataman")
def create_correction(date, place):
    """
    Dataman can create a correction version — provide items map or total_sales, optional bank_entries/expenses lists.
    Body example:
    {
      "items": {"HARAR ...": 10, ...},        # optional
      "total_sales": 40520,                   # optional if items present or used directly
      "cash_total": 370,                      # optional
      "bank_entries": [{"bank":"Awash","amount":100}, ...],  # optional
      "expenses": [{"description":"fuel","amount":50}, ...], # optional
      "note": "correction after recount",
      "prev_version": ""                       # optional
    }
    """
    user = current_user()
    place = normalize_place_name(place)
    data = request.json or {}
    items = data.get("items") or {}
    note = data.get("note", "")
    bank_entries = data.get("bank_entries") or []
    expenses = data.get("expenses") or []

    # compute total_sales from items if provided
    computed_total_sales = None
    if isinstance(items, dict) and items:
        cfg = root_ref.child("config").get() or {}
        price_cfg_db = cfg.get("price_config") or {}
        def get_price_map_for_place(place_name):
            db_place = "Main Store" if place_name == "Store" else place_name
            db_prices = price_cfg_db.get(db_place) or {}
            return translate_price_dict_from_db(db_prices)
        place_price_map = get_price_map_for_place(place)
        store_price_map = get_price_map_for_place("Store")
        total = 0.0
        missing = []
        for display_name, crates in items.items():
            try: crates_i = int(crates or 0)
            except: return jsonify({"error": f"invalid crates for {display_name}"}), 400
            price = None
            if isinstance(place_price_map, dict):
                p = place_price_map.get(display_name)
                if p is not None: price = p
            if price is None and isinstance(store_price_map, dict):
                p = store_price_map.get(display_name)
                if p is not None: price = p
            if price is None:
                missing.append(display_name)
            else:
                total += crates_i * float(price)
        if missing:
            computed_total_sales = None
        else:
            computed_total_sales = round(total, 2)

    if computed_total_sales is None:
        try:
            total_sales = float(data.get("total_sales") or 0)
        except Exception:
            return jsonify({"error":"invalid total_sales"}), 400
    else:
        total_sales = computed_total_sales

    # totals for bank / expenses (sum arrays if provided)
    bank_total = round(sum(float(b.get("amount") or 0) for b in bank_entries), 2)
    expenses_total = round(sum(float(e.get("amount") or 0) for e in expenses), 2)

    cash_override = data.get("cash_total")
    if cash_override is not None:
        try: cash_total = round(float(cash_override), 2)
        except Exception: return jsonify({"error":"invalid cash_total override"}), 400
    else:
        cash_total = round(total_sales - bank_total - expenses_total, 2)

    # items_for_db
    items_for_db = {}
    crates_total = 0
    if isinstance(items, dict) and items:
        for display_name, crates in items.items():
            try: crates_i = int(crates or 0)
            except: crates_i = 0
            dbk = make_safe_key(display_name)
            items_for_db[dbk] = {"display_name": display_name, "crates": crates_i}
            crates_total += crates_i

    version_id = make_version_id()
    version_obj = {
        "id": version_id,
        "created_by": user["username"],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "prev_version": data.get("prev_version", ""),
        "status": "pending_verification",
        "bank_entries": bank_entries,
        "bank_total": bank_total,
        "expenses": expenses,
        "expenses_total": expenses_total,
        "cash_total": cash_total,
        "items": items_for_db,
        "crates_total": crates_total,
        "total_sales": round(total_sales, 2),
        "note": note
    }

    try:
        reports_base_ref().child(date).child(place).child("versions").child(version_id).set(version_obj)
    except Exception as e:
        logging.exception("Failed to save correction version")
        return jsonify({"error":"failed to save correction", "details": str(e)}), 500

    return jsonify({"status":"ok", "version": version_obj})

# ---------- List versions for a date/place ----------
@app.route("/api/reports/<date>/<place>", methods=["GET"])
@login_required
def list_versions_and_summary(date, place):
    """
    Returns: { versions: [...], summary: {...} }
    Versions is a list (possibly empty) of version objects sorted by created_at desc.
    Summary is a computed place/day summary (uses compute_place_day_summary).
    """
    place = normalize_place_name(place)
    versions_map = reports_base_ref().child(date).child(place).child("versions").get() or {}
    versions = list(versions_map.values()) if isinstance(versions_map, dict) else (versions_map or [])
    # sort descending by created_at
    try:
        versions = sorted(versions, key=lambda x: x.get("created_at",""), reverse=True)
    except Exception:
        pass
    summary = compute_place_day_summary(date, place)
    return jsonify({"versions": versions, "summary": summary})

# ---------- Edit & Finalize endpoints (dataman) ----------
@app.route("/api/reports/<date>/<place>/versions/<version_id>", methods=["PATCH"])
@login_required
@role_required("dataman")
def edit_report_version(date, place, version_id):
    user = current_user()
    place = normalize_place_name(place)
    version_ref = reports_base_ref().child(date).child(place).child("versions").child(version_id)
    version = version_ref.get()
    if not version:
        return jsonify({"error":"version not found"}), 404
    if str(version.get("status") or "").lower() == "finalized":
        return jsonify({"error":"version already finalized and cannot be edited"}), 400

    data = request.json or {}
    items_in = data.get("items")
    note = (data.get("note") or "").strip()
    total_sales_override = data.get("total_sales", None)
    cash_override = data.get("cash_total", None)

    items_for_db = version.get("items") or {}
    crates_total = version.get("crates_total", 0)
    computed_total_sales = None

    if isinstance(items_in, dict) and items_in:
        new_items = {}
        crates_sum = 0
        for display_name, crates in items_in.items():
            try: crates_i = int(crates or 0)
            except: crates_i = 0
            dbk = make_safe_key(display_name)
            new_items[dbk] = {"display_name": display_name, "crates": crates_i}
            crates_sum += crates_i
        items_for_db = new_items
        crates_total = crates_sum

        # try compute total_sales via price_config; if missing prices, skip computed_total_sales
        cfg = root_ref.child("config").get() or {}
        price_cfg_db = cfg.get("price_config") or {}
        def get_price_map_for_place(place_name):
            db_place = "Main Store" if place_name == "Store" else place_name
            db_prices = price_cfg_db.get(db_place) or {}
            return translate_price_dict_from_db(db_prices)
        place_price_map = get_price_map_for_place(place)
        store_price_map = get_price_map_for_place("Store")
        total_calc = 0.0; missing = []
        for dbk, it in items_for_db.items():
            display = it.get("display_name") or DB_KEY_TO_DISPLAY.get(dbk, dbk)
            crates_i = int(it.get("crates") or 0)
            price = None
            if isinstance(place_price_map, dict):
                p = place_price_map.get(display)
                if p is not None: price = p
            if price is None and isinstance(store_price_map, dict):
                p = store_price_map.get(display)
                if p is not None: price = p
            if price is None:
                missing.append(display)
            else:
                total_calc += crates_i * float(price)
        if not missing:
            computed_total_sales = round(total_calc, 2)

    # resolve total_sales
    if computed_total_sales is not None:
        total_sales_final = computed_total_sales
    elif total_sales_override is not None:
        try: total_sales_final = round(float(total_sales_override), 2)
        except Exception: return jsonify({"error":"invalid total_sales override"}), 400
    else:
        total_sales_final = float(version.get("total_sales") or 0)

    # cash resolution
    if cash_override is not None:
        try: cash_total_final = round(float(cash_override), 2)
        except Exception: return jsonify({"error":"invalid cash_total override"}), 400
    else:
        bank_total = float(version.get("bank_total") or 0)
        expenses_total = float(version.get("expenses_total") or 0)
        cash_total_final = round(total_sales_final - bank_total - expenses_total, 2)

    patch = {
        "items": items_for_db,
        "crates_total": int(crates_total or 0),
        "total_sales": float(total_sales_final),
        "cash_total": float(cash_total_final),
        "note": note or version.get("note",""),
        "updated_by": user["username"],
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

    try:
        version_ref.update(patch)
    except Exception as e:
        logging.exception("Failed to update version")
        return jsonify({"error":"failed to update version", "details": str(e)}), 500

    updated = version_ref.get()
    return jsonify({"status":"ok", "version": updated})

@app.route("/api/reports/<date>/<place>/versions/<version_id>/finalize", methods=["POST"])
@login_required
@role_required("dataman")
def dataman_finalize_version(date, place, version_id):
    user = current_user()
    place = normalize_place_name(place)
    version_ref = reports_base_ref().child(date).child(place).child("versions").child(version_id)
    version = version_ref.get()
    if not version:
        return jsonify({"error":"version not found"}), 404
    if str(version.get("status") or "").lower() == "finalized":
        return jsonify({"error":"version already finalized"}), 400
    try:
        version_ref.update({
            "status": "finalized",
            "finalized_by": user["username"],
            "finalized_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        })
        return jsonify({"status":"ok", "version_id": version_id})
    except Exception as e:
        logging.exception("Failed to finalize version")
        return jsonify({"error":"failed to finalize", "details": str(e)}), 500

# ---------- Helper: compute place/day summary ----------
# ---------- Helper: compute place/day summary (used by role-aware view) ----------
def _to_list(maybe):
    if maybe is None: return []
    if isinstance(maybe, list): return maybe
    if isinstance(maybe, dict): return list(maybe.values())
    return [maybe]

def compute_place_day_summary(date_str: str, place: str, *, for_role: str = None, username: str = None):
    """
    Build a consistent summary structure for a given date/place.
    Important fix: if a versioned report exists, include the version's bank_entries and expenses
    (they may be stored only inside the version node in some DB shapes).
    """
    place = normalize_place_name(place)
    out = {"date": date_str, "place": place}
    versions = reports_base_ref().child(date_str).child(place).child("versions").get() or {}
    if versions:
        # versions likely a dict of id->version. pick latest by created_at
        try:
            latest = max(versions.values(), key=lambda x: x.get("created_at",""))
        except Exception:
            # defensive fallback: pick any
            latest = list(versions.values())[0]
        # normalize bank_entries & expenses from the version (versions often contain snapshot)
        ver_bank_entries = _to_list(latest.get("bank_entries") or [])
        ver_expenses = _to_list(latest.get("expenses") or [])
        # compute bank_total/expenses_total from the version if present, else fall back to fields
        try:
            ver_bank_total = float(latest.get("bank_total")) if latest.get("bank_total") is not None else round(sum(float(b.get("amount") or 0) for b in ver_bank_entries), 2)
        except Exception:
            ver_bank_total = round(sum(float(b.get("amount") or 0) for b in ver_bank_entries), 2)
        try:
            ver_expenses_total = float(latest.get("expenses_total")) if latest.get("expenses_total") is not None else round(sum(float(e.get("amount") or 0) for e in ver_expenses), 2)
        except Exception:
            ver_expenses_total = round(sum(float(e.get("amount") or 0) for e in ver_expenses), 2)

        out.update({
            "source": "report_version",
            "status": latest.get("status"),
            "created_by": latest.get("created_by"),
            "created_at": latest.get("created_at"),
            "crates_total": latest.get("crates_total", 0),
            "total_sales": float(latest.get("total_sales") or 0),
            "cash_total": float(latest.get("cash_total") or 0),
            "bank_total": ver_bank_total,
            "expenses_total": ver_expenses_total,
            "version": latest,
            # include the actual arrays so frontend can show them directly
            "bank_entries": ver_bank_entries,
            "expenses": ver_expenses,
            "bank_total_calculated": round(ver_bank_total, 2),
            "expenses_total_calculated": round(ver_expenses_total, 2),
            "cash_total_computed": round(float(latest.get("cash_total") or (float(latest.get("total_sales") or 0) - ver_bank_total - ver_expenses_total)), 2)
        })
    else:
        # fallback: aggregate from raw sales & top-level bank_entries/expenses nodes
        sales_for_day = root_ref.child("sales").child(date_str).get() or {}
        crates_total = 0
        total_sales = 0.0
        cash_total = 0.0
        bank_total = 0.0
        sales_list = []
        for sid, s in (sales_for_day.items()):
            sale_place = normalize_place_name(s.get("place"))
            if sale_place != place:
                continue
            if for_role == "van" and username:
                sm = (s.get("salesman") or "").strip().lower()
                if username.lower() not in sm and not sm.startswith(username.lower()):
                    continue
            items = s.get("items") or {}
            for ik, idet in items.items():
                crates = 0
                if isinstance(idet, dict):
                    crates = int((idet.get("crates") or 0) or 0)
                else:
                    try:
                        crates = int(idet or 0)
                    except Exception:
                        crates = 0
                crates_total += crates
            try:
                total_sales += float(s.get("sales_total") or 0)
            except Exception:
                pass
            try:
                cash_total += float((s.get("payments") or {}).get("cash") or 0)
            except Exception:
                pass
            payments = s.get("payments") or {}
            banks = payments.get("banks") or {}
            for k, v in (banks.items() if isinstance(banks, dict) else []):
                if isinstance(v, dict):
                    amt = float(v.get("amount") or 0)
                    if amt:
                        bank_total += amt
                else:
                    try:
                        amt = float(v or 0)
                        if amt:
                            bank_total += amt
                    except Exception:
                        pass
            sales_list.append(s)
        out.update({
            "source": "sales_fallback",
            "status": None,
            "created_by": None,
            "created_at": None,
            "crates_total": crates_total,
            "total_sales": round(total_sales, 2),
            "cash_total": round(cash_total, 2),
            "bank_total": round(bank_total, 2),
            "sales": sales_list
        })
    # read top-level bank_entries/expenses when versions absent OR when role requires (van may want only their entries)
    if out.get("source") != "report_version":
        be_node = reports_base_ref().child(date_str).child(place).child("bank_entries")
        be_map = be_node.get() or {}
        be_list = list(be_map.values())
    else:
        # already populated from version
        be_list = out.get("bank_entries") or []
    if for_role == "van" and username:
        be_list = [b for b in be_list if (b.get("created_by") or "").lower() == username.lower()]
    out["bank_entries"] = sorted(be_list, key=lambda x: x.get("created_at",""))
    out["bank_total_calculated"] = round(sum(float(b.get("amount") or 0) for b in out["bank_entries"]), 2)

    if out.get("source") != "report_version":
        exp_node = reports_base_ref().child(date_str).child(place).child("expenses")
        exp_map = exp_node.get() or {}
        exp_list = list(exp_map.values())
    else:
        exp_list = out.get("expenses") or []
    if for_role == "van" and username:
        exp_list = [e for e in exp_list if (e.get("created_by") or "").lower() == username.lower()]
    out["expenses"] = sorted(exp_list, key=lambda x: x.get("created_at",""))
    out["expenses_total_calculated"] = round(sum(float(e.get("amount") or 0) for e in out["expenses"]), 2)

    if "cash_total" not in out or out.get("cash_total") is None:
        out["cash_total_computed"] = round(out.get("total_sales", 0) - out.get("bank_total_calculated", 0) - out.get("expenses_total_calculated", 0), 2)
    else:
        out["cash_total_computed"] = out.get("cash_total")
    return out

# ---------- Role-aware report view endpoint ----------
@app.route("/api/reports/view", methods=["GET"])
@login_required
def api_reports_view():
    u = current_user()
    if not u: return jsonify({"error":"auth required"}), 401
    role = u.get("role"); username = u.get("username") or ""
    start = request.args.get("start"); end = request.args.get("end")
    if not start or not end: return jsonify({"error":"start and end required"}), 400
    try:
        start_date = datetime.datetime.strptime(start, "%Y-%m-%d").date()
        end_date = datetime.datetime.strptime(end, "%Y-%m-%d").date()
    except Exception:
        return jsonify({"error":"bad date format"}), 400

    if role == "van":
        user_db = get_user(username) or {}
        assigned = normalize_place_name(user_db.get("place") or u.get("place") or "")
        if not assigned: return jsonify({"error":"van user has no assigned place"}), 400
        places_to_show = [assigned]
    elif role == "dataman":
        places_to_show = ["Store", "Van 2", "Van 3", "Dawa", "Shet"]
    else:
        param_places = request.args.get("places")
        if param_places:
            places_to_show = [normalize_place_name(p.strip()) for p in param_places.split(",") if p.strip()]
        else:
            places_to_show = PLACES.copy()

    result = {}
    cur = start_date
    while cur <= end_date:
        dstr = cur.strftime("%Y-%m-%d")
        result[dstr] = {}
        for place in places_to_show:
            if role == "van":
                summary = compute_place_day_summary(dstr, place, for_role="van", username=username)
            else:
                summary = compute_place_day_summary(dstr, place, for_role=None, username=None)
            result[dstr][place] = summary
        cur += datetime.timedelta(days=1)
    return jsonify({"start": start, "end": end, "role": role, "places": places_to_show, "summary": result})

# ---------- Owner day summary ----------
@app.route("/api/owner/day_summary")
@login_required
@role_required("owner")
def api_owner_day_summary():
    date = request.args.get("date") or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    result = {}; bank_details = []
    for place in PLACES:
        sales = root_ref.child("sales").child(date).get() or {}
        bank_total = 0.0; raw_bank_items = []; sales_sum_from_raw = 0.0
        for sid, s in (sales.items()):
            sale_place = normalize_place_name(s.get("place"))
            if sale_place != place: continue
            try: sales_sum_from_raw += float(s.get("sales_total") or 0)
            except: pass
            payments = s.get("payments") or {}
            banks = payments.get("banks") or {}
            if banks:
                for bk, bv in banks.items():
                    if isinstance(bv, dict):
                        display = bv.get("display") or bk
                        amt = float(bv.get("amount") or 0)
                        if amt:
                            bank_total += amt
                            raw_bank_items.append({"date": s.get("date"), "place": sale_place, "bank": display, "amount": amt, "customer": s.get("customer",""), "salesman": s.get("salesman"), "sale_id": s.get("id")})
                    else:
                        try: amt = float(bv or 0)
                        except: amt = 0.0
                        if amt:
                            bank_total += amt
                            raw_bank_items.append({"date": s.get("date"), "place": sale_place, "bank": bk, "amount": amt, "customer": s.get("customer",""), "salesman": s.get("salesman"), "sale_id": s.get("id")})
            else:
                legacy = payments.get("banks_display") or {}
                for b, amt in legacy.items():
                    try: a = float(amt or 0)
                    except: a = 0.0
                    if a:
                        bank_total += a
                        raw_bank_items.append({"date": s.get("date"), "place": sale_place, "bank": b, "amount": a, "customer": s.get("customer",""), "salesman": s.get("salesman"), "sale_id": s.get("id")})
        versions = reports_base_ref().child(date).child(place).child("versions").get() or {}
        if versions:
            latest = max(versions.values(), key=lambda x: x.get("created_at",""))
            reported_total = float(latest.get("total_sales") or 0)
            reported_source = "version"
        else:
            reported_total = round(sales_sum_from_raw, 2)
            reported_source = "raw_sales"
        cash_total = round(reported_total - bank_total, 2)
        result[place] = {"date": date, "reported_total": round(reported_total, 2), "bank_total": round(bank_total, 2), "cash_total": cash_total, "reported_source": reported_source}
        bank_details.extend(raw_bank_items)
    bank_details = sorted(bank_details, key=lambda x: (x["place"], -x["amount"]))
    return jsonify({"date": date, "places": result, "bank_details": bank_details})

# ---------- Reporting endpoints (placeholders) ----------
@app.route("/report/pdf")
@login_required
@role_required(["owner","dataman"])
def report_pdf():
    if not REPORTLAB_AVAILABLE:
        return ("PDF generation disabled: install reportlab", 503)
    start = request.args.get("start"); end = request.args.get("end")
    if not start or not end: return "start and end required (YYYY-MM-DD)", 400
    return ("PDF generation not shown here", 200)

@app.route("/report/csv")
@login_required
@role_required(["owner","dataman"])
def report_csv():
    return ("CSV endpoint present - use prior implementation", 200)

# ---------- Front-end routes ----------
# Replace the index() route at the bottom of your app.py with this function

# ---------- Front-end routes ----------
@app.route("/")
def index():
    u = current_user()
    if u:
        # owner -> owner dashboard
        if u.get("role") == "owner":
            return redirect(url_for("owner_dashboard"))
        # dataman and van should be able to register sales (index is sales registration form)
        if u.get("role") in ("dataman", "van"):
            return render_template("index.html", items=ITEMS, banks=BANKS, places=PLACES)
    # unauthenticated users and others see sales entry as a starting page
    return render_template("index.html", items=ITEMS, banks=BANKS, places=PLACES)

@app.route("/sales")
def sales_list_page():
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    return render_template("sales_list.html", today=today, places=PLACES)

if __name__ == "__main__":
    # Disable reloader to avoid double initialization and extra DB probes during development
    app.run(debug=True, port=5000, use_reloader=False)