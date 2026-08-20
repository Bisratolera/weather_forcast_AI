# Weather Forecast AI - Project Documentation

## 1. Project Overview

This project is a weather forecasting dashboard for Addis Ababa, Ethiopia. It uses historical monthly climate observations to train seasonal ARIMA models and displays the resulting 24-month forecast in a browser dashboard.

The system has four main responsibilities:

1. Prepare raw climate observations into a monthly time series.
2. Train one SARIMAX model for each weather variable.
3. Serve historical data, forecast data, and accuracy metrics through a Flask API.
4. Render an interactive dashboard with HTML, CSS, and vanilla JavaScript.

The forecast variables are:

| Variable | Meaning | Unit |
|---|---|---|
| `temp_max_C` | Monthly maximum temperature | deg C |
| `temp_min_C` | Monthly minimum temperature | deg C |
| `precip_mm` | Monthly precipitation | mm |
| `rel_humidity_pct` | Relative humidity | percent |
| `sun_hours` | Sunshine duration | hours/day |

The dashboard also assigns each month to one of Addis Ababa's three climate seasons:

- **Bega**: dry season
- **Belg**: short rainy season
- **Kiremt**: main rainy season

---

## 2. Repository Structure

```text
weather_forcast_AI/
|
|-- 01_prepare_data.py
|-- 02_train_forecast.py
|-- requirements.txt
|-- Readme.md
|-- forecast_24months.csv
|-- model_accuracy_summary.csv
|-- monthly_timeseries.csv
|
|-- data/
|   |-- raw_data.csv
|   `-- monthly_timeseries.csv
|
|-- backend/
|   |-- app.py
|   `-- data/
|       |-- monthly_timeseries.csv
|       |-- forecast_24months.csv
|       `-- model_accuracy_summary.csv
|
|-- frontend/
|   |-- index.html
|   |-- script.js
|   |-- style.css
|   `-- image.png
|
|-- outputs/
|   |-- forecast_24months.csv
|   |-- model_accuracy_summary.csv
|   `-- forecast_charts.png
|
`-- Documentation/
    `-- PROJECT_DOCUMENTATION.md
```

### Important data-location note

The training script reads the root-level `monthly_timeseries.csv` and writes to `outputs/`. The Flask backend serves files from `backend/data/`.

After generating a new forecast, copy the generated files into the backend data directory:

```powershell
Copy-Item .\outputs\forecast_24months.csv .\backend\data\forecast_24months.csv -Force
Copy-Item .\outputs\model_accuracy_summary.csv .\backend\data\model_accuracy_summary.csv -Force
```

The historical data used for training should also match the historical data served by the backend. Keeping these copies synchronized prevents the dashboard from showing stale dates.

---

## 3. Data Preparation: `01_prepare_data.py`

This script converts raw climate records into one row per month.

### Imports

```python
import pandas as pd
import numpy as np
from pathlib import Path
```

- `pandas` reads, reshapes, groups, and writes tabular data.
- `numpy` is imported for numerical operations and compatibility with the data pipeline.
- `Path` creates operating-system-safe file paths.

### File paths

```python
BASE_DIR = Path(__file__).resolve().parent
RAW_PATH = BASE_DIR / "data/raw_data.csv"
OUT_PATH = BASE_DIR / "data/monthly_timeseries.csv"
```

`BASE_DIR` is the project directory containing the script. The raw input is read from `data/raw_data.csv`, and the prepared output is written to `data/monthly_timeseries.csv`.

### Month definitions

```python
MONTHS = ["Jan", "Feb", ..., "Dec"]
```

The list tells Pandas which columns contain monthly measurements in the raw file.

### `main()` function

The `main()` function performs the full preparation process.

#### Read the raw data

```python
df = pd.read_csv(RAW_PATH)
```

The raw CSV is loaded into a DataFrame.

#### Display available years

```python
print(sorted(df["Year"].unique()))
```

This is a diagnostic check showing which years are present in the source file.

#### Keep Addis Ababa records

```python
df = df[df["Name"] == "Addis Ababa"].copy()
```

The project is location-specific, so all stations except Addis Ababa are removed.

#### Convert wide monthly columns into rows

```python
long_df = df.melt(
    id_vars=["Name", "ELEMENT", "Year", "Time"],
    value_vars=MONTHS,
    var_name="Month",
    value_name="Value",
)
```

The raw data stores January through December as separate columns. `melt()` converts those columns into a normalized format with one measurement per row.

For example:

```text
Before: Year | Jan | Feb | Mar
After:  Year | Month | Value
        2025 | Jan   | 21.3
        2025 | Feb   | 22.1
```

#### Average duplicate monthly readings

```python
monthly = (
    long_df.groupby(["ELEMENT", "Year", "Month"])["Value"]
    .mean()
    .reset_index()
)
```

If multiple observations exist for the same element, year, and month, they are averaged.

#### Convert month names to numbers

```python
month_num = {month: index + 1 for index, month in enumerate(MONTHS)}
monthly["month_num"] = monthly["Month"].map(month_num)
```

This changes `Jan` to `1`, `Feb` to `2`, and so on.

#### Create real dates

```python
monthly["date"] = pd.to_datetime(
    dict(year=monthly["Year"], month=monthly["month_num"], day=1)
)
```

Each monthly record receives a date such as `2025-05-01`. The first day of the month is used as the monthly timestamp.

#### Pivot to one row per date

```python
wide = monthly.pivot_table(
    index="date",
    columns="ELEMENT",
    values="Value",
)
wide = wide.sort_index()
```

The result has one row per month and one column per climate element.

#### Rename climate columns

```python
wide = wide.rename(columns={
    "TMPMAX": "temp_max_C",
    "TMPMIN": "temp_min_C",
    "PRECIP": "precip_mm",
    "RELHUM": "rel_humidity_pct",
    "SUNHRS": "sun_hours",
    "WINDLY": "wind_speed",
})
```

Short source element codes are changed to descriptive names used by the training script, backend, and frontend.

#### Save and report the prepared data

```python
wide.index.name = "date"
wide.to_csv(OUT_PATH)
```

The prepared monthly time series is saved as CSV. The script also prints the row count, date range, missing-value count, and a preview.

### Run the preparation step

```powershell
python .\01_prepare_data.py
```

Run this whenever `data/raw_data.csv` changes.

---

## 4. Forecast Training: `02_train_forecast.py`

This script trains five separate SARIMAX models, evaluates each model with a 12-month backtest, and creates a 24-month forecast.

### Main libraries

- `pandas`: time-series data handling.
- `numpy`: numerical calculations.
- `matplotlib`: saves forecast charts.
- `statsmodels`: provides the `SARIMAX` model.
- `scikit-learn`: calculates MAE and MSE-based RMSE.

### Configuration

```python
DATA_PATH = BASE_DIR / "monthly_timeseries.csv"
OUT_DIR = BASE_DIR / "outputs"
FORECAST_HORIZON = 24
```

The model reads the root-level prepared data and writes generated artifacts to `outputs/`.

### Model definitions

```python
VARIABLES = {
    "temp_max_C": {"order": (1, 0, 1), "seasonal_order": (1, 1, 1, 12)},
    ...
}
```

Each variable has a SARIMAX configuration:

- `order=(p, d, q)` controls non-seasonal autoregression, differencing, and moving average.
- `seasonal_order=(P, D, Q, s)` controls seasonal behavior.
- `s=12` means the model learns a yearly cycle from monthly data.

### `load_data()`

```python
df = pd.read_csv(DATA_PATH, parse_dates=["date"], index_col="date")
df = df.asfreq("MS")
df = df.interpolate(method="time", limit_direction="both")
```

The function:

1. Checks that the prepared input exists.
2. Loads dates as a Pandas time index.
3. Forces a monthly-start frequency (`MS`).
4. Interpolates missing values using time-based interpolation.

### `backtest()`

```python
train, test = series.iloc[:-test_months], series.iloc[-test_months:]
```

The last 12 months are hidden from the model. The model trains on earlier months and predicts the hidden period.

The predicted values are compared with the actual hidden values using:

- **MAE**: mean absolute error.
- **RMSE**: root mean squared error.

Smaller values indicate better average prediction accuracy.

### `main()` training loop

For each configured variable, the script:

1. Removes missing values.
2. Runs the 12-month backtest.
3. Fits a model using all available history.
4. Generates 24 future monthly predictions.
5. Generates an 80% confidence interval.
6. Adds the forecast columns to a combined forecast table.
7. Plots historical values, forecast values, and the confidence band.
8. Stores MAE and RMSE in the accuracy summary.

### Confidence intervals

```python
ci = fc.conf_int(alpha=0.2)
```

`alpha=0.2` leaves an 80% interval because:

```text
confidence = 1 - alpha = 1 - 0.2 = 0.8
```

Each forecast variable produces three columns:

```text
variable
variable_lower80
variable_upper80
```

### Generated files

The script creates:

- `outputs/forecast_24months.csv`: 24 future months and confidence bounds.
- `outputs/model_accuracy_summary.csv`: MAE and RMSE for every variable.
- `outputs/forecast_charts.png`: static diagnostic charts.

### Run the training step

```powershell
python .\02_train_forecast.py
```

The training script currently fixes the plotting label argument and produces the forecast successfully.

---

## 5. Flask Backend: `backend/app.py`

The Flask application serves the data to the browser and hosts the frontend files.

### Paths and metadata

```python
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR.parent / "frontend"
```

Because `app.py` is inside `backend/`, `BASE_DIR.parent` points to the project root.

The backend reads:

- `backend/data/monthly_timeseries.csv`
- `backend/data/forecast_24months.csv`
- `backend/data/model_accuracy_summary.csv`

`LOCATION`, `SEASONS`, and `VARIABLE_META` provide shared location, season, and display metadata.

### Flask and CORS setup

```python
app = Flask(__name__)
CORS(app)
```

Flask creates the web application. CORS permits browser requests from the frontend origin.

### `_clean(records)`

```python
None if (isinstance(value, float) and np.isnan(value)) else value
```

JSON does not support Pandas `NaN` values reliably. This helper converts missing floating-point values to `None`, which becomes JSON `null`.

### `load_historical()`

This function:

1. Reads historical monthly data.
2. Sorts by date.
3. Formats dates as `YYYY-MM-DD`.
4. Adds the Addis Ababa season.
5. Removes `wind_speed` because its coverage is too limited.
6. Returns JSON-ready records.

### `load_forecast()`

This function performs the same formatting for forecasts and additionally applies this rule:

```python
df = df[df["date"] > historical_dates.max()]
```

Only forecast rows after the latest observed historical month are served. This prevents stale or overlapping forecast records from appearing in the dashboard.

### `load_accuracy()`

The accuracy CSV contains model metrics. This function adds a human-readable label and unit to each metric using `VARIABLE_META`.

### API routes

| Route | Purpose |
|---|---|
| `GET /api/health` | Returns service status. |
| `GET /api/location` | Returns Addis Ababa location metadata. |
| `GET /api/historical` | Returns historical monthly observations. |
| `GET /api/forecast` | Returns future forecast months. |
| `GET /api/accuracy` | Returns MAE and RMSE metrics. |
| `GET /api/variables` | Returns variable labels and units. |
| `GET /api/summary` | Returns latest observation, first forecast, accuracy, and date ranges. |
| `GET /api/combined` | Returns historical and forecast arrays together. |
| `GET /` | Serves `frontend/index.html`. |
| `GET /<path:filename>` | Serves frontend assets such as CSS, JavaScript, and images. |

### Run the backend

From the project root:

```powershell
python .\backend\app.py
```

Then open:

```text
http://127.0.0.1:5000/
```

---

## 6. Frontend HTML: `frontend/index.html`

The HTML defines the dashboard structure. Dynamic values are inserted by `script.js`.

### Header

The header contains:

- WFAI branding and logo image.
- A link to the project owner's portfolio.
- Addis Ababa name in English and Amharic.
- Coordinates and elevation.
- SARIMAX model status.

### Now and next forecast panel

The first dashboard panel contains:

1. Last observed month.
2. Current month projected.
3. Next month projected.

Each card has a date and a dynamically generated weather-statistics grid.

### Season strip

The season strip displays one vertical tick per historical and forecast month. Tick colors identify Bega, Belg, and Kiremt.

### Search section

The search section lets users search all observed and projected records by month, year, season, or numeric weather value. Matching records are rendered as compact result cards showing the record type, season, temperatures, rainfall, humidity, and sunshine. No records are shown until a search is entered.

### Chart section

The chart section contains:

- Variable tabs for the five weather variables.
- An SVG chart.
- A hover tooltip.
- A legend for observed values, projected values, and the 80% interval.

### Accuracy section

The accuracy section displays a card per model variable with:

- Variable label.
- MAE.
- Relative visual bar.
- RMSE note.

### About section

The about section explains the data source, SARIMAX method, and confidence intervals.

### Footer

The footer contains:

- Elites Ethiopia logo image.
- Project description.
- Acknowledgement of the Ethiopian Meteorology Institute.
- GitHub icon link to `https://github.com/Bisratolera/weather_forcast_AI`.

---

## 7. Frontend JavaScript: `frontend/script.js`

The frontend uses browser JavaScript without a chart library.

### API configuration

```javascript
const API_BASE = "http://127.0.0.1:5000";
```

All API requests use the Flask server at this address.

### `VARIABLES`

The `VARIABLES` object defines the display label, unit, and color category for each supported variable. It is used by the statistic cards, tabs, chart, and tooltip.

### Application state

```javascript
let state = {
  historical: [],
  forecast: [],
  accuracy: [],
  activeVar: "temp_max_C",
};
```

This object stores the loaded data and the currently selected chart variable.

### `getJSON(path)`

Fetches JSON from the Flask API and throws an error when the response is unsuccessful.

### Formatting helpers

- `fmt()`: formats numeric values and displays an em dash for missing values.
- `monthLabel()`: changes an ISO date into a readable label such as `Aug 2026`.

### `renderNowNext()`

This function fills the observed, current-month forecast, and next-month forecast cards.

The current forecast selection uses the browser's current year and month:

```javascript
const currentIndex = state.forecast.findIndex(
  (row) => row.date.startsWith(currentMonth)
);
```

If the current month is not included in the forecast range, the first available forecast row is used. The next forecast card uses the following row.

### `statTile()`

Creates one weather statistic element using DOM methods rather than raw HTML. It displays values such as:

```text
Max Temp: 22.0 deg C
Rainfall: 279.3 mm
Humidity: 78 percent
```

### `renderSeasonStrip()`

Combines historical and forecast rows, creates one tick per month, assigns its season class, and adds a tooltip title containing the month and season.

### `renderTabs()`

Creates one accessible tab button for each weather variable. Clicking a tab updates `state.activeVar` and redraws the chart.

### `renderChart()`

The chart is drawn manually with SVG. The function:

1. Selects the active variable.
2. Combines observed and forecast dates.
3. Calculates minimum and maximum chart values.
4. Converts data values into SVG coordinates.
5. Draws gridlines and y-axis labels.
6. Draws year markers on the x-axis.
7. Draws the observed line.
8. Draws the forecast line.
9. Draws the 80% confidence polygon.
10. Adds hover and touch interaction.

The historical line is cream-colored. The forecast line and interval use the amber forecast color.

### `drawPolyline()`

Creates an SVG `polyline` from a list of coordinate pairs. It is used for the historical and forecast lines.

### `attachHover()`

Adds a transparent SVG overlay that detects mouse movement and touch movement. The nearest data point is calculated and shown in the tooltip.

### `renderAccuracy()`

Creates accuracy cards from the `/api/accuracy` response. The MAE values are normalized with `referenceScale()` so variables with different units can be compared visually.

### `referenceScale()`

Contains rough typical scales for each variable:

```javascript
const scales = {
  temp_max_C: 5,
  temp_min_C: 5,
  precip_mm: 150,
  rel_humidity_pct: 20,
  sun_hours: 4,
};
```

This affects only the relative width of the visual bars. The displayed MAE and RMSE values remain unchanged.

### `init()`

Loads historical data, forecasts, and accuracy metrics in parallel using `Promise.all()`. Once all requests finish, it renders every dashboard section.

If the API cannot be reached, an error message is added to each main section.

### Resize handling

The chart is redrawn on browser resize so its SVG coordinates remain responsive.

---

## 8. Frontend CSS: `frontend/style.css`

The stylesheet defines the visual system and responsive layout.

### Design tokens

The `:root` block contains reusable CSS variables for:

- Background and raised surfaces.
- Cream text and paper cards.
- Addis Ababa season colors.
- Amber forecast accents.
- Display, body, and monospace fonts.
- Card radius.

Changing a token updates the whole dashboard consistently.

### Global styles

The global rules set box sizing, body typography, background color, text color, focus outlines, and reduced-motion behavior.

### Sky band

`.sky-band` creates the animated seasonal color strip at the top of the page. Its gradient cycles through Bega blue, Belg green, and Kiremt teal.

### Masthead and branding

The masthead uses a flexible layout. The logo image is styled with `.header-logo`. The title uses Fraunces, while coordinates and model metadata use the monospace font.

### Forecast cards

`.panel-now` uses a five-column grid:

```text
observed | divider | current forecast | divider | next forecast
```

At screens narrower than 720 pixels, the grid becomes one column and the dividers become horizontal.

### Season strip

The strip uses CSS grid columns so every month receives a stable visual tick. Color classes identify the season.

### Chart

The chart container uses a raised background and rounded corners. The SVG is fluid and preserves its aspect ratio.

### Accuracy cards

Accuracy cards use a responsive grid. The filled bars use a teal-to-amber gradient.

### Footer

Footer rules align the branding row, acknowledgement text, and GitHub link. The logo image sizes are controlled by `.footer-logo`.

---

## 9. End-to-End Workflow

Run the project in this order when the raw climate data changes:

### Step 1: Prepare monthly data

```powershell
python .\01_prepare_data.py
```

### Step 2: Make the training input current

The training script reads the root-level file. Copy the prepared data there if necessary:

```powershell
Copy-Item .\data\monthly_timeseries.csv .\monthly_timeseries.csv -Force
```

### Step 3: Train the models

```powershell
python .\02_train_forecast.py
```

### Step 4: Publish generated artifacts to the backend

```powershell
Copy-Item .\outputs\forecast_24months.csv .\backend\data\forecast_24months.csv -Force
Copy-Item .\outputs\model_accuracy_summary.csv .\backend\data\model_accuracy_summary.csv -Force
Copy-Item .\data\monthly_timeseries.csv .\backend\data\monthly_timeseries.csv -Force
```

### Step 5: Start Flask

```powershell
python .\backend\app.py
```

### Step 6: Open the dashboard

```text
http://127.0.0.1:5000/
```

---

## 10. API Examples

### Health check

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

Expected response:

```json
{"status":"ok"}
```

### First forecast record

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/forecast | Select-Object -First 1
```

### Combined data

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/combined
```

---

## 11. Dependencies

Install the Python dependencies listed in `requirements.txt`:

```powershell
pip install -r requirements.txt
```

The project requires the libraries used by the data and web layers, including Pandas, NumPy, Statsmodels, Matplotlib, scikit-learn, Flask, and Flask-CORS.

---

## 12. Interpretation and Limitations

- Forecasts are statistical estimates, not guarantees.
- The model learns monthly seasonal patterns and historical trends; it does not use live weather radar or real-time atmospheric conditions.
- Precipitation forecasts can have wider errors than temperature forecasts because rainfall is more variable.
- The 80% interval describes model uncertainty, not every possible source of real-world uncertainty.
- The dashboard only displays the data available in the prepared historical CSV.
- New observations must be added and the model must be retrained to update the forecast.
- The current-month card uses the browser's calendar month when that month exists in the forecast range.

---

## 13. Troubleshooting

### The dashboard says it cannot reach the API

Make sure Flask is running:

```powershell
python .\backend\app.py
```

Then check:

```text
http://127.0.0.1:5000/api/health
```

### The dashboard shows old forecast dates

Refresh the generated files in `backend/data/`:

```powershell
Copy-Item .\outputs\forecast_24months.csv .\backend\data\forecast_24months.csv -Force
Copy-Item .\outputs\model_accuracy_summary.csv .\backend\data\model_accuracy_summary.csv -Force
```

Also verify that `backend/data/monthly_timeseries.csv` contains the newest historical month.

### The training script cannot find the data file

The script expects:

```text
monthly_timeseries.csv
```

at the project root. Run the preparation script and copy the generated data file into the root if needed.

### The logo does not appear

The frontend currently references:

```text
frontend/image.png
```

from the HTML file. Confirm that `frontend/image.png` exists and that Flask is serving the latest frontend files.

### The forecast chart is empty

Check that both `/api/historical` and `/api/forecast` return non-empty arrays and that the selected variable exists in both responses.

---

## 14. Suggested Future Improvements

- Remove duplicated CSV locations by introducing one authoritative data directory.
- Add an automated publish step after training.
- Add unit tests for data preparation, season assignment, API filtering, and forecast selection.
- Add a live data ingestion process from the Ethiopian Meteorology Institute.
- Store model configuration and training timestamps in a metadata file.
- Add server-side caching for CSV loads.
- Replace the generic browser current-month fallback with an explicit forecast status when current data is unavailable.
- Add a configurable GitHub and portfolio URL instead of hard-coding links in HTML.
