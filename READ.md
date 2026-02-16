# Achameyelesh Chefo — Sales Recording System

Simple Flask app to record daily sales and generate PDF reports (crate counts and totals). Uses Firebase Realtime Database as the backend.

Important: Do NOT commit your Firebase service account JSON file into source control.

## Setup

1. Create and activate a virtual environment (recommended)
Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

If you don't need PDF generation, you can omit `reportlab`.

3. Place your Firebase service account JSON in the project (don't commit it).
Set environment variables (PowerShell example):
```powershell
$env:FIREBASE_CREDENTIAL_PATH = "$PWD\ethiostore-17d9f-firebase-adminsdk-5e87k-ff766d2648.json"
$env:FIREBASE_DB_URL = "https://ethiostore-17d9f-default-rtdb.firebaseio.com/"
```
Or copy/rename the JSON to `serviceAccountKey.json` in the project root (quick test only).

4. Run:
```bash
python app.py
```

Open http://127.0.0.1:5000

## Notes
- Dawa and Shet prices are editable at the time of recording (flexible pricing).
- All sales are stored under `/sales/YYYY-MM-DD/{id}` in Firebase RTDB.
- If reportlab is not installed, the /report/pdf route returns a helpful message and the rest of the app will still work.
- Secure your service account JSON and add it to `.gitignore`.
