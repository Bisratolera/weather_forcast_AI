"""
WeatherForecastAI backend
--------------------------
Serves the Addis Ababa historical monthly weather record and the 24-month
SARIMAX forecast (produced by 01_prepare_data.py / 02_train_forecast.py)
as a small JSON API, and hosts the static frontend that visualizes it.

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000 in a browser.
"""
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

HISTORICAL_PATH = DATA_DIR / "monthly_timeseries.csv"
FORECAST_PATH = DATA_DIR / "forecast_24months.csv"
ACCURACY_PATH = DATA_DIR / "model_accuracy_summary.csv"

LOCATION = {
    "name": "Addis Ababa",
    "country": "Ethiopia",
    "latitude": 9.03,
    "longitude": 38.74,
    "elevation_m": 2355,
}

SEASONS = {
    1: "Bega (dry)", 2: "Bega (dry)",
    3: "Belg (short rains)", 4: "Belg (short rains)", 5: "Belg (short rains)",
    6: "Kiremt (main rains)", 7: "Kiremt (main rains)",
    8: "Kiremt (main rains)", 9: "Kiremt (main rains)",
    10: "Bega (dry)", 11: "Bega (dry)", 12: "Bega (dry)",
}

VARIABLE_META = {
    "temp_max_C": {"label": "Max Temperature", "unit": "\u00b0C"},
    "temp_min_C": {"label": "Min Temperature", "unit": "\u00b0C"},
    "precip_mm": {"label": "Precipitation", "unit": "mm"},
    "rel_humidity_pct": {"label": "Relative Humidity", "unit": "%"},
    "sun_hours": {"label": "Sunshine", "unit": "hrs/day"},
}

app = Flask(__name__)
CORS(app)


def _clean(records):
    """Replace NaN/NaT with None so the payload is valid JSON."""
    return [
        {k: (None if (isinstance(v, float) and np.isnan(v)) else v) for k, v in row.items()}
        for row in records
    ]


def load_historical():
    df = pd.read_csv(HISTORICAL_PATH, parse_dates=["date"])
    df = df.sort_values("date")
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    df["season"] = df["date"].apply(lambda d: SEASONS[int(d[5:7])])
    if "wind_speed" in df.columns:
        df = df.drop(columns=["wind_speed"])  # <5% coverage, not usable
    return _clean(df.to_dict(orient="records"))


def load_forecast():
    df = pd.read_csv(FORECAST_PATH, parse_dates=["date"])
    df = df.sort_values("date")
    historical_dates = pd.read_csv(HISTORICAL_PATH, parse_dates=["date"])["date"]
    if not historical_dates.empty:
        df = df[df["date"] > historical_dates.max()]
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    df["season"] = df["date"].apply(lambda d: SEASONS[int(d[5:7])])
    return _clean(df.to_dict(orient="records"))


def load_accuracy():
    df = pd.read_csv(ACCURACY_PATH)
    records = df.to_dict(orient="records")
    for r in records:
        meta = VARIABLE_META.get(r["variable"], {})
        r["label"] = meta.get("label", r["variable"])
        r["unit"] = meta.get("unit", "")
    return records


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/location")
def location():
    return jsonify(LOCATION)


@app.get("/api/historical")
def historical():
    return jsonify(load_historical())


@app.get("/api/forecast")
def forecast():
    return jsonify(load_forecast())


@app.get("/api/accuracy")
def accuracy():
    return jsonify(load_accuracy())


@app.get("/api/variables")
def variables():
    return jsonify(VARIABLE_META)


@app.get("/api/summary")
def summary():
    """A single payload combining the latest observed month, the next
    forecast month, and model accuracy - built for the dashboard header."""
    hist = load_historical()
    fc = load_forecast()
    acc = load_accuracy()

    latest_observed = hist[-1] if hist else None
    next_forecast = fc[0] if fc else None

    return jsonify(
        {
            "location": LOCATION,
            "latest_observed": latest_observed,
            "next_forecast": next_forecast,
            "accuracy": acc,
            "history_range": {
                "start": hist[0]["date"] if hist else None,
                "end": hist[-1]["date"] if hist else None,
                "months": len(hist),
            },
            "forecast_range": {
                "start": fc[0]["date"] if fc else None,
                "end": fc[-1]["date"] if fc else None,
                "months": len(fc),
            },
        }
    )


@app.get("/api/combined")
def combined():
    """Historical + forecast stitched into one series per variable, handy
    for drawing a single continuous chart with a 'today' divider."""
    hist = load_historical()
    fc = load_forecast()
    return jsonify({"historical": hist, "forecast": fc})


@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:filename>")
def frontend_assets(filename):
    return send_from_directory(FRONTEND_DIR, filename)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
