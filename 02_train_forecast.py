import warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path
from statsmodels.tsa.statespace.sarimax import SARIMAX
from sklearn.metrics import mean_absolute_error, mean_squared_error

warnings.filterwarnings("ignore")

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "monthly_timeseries.csv"
OUT_DIR = BASE_DIR / "outputs"
FORECAST_HORIZON = 24 

VARIABLES = {
    "temp_max_C":        {"order": (1, 0, 1), "seasonal_order": (1, 1, 1, 12)},
    "temp_min_C":        {"order": (1, 0, 1), "seasonal_order": (1, 1, 1, 12)},
    "precip_mm":         {"order": (1, 0, 1), "seasonal_order": (0, 1, 1, 12)},
    "rel_humidity_pct":  {"order": (1, 0, 0), "seasonal_order": (1, 1, 1, 12)},
    "sun_hours":         {"order": (1, 0, 0), "seasonal_order": (1, 1, 1, 12)},
}


def load_data():
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Data file not found: {DATA_PATH}. Run the data preparation 01_prepare_data.py first."
        )
    df = pd.read_csv(DATA_PATH, parse_dates=["date"], index_col="date")
    df = df.asfreq("MS") 
    df = df.interpolate(method="time", limit_direction="both")
    return df


def backtest(series, order, seasonal_order, test_months=12):
    """Hold out the last `test_months` to check forecast accuracy."""
    train, test = series.iloc[:-test_months], series.iloc[-test_months:]
    model = SARIMAX(train, order=order, seasonal_order=seasonal_order,
                     enforce_stationarity=False, enforce_invertibility=False)
    fit = model.fit(disp=False)
    pred = fit.get_forecast(steps=test_months).predicted_mean
    mae = mean_absolute_error(test, pred)
    rmse = np.sqrt(mean_squared_error(test, pred))
    return mae, rmse


def main():
    df = load_data()
    results_summary = []

    fig, axes = plt.subplots(len(VARIABLES), 1, figsize=(11, 4 * len(VARIABLES)))

    forecast_table = None

    for i, (var, cfg) in enumerate(VARIABLES.items()):
        series = df[var].dropna()
        order, seasonal_order = cfg["order"], cfg["seasonal_order"]

        mae, rmse = backtest(series, order, seasonal_order, test_months=12)

        model = SARIMAX(series, order=order, seasonal_order=seasonal_order,
                         enforce_stationarity=False, enforce_invertibility=False)
        fit = model.fit(disp=False)
        fc = fit.get_forecast(steps=FORECAST_HORIZON)
        mean_fc = fc.predicted_mean
        ci = fc.conf_int(alpha=0.2) 

        results_summary.append({
            "variable": var, "MAE": round(mae, 2), "RMSE": round(rmse, 2),
            "unit_context": "lower is better; compare to variable's typical range",
        })

        col_df = pd.DataFrame({
            var: mean_fc,
            f"{var}_lower80": ci.iloc[:, 0],
            f"{var}_upper80": ci.iloc[:, 1],
        })
        forecast_table = col_df if forecast_table is None else forecast_table.join(col_df, how="outer")

        ax = axes[i]
        ax.plot(series.index, series.values, label="Historical", color="#2c6e91")
        ax.plot(mean_fc.index, mean_fc.values, label="Forecast", color="#d1495b")
        ax.fill_between(mean_fc.index, ci.iloc[:, 0], ci.iloc[:, 1],
                 color="#d1495b", alpha=0.15, label="80% interval")
        ax.set_title(f"{var} - Addis Ababa | backtest MAE={mae:.2f}, RMSE={rmse:.2f}")
        ax.legend(loc="upper left", fontsize=8)
        ax.grid(alpha=0.3)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(OUT_DIR / "forecast_charts.png", dpi=150)
    print(f"Saved chart -> {OUT_DIR / 'forecast_charts.png'}")

    forecast_table.index.name = "date"
    forecast_table.to_csv(OUT_DIR / f"forecast_{FORECAST_HORIZON}months.csv")
    print(f"Saved forecast table -> {OUT_DIR / f'forecast_{FORECAST_HORIZON}months.csv'}")

    summary_df = pd.DataFrame(results_summary)
    summary_df.to_csv(OUT_DIR / "model_accuracy_summary.csv", index=False)
    print("\nBacktest accuracy (last 12 real months held out):")
    print(summary_df.to_string(index=False))


if __name__ == "__main__":
    main()
