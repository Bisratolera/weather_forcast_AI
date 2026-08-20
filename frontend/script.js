/* ============================================================
   WeatherForecastAI frontend
   Vanilla JS - fetches the Flask API and renders everything by hand,
   including a small custom SVG line/area chart (no chart library).
   ============================================================ */

const API_BASE = "http://127.0.0.1:5000"; // same-origin: served by the Flask app

const VARIABLES = {
  temp_max_C:       { label: "Max Temp",   unit: "\u00b0C",  color: "temp" },
  temp_min_C:       { label: "Min Temp",   unit: "\u00b0C",  color: "temp" },
  precip_mm:        { label: "Rainfall",   unit: "mm",       color: "rain" },
  rel_humidity_pct: { label: "Humidity",   unit: "%",        color: "hum" },
  sun_hours:        { label: "Sunshine",   unit: "hrs/day",  color: "sun" },
};

const SEASON_CLASS = {
  "Bega (dry)": "dot-bega",
  "Belg (short rains)": "dot-belg",
  "Kiremt (main rains)": "dot-kiremt",
};

let state = {
  historical: [],
  forecast: [],
  accuracy: [],
  activeVar: "temp_max_C",
};

async function getJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function fmt(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "\u2014";
  return Number(n).toFixed(digits);
}

function monthLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/* ---------------------------------------------------------- */
/* Now / Next panel                                            */
/* ---------------------------------------------------------- */
function renderNowNext() {
  const obs = state.historical[state.historical.length - 1];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentIndex = state.forecast.findIndex((row) => row.date.startsWith(currentMonth));
  const forecastIndex = currentIndex >= 0 ? currentIndex : 0;
  const fc = state.forecast[forecastIndex];
  const nextFc = state.forecast[forecastIndex + 1];

  document.getElementById("observed-date").textContent = obs ? monthLabel(obs.date) : "No data";
  document.getElementById("forecast-date").textContent = fc ? monthLabel(fc.date) : "No data";
  document.getElementById("next-forecast-date").textContent = nextFc ? monthLabel(nextFc.date) : "No data";

  const obsGrid = document.getElementById("observed-grid");
  const fcGrid = document.getElementById("forecast-grid");
  const nextFcGrid = document.getElementById("next-forecast-grid");
  obsGrid.innerHTML = "";
  fcGrid.innerHTML = "";
  nextFcGrid.innerHTML = "";

  Object.entries(VARIABLES).forEach(([key, meta]) => {
    obsGrid.appendChild(statTile(meta.label, obs ? obs[key] : null, meta.unit));
    fcGrid.appendChild(statTile(meta.label, fc ? fc[key] : null, meta.unit));
    nextFcGrid.appendChild(statTile(meta.label, nextFc ? nextFc[key] : null, meta.unit));
  });
}

function statTile(label, value, unit) {
  const wrap = document.createElement("div");
  wrap.className = "now-stat";
  const l = document.createElement("span");
  l.className = "now-stat-label";
  l.textContent = label;
  const v = document.createElement("span");
  const known = value !== null && value !== undefined && !Number.isNaN(value);
  v.className = "now-stat-value" + (known ? "" : " na");
  v.textContent = known ? `${fmt(value, unit === "%" ? 0 : 1)}${unit}` : "no reading";
  wrap.append(l, v);
  return wrap;
}

/* ---------------------------------------------------------- */
/* Search                                                       */
/* ---------------------------------------------------------- */
function renderSearchResults(query = "") {
  const results = document.getElementById("search-results");
  const summary = document.getElementById("search-summary");
  const normalizedQuery = query.trim().toLowerCase();
  const records = [
    ...state.historical.map((row) => ({ ...row, recordType: "Observed" })),
    ...state.forecast.map((row) => ({ ...row, recordType: "Projected" })),
  ];
  if (!normalizedQuery) {
    summary.textContent = "Type a month, year, season, or value to search";
    results.innerHTML = "";
    return;
  }
  const matches = records.filter((row) => {
    const searchableText = [
      ...Object.values(row),
      monthLabel(row.date),
      new Date(`${row.date}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    ].join(" ").toLowerCase();
    return searchableText.includes(normalizedQuery);
  });

  summary.textContent = normalizedQuery
    ? `${matches.length} matching record${matches.length === 1 ? "" : "s"}`
    : `Showing all ${matches.length} records`;
  results.innerHTML = "";

  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No weather records match that search.";
    results.appendChild(empty);
    return;
  }

  matches.forEach((row) => {
    const card = document.createElement("article");
    card.className = "search-record";
    card.innerHTML = `
      <div class="search-record-head">
        <div><h3>${monthLabel(row.date)}</h3><span class="record-season">${row.season || "-"}</span></div>
        <span class="record-type ${row.recordType === "Projected" ? "is-projected" : "is-observed"}">${row.recordType}</span>
      </div>
      <div class="search-record-grid">
        <span><b>Max Temp</b>${fmt(row.temp_max_C)}°C</span>
        <span><b>Min Temp</b>${fmt(row.temp_min_C)}°C</span>
        <span><b>Rainfall</b>${fmt(row.precip_mm)} mm</span>
        <span><b>Humidity</b>${fmt(row.rel_humidity_pct, 0)}%</span>
        <span><b>Sunshine</b>${fmt(row.sun_hours)} hrs</span>
      </div>`;
    results.appendChild(card);
  });
}

function initSearch() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("record-search");
  const clear = document.getElementById("search-clear");
  form.addEventListener("submit", (event) => event.preventDefault());
  input.addEventListener("input", () => renderSearchResults(input.value));
  clear.addEventListener("click", () => {
    input.value = "";
    input.focus();
    renderSearchResults();
  });
}

/* ---------------------------------------------------------- */
/* Season strip                                                */
/* ---------------------------------------------------------- */
function renderSeasonStrip() {
  const strip = document.getElementById("season-strip");
  strip.innerHTML = "";
  const all = [
    ...state.historical.map((r) => ({ ...r, part: "historical" })),
    ...state.forecast.map((r) => ({ ...r, part: "forecast" })),
  ];
  all.forEach((row) => {
    const tick = document.createElement("div");
    tick.className = `season-tick ${SEASON_CLASS[row.season] || ""}`;
    tick.dataset.part = row.part;
    const heightPct = row.part === "forecast" ? 100 : 62 + (hashMonth(row.date) % 30);
    tick.style.height = `${heightPct}%`;
    const title = document.createElement("title");
    title.textContent = `${monthLabel(row.date)} \u2014 ${row.season}${row.part === "forecast" ? " (projected)" : ""}`;
    tick.appendChild(title);
    strip.appendChild(tick);
  });
}

function hashMonth(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) % 100;
  return h;
}

/* ---------------------------------------------------------- */
/* Variable tabs                                                */
/* ---------------------------------------------------------- */
function renderTabs() {
  const tabs = document.getElementById("var-tabs");
  tabs.innerHTML = "";
  Object.entries(VARIABLES).forEach(([key, meta]) => {
    const btn = document.createElement("button");
    btn.className = "var-tab";
    btn.type = "button";
    btn.role = "tab";
    btn.textContent = meta.label;
    btn.setAttribute("aria-selected", key === state.activeVar ? "true" : "false");
    btn.addEventListener("click", () => {
      state.activeVar = key;
      renderTabs();
      renderChart();
    });
    tabs.appendChild(btn);
  });
}

/* ---------------------------------------------------------- */
/* Chart                                                        */
/* ---------------------------------------------------------- */
const CHART = { W: 1000, H: 420, padL: 56, padR: 16, padT: 16, padB: 34 };

function renderChart() {
  const key = state.activeVar;
  const meta = VARIABLES[key];
  document.getElementById("chart-caption").textContent =
    `${meta.label} (${meta.unit}) \u2014 ten years of monthly readings, followed by 24 months of model projection with an 80% confidence band.`;

  const hist = state.historical.filter((r) => r[key] !== null && r[key] !== undefined);
  const fc = state.forecast;
  if (hist.length === 0 || fc.length === 0) return;

  const allDates = [...hist.map((r) => r.date), ...fc.map((r) => r.date)];
  const lowerKey = `${key}_lower80`;
  const upperKey = `${key}_upper80`;

  const values = [
    ...hist.map((r) => r[key]),
    ...fc.map((r) => r[key]),
    ...fc.map((r) => r[lowerKey]),
    ...fc.map((r) => r[upperKey]),
  ].filter((v) => v !== null && v !== undefined && !Number.isNaN(v));

  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const pad = (yMax - yMin) * 0.1 || 1;
  yMin -= pad;
  yMax += pad;
  if (key === "precip_mm" || key === "sun_hours") yMin = Math.min(yMin, 0);

  const n = allDates.length;
  const { W, H, padL, padR, padT, padB } = CHART;
  const xStep = (W - padL - padR) / (n - 1);
  const x = (i) => padL + i * xStep;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - yMin) / (yMax - yMin));

  const histCount = hist.length;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("chart-svg");
  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // gridlines + y labels
  const gridGroup = document.createElementNS(svgNS, "g");
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = yMin + ((yMax - yMin) * t) / ticks;
    const yy = y(v);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", padL);
    line.setAttribute("x2", W - padR);
    line.setAttribute("y1", yy);
    line.setAttribute("y2", yy);
    line.setAttribute("stroke", "rgba(243,238,224,0.10)");
    line.setAttribute("stroke-width", "1");
    gridGroup.appendChild(line);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", padL - 10);
    label.setAttribute("y", yy + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("font-size", "11");
    label.setAttribute("font-family", "JetBrains Mono, monospace");
    label.setAttribute("fill", "rgba(243,238,224,0.55)");
    label.textContent = fmt(v, key === "rel_humidity_pct" ? 0 : 1);
    gridGroup.appendChild(label);
  }
  svg.appendChild(gridGroup);

  allDates.forEach((d, i) => {
    if (d.endsWith("01-01")) {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", x(i));
      line.setAttribute("x2", x(i));
      line.setAttribute("y1", padT);
      line.setAttribute("y2", H - padB);
      line.setAttribute("stroke", "rgba(243,238,224,0.06)");
      svg.appendChild(line);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", x(i));
      label.setAttribute("y", H - 12);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "11");
      label.setAttribute("font-family", "JetBrains Mono, monospace");
      label.setAttribute("fill", "rgba(243,238,224,0.55)");
      label.textContent = d.slice(0, 4);
      svg.appendChild(label);
    }
  });

  const boundaryX = x(histCount - 1);
  const boundary = document.createElementNS(svgNS, "line");
  boundary.setAttribute("x1", boundaryX);
  boundary.setAttribute("x2", boundaryX);
  boundary.setAttribute("y1", padT);
  boundary.setAttribute("y2", H - padB);
  boundary.setAttribute("stroke", "#E0973F");
  boundary.setAttribute("stroke-width", "1");
  boundary.setAttribute("stroke-dasharray", "3 4");
  boundary.setAttribute("opacity", "0.7");
  svg.appendChild(boundary);

  // confidence band (forecast only)
  const bandTop = fc.map((r, i) => `${x(histCount + i)},${y(r[upperKey])}`);
  const bandBottom = fc.map((r, i) => `${x(histCount + i)},${y(r[lowerKey])}`).reverse();
  const band = document.createElementNS(svgNS, "polygon");
  band.setAttribute("points", [...bandTop, ...bandBottom].join(" "));
  band.setAttribute("fill", "rgba(224,151,63,0.16)");
  svg.appendChild(band);

  // historical line
  const histPoints = hist.map((r, i) => `${x(i)},${y(r[key])}`).join(" ");
  drawPolyline(svg, svgNS, histPoints, "#F3EEE0", 2);

  // forecast line - start at the last historical point for a continuous join
  const fcPoints = [`${x(histCount - 1)},${y(hist[hist.length - 1][key])}`,
    ...fc.map((r, i) => `${x(histCount + i)},${y(r[key])}`)].join(" ");
  drawPolyline(svg, svgNS, fcPoints, "#E0973F", 2.25);

  // hover targets
  const allRows = [...hist, ...fc.map((r) => ({ ...r, [key]: r[key] }))];
  attachHover(svg, allRows, x, y, key, meta, histCount);
}

function drawPolyline(svg, svgNS, points, stroke, width) {
  const poly = document.createElementNS(svgNS, "polyline");
  poly.setAttribute("points", points);
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", stroke);
  poly.setAttribute("stroke-width", width);
  poly.setAttribute("stroke-linejoin", "round");
  poly.setAttribute("stroke-linecap", "round");
  svg.appendChild(poly);
}

function attachHover(svg, rows, x, y, key, meta, histCount) {
  const svgNS = "http://www.w3.org/2000/svg";
  const tooltip = document.getElementById("chart-tooltip");
  const wrap = svg.parentElement;

  const dotGroup = document.createElementNS(svgNS, "g");
  const dot = document.createElementNS(svgNS, "circle");
  dot.setAttribute("r", "4.5");
  dot.setAttribute("fill", "#F3EEE0");
  dot.setAttribute("stroke", "#10171F");
  dot.setAttribute("stroke-width", "1.5");
  dot.setAttribute("visibility", "hidden");
  dotGroup.appendChild(dot);
  svg.appendChild(dotGroup);

  const overlay = document.createElementNS(svgNS, "rect");
  overlay.setAttribute("x", 0);
  overlay.setAttribute("y", 0);
  overlay.setAttribute("width", CHART.W);
  overlay.setAttribute("height", CHART.H);
  overlay.setAttribute("fill", "transparent");
  svg.appendChild(overlay);

  function handleMove(evt) {
    const rect = svg.getBoundingClientRect();
    const scaleX = CHART.W / rect.width;
    const px = (evt.clientX - rect.left) * scaleX;
    const step = (CHART.W - CHART.padL - CHART.padR) / (rows.length - 1);
    let idx = Math.round((px - CHART.padL) / step);
    idx = Math.max(0, Math.min(rows.length - 1, idx));
    const row = rows[idx];
    const val = row[key];
    if (val === null || val === undefined || Number.isNaN(val)) {
      dot.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
      return;
    }
    const cx = x(idx);
    const cy = y(val);
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    dot.setAttribute("visibility", "visible");

    const isForecast = idx >= histCount;
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${monthLabel(row.date)}</strong><br>${meta.label}: ${fmt(val)}${meta.unit}${isForecast ? " (projected)" : ""}`;
    const rectWrap = wrap.getBoundingClientRect();
    const scaleFactor = rectWrap.width / CHART.W;
    tooltip.style.left = `${cx * scaleFactor}px`;
    tooltip.style.top = `${cy * scaleFactor}px`;
  }

  overlay.addEventListener("mousemove", handleMove);
  overlay.addEventListener("mouseleave", () => {
    dot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  });
  overlay.addEventListener("touchmove", (e) => { handleMove(e.touches[0]); }, { passive: true });
}



function renderAccuracy() {
  const grid = document.getElementById("accuracy-grid");
  grid.innerHTML = "";
  const maxMae = Math.max(...state.accuracy.map((a) => a.MAE / referenceScale(a.variable)));

  state.accuracy.forEach((a) => {
    const scaled = a.MAE / referenceScale(a.variable);
    const pct = Math.min(100, (scaled / maxMae) * 100);

    const card = document.createElement("div");
    card.className = "accuracy-card";
    card.innerHTML = `
      <div class="accuracy-card-top">
        <h3>${a.label}</h3>
        <span class="accuracy-mae">MAE ${fmt(a.MAE, 2)}${a.unit}</span>
      </div>
      <div class="accuracy-bar-track"><div class="accuracy-bar-fill" style="width:${pct}%"></div></div>
      <p class="accuracy-note">RMSE ${fmt(a.RMSE, 2)}${a.unit} on a 12-month holdout</p>
    `;
    grid.appendChild(card);
  });
}

// rough per-variable scale so bars are visually comparable across units
function referenceScale(variable) {
  const scales = { temp_max_C: 5, temp_min_C: 5, precip_mm: 150, rel_humidity_pct: 20, sun_hours: 4 };
  return scales[variable] || 1;
}



async function init() {
  try {
    const [historical, forecast, accuracy] = await Promise.all([
      getJSON("/api/historical"),
      getJSON("/api/forecast"),
      getJSON("/api/accuracy"),
    ]);
    state.historical = historical;
    state.forecast = forecast;
    state.accuracy = accuracy;

    renderNowNext();
    initSearch();
    renderSearchResults();
    renderSeasonStrip();
    renderTabs();
    renderChart();
    renderAccuracy();
  } catch (err) {
    console.error(err);
    document.querySelectorAll("main section").forEach((s) => {
      const msg = document.createElement("p");
      msg.className = "state-msg is-error";
      msg.textContent = "Couldn't reach the forecast API. Is the Flask backend running?";
      s.prepend(msg);
    });
  }
}

window.addEventListener("resize", () => {
  if (state.historical.length) renderChart();
});

init();
