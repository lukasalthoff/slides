/* =============================================================
  Econ 30 · SA integration - website_v2 / app.js
   Chart.js + Leaflet + regression-table renderer + theme toggle.
   ============================================================= */

(() => {
  "use strict";

  // ------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const fmt = {
    p: v => (v == null ? "–" : (v < 1e-4 ? "<0.0001" : v.toFixed(4))),
    p3: v => (v == null ? "–" : (v < 1e-3 ? "<0.001" : v.toFixed(3))),
    n: v => (v == null ? "–" : v.toString()),
    r2: v => (v == null ? "–" : v.toFixed(3)),
    dw: v => (v == null ? "–" : v.toFixed(2)),
    sig: v => (v == null ? "" : (v.toFixed(3))),
    coef: v => (v == null ? "–" : v.toLocaleString(undefined, { maximumSignificantDigits: 4 })),
  };

  const fetchJSON = url => fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });

  // ------------------------------------------------------------
  // Theme toggle (light ↔ dark, persisted) + picker on each load
  // ------------------------------------------------------------
  const themeKey = "econ30-theme";
  const mapThemeRefreshers = [];
  const themeRefreshFns = [];
  const setThemeOnPage = (t, { persist = true, refreshMedia = false } = {}) => {
    document.documentElement.dataset.theme = t;
    if (persist) localStorage.setItem(themeKey, t);
    const icon = $("#theme-toggle .theme-icon");
    const btn = $("#theme-toggle");
    if (icon) icon.textContent = t === "dark" ? "◑" : "◐";
    if (btn) {
      btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
      btn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
    if (refreshMedia) {
      themeRefreshFns.forEach((fn) => fn());
    }
  };
  const hideThemePrompt = () => {
    const prompt = $("#theme-prompt");
    if (!prompt) return;
    prompt.hidden = true;
    document.body.classList.remove("theme-prompt-open");
  };
  const showThemePrompt = () => {
    const prompt = $("#theme-prompt");
    if (!prompt) return;
    prompt.hidden = false;
    document.body.classList.add("theme-prompt-open");
  };
  const chooseTheme = (t) => {
    setThemeOnPage(t, { refreshMedia: true });
    hideThemePrompt();
    window.dispatchEvent(new CustomEvent("econ30-theme-chosen", { detail: { theme: t } }));
  };
  const savedTheme = localStorage.getItem(themeKey);
  setThemeOnPage(savedTheme === "dark" ? "dark" : "light", { persist: false });
  {
    const prompt = $("#theme-prompt");
    const current = document.documentElement.dataset.theme;
    prompt?.querySelectorAll("[data-theme-choice]").forEach((btn) => {
      btn.classList.toggle("is-current", btn.dataset.themeChoice === current);
    });
    showThemePrompt();
    const focusBtn = prompt?.querySelector(`[data-theme-choice="${current}"]`)
      || prompt?.querySelector('[data-theme-choice="light"]');
    focusBtn?.focus();
  }
  $("#theme-prompt")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-choice]");
    if (!btn) return;
    chooseTheme(btn.dataset.themeChoice === "dark" ? "dark" : "light");
  });
  $("#theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setThemeOnPage(cur, { refreshMedia: true });
  });

  // ------------------------------------------------------------
  // Chart.js defaults keyed to CSS variables
  // ------------------------------------------------------------
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const palette = () => ({
    bg: cssVar("--bg"),
    bgElev: cssVar("--bg-elev"),
    bgSunken: cssVar("--bg-sunken"),
    fg: cssVar("--fg"),
    muted: cssVar("--fg-muted"),
    rule: cssVar("--rule"),
    accent: cssVar("--accent"),
    accentSoft: cssVar("--accent-soft"),
    wdi: cssVar("--c-wdi"),
    wid: cssVar("--c-wid"),
    wiid: cssVar("--c-wiid"),
    wgi: cssVar("--c-wgi"),
    qlfs: cssVar("--c-qlfs"),
    danger: cssVar("--danger"),
    warn: cssVar("--warn"),
  });

  const chartMarkerStroke = (opacity = 0.4) => {
    const dark = document.documentElement.dataset.theme === "dark";
    return dark ? `rgba(255,255,255,${opacity})` : `rgba(24,24,27,${opacity * 0.88})`;
  };

  const clearChartLoading = (canvas) => {
    const wrap = canvas?.closest?.(".chart-canvas-wrap");
    if (!wrap) return;
    wrap.classList.remove("is-loading");
    wrap.removeAttribute("aria-busy");
  };

  /** Tooltip chrome follows light/dark page theme (readable on both). */
  const tooltipThemeColors = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    return dark
      ? {
          backgroundColor: "rgba(22, 26, 34, 0.96)",
          titleColor: "#f4f4f5",
          bodyColor: "#e4e4e7",
          borderColor: "rgba(255,255,255,0.12)",
        }
      : {
          backgroundColor: "rgba(255, 255, 255, 0.97)",
          titleColor: "#18181b",
          bodyColor: "#3f3f46",
          borderColor: "rgba(15, 23, 42, 0.12)",
        };
  };

  const setChartDefaults = () => {
    const p = palette();
    const tt = tooltipThemeColors();
    Chart.defaults.font.family = "Inter, -apple-system, system-ui, sans-serif";
    Chart.defaults.color = p.muted;
    Chart.defaults.borderColor = p.rule;
    Chart.defaults.plugins.legend.labels.color = p.fg;
    if (!Chart.defaults.plugins.tooltip) Chart.defaults.plugins.tooltip = {};
    Object.assign(Chart.defaults.plugins.tooltip, {
      ...tt,
      borderWidth: 1,
      boxPadding: 6,
      padding: 10,
      cornerRadius: 8,
      displayColors: true,
    });
  };
  setChartDefaults();

  /** Chart.js merges defaults at build time; theme flip must push fresh CSS-derived colors into each instance. */
  const applyPaletteToChart = chart => {
    const p = palette();
    const o = chart.options;
    if (o.plugins?.legend?.labels) o.plugins.legend.labels.color = p.fg;
    if (o.plugins?.tooltip) Object.assign(o.plugins.tooltip, tooltipThemeColors());
    if (o.color !== undefined) o.color = p.muted;
    chart.data.datasets.forEach(ds => {
      if (!ds.paletteKey || !p[ds.paletteKey]) return;
      const color = p[ds.paletteKey];
      const border = `${color}${ds.colorAlpha ?? ""}`;
      ds.borderColor = border;
      ds.backgroundColor = `${color}${ds.backgroundAlpha ?? "33"}`;
      ds.pointBackgroundColor = border;
    });
    Object.values(o.scales || {}).forEach(scale => {
      if (!scale || typeof scale !== "object") return;
      if (scale.ticks) scale.ticks.color = p.muted;
      if (scale.grid) scale.grid.color = p.rule;
      if (scale.title?.display) scale.title.color = p.muted;
    });
    chart.update();
  };

  const refreshAllChartsForTheme = () => {
    setChartDefaults();
    document.querySelectorAll("canvas").forEach(canvas => {
      const c = typeof Chart !== "undefined" && Chart.getChart ? Chart.getChart(canvas) : null;
      if (c) applyPaletteToChart(c);
    });
  };
  themeRefreshFns.push(refreshAllChartsForTheme);
  themeRefreshFns.push(() => mapThemeRefreshers.forEach((fn) => fn()));

  /** Axis & tooltip numbers without locale grouping (years read as 1990 not 1,990). */
  const formatChartTickPlain = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (Number.isInteger(n)) return String(n);
    const r = Math.round(n);
    if (Math.abs(n - r) < 1e-9) return String(r);
    return n.toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: 8 });
  };

  const annotationPlugin = {
    id: "essayAnnotation",
    afterDraw(chart, _args, opts) {
      const items = opts?.items;
      if (!Array.isArray(items) || !items.length || !chart?.scales?.x || !chart?.scales?.y) return;
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      items.forEach((item) => {
        if (item.type === "band") {
          const x1 = scales.x.getPixelForValue(item.x1);
          const x2 = scales.x.getPixelForValue(item.x2);
          const bandW = x2 - x1;
          ctx.fillStyle = item.fill || "rgba(15,95,70,0.08)";
          ctx.fillRect(x1, chartArea.top, bandW, chartArea.bottom - chartArea.top);
          const label = item.label || "";
          if (label) {
            const pad = 6;
            let fontSize = 12;
            let textWidth = 0;
            do {
              ctx.font = `600 ${fontSize}px Inter, sans-serif`;
              textWidth = ctx.measureText(label).width;
              fontSize -= 1;
            } while (textWidth > bandW - pad * 2 && fontSize >= 9);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x1 + pad, chartArea.top, bandW - pad * 2, chartArea.bottom - chartArea.top);
            ctx.clip();
            ctx.fillStyle = item.color || palette().fg;
            const textX = x1 + Math.max(pad, (bandW - textWidth) / 2);
            const textY = chartArea.bottom - 8;
            ctx.fillText(label, textX, textY);
            ctx.restore();
          }
        } else if (item.type === "marker") {
          const x = scales.x.getPixelForValue(item.x);
          ctx.strokeStyle = item.color || "rgba(255,255,255,0.45)";
          ctx.lineWidth = item.width || 1.5;
          ctx.setLineDash(item.dash || [5, 5]);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          const label = item.label || "";
          if (label) {
            ctx.fillStyle = item.color || palette().fg;
            ctx.font = "600 12px Inter, sans-serif";
            const pad = 6;
            const y = chartArea.top + 16;
            const textWidth = ctx.measureText(label).width;
            let textX = x + pad;
            if (textX + textWidth > chartArea.right - 2) {
              textX = Math.max(chartArea.left + 2, x - pad - textWidth);
            }
            ctx.fillText(label, textX, y);
          }
        } else if (item.type === "label") {
          const x = scales.x.getPixelForValue(item.x);
          const y = scales.y.getPixelForValue(item.y);
          ctx.fillStyle = item.color || palette().fg;
          ctx.font = "600 12px Inter, sans-serif";
          ctx.fillText(item.label || "", x + 6, y - 6);
        }
      });
      ctx.restore();
    },
  };

  const makeLineChart = (canvas, { labels, datasets, yTitle, xTitle, xAxisType = "linear", yAxisType = "linear", annotations = [], xMin = null }) => {
    const p = palette();
    if (Chart.registry && !Chart.registry.plugins.get("essayAnnotation")) {
      Chart.register(annotationPlugin);
    }
    const yScale = {
      type: yAxisType,
      title: yTitle ? { display: true, text: yTitle, color: p.muted } : { display: false },
      grid: { color: p.rule, drawBorder: false },
      ticks: { color: p.muted },
    };
    if (yAxisType === "logarithmic") {
      yScale.ticks.callback = function (value) {
        if (value === 50 || value === 75 || value === 100 || value === 150 || value === 200 ||
            value === 300 || value === 500 || value === 1000) {
          return formatChartTickPlain(value);
        }
        return null;
      };
    } else {
      yScale.ticks.callback = formatChartTickPlain;
    }
    clearChartLoading(canvas);
    return new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 420, easing: "easeOutQuart" },
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
          essayAnnotation: { items: annotations },
          tooltip: {
            ...tooltipThemeColors(),
            enabled: true,
            callbacks: {
              title(items) {
                if (!items.length) return "";
                const x = items[0].parsed?.x;
                if (x != null && Number.isFinite(x)) return formatChartTickPlain(x);
                return items[0].label ?? "";
              },
              label(ctx) {
                const name = ctx.dataset.label ?? "";
                const y = ctx.parsed?.y;
                if (y == null || !Number.isFinite(y)) return name;
                const v = formatChartTickPlain(y);
                return name ? `${name}: ${v}` : v;
              },
            },
          },
        },
        scales: {
          x: {
            type: xAxisType,
            ...(xMin == null ? {} : { min: xMin }),
            title: xTitle ? { display: true, text: xTitle, color: p.muted } : { display: false },
            grid: { color: p.rule, drawBorder: false },
            ticks: { color: p.muted, maxRotation: 0, callback: formatChartTickPlain },
          },
          y: yScale,
        },
        elements: {
          line: { tension: 0.25, borderWidth: 2 },
          point: { radius: 2, hoverRadius: 4 },
        },
      },
    });
  };

  // ------------------------------------------------------------
  // Macro / inequality / hero charts
  // ------------------------------------------------------------
  const colorFrom = keyOrColor => palette()[keyOrColor] ?? keyOrColor;
  const datasetFrom = (years, series, colorKey, style = {}) => {
    const color = colorFrom(colorKey);
    const paletteKey = palette()[colorKey] ? colorKey : style.paletteKey;
    const border = `${color}${style.colorAlpha ?? ""}`;
    return {
      label: series.label,
      data: series.values.map((v, i) => ({ x: years[i], y: v })),
      borderColor: border,
      backgroundColor: `${color}${style.backgroundAlpha ?? "33"}`,
      pointBackgroundColor: border,
      spanGaps: true,
      paletteKey,
      ...style,
    };
  };

  const buildIndexedChart = (ts) => {
    const canvas = $("#chart-indexed");
    if (!canvas) return;
    const years = ts.indexed.years;
    const ds = [];
    const colors = { gdp_pc_usd: "wdi", trade_gdp: "wid" };
    const styles = {
      gdp_pc_usd: { borderWidth: 2.6 },
      trade_gdp: { borderWidth: 2.6, borderDash: [6, 4] },
    };
    ["gdp_pc_usd", "trade_gdp"].forEach((key) => {
      const s = ts.indexed.series[key];
      if (!s) return;
      ds.push(datasetFrom(years, s, colors[key] ?? "fg", styles[key] ?? { borderWidth: 2.2 }));
    });
    makeLineChart(canvas, {
      labels: years,
      datasets: ds,
      yTitle: "Index, 1990 = 100 (log axis)",
      xTitle: "Year",
      yAxisType: "logarithmic",
      annotations: [
        { type: "band", x1: 1960, x2: 1990, label: "Apartheid era", fill: "rgba(15,95,70,0.06)" },
        { type: "marker", x: 1994, label: "1994 elections", color: chartMarkerStroke(0.42), dash: [3, 4] },
        { type: "label", x: 2002, y: 320, label: "Trade rises faster than income" },
      ],
    });
  };

  /** Sector deep-dive (Section 05). Two stacked line charts. */
  const buildSectorCharts = (sector) => {
    if (!sector || !Array.isArray(sector.rows)) return;
    const rows = sector.rows.filter((r) => r.year != null);
    const empRows = rows.filter((r) => r.tradable_share != null);
    const empYears = empRows.map((r) => r.year);

    const sharesCanvas = $("#chart-sector-shares");
    if (sharesCanvas) {
      makeLineChart(sharesCanvas, {
        labels: empYears,
        datasets: [
          datasetFrom(
            empYears,
            { label: "Tradable (agriculture + mining + manufacturing)", values: empRows.map((r) => r.tradable_share) },
            "wid",
            { borderWidth: 2.6 },
          ),
          datasetFrom(
            empYears,
            { label: "Non-tradable (services, construction, utilities…)", values: empRows.map((r) => r.nontradable_share) },
            "wdi",
            { borderWidth: 2.6 },
          ),
          datasetFrom(
            empYears,
            { label: "Manufacturing only", values: empRows.map((r) => r.sic3_share) },
            "wiid",
            { borderWidth: 2.2, borderDash: [4, 4] },
          ),
        ],
        yTitle: "Share of employed adults (0–1)",
        xTitle: "Year",
      });
    }

    const decline = $("#chart-manuf-decline");
    if (decline) {
      const vaRows = rows.filter((r) => r.manuf_va_share_gdp != null);
      const empMfg = rows.filter((r) => r.sic3_share != null);
      makeLineChart(decline, {
        labels: vaRows.map((r) => r.year),
        datasets: [
          datasetFrom(
            vaRows.map((r) => r.year),
            { label: "Manufacturing value added, % of GDP (WDI)", values: vaRows.map((r) => r.manuf_va_share_gdp) },
            "wid",
            { borderWidth: 2.6 },
          ),
          datasetFrom(
            empMfg.map((r) => r.year),
            { label: "Manufacturing employment share × 100", values: empMfg.map((r) => r.sic3_share * 100) },
            "wiid",
            { borderWidth: 2.4, borderDash: [4, 4] },
          ),
        ],
        yTitle: "% of GDP / % of employed",
        xTitle: "Year",
        annotations: [
          { type: "band", x1: 1960, x2: 1990, label: "VA from 1960", fill: "rgba(15,95,70,0.05)" },
        ],
      });
    }
  };

  /** Backfill the three "first → latest" stat boxes and the inline regression numbers. */
  const renderSectorStats = (sector) => {
    $$("[data-stat]").forEach((card) => card.classList.remove("sector-stat--loading", "sector-stat--error"));
    if (!sector || !Array.isArray(sector.rows)) {
      $$("[data-stat]").forEach((card) => card.classList.add("sector-stat--error"));
      return;
    }
    const rows = sector.rows;
    const fmtPct = (v, dp = 1) => (v == null || Number.isNaN(v) ? "–" : `${(v * 100).toFixed(dp)}%`);
    const fmtRaw = (v, dp = 1) => (v == null || Number.isNaN(v) ? "–" : `${v.toFixed(dp)}%`);
    const fmtDeltaPp = (d, dp = 1) => {
      if (d == null || Number.isNaN(d)) return "–";
      const sign = d > 0 ? "+" : d < 0 ? "−" : "";
      return `${sign}${Math.abs(d).toFixed(dp)} pp`;
    };

    const paintSectorStat = ({
      cardKey,
      startVal,
      endVal,
      startYear,
      endYear,
      fmtValue,
      deltaPp,
    }) => {
      const root = document.querySelector(`[data-stat="${cardKey}"]`);
      if (!root || startVal == null || endVal == null) return;
      const trend = endVal < startVal ? "down" : endVal > startVal ? "up" : "flat";
      root.classList.remove("sector-stat--down", "sector-stat--up", "sector-stat--flat");
      root.classList.add(`sector-stat--${trend}`);
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set(`stat-${cardKey}-start`, fmtValue(startVal));
      set(`stat-${cardKey}-end`, fmtValue(endVal));
      set(`stat-${cardKey}-start-yr`, String(startYear));
      set(`stat-${cardKey}-end-yr`, String(endYear));
      set(`stat-${cardKey}-delta`, fmtDeltaPp(deltaPp));
      const arrow = document.getElementById(`stat-${cardKey}-arrow`);
      if (arrow) arrow.textContent = trend === "down" ? "↓" : trend === "up" ? "↑" : "→";
    };

    const vaFirst = rows.find((r) => r.manuf_va_share_gdp != null);
    const vaLast = [...rows].reverse().find((r) => r.manuf_va_share_gdp != null);
    if (vaFirst && vaLast) {
      paintSectorStat({
        cardKey: "manuf-va",
        startVal: vaFirst.manuf_va_share_gdp,
        endVal: vaLast.manuf_va_share_gdp,
        startYear: vaFirst.year,
        endYear: vaLast.year,
        fmtValue: fmtRaw,
        deltaPp: vaLast.manuf_va_share_gdp - vaFirst.manuf_va_share_gdp,
      });
    }

    const empFirst = rows.find((r) => r.sic3_share != null);
    const empLast = [...rows].reverse().find((r) => r.sic3_share != null);
    if (empFirst && empLast) {
      paintSectorStat({
        cardKey: "manuf-emp",
        startVal: empFirst.sic3_share,
        endVal: empLast.sic3_share,
        startYear: empFirst.year,
        endYear: empLast.year,
        fmtValue: fmtPct,
        deltaPp: (empLast.sic3_share - empFirst.sic3_share) * 100,
      });
    }

    const trFirst = rows.find((r) => r.tradable_share != null);
    const trLast = [...rows].reverse().find((r) => r.tradable_share != null);
    if (trFirst && trLast) {
      paintSectorStat({
        cardKey: "tradable",
        startVal: trFirst.tradable_share,
        endVal: trLast.tradable_share,
        startYear: trFirst.year,
        endYear: trLast.year,
        fmtValue: fmtPct,
        deltaPp: (trLast.tradable_share - trFirst.tradable_share) * 100,
      });
    }

  };

  const buildUnemploymentChart = (ts) => {
    const canvas = $("#chart-unemployment");
    if (!canvas) return;
    const years = ts.years;
    const vals = ts.series.unemployment.values;
    makeLineChart(canvas, {
      labels: years,
      datasets: [datasetFrom(years, ts.series.unemployment, "danger", { borderWidth: 2.5 })],
      yTitle: "% of labour force",
      xTitle: "Year",
      xMin: vals.findIndex((v) => v != null) >= 0 ? years[vals.findIndex((v) => v != null)] : 1990,
      annotations: [{ type: "marker", x: 2020, label: "COVID shock", color: chartMarkerStroke(0.48), dash: [4, 4] }],
    });
  };

  const buildIncomeChart = (ineq) => {
    const canvas = $("#chart-income-shares");
    if (!canvas) return;
    const years = ineq.years;
    makeLineChart(canvas, {
      labels: years,
      datasets: [
        datasetFrom(years, ineq.series.top10_inc, "wid"),
        datasetFrom(years, ineq.series.top1_inc, "danger"),
        datasetFrom(years, ineq.series.bottom50_inc, "wgi"),
      ],
      yTitle: "Share of national income (pre-tax)",
      xTitle: "Year",
      annotations: [
        { type: "band", x1: 1980, x2: 1990, label: "Pre-1990 WID (imputed)", fill: "rgba(15,95,70,0.06)" },
        { type: "marker", x: 1994, label: "1994", color: chartMarkerStroke(0.38), dash: [3, 4] },
        { type: "label", x: 2020, y: 0.65, label: "≈65%" },
      ],
    });
  };

  const buildWealthChart = (ineq) => {
    const canvas = $("#chart-wealth-shares");
    if (!canvas) return;
    const years = ineq.years;
    makeLineChart(canvas, {
      labels: years,
      datasets: [
        datasetFrom(years, ineq.series.top10_wealth, "wid"),
        datasetFrom(years, ineq.series.top1_wealth, "danger"),
      ],
      yTitle: "Share of household wealth",
      xTitle: "Year",
      annotations: [
        { type: "band", x1: 1980, x2: 1990, label: "Pre-1990 WID (imputed)", fill: "rgba(15,95,70,0.06)" },
        { type: "marker", x: 1994, label: "1994", color: chartMarkerStroke(0.38), dash: [3, 4] },
        { type: "label", x: 2020, y: 0.85, label: "≈85%" },
      ],
    });
  };

  // ------------------------------------------------------------
  // Timeline
  // ------------------------------------------------------------
  const TIMELINE = [
    { year: "1989–93", title: "Apartheid sanctions unravel", kb: "apartheid-era-sanctions",
      body: "Trade and banking sanctions eased step by step while multiparty talks (CODESA) moved forward." },
    { year: "1994", title: "Democratic elections · RDP", kb: "reconstruction-and-development-programme",
      body: "RDP emphasised redistribution and basic services; import taxes (tariffs) were still relatively high." },
    { year: "1995", title: "Joining the WTO", kb: "state-of-trade-policy-south-africa",
      body: "Membership committed South Africa to phase down import taxes through about 2005." },
    { year: "1996", title: "GEAR adopted", kb: "gear-strategy", chartHref: "#results",
      body: "Tighter budgets, lower trade barriers, some privatisation, and inflation targets became the main macro recipe." },
    { year: "2000s", title: "Commodity boom years", kb: "minerals-energy-complex",
      body: "Resource prices and foreign investment jumped; factory jobs outside mining often struggled." },
    { year: "2008–09", title: "Global financial crisis", kb: "trade-liberalization-sa-manufacturing", chartHref: "#chart-unemployment",
      body: "Manufacturing shrank sharply; unemployment stepped up." },
    { year: "2009–18", title: "The gap widens", kb: "political-economy-of-transition",
      body: "A decade of slow, uneven growth: asset-holders kept pulling ahead while jobless and informal workers fell further behind; the divergence accelerated rather than closed." },
    { year: "2017", title: "Sovereign rating downgrades", kb: "trade-liberalisation-south-africa",
      body: "Credit-rating agencies moved South Africa below top investment grades; borrowing became costlier." },
    { year: "2020–22", title: "COVID-19 shock", kb: "building-back-better-covid-jobs",
      body: "Record single-year job losses; only partial recovery through 2021–22." },
    { year: "2024–25", title: "QLFS Q1 2025: narrow u = 32.9%", kb: "stats-sa-qlfs-p0211-2025q1",
      body: "Broader unemployment (including discouraged seekers) at 43.1%; youth unemployment at 46.1%." },
  ];
  /* Primary sources (publishers, datasets, DOIs), not course wiki mirrors. */
  const KB_SOURCE_URL = {
    "apartheid-era-sanctions": "https://doi.org/10.1111/1467-9485.00248",
    "reconstruction-and-development-programme": "https://www.gov.za/sites/default/files/16085.pdf",
    "gear-strategy": "https://www.treasury.gov.za/publications/other/gear/chapters.pdf",
    "state-of-trade-policy-south-africa": "https://www.wto.org/english/tratop_e/tpr_e/tp547_e.htm",
    "minerals-energy-complex": "https://doi.org/10.1080/03056248808403756",
    "trade-liberalization-sa-manufacturing": "https://hdl.handle.net/10419/211260",
    "political-economy-of-transition": "https://ilrigsa.org.za/the-political-economy-of-the-south-african-transition/",
    "building-back-better-covid-jobs":
      "https://documents.worldbank.org/en/publication/documents-reports/documentdetail/368961522944196494/south-africa-economic-update-jobs-and-inequality",
    "stats-sa-qlfs-p0211-2025q1": "https://www.statssa.gov.za/?page_id=1854&PPN=P0211",
    "stats-sa-qlfs-p0211-2023q3": "https://www.statssa.gov.za/?page_id=1854&PPN=P0211",
    "trade-liberalization-local-labor-markets-south-africa": "https://doi.org/10.1016/j.jinteco.2019.02.006",
    "quarterly-labour-force-survey": "https://www.statssa.gov.za/?page_id=1854&PPN=P0211",
    "labour-market-south-africa": "https://ilostat.ilo.org/data/country/?ccode=ZAF&lang=en",
    "trade-liberalisation-south-africa": "https://www.wto.org/english/tratop_e/tpr_e/tp547_e.htm",
    "wealth-inequality-lab-south-africa": "https://doi.org/10.1093/wber/lhab012",
    "dataset-wiid-2025": "https://www.wider.unu.edu/project/wiid-world-income-inequality-database",
    "inequality-in-south-africa": "https://www.worldbank.org/en/country/southafrica/overview",
    "sanctions-synthetic-control-south-africa": "https://open.uct.ac.za/items/57c851e3-bd2e-4b04-9626-7778d529137e",
    "sanctions-impact-south-african-exports": "https://doi.org/10.1111/1467-9485.00248",
    "mayekiso-trade-liberalisation-privatisation": "https://doi.org/10.70132/j4269338243",
    "dataset-sa-wdi-panel": "https://databank.worldbank.org/source/world-development-indicators",
    "dataset-wid-south-africa": "https://wid.world/country/south-africa/",
  };
  const kbHref = (slug) => KB_SOURCE_URL[slug] ?? "https://www.worldbank.org/en/country/southafrica";
  const renderTimeline = () => {
    const list = $("#timeline-list");
    if (!list) return;
    TIMELINE.forEach((item, idx) => {
      const li = document.createElement("li");
      const above = idx % 2 === 0;
      li.className = `timeline-node ${above ? "timeline-node--above" : "timeline-node--below"}`;
      const cardInner = `
          <span class="timeline-idx">${String(idx + 1).padStart(2, "0")}</span>
          <span class="year">${item.year}</span>
          <h4>${item.title}</h4>
          <p>${item.body}</p>
          <a class="kb-link" href="${kbHref(item.kb)}" target="_blank" rel="noopener noreferrer" data-kb="${item.kb}">View source →</a>
          ${item.chartHref ? `<a class="timeline-see-chart" href="${item.chartHref}">See this in the data →</a>` : ""}`;
      li.innerHTML = above
        ? `<div class="timeline-card">${cardInner}</div>
        <div class="timeline-axis-slot" aria-hidden="true">
          <span class="timeline-stem timeline-stem--up"></span>
          <span class="timeline-dot"></span>
        </div>
        <div class="timeline-fill" aria-hidden="true"></div>`
        : `<div class="timeline-fill" aria-hidden="true"></div>
        <div class="timeline-axis-slot" aria-hidden="true">
          <span class="timeline-dot"></span>
          <span class="timeline-stem timeline-stem--down"></span>
        </div>
        <div class="timeline-card">${cardInner}</div>`;
      list.appendChild(li);
    });
  };

  const wireTimelineAutoscroll = () => {
    const scrollEl = $("#timeline-scroll");
    const shell = $("#timeline-shell");
    const listEl = $("#timeline-list");
    const sectionEl = document.getElementById("timeline");
    const playToggleBtn = $("#timeline-play-toggle");
    const restartBtn = $("#timeline-restart");
    if (!scrollEl || !shell) return;

    const mqVerticalRail = window.matchMedia("(max-width: 860px)");

    /* Autoplay unless explicitly opted out (attribute missing = on, matching original behaviour). */
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let autoplay = !reduceMotion && scrollEl.dataset.autoplay === "true";
    let sectionVisible = false;
    let rafId = 0;
    /* Visible drift at ~27px/s @ 60fps; small values were easy to dismiss as “not moving”. */
    const speed = 0.45;
    const ioTarget = sectionEl || shell;

    const syncChrome = () => {
      scrollEl.classList.toggle("is-autoplay-paused", !autoplay);
      if (!playToggleBtn) return;
      playToggleBtn.setAttribute("aria-pressed", autoplay ? "true" : "false");
      const text = playToggleBtn.querySelector(".ghost-btn__text");
      if (text) text.textContent = autoplay ? "Pause timeline" : "Play timeline";
    };

    const applyTimelineLayoutMode = () => {
      const stacked = mqVerticalRail.matches;
      scrollEl.classList.toggle("timeline-h-scroll--stacked", stacked);
      [playToggleBtn, restartBtn].forEach((btn) => {
        if (!btn) return;
        if (stacked) {
          btn.disabled = true;
          btn.setAttribute("aria-disabled", "true");
        } else {
          btn.disabled = false;
          btn.removeAttribute("aria-disabled");
        }
      });
      if (stacked) {
        autoplay = false;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        playToggleBtn?.setAttribute(
          "title",
          "Autoplay applies to the horizontal timeline on wider screens."
        );
        restartBtn?.setAttribute(
          "title",
          "Restart applies to the horizontal timeline on wider screens."
        );
      } else {
        playToggleBtn?.removeAttribute("title");
        restartBtn?.removeAttribute("title");
      }
      syncChrome();
    };

    const tick = () => {
      if (!autoplay || !sectionVisible) {
        rafId = 0;
        return;
      }
      const max = scrollEl.scrollWidth - scrollEl.clientWidth;
      if (max <= 0) {
        /* Do not RAF-spin: wait for ResizeObserver/fonts when rail width catches up with layout. */
        rafId = 0;
        return;
      }
      if (scrollEl.scrollLeft >= max - 0.5) {
        scrollEl.scrollLeft = max;
        rafId = 0;
        return;
      }
      scrollEl.scrollLeft = Math.min(max, scrollEl.scrollLeft + speed);
      rafId = requestAnimationFrame(tick);
    };

    const startIfNeeded = () => {
      if (!autoplay || !sectionVisible) return;
      const max = scrollEl.scrollWidth - scrollEl.clientWidth;
      if (max > 0 && scrollEl.scrollLeft >= max - 0.5) {
        /* If user re-enters after reaching the end, restart autoplay from the beginning. */
        scrollEl.scrollLeft = 0;
      }
      if (rafId) return;
      rafId = requestAnimationFrame(tick);
    };
    const toggleAutoplay = () => {
      if (playToggleBtn?.disabled) return;
      autoplay = !autoplay;
      if (!autoplay && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      syncChrome();
      startIfNeeded();
    };
    const restartTimeline = () => {
      if (restartBtn?.disabled) return;
      scrollEl.scrollLeft = 0;
      startIfNeeded();
    };

    window.addEventListener("resize", () => {
      if (sectionVisible) startIfNeeded();
    });

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (sectionVisible) startIfNeeded();
      });
      ro.observe(scrollEl);
      if (listEl) ro.observe(listEl);
    }

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (sectionVisible) startIfNeeded();
      });
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          sectionVisible = en.isIntersecting;
          if (sectionVisible) {
            startIfNeeded();
          } else if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
        });
      },
      /* Whole section covers the hero→rail span; threshold 0 matches “any overlap”. */
      { root: null, threshold: 0 }
    );
    io.observe(ioTarget);
    playToggleBtn?.addEventListener("click", toggleAutoplay);
    restartBtn?.addEventListener("click", restartTimeline);

    mqVerticalRail.addEventListener("change", () => {
      applyTimelineLayoutMode();
      requestAnimationFrame(() => startIfNeeded());
    });
    applyTimelineLayoutMode();

    syncChrome();
    const wr = ioTarget.getBoundingClientRect();
    if (wr.top < window.innerHeight && wr.bottom > 0) {
      sectionVisible = true;
      requestAnimationFrame(() => startIfNeeded());
    }

    /* After charts + ScrollTrigger.refresh(), layout can shift; production CDNs also cache JS. */
    window.refreshTimelineAutoplay = () => {
      requestAnimationFrame(() => startIfNeeded());
    };
    window.addEventListener("load", () => {
      window.refreshTimelineAutoplay();
    });

    scrollEl.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 280 : -280;
      scrollEl.scrollBy({ left: step, behavior: reduceMotion ? "auto" : "smooth" });
    });
  };

  const wireKBLinks = () => {
    $$("a.kb-link[data-kb]").forEach(link => {
      const slug = link.dataset.kb;
      if (!slug) return;
      if (link.getAttribute("href") === "#sources") {
        link.setAttribute("href", kbHref(slug));
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    });
  };

  // ------------------------------------------------------------
  // Regression tables
  // ------------------------------------------------------------
  const dwClass = v => v == null ? "" : (v < 1.2 || v > 2.8 ? "dw-bad" : (v < 1.5 || v > 2.5 ? "" : "dw-ok"));
  const pClass = v => v == null ? "" : (v < 0.05 ? "p-sig" : "p-notsig");

  const tierFor = (r) => {
    const bh = r.min_p_bh, bf = r.min_p_bonf, raw = r.min_p_raw;
    if (bh != null && bh < 0.05) return { cls: "tier-bh", label: "BH", title: "Passes strict BH many-test check" };
    if (bf != null && bf < 0.05) return { cls: "tier-bonf", label: "Bonf", title: "Passes very harsh Bonferroni check" };
    if (raw != null && raw < 0.05) return { cls: "tier-raw", label: "Raw", title: "Passes basic 5% bar only" };
    return { cls: "tier-ns", label: "n/s", title: "Not significant at 5%" };
  };
  const tierPill = (r) => {
    const t = tierFor(r);
    return `<span class="tier-pill ${t.cls}" title="${t.title}">${t.label}</span>`;
  };

  const makeRow = (r, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.specId = r.spec_id;
    tr.dataset.dw = r.diagnostics.dw ?? "";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-expanded", "false");
    tr.setAttribute("aria-label", `Expand estimates for ${r.y_label}`);
    const joined = `${r.y_label} ${r.x_labels.join(" ")}`.toLowerCase();
    if (joined.includes("top 1") && joined.includes("trade")) tr.id = "row-trade-top1";
    if (joined.includes("unemployment") && joined.includes("trade")) tr.id = "row-trade-unemp";
    if (joined.includes("gear") || joined.includes("1996")) tr.id = "row-gear-break";
    tr.innerHTML = `
      <td class="num">${idx}</td>
      <td><span class="outcome-cell">${tierPill(r)}${r.y_label}</span></td>
      <td>${r.x_labels.join(" + ")}</td>
      <td>${r.sample}</td>
      <td class="num">${fmt.n(r.n)}</td>
      <td class="num">${fmt.r2(r.r2)}</td>
      <td class="num ${pClass(r.min_p_raw)}">${fmt.p(r.min_p_raw)}</td>
      <td class="num ${pClass(r.min_p_bonf)}">${fmt.p3(r.min_p_bonf)}</td>
      <td class="num ${pClass(r.min_p_bh)}">${fmt.p3(r.min_p_bh)}</td>
      <td class="num ${dwClass(r.diagnostics.dw)}">${fmt.dw(r.diagnostics.dw)}</td>
      <td class="num">${fmt.p3(r.diagnostics.bp_pvalue)}</td>
      <td class="num">${fmt.p3(r.diagnostics.lb_pvalue)}</td>
    `;
    tr.addEventListener("click", () => toggleExpand(tr, r));
    tr.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleExpand(tr, r);
    });
    return tr;
  };

  const makeRowAll = (r) => {
    const tr = document.createElement("tr");
    tr.dataset.dw = r.diagnostics.dw ?? "";
    tr.innerHTML = `
      <td><span class="outcome-cell">${tierPill(r)}${r.y_label}</span></td>
      <td>${r.x_labels.join(" + ")}</td>
      <td>${r.sample}</td>
      <td class="num">${fmt.n(r.n)}</td>
      <td class="num">${fmt.r2(r.r2)}</td>
      <td class="num ${pClass(r.min_p_raw)}">${fmt.p(r.min_p_raw)}</td>
      <td class="num ${pClass(r.min_p_bonf)}">${fmt.p3(r.min_p_bonf)}</td>
      <td class="num ${pClass(r.min_p_bh)}">${fmt.p3(r.min_p_bh)}</td>
      <td class="num ${dwClass(r.diagnostics.dw)}">${fmt.dw(r.diagnostics.dw)}</td>
      <td class="num">${fmt.p3(r.diagnostics.bp_pvalue)}</td>
      <td class="num">${fmt.p3(r.diagnostics.lb_pvalue)}</td>
    `;
    return tr;
  };

  const toggleExpand = (tr, r) => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("row-expander") && next.dataset.specId === r.spec_id) {
      next.remove();
      tr.classList.remove("row-open");
      tr.setAttribute("aria-expanded", "false");
      window.refreshResultsScrolly?.();
      return;
    }
    // remove any other expander in this table
    $$("tr.row-expander", tr.parentElement).forEach(n => n.remove());
    $$("tr.row-open", tr.parentElement).forEach(n => {
      n.classList.remove("row-open");
      n.setAttribute("aria-expanded", "false");
    });
    tr.classList.add("row-open");
    tr.setAttribute("aria-expanded", "true");
    const ex = document.createElement("tr");
    ex.classList.add("row-expander");
    ex.dataset.specId = r.spec_id;
    const td = document.createElement("td");
    td.colSpan = 12;
    const coefRows = r.coefficients.map(c => `
      <span class="var">${c.label}</span>
      <span class="c">Estimate = ${fmt.coef(c.coef)}</span>
      <span class="s">SE = ${fmt.coef(c.se)}</span>
      <span class="c">t = ${c.t.toFixed(2)}</span>
      <span class="p ${c.p < 0.05 ? "" : "notsig"}">p = ${fmt.p(c.p)}</span>
    `).join("");
    const vif = r.diagnostics.vif
      ? Object.entries(r.diagnostics.vif).map(([k, v]) => `${k}=${v == null ? "–" : v.toFixed(2)}`).join(" · ")
      : "n/a (univariate)";
    td.innerHTML = `
      <div class="coef-grid">
        <span class="h">Variable</span><span class="h">Estimate</span><span class="h">SE</span><span class="h">t</span><span class="h">p</span>
        ${coefRows}
      </div>
      <div class="expander-meta">
        HAC lags = ${r.hac_lags} · F-test p = ${fmt.p(r.f_pvalue)} · VIF: ${vif}
      </div>`;
    ex.appendChild(td);
    tr.after(ex);
    window.refreshResultsScrolly?.();
  };

  const renderRegressionTables = (payload) => {
    const meta = payload.meta;
    const setText = (sel, val) => {
      const el = $(sel);
      if (el) el.textContent = String(val);
    };
    setText("#m-total", meta.n_specs);
    setText("#m-raw", meta.n_sig_raw);
    setText("#m-bonf", meta.n_sig_bonf);
    setText("#m-bh", meta.n_sig_bh);
    setText("#spec-count", meta.n_specs.toLocaleString());
    setText("#m-total-inline", meta.n_specs.toLocaleString());
    setText("#all-count", meta.n_specs);

    const headlineBody = $("#headline-table tbody");
    if (headlineBody) payload.headline.forEach((r, i) => headlineBody.appendChild(makeRow(r, i + 1)));

    const allBody = $("#all-table tbody");
    if (allBody) payload.all_specs.slice(0, 400).forEach(r => allBody.appendChild(makeRowAll(r)));

    // Chow
    const chowBody = $("#chow-table tbody");
    if (chowBody) {
      payload.chow.filter(r => r.status === "ok").forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.y_label}</td>
          <td>${r.x_labels.join(" + ")}</td>
          <td class="num">${r.n}</td>
          <td class="num">${r.F.toFixed(3)}</td>
          <td class="num ${pClass(r.p)}">${fmt.p(r.p)}</td>`;
        chowBody.appendChild(tr);
      });
    }

    // Cointegration
    const coiBody = $("#coint-table tbody");
    if (coiBody) {
      payload.cointegration.filter(r => r.status === "ok").forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.y_label}</td>
          <td>${r.x_label}</td>
          <td class="num">${r.n}</td>
          <td class="num">${fmt.p3(r.adf_y_p)}</td>
          <td class="num">${fmt.p3(r.adf_x_p)}</td>
          <td class="num">${r.eg_stat.toFixed(3)}</td>
          <td class="num ${pClass(r.eg_p)}">${fmt.p(r.eg_p)}</td>`;
        coiBody.appendChild(tr);
      });
    }
    const egGdpTrade = payload.cointegration.find(r => r.y === "log_gdp_pc" && r.x === "wdi_trade_gdp");
    if (egGdpTrade && egGdpTrade.status === "ok") {
      const el = $("#coint-gdp-trade");
      if (el) el.textContent = `p ≈ ${egGdpTrade.eg_p.toFixed(2)}`;
    }

    // Granger
    const grBody = $("#granger-table tbody");
    if (grBody) {
      payload.granger.filter(r => r.status === "ok").forEach(r => {
        const p = r.p_by_lag;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.description}</td>
          <td class="num">${r.n}</td>
          <td class="num ${pClass(p["1"])}">${fmt.p3(p["1"])}</td>
          <td class="num ${pClass(p["2"])}">${fmt.p3(p["2"])}</td>
          <td class="num ${pClass(p["3"])}">${fmt.p3(p["3"])}</td>`;
        grBody.appendChild(tr);
      });
    }

    // Glossary dropdown
    const glossarySel = $("#glossary-select");
    const glossaryDef = $("#glossary-def");
    if (glossarySel && glossaryDef) {
      glossarySel.addEventListener("change", () => {
        const opt = glossarySel.selectedOptions[0];
        glossaryDef.textContent = opt?.dataset?.def ?? "";
      });
    }

    // DW filter
    $("#dw-filter")?.addEventListener("change", e => {
      const hide = e.target.checked;
      $$("tr[data-dw]", document).forEach(tr => {
        const dw = parseFloat(tr.dataset.dw);
        tr.style.display = (hide && !Number.isNaN(dw) && dw < 1.5) ? "none" : "";
      });
    });
  };

  // ------------------------------------------------------------
  // Leaflet map: SA-only bounds, provincial choropleth, metro markers when zoomed
  // ------------------------------------------------------------
  // Plain corner array (not L.latLngBounds) so this module-level constant does not
  // reference Leaflet's global `L`, which is now lazy-loaded. Leaflet accepts this
  // form directly for the `maxBounds` option.
  const SA_MAP_BOUNDS = [[-35.35, 15.65], [-21.25, 34.05]];
  const METRO_ZOOM_MIN = 8;
  /** Representative centres for the eight metros (QLFS Metro_code); display only. */
  const METRO_COORDS = {
    "City of Cape Town": [-33.9249, 18.4241],
    "Buffalo City": [-32.9963, 27.8964],
    "Nelson Mandela Bay": [-33.9138, 25.5827],
    "Mangaung": [-29.1194, 26.218],
    "eThekwini": [-29.8587, 31.0218],
    "Ekurhuleni": [-26.1715, 28.3183],
    "City of Johannesburg": [-26.2041, 28.0473],
    "City of Tshwane": [-25.7461, 28.1881],
  };
  /** Choropleth ramp: green in dark theme, blue in light (matches CSS --map-choro-legend-*). */
  const choroRgbEndpoints = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    if (dark) {
      return { low: [209, 250, 229], high: [6, 78, 59] };
    }
    return { low: [239, 246, 255], high: [30, 58, 138] };
  };

  const fillColorForRate = (rate, vmin, vmax) => {
    const span = vmax - vmin;
    let t = span > 0.001 ? (rate - vmin) / span : 0.5;
    t = Math.max(0, Math.min(1, t));
    const { low, high } = choroRgbEndpoints();
    const r = Math.round(low[0] + (high[0] - low[0]) * t);
    const g = Math.round(low[1] + (high[1] - low[1]) * t);
    const b = Math.round(low[2] + (high[2] - low[2]) * t);
    return `rgb(${r},${g},${b})`;
  };

  let provSpreadChart = null;

  const renderMapSpreadInsight = (series) => {
    const mapStatKeys = ["map-national", "map-spread", "map-anchor"];
    const clearLoading = () => {
      mapStatKeys.forEach((key) => {
        const root = document.querySelector(`[data-stat="${key}"]`);
        root?.classList.remove("sector-stat--loading", "sector-stat--error");
      });
    };
    const ins = series?.spread_insight;
    const waves = series?.waves;
    if (!ins || !waves?.length) {
      clearLoading();
      mapStatKeys.forEach((key) => {
        document.querySelector(`[data-stat="${key}"]`)?.classList.add("sector-stat--error");
      });
      return;
    }
    const fmtRate = (v) => (v == null ? "–" : `${Number(v).toFixed(1)}%`);
    const fmtPp = (v) => (v == null ? "–" : `${Number(v).toFixed(1)} pp`);
    const fmtDeltaPp = (d) => {
      if (d == null || Number.isNaN(d)) return "–";
      const sign = d > 0 ? "+" : d < 0 ? "−" : "";
      return `${sign}${Math.abs(d).toFixed(1)} pp`;
    };
    const paintStat = ({
      cardKey,
      startText,
      endText,
      startYear,
      endYear,
      deltaText,
      trend = "up",
    }) => {
      const root = document.querySelector(`[data-stat="${cardKey}"]`);
      if (!root) return;
      root.classList.remove("sector-stat--down", "sector-stat--up", "sector-stat--worse", "sector-stat--flat");
      root.classList.add(`sector-stat--${trend}`);
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set(`stat-${cardKey}-start`, startText);
      set(`stat-${cardKey}-end`, endText);
      set(`stat-${cardKey}-start-yr`, startYear);
      set(`stat-${cardKey}-end-yr`, endYear);
      set(`stat-${cardKey}-delta`, deltaText);
      const arrow = document.getElementById(`stat-${cardKey}-arrow`);
      if (arrow) {
        arrow.textContent = trend === "down" ? "↓" : (trend === "up" || trend === "worse") ? "↑" : "→";
      }
    };

    const worseIfRising = (delta) => (delta > 0 ? "worse" : delta < 0 ? "up" : "flat");

    paintStat({
      cardKey: "map-national",
      startText: fmtRate(ins.national_start),
      endText: fmtRate(ins.national_end),
      startYear: ins.start_label,
      endYear: ins.end_label,
      deltaText: fmtDeltaPp(ins.national_delta_pp),
      trend: worseIfRising(ins.national_delta_pp),
    });
    paintStat({
      cardKey: "map-spread",
      startText: fmtPp(ins.spread_start_pp),
      endText: fmtPp(ins.spread_end_pp),
      startYear: ins.start_label,
      endYear: ins.end_label,
      deltaText: fmtDeltaPp(ins.spread_delta_pp),
      trend: worseIfRising(ins.spread_delta_pp),
    });

    const d0 = waves[0].dispersion;
    const d1 = waves[waves.length - 1].dispersion;
    const anchorRoot = document.querySelector('[data-stat="map-anchor"]');
    if (anchorRoot && d0 && d1) {
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set("stat-map-anchor-low-name", d0.min_province);
      set("stat-map-anchor-high-name", d0.max_province);
      set("stat-map-anchor-low", `${d0.min_rate.toFixed(1)}% → ${d1.min_rate.toFixed(1)}%`);
      set("stat-map-anchor-high", `${d0.max_rate.toFixed(1)}% → ${d1.max_rate.toFixed(1)}%`);
      set("stat-map-anchor-years", `${ins.start_label} → ${ins.end_label}`);
      anchorRoot.classList.remove("sector-stat--down", "sector-stat--up", "sector-stat--worse", "sector-stat--flat");
      anchorRoot.classList.add(worseIfRising(ins.spread_delta_pp));
    }
    clearLoading();
  };

  const buildProvincialSpreadChart = (series) => {
    const canvas = $("#chart-prov-spread");
    if (!canvas || !series?.waves?.length) return;
    const waves = series.waves.filter((w) => w.dispersion?.spread_pp != null);
    if (!waves.length) return;
    const years = waves.map((w) => w.year + (w.quarter - 1) / 4);
    const values = waves.map((w) => w.dispersion.spread_pp);
    if (provSpreadChart) provSpreadChart.destroy();
    provSpreadChart = makeLineChart(canvas, {
      labels: years,
      datasets: [
        datasetFrom(
          years,
          { label: "Provincial spread (max − min)", values },
          "danger",
          { borderWidth: 2.4, pointRadius: 0, pointHoverRadius: 4, paletteKey: "danger" },
        ),
      ],
      yTitle: "Spread (percentage points)",
      xTitle: "Year",
      xMin: Math.floor(years[0]),
    });
    themeRefreshFns.push(() => {
      if (!provSpreadChart) return;
      const p = palette();
      provSpreadChart.data.datasets.forEach((ds) => {
        const color = colorFrom(ds.paletteKey || "danger");
        ds.borderColor = color;
        ds.backgroundColor = `${color}33`;
        ds.pointBackgroundColor = color;
      });
      provSpreadChart.update("none");
    });
  };

  const buildMap = async (series) => {
    renderMapSpreadInsight(series);
    buildProvincialSpreadChart(series);

    const el = $("#za-map");
    if (!el || typeof L === "undefined") return;
    const waves = series?.waves;
    if (!waves?.length) {
      console.warn("map: no wave data");
      return;
    }

    const citeRoot = $("#map-data-citation");
    if (citeRoot && (series.citation_apa || series.method_note || (series.citation_urls && series.citation_urls.length))) {
      citeRoot.replaceChildren();
      const summary = document.createElement("summary");
      summary.textContent = "Statistics South Africa (1994-2025)";
      citeRoot.appendChild(summary);
      const citeBody = document.createElement("div");
      citeBody.className = "map-methodology__toggle-body";
      if (series.citation_apa) {
        const p = document.createElement("p");
        p.className = "map-citation-apa";
        const cite = document.createElement("cite");
        cite.textContent = series.citation_apa;
        p.appendChild(cite);
        citeBody.appendChild(p);
      }
      if (Array.isArray(series.citation_urls) && series.citation_urls.length) {
        const linkRow = document.createElement("p");
        linkRow.className = "map-citation-links";
        const labels = Array.isArray(series.citation_link_labels) ? series.citation_link_labels : [];
        series.citation_urls.forEach((url, i) => {
          if (!url || typeof url !== "string") return;
          if (linkRow.childElementCount > 0) {
            linkRow.appendChild(document.createTextNode(" · "));
          }
          const a = document.createElement("a");
          a.href = url;
          a.rel = "noopener noreferrer";
          a.target = "_blank";
          let label = labels[i];
          if (!label) {
            try {
              label = new URL(url).hostname.replace(/^www\./u, "");
            } catch {
              label = url.replace(/^https?:\/\//u, "");
            }
          }
          a.textContent = label;
          linkRow.appendChild(a);
        });
        if (linkRow.childElementCount) citeBody.appendChild(linkRow);
      }
      if (series.method_note) {
        const mn = document.createElement("p");
        mn.className = "map-method-note";
        mn.textContent = series.method_note;
        citeBody.appendChild(mn);
      }
      if (series.method_note_detail) {
        const subhead = document.createElement("p");
        subhead.className = "map-methodology__toggle-subhead";
        subhead.textContent = "Technical notes (harmonisation)";
        citeBody.appendChild(subhead);
        const detailItems = Array.isArray(series.method_note_detail)
          ? series.method_note_detail
          : String(series.method_note_detail)
              .split(/(?<=[.])\s+(?=[A-Z])/)
              .map((s) => s.trim())
              .filter(Boolean);
        if (detailItems.length > 1) {
          const list = document.createElement("ul");
          list.className = "map-method-detail-list";
          detailItems.forEach((line) => {
            const li = document.createElement("li");
            li.textContent = line;
            list.appendChild(li);
          });
          citeBody.appendChild(list);
        } else {
          const body = document.createElement("p");
          body.className = "map-method-detail-body";
          body.textContent = detailItems[0] || series.method_note_detail;
          citeBody.appendChild(body);
        }
      }
      citeRoot.appendChild(citeBody);
    }

    const gj = await fetchJSON("zaf-provinces.geojson");
    const legendRangeEl = $("#map-legend-range");
    const legendHintEl = $("#map-metro-zoom-hint");

    const map = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
      minZoom: 5,
      maxZoom: 11,
      maxBounds: SA_MAP_BOUNDS,
      maxBoundsViscosity: 1,
    }).setView([-28.9, 25.2], 5);
    const tile = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 11,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © CARTO · '
        + 'Province outlines: <a href="https://gadm.org" target="_blank" rel="noopener noreferrer">GADM</a>',
      opacity: 0.62,
    }).addTo(map);

    let waveIndex = 0;
    const currentScale = { wave: waves[waveIndex] };
    const mapScrolly = $("#map-scrolly");
    const comparePanel = $("#map-compare");
    const compareStartCap = $("#map-compare-start-caption");
    const compareEndCap = $("#map-compare-end-caption");
    const scrollyHintEl = $("#map-scrolly-hint");

    /** Min/max narrow unemployment across every province & metro in every wave; fixed legend so time animation is comparable. */
    const ratesForFixedScale = [];
    waves.forEach((wv) => {
      Object.values(wv.provinces || {}).forEach((v) => {
        if (typeof v === "number") ratesForFixedScale.push(v);
      });
      Object.values(wv.metros || {}).forEach((v) => {
        if (typeof v === "number") ratesForFixedScale.push(v);
      });
    });
    let mapFixedVmin = ratesForFixedScale.length ? Math.min(...ratesForFixedScale) : 0;
    let mapFixedVmax = ratesForFixedScale.length ? Math.max(...ratesForFixedScale) : 50;
    if (mapFixedVmax - mapFixedVmin < 1) {
      mapFixedVmin = Math.max(0, mapFixedVmin - 3);
      mapFixedVmax = mapFixedVmax + 3;
    }

    const strokeForTheme = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      return dark ? "rgba(231,235,241,0.42)" : "rgba(24,28,35,0.5)";
    };

    const styleProvince = feature => {
      const name = feature.properties.province;
      const rate = currentScale.wave.provinces[name];
      const r = typeof rate === "number" ? rate : 0;
      return {
        fillColor: fillColorForRate(r, mapFixedVmin, mapFixedVmax),
        weight: 1.15,
        color: strokeForTheme(),
        fillOpacity: 0.88,
      };
    };

    const metroTooltip = (name, rate) =>
      `<strong>${name}</strong><br><span class="mono">Narrow unemployment: ${typeof rate === "number" ? rate.toFixed(1) : "–"}%</span>`;

    const metroLayer = L.layerGroup();
    const metroEntries = [];
    Object.keys(METRO_COORDS).forEach((name) => {
      const [lat, lng] = METRO_COORDS[name];
      const marker = L.circleMarker([lat, lng], {
        radius: 11,
        stroke: true,
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.92,
      });
      marker.bindTooltip(metroTooltip(name, null), { sticky: true, direction: "top", className: "za-map-metro-tip" });
      metroEntries.push({ marker, name, hover: false });
      marker.addTo(metroLayer);
    });

    const provLayer = L.geoJSON(gj, {
      style: styleProvince,
      onEachFeature: (feature, lyr) => {
        const pname = feature.properties.province;
        lyr.bindTooltip("", { sticky: true, className: "za-map-prov-tip" });
        lyr.on({
          mouseover: (e) => {
            e.target.setStyle({ weight: 2.6, color: palette().accent });
            e.target.bringToFront();
          },
          mouseout: (e) => {
            e.target.setStyle(styleProvince(e.target.feature));
          },
        });
      },
    }).addTo(map);

    const applyMetroStyles = () => {
      const w = currentScale.wave;
      const metros = w.metros || {};
      metroEntries.forEach((entry) => {
        const rate = metros[entry.name];
        const r = typeof rate === "number" ? rate : 0;
        entry.marker.setStyle({
          radius: 9 + Math.min(12, r / 4),
          color: entry.hover ? palette().accent : strokeForTheme(),
          weight: entry.hover ? 2.4 : 1.5,
          fillColor: fillColorForRate(r, mapFixedVmin, mapFixedVmax),
        });
        entry.marker.setTooltipContent(metroTooltip(entry.name, typeof rate === "number" ? rate : null));
      });
    };

    const waveHasMetros = () => {
      const m = waves[waveIndex]?.metros;
      return m && typeof m === "object" && Object.keys(m).length > 0;
    };

    const syncMetroLayerZoom = () => {
      const z = map.getZoom();
      const ok = waveHasMetros();
      if (ok && z >= METRO_ZOOM_MIN) {
        if (!map.hasLayer(metroLayer)) metroLayer.addTo(map);
        if (legendHintEl) legendHintEl.hidden = true;
      } else {
        if (map.hasLayer(metroLayer)) map.removeLayer(metroLayer);
        if (legendHintEl) legendHintEl.hidden = false;
      }
    };

    const playBtn = $("#map-play-pause");
    const playLabel = $("#map-play-label");
    const periodEl = $("#map-period-label");
    const sliderEl = $("#map-wave-slider");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let playing = false;
    let autoplayTimer = null;
    let comparePairBuilt = false;
    let playbackCompleted = false;
    let scrollDriveActive = !reduceMotion;

    if (playLabel) playLabel.textContent = "Play";
    if (playBtn) playBtn.setAttribute("aria-pressed", "false");
    if (scrollyHintEl && reduceMotion) {
      scrollyHintEl.innerHTML = "Use the <strong>slider</strong> or <strong>Play</strong> to move through quarters. After you reach the <strong>last</strong> quarter once, a before-and-after comparison appears below.";
    }

    const markPlaybackComplete = () => {
      if (playbackCompleted) return;
      playbackCompleted = true;
      scrollDriveActive = false;
      setScrollyHeight();
      buildComparePairOnce();
      if (scrollyHintEl) {
        scrollyHintEl.innerHTML =
          "Animation complete. Compare the <strong>first and latest</strong> quarters below, or drag the slider to revisit any quarter.";
      }
      comparePanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const setPlaying = (on) => {
      playing = on;
      if (playBtn) playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
      if (playLabel) playLabel.textContent = playing ? "Pause" : "Play";
      if (playing) startAutoplay();
      else stopAutoplay();
    };

    const stopAutoplay = () => {
      if (autoplayTimer) {
        clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
    };

    /** ~20 seconds for one full loop through all quarters (interval scales with wave count). */
    const mapPlayStepMs = Math.max(120, Math.round(20000 / Math.max(1, waves.length)));

    const startAutoplay = () => {
      stopAutoplay();
      if (!playing) return;
      if (waveIndex >= waves.length - 1) {
        markPlaybackComplete();
        setPlaying(false);
        return;
      }
      autoplayTimer = setInterval(() => {
        if (waveIndex < waves.length - 1) {
          waveIndex += 1;
          applyWave(waveIndex);
        }
        if (waveIndex >= waves.length - 1) {
          markPlaybackComplete();
          setPlaying(false);
        }
      }, mapPlayStepMs);
    };

    const mountSideBySideMap = (containerEl, waveData) => {
      if (!containerEl || containerEl._leaflet_id) return null;
      const mini = L.map(containerEl, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
        minZoom: 5,
        maxZoom: 11,
        maxBounds: SA_MAP_BOUNDS,
        maxBoundsViscosity: 1,
      }).setView([-28.9, 25.2], 5);
      const tl = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 11,
        attribution: "",
        opacity: document.documentElement.dataset.theme === "dark" ? 0.42 : 0.62,
      }).addTo(mini);
      const wRef = { wave: waveData };
      const styleMini = (feature) => {
        const nm = feature.properties.province;
        const rate = wRef.wave.provinces[nm];
        const r = typeof rate === "number" ? rate : 0;
        return {
          fillColor: fillColorForRate(r, mapFixedVmin, mapFixedVmax),
          weight: 1.1,
          color: strokeForTheme(),
          fillOpacity: 0.88,
        };
      };
      const lyr = L.geoJSON(gj, {
        style: styleMini,
        onEachFeature: (feature, lyr2) => {
          const pname = feature.properties.province;
          lyr2.bindTooltip("", { sticky: true, className: "za-map-prov-tip" });
          lyr2.on({
            mouseover: (e) => {
              e.target.setStyle({ weight: 2.4, color: palette().accent });
              e.target.bringToFront();
            },
            mouseout: (e) => {
              e.target.setStyle(styleMini(e.target.feature));
            },
          });
        },
      }).addTo(mini);
      const syncTips = () => {
        lyr.eachLayer((ly2) => {
          const pname = ly2.feature.properties.province;
          const r = wRef.wave.provinces[pname];
          const pct = typeof r === "number" ? r.toFixed(1) : "–";
          ly2.setTooltipContent(`<strong>${pname}</strong><br><span class="mono">Narrow unemployment: ${pct}%</span>`);
        });
      };
      syncTips();
      mini.fitBounds(lyr.getBounds(), { padding: [10, 10] });
      const refreshMini = () => {
        tl.setOpacity(document.documentElement.dataset.theme === "dark" ? 0.42 : 0.62);
        lyr.eachLayer((ly2) => ly2.setStyle(styleMini(ly2.feature)));
      };
      return { map: mini, refreshMini };
    };

    const buildComparePairOnce = () => {
      if (comparePairBuilt || !comparePanel) return;
      const startEl = $("#za-map-compare-start");
      const endEl = $("#za-map-compare-end");
      if (!startEl || !endEl) return;
      comparePairBuilt = true;
      comparePanel.hidden = false;
      const w0 = waves[0];
      const w1 = waves[waves.length - 1];
      const compareLede = $("#map-compare-lede");
      const ins = series?.spread_insight;
      if (compareLede && ins?.spread_start_pp != null && ins?.national_delta_pp != null) {
        compareLede.textContent =
          `Spread widened from ${ins.spread_start_pp.toFixed(1)} to ${ins.spread_end_pp.toFixed(1)} pp while national unemployment rose ${ins.national_delta_pp.toFixed(1)} pp (${ins.start_label} → ${ins.end_label}). Lighter color = lower unemployment, darker = higher.`;
      }
      if (compareStartCap) compareStartCap.textContent = `${w0.label}${w0.national != null ? ` · National ${w0.national}%` : ""}`;
      if (compareEndCap) compareEndCap.textContent = `${w1.label}${w1.national != null ? ` · National ${w1.national}%` : ""}`;
      const a = mountSideBySideMap(startEl, w0);
      const b = mountSideBySideMap(endEl, w1);
      [a, b].forEach((x) => {
        if (x?.refreshMini) mapThemeRefreshers.push(x.refreshMini);
      });
      requestAnimationFrame(() => {
        a?.map?.invalidateSize();
        b?.map?.invalidateSize();
      });
    };

    const PX_PER_WAVE = 52;
    const setScrollyHeight = () => {
      if (!mapScrolly || !scrollDriveActive) {
        if (mapScrolly) mapScrolly.style.minHeight = "";
        return;
      }
      const stickyInner = mapScrolly.querySelector(".map-scrolly-sticky");
      const base = stickyInner ? stickyInner.offsetHeight : 560;
      const extra = Math.max(2000, (waves.length - 1) * PX_PER_WAVE);
      mapScrolly.style.minHeight = `${base + extra}px`;
    };

    let scrollRaf = null;
    const onScrollProgress = () => {
      if (!scrollDriveActive || !mapScrolly || waves.length < 2) return;
      const rect = mapScrolly.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const start = top;
      const end = top + mapScrolly.offsetHeight - window.innerHeight;
      const range = Math.max(1, end - start);
      let t = (window.scrollY - start) / range;
      t = Math.max(0, Math.min(1, t));
      const idx = Math.round(t * (waves.length - 1));
      if (idx !== waveIndex && !playing) {
        waveIndex = idx;
        applyWave(waveIndex);
      }
      if (waves.length > 1 && t >= 0.997) {
        markPlaybackComplete();
      }
    };

    const scheduleScrollTick = () => {
      if (!scrollDriveActive) return;
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        onScrollProgress();
      });
    };

    const applyWave = (i) => {
      waveIndex = Math.max(0, Math.min(waves.length - 1, i));
      const w = waves[waveIndex];
      currentScale.wave = w;

      const nat = w.national != null ? ` · National ${w.national}%` : "";
      if (periodEl) periodEl.textContent = `${w.label}${nat}`;
      if (sliderEl) sliderEl.value = String(waveIndex);
      if (legendRangeEl) {
        legendRangeEl.textContent = `${mapFixedVmin.toFixed(1)}% to ${mapFixedVmax.toFixed(1)}% (fixed scale, all quarters)`;
      }
      if (legendHintEl) {
        const ok = w.metros && Object.keys(w.metros).length > 0;
        legendHintEl.textContent = ok
          ? "Tip: zoom in on the map (scroll or +/−) to show unemployment for the eight metropolitan municipalities."
          : "Metro municipality dots use the Stats SA Metro_code scheme from 2015 Q1 onward; scrub the slider to 2015 or later, then zoom in.";
      }

      provLayer.eachLayer((ly) => {
        ly.setStyle(styleProvince(ly.feature));
        const pname = ly.feature.properties.province;
        const r = w.provinces[pname];
        const pct = typeof r === "number" ? r.toFixed(1) : "–";
        ly.setTooltipContent(`<strong>${pname}</strong><br><span class="mono">Narrow unemployment: ${pct}%</span>`);
      });
      applyMetroStyles();
      syncMetroLayerZoom();
    };

    const applyMapTheme = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      tile.setOpacity(dark ? 0.42 : 0.62);
      applyWave(waveIndex);
    };

    metroEntries.forEach((entry) => {
      entry.marker.on("mouseover", () => {
        entry.hover = true;
        applyMetroStyles();
      });
      entry.marker.on("mouseout", () => {
        entry.hover = false;
        applyMetroStyles();
      });
    });

    map.on("zoomend", syncMetroLayerZoom);

    if (sliderEl) {
      sliderEl.max = String(waves.length - 1);
      sliderEl.addEventListener("input", () => {
        const v = Number.parseInt(sliderEl.value, 10);
        if (Number.isFinite(v)) {
          setPlaying(false);
          applyWave(v);
          if (reduceMotion && v >= waves.length - 1) {
            markPlaybackComplete();
          }
        }
      });
    }

    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (!playing && waveIndex >= waves.length - 1) {
          waveIndex = 0;
          applyWave(0);
        }
        setPlaying(!playing);
      });
    }

    applyWave(waveIndex);

    const mapSection = $("#map");
    if (mapSection) {
      const visObs = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            map.invalidateSize();
          } else {
            stopAutoplay();
            setPlaying(false);
          }
        });
      }, { threshold: 0.12 });
      visObs.observe(mapSection);
    }

    mapThemeRefreshers.push(applyMapTheme);
    const darkInit = document.documentElement.dataset.theme === "dark";
    tile.setOpacity(darkInit ? 0.42 : 0.62);

    map.fitBounds(provLayer.getBounds(), { padding: [14, 14] });
    syncMetroLayerZoom();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setScrollyHeight();
        scheduleScrollTick();
      });
    });
    window.addEventListener("scroll", scheduleScrollTick, { passive: true });
    window.addEventListener("resize", () => {
      map.invalidateSize();
      setScrollyHeight();
      scheduleScrollTick();
    });

    const obs = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) map.invalidateSize(); });
    }, { threshold: 0.15 });
    obs.observe(el);
  };

  // ------------------------------------------------------------
  // TOC highlight via IntersectionObserver
  // ------------------------------------------------------------


  const wireResultChips = () => {
    $$(".result-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const row = document.getElementById(chip.dataset.target || "");
        if (!row) return;
        const details = row.closest(".results-detail-toggle");
        if (details && !details.open) details.open = true;
        const mainRail = document.querySelector('.results-scrolly-rail-item[data-step="1"]');
        if (mainRail) {
          mainRail.click();
        } else {
          window.refreshResultsScrolly?.();
        }
        requestAnimationFrame(() => {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.add("flash-target");
          setTimeout(() => row.classList.remove("flash-target"), 1200);
        });
      });
    });
  };
  const wireTOC = () => {
    const links = $$(".topnav a");
    const progressFill = document.getElementById("top-progress-fill");
    const indicatorText = document.getElementById("section-indicator-text");
    if (!links.length) return;
    const sectionOrder = ["question", "from-the-ground", "timeline", "macro", "sectors", "inequality", "two-lives", "results", "map", "conclusions", "ask-anything", "sources"];
    const spyIds = ["hero", ...sectionOrder];
    const spySections = spyIds.map(id => document.getElementById(id)).filter(Boolean);
    const sectionLabelById = new Map(sectionOrder.map((id, idx) => {
      const h = document.querySelector(`#${id} h2`);
      const title = h ? h.textContent.replace(/^\d+\s*[·.-]\s*/, "").trim() : id;
      return [id, `${idx + 1}/${sectionOrder.length} · ${title}`];
    }));

    const readingLineY = () => window.scrollY + window.innerHeight * 0.55;

    const syncProgress = () => {
      if (!progressFill) return;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      progressFill.style.width = `${pct.toFixed(2)}%`;
    };

    const syncActiveNav = () => {
      const doc = document.documentElement;
      const nearBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 6;
      const y = readingLineY();
      let activeId = spySections[0]?.id ?? "hero";
      if (nearBottom && spySections.length) {
        activeId = spySections[spySections.length - 1].id;
      } else {
        for (const sec of spySections) {
          const rect = sec.getBoundingClientRect();
          const top = rect.top + window.scrollY;
          const bottom = top + rect.height;
          if (top <= y && bottom > y) {
            activeId = sec.id;
            break;
          }
          if (top <= y) activeId = sec.id;
        }
      }

      links.forEach((l) => {
        const group = (l.dataset.navSections || l.getAttribute("href")?.slice(1) || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const inGroup = group.includes(activeId);
        l.classList.toggle("active", inGroup && activeId !== "hero");
      });

      if (indicatorText) {
        indicatorText.textContent =
          activeId === "hero"
            ? "Intro"
            : sectionLabelById.get(activeId) ?? activeId;
      }
    };

    const onScroll = () => {
      syncProgress();
      if (!document.body.classList.contains("essay-guide-tour-active")) {
        syncActiveNav();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  };

  /**
   * Collect section children for staggered reveals: unwrap grids and quote tiles
   * so motion feels intentional instead of one heavy block.
   */
  const flattenSectionBlocks = (section) => {
    const acc = [];
    for (const el of section.children) {
      if (!el || el.nodeType !== 1) continue;
      if (el.matches(".grid-2, .grid-3")) {
        acc.push(...el.children);
      } else if (el.matches(".chart-mockup")) {
        const copy = el.querySelector(".chart-mockup__copy");
        const charts = el.querySelector(".chart-mockup__charts");
        if (copy) acc.push(copy);
        if (charts) acc.push(charts);
        if (!copy && !charts) acc.push(el);
      } else if (el.matches(".chart-more")) {
        const inner = el.querySelector(".chart-more-inner");
        if (inner) acc.push(...inner.children);
        else acc.push(el);
      } else if (el.classList.contains("card") && el.querySelector(":scope > .quote-orbit")) {
        acc.push(el.querySelector(".quote-orbit"));
      } else if (el.classList.contains("card") && el.querySelector(":scope > .quote-grid")) {
        const tiles = el.querySelectorAll(".quote-tile");
        if (tiles.length) acc.push(...tiles);
        else acc.push(el);
      } else {
        acc.push(el);
      }
    }
    return acc.filter(Boolean);
  };

  /**
   * Kokonut-style hand-drawn SVG loop (vanilla port of framer-motion pathLength).
   * Fires once when #hand-scroll-ink enters the viewport; loop fades out after a short beat.
   */
  const wireHandScrollInk = () => {
    const root = document.getElementById("hand-scroll-ink");
    const path = root?.querySelector?.(".hand-scroll-ink__path");
    if (!root || !path) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const len = path.getTotalLength?.() ?? 0;
    if (len > 0) {
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    }

    const INK_HOLD_MS = 850;
    const scheduleFadeOut = () => {
      window.setTimeout(() => {
        root.classList.add("hand-scroll-ink--fade-out");
      }, INK_HOLD_MS);
    };

    const finish = () => {
      scheduleFadeOut();
    };

    if (reduce) {
      path.style.strokeDashoffset = "0";
      root.classList.add("hand-scroll-ink--fade-out");
      return;
    }

    const play = () => {
      if (root.dataset.inkPlayed === "1") return;
      root.dataset.inkPlayed = "1";
      if (len <= 0) {
        path.style.strokeDashoffset = "0";
        finish();
        return;
      }
      if (typeof gsap !== "undefined") {
        if (typeof ScrollTrigger !== "undefined") gsap.registerPlugin(ScrollTrigger);
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 2.5,
          ease: "power2.inOut",
          onComplete: finish,
        });
        return;
      }
      path.style.transition =
        "stroke-dashoffset 2.5s cubic-bezier(0.43, 0.13, 0.23, 0.96)";
      requestAnimationFrame(() => {
        path.style.strokeDashoffset = "0";
        path.addEventListener("transitionend", finish, { once: true });
      });
    };

    if (typeof ScrollTrigger !== "undefined" && typeof gsap !== "undefined") {
      gsap.registerPlugin(ScrollTrigger);
      ScrollTrigger.create({
        trigger: root,
        start: "top 80%",
        once: true,
        onEnter: play,
      });
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          play();
        },
        { root: null, rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
      );
      io.observe(root);
    }
  };

  const wireGlobalScrollMotion = () => {
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;

    gsap.registerPlugin(ScrollTrigger);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.classList.add("reduce-motion");
      return;
    }

    document.documentElement.classList.add("motion-ready");

    const easeOut = "power3.out";
    const easeSoft = "power2.out";

    // Hero: short load timeline (no scroll scrub).
    const heroTargets = gsap.utils.toArray(".hero-inner > *, .hero .hero-figure");
    if (heroTargets.length) {
      gsap.set(heroTargets, { opacity: 0, y: 16 });
      gsap
        .timeline({ defaults: { ease: easeOut } })
        .to(heroTargets, {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: { each: 0.08, amount: 0.34 },
          onComplete: () => {
            gsap.set(heroTargets, { clearProps: "transform" });
          },
        }, 0.12);
    }

    const heroPhoto = document.querySelector(".hero-photo");
    if (heroPhoto) {
      gsap.to(heroPhoto, {
        yPercent: 4,
        ease: "none",
        scrollTrigger: {
          trigger: "#hero",
          start: "top top",
          end: "bottom top",
          scrub: 1.25,
          invalidateOnRefresh: true,
        },
      });
    }

    gsap.utils.toArray("main#main > section.section").forEach((section) => {
      const blocks = flattenSectionBlocks(section);
      if (!blocks.length) return;
      gsap.set(blocks, { opacity: 0, y: 20 });
      ScrollTrigger.create({
        trigger: section,
        start: "top 82%",
        once: true,
        onEnter: () => {
          gsap.to(blocks, {
            opacity: 1,
            y: 0,
            duration: 0.52,
            ease: easeOut,
            stagger: { each: 0.05, amount: 0.28 },
            onComplete: () => {
              gsap.set(blocks, { clearProps: "transform" });
            },
          });
        },
      });
    });

    const footer = document.querySelector("footer.footer");
    if (footer) {
      gsap.set(footer, { opacity: 0, y: 20 });
      ScrollTrigger.create({
        trigger: footer,
        start: "top 94%",
        once: true,
        onEnter: () => {
          gsap.to(footer, {
            opacity: 1,
            y: 0,
            duration: 0.58,
            ease: easeSoft,
            onComplete: () => {
              gsap.set(footer, { clearProps: "transform" });
            },
          });
        },
      });
    }

    wireChartCopyScrollDrift();
  };

  /**
   * Macro / sectors / inequality: left copy starts level with charts, then drifts toward
   * viewport center while the reader scrolls through the chart stack.
   */
  const wireChartCopyScrollDrift = () => {
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;
    gsap.registerPlugin(ScrollTrigger);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const desktop = () => window.matchMedia("(min-width: 900px)").matches;

    const topbarPx = () => {
      const tb = document.querySelector(".topbar");
      return Math.round((tb?.offsetHeight || 64) + 12);
    };

    const centerTopPx = (copyEl) => {
      const start = topbarPx();
      const h = copyEl.offsetHeight;
      return Math.max(start, Math.round((window.innerHeight - h) * 0.5));
    };

    const teardown = () => {
      ScrollTrigger.getAll()
        .filter((st) => st.vars?.id === "chart-copy-drift")
        .forEach((st) => st.kill());
      document.querySelectorAll(".chart-mockup__copy").forEach((el) => {
        gsap.killTweensOf(el);
        el.style.removeProperty("top");
      });
    };

    const setup = () => {
      teardown();
      if (reduce || !desktop()) return;

      document.querySelectorAll(".chart-mockup").forEach((mockup) => {
        const pin = mockup.querySelector(".chart-mockup__copy-pin");
        const copy = mockup.querySelector(".chart-mockup__copy");
        if (!pin || !copy) return;

        const start = topbarPx();
        copy.style.top = `${start}px`;

        gsap.fromTo(
          copy,
          { top: start },
          {
            top: () => centerTopPx(copy),
            ease: "none",
            immediateRender: false,
            scrollTrigger: {
              id: "chart-copy-drift",
              trigger: pin,
              start: () => `top top+=${topbarPx()}`,
              end: "bottom bottom",
              scrub: 0.55,
              invalidateOnRefresh: true,
            },
          }
        );
      });
    };

    setup();
    window.setupChartCopyScrollDrift = setup;
    window.matchMedia("(min-width: 900px)").addEventListener("change", () => {
      setup();
      ScrollTrigger.refresh();
    });
  };

  /** Chart.js bitmap must match CSS box size; call after layout settles (esp. after wrapper CSS fix). */
  const resizeRegisteredCharts = () => {
    if (typeof Chart === "undefined") return;
    [
      "chart-indexed",
      "chart-unemployment",
      "chart-sector-shares",
      "chart-manuf-decline",
      "chart-income-shares",
      "chart-wealth-shares",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const c = Chart.getChart(el);
      if (c) c.resize();
    });
  };

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // Conclusions: circular quote carousel (theme-matched vanilla port)
  // ------------------------------------------------------------
  const QUOTE_ORBIT_SLIDES = [
    {
      quote:
        "Districts with larger tariff cuts experienced significant declines in both formal and informal employment, driven primarily by manufacturing job losses.",
      name: "Erten, Leight & Tregenna",
      designation: "2018 · tariff cuts and local labour markets",
    },
    {
      quote:
        "No wage effects for those who remain employed; wages are too rigid to absorb the shock.",
      name: "Erten, Leight & Tregenna",
      designation: "2018 · same study (wages did not flex enough)",
    },
    {
      quote:
        "The top 10% of wealth holders own 85–86% of household wealth … [and] no decline in wealth inequality since the end of apartheid.",
      name: "Chatterjee, Czajka & Gethin",
      designation: "2021 · WIL wealth inequality for South Africa",
    },
    {
      quote: "Growth and redistribution are parts of a single process.",
      name: "ANC",
      designation: "1994 · Reconstruction and Development Programme",
    },
  ];

  /** Horizontal offset for side faces; scales down on narrow rings (fixed 60px used to stack all slides). */
  const quoteOrbitCalcGap = width => {
    const minW = 420;
    const maxW = 1456;
    const minGap = 20;
    const maxGap = 86;
    const w = Math.max(0, width);
    if (w <= minW) return minGap;
    if (w >= maxW) return Math.max(minGap, maxGap + 0.06018 * (w - maxW));
    const t = (w - minW) / (maxW - minW);
    return minGap + (maxGap - minGap) * t;
  };

  const wireQuoteOrbit = () => {
    const root = document.getElementById("quote-orbit");
    const ring = document.getElementById("quote-orbit-ring");
    if (!root || !ring) return;

    const faces = [...root.querySelectorAll(".quote-orbit__face")];
    const n = faces.length;
    if (n !== QUOTE_ORBIT_SLIDES.length) return;

    const nameEl = document.getElementById("quote-orbit-name");
    const desigEl = document.getElementById("quote-orbit-designation");
    const quoteEl = document.getElementById("quote-orbit-quote");
    const dotsEl = document.getElementById("quote-orbit-dots");
    const btnPrev = document.getElementById("quote-orbit-prev");
    const btnNext = document.getElementById("quote-orbit-next");
    if (!nameEl || !desigEl || !quoteEl || !dotsEl || !btnPrev || !btnNext) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const autoplayOn = root.dataset.autoplay === "true" && !reduce;

    let active = 0;
    let timer = null;

    const clearTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const startTimer = () => {
      clearTimer();
      if (!autoplayOn) return;
      timer = setInterval(() => {
        active = (active + 1) % n;
        render();
      }, 5000);
    };

    const applyFaceStyles = () => {
      const rw = ring.offsetWidth || 400;
      const gap = quoteOrbitCalcGap(rw);
      /* Upward offset spilled over the section title on small stages; keep flat below ~720px. */
      const maxStickUp =
        rw >= 720 ? Math.min(gap * 0.5, rw * 0.045) : 0;
      const singleSlide = rw < 420;
      const rot = reduce ? 0 : 15;
      const ease = "all 0.55s cubic-bezier(0.22, 1, 0.36, 1)";

      for (let i = 0; i < n; i++) {
        const el = faces[i];
        const isActive = i === active;
        const isLeft = (active - 1 + n) % n === i;
        const isRight = (active + 1) % n === i;

        if (isActive) {
          el.style.zIndex = "30";
          el.style.opacity = "1";
          el.style.pointerEvents = "auto";
          /* translateZ last: moves along post-rotate local Z so center sits in front in 3D. */
          el.style.transform =
            "translateX(0) translateY(0) scale(1) rotateY(0deg) translateZ(72px)";
        } else if (singleSlide) {
          el.style.zIndex = "1";
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          el.style.transform = "translateX(0) translateY(8px) scale(0.92) rotateY(0deg)";
        } else if (isLeft) {
          el.style.zIndex = "4";
          el.style.opacity = "1";
          el.style.pointerEvents = "auto";
          el.style.transform = `translateX(-${gap}px) translateY(-${maxStickUp}px) scale(0.85) rotateY(${rot}deg) translateZ(-40px)`;
        } else if (isRight) {
          el.style.zIndex = "4";
          el.style.opacity = "1";
          el.style.pointerEvents = "auto";
          el.style.transform = `translateX(${gap}px) translateY(-${maxStickUp}px) scale(0.85) rotateY(-${rot}deg) translateZ(-40px)`;
        } else {
          el.style.zIndex = "1";
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          el.style.transform = "translateX(0) translateY(12px) scale(0.75) rotateY(0deg)";
        }
        el.style.transition = reduce ? "none" : ease;
      }
    };

    const render = () => {
      const s = QUOTE_ORBIT_SLIDES[active];
      nameEl.textContent = s.name;
      desigEl.textContent = s.designation;
      quoteEl.textContent = `“${s.quote}”`;

      dotsEl.querySelectorAll(".quote-orbit__dot").forEach((dot, i) => {
        const on = i === active;
        dot.classList.toggle("is-active", on);
        dot.setAttribute("aria-pressed", on ? "true" : "false");
      });

      root.setAttribute("aria-label", `Voices from the record, slide ${active + 1} of ${n}: ${s.name}`);
      applyFaceStyles();
    };

    dotsEl.innerHTML = "";
    QUOTE_ORBIT_SLIDES.forEach((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quote-orbit__dot";
      b.setAttribute("aria-label", `Show quotation ${i + 1}`);
      b.addEventListener("click", () => {
        active = i;
        clearTimer();
        render();
        startTimer();
      });
      dotsEl.appendChild(b);
    });

    const go = delta => {
      active = (active + delta + n) % n;
      clearTimer();
      render();
      startTimer();
    };

    btnPrev.addEventListener("click", () => go(-1));
    btnNext.addEventListener("click", () => go(1));

    root.addEventListener("keydown", e => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    });

    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => applyFaceStyles());
      ro.observe(ring);
    }
    window.addEventListener("resize", applyFaceStyles);

    render();
    startTimer();
  };

  const boot = async () => {
    renderTimeline();
    wireTimelineAutoscroll();
    wireKBLinks();
    wireTOC();
    wireResultChips();
    wireQuoteOrbit();
    // Disabled outdated hand-drawn intro effect per UX cleanup.
    wireGlobalScrollMotion();
    $$("[data-stat]").forEach((card) => card.classList.add("sector-stat--loading"));
    try {
      const [ts, ineq, panel, mapSeries, sectorData] = await Promise.all([
        fetchJSON("data/timeseries.json"),
        fetchJSON("data/inequality.json"),
        fetchJSON("data/panel.json"),
        fetchJSON("data/map_unemployment_series.json"),
        fetchJSON("data/sector_employment.json").catch(() => null),
      ]);
      const safeRun = (name, fn) => {
        try {
          fn();
        } catch (e) {
          console.error(`website_v2 block failed: ${name}`, e);
        }
      };
      const lazySections = new Map([
        ["macro", () => safeRun("macro charts", () => { buildIndexedChart(ts); buildUnemploymentChart(ts); })],
        ["sectors", () => safeRun("sector charts", () => { if (sectorData) { buildSectorCharts(sectorData); renderSectorStats(sectorData); } })],
        ["inequality", () => safeRun("inequality charts", () => { buildIncomeChart(ineq); buildWealthChart(ineq); })],
      ]);
      const lazyObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id;
          if (entry.target.dataset.chartBuilt === "1") return;
          const run = lazySections.get(id);
          if (!run) return;
          run();
          entry.target.dataset.chartBuilt = "1";
        });
      }, { rootMargin: "120px 0px" });
      ["macro", "sectors", "inequality"].forEach((id) => {
        const section = document.getElementById(id);
        if (section) lazyObserver.observe(section);
      });
      let regressionsPromise = null;
      const loadRegressions = () => {
        if (regressionsPromise) return regressionsPromise;
        regressionsPromise = fetchJSON("data/regressions.json")
          .then((reg) => {
            safeRun("regression tables", () => renderRegressionTables(reg));
            window.refreshResultsScrolly?.();
          })
          .catch((e) => {
            regressionsPromise = null;
            throw e;
          });
        return regressionsPromise;
      };
      const resultsSection = document.getElementById("results");
      if (resultsSection && "IntersectionObserver" in window) {
        const regObserver = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          regObserver.disconnect();
          loadRegressions().catch((e) => console.error("website_v2 block failed: regressions", e));
        }, { rootMargin: "120px 0px" });
        regObserver.observe(resultsSection);
      }
      document.querySelector(".results-detail-toggle")?.addEventListener("toggle", (e) => {
        if (e.target.open) {
          loadRegressions().catch((err) => console.error("website_v2 block failed: regressions", err));
        }
      });
      if (!sectorData) {
        $$("[data-stat]").forEach((card) => {
          card.classList.remove("sector-stat--loading");
          card.classList.add("sector-stat--error");
        });
      }
      // Lazy-load Leaflet (CSS + JS) only when the map section approaches the viewport.
      let leafletPromise = null;
      const loadLeaflet = () => {
        if (window.L) return Promise.resolve();
        if (leafletPromise) return leafletPromise;
        leafletPromise = new Promise((resolve, reject) => {
          const css = document.createElement("link");
          css.rel = "stylesheet";
          css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
          document.head.appendChild(css);
          const js = document.createElement("script");
          js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          js.onload = () => resolve();
          js.onerror = () => reject(new Error("Leaflet failed to load"));
          document.head.appendChild(js);
        });
        return leafletPromise;
      };
      const buildMapLazy = () => loadLeaflet()
        .then(() => safeRun("map", () => buildMap(mapSeries)))
        .catch((e) => console.error("website_v2 block failed: map (Leaflet load)", e));
      const mapSection = document.getElementById("map");
      if (mapSection && "IntersectionObserver" in window) {
        let mapStarted = false;
        const mapObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting || mapStarted) return;
            mapStarted = true;
            mapObserver.disconnect();
            buildMapLazy();
          });
        }, { rootMargin: "300px 0px" });
        mapObserver.observe(mapSection);
      } else {
        buildMapLazy();
      }
      const seenCharts = new Set();
      const chartObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.target.id) seenCharts.add(entry.target.id);
        });
      }, { threshold: 0.35 });
      $$("canvas[id]").forEach((canvas) => chartObserver.observe(canvas));
      const telemetryEndpoint = document.documentElement.dataset.telemetryEndpoint || "";
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") return;
        const sectionIds = ["hero", "question", "from-the-ground", "timeline", "macro", "sectors", "inequality", "two-lives", "results", "map", "conclusions", "sources"];
        let reached = "hero";
        sectionIds.forEach((id) => {
          const section = document.getElementById(id);
          if (!section) return;
          const rect = section.getBoundingClientRect();
          if (rect.top < window.innerHeight * 0.66) reached = id;
        });
        const payload = JSON.stringify({ reached, charts: [...seenCharts], ts: Date.now() });
        if (!telemetryEndpoint) {
          console.info("essay telemetry (local)", payload);
          return;
        }
        if (navigator.sendBeacon) navigator.sendBeacon(telemetryEndpoint, payload);
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resizeRegisteredCharts();
          window.setupChartCopyScrollDrift?.();
          if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
          window.refreshTimelineAutoplay?.();
        });
      });
    } catch (err) {
      console.error("website_v2 load failed", err);
      const warn = document.createElement("div");
      warn.style.cssText = "padding:16px;background:#fde68a;color:#713f12;margin:16px;border-radius:8px;font-family:system-ui;";
      warn.textContent = `Data load failed: ${err.message}. Run website_v2 from a local HTTP server (e.g. python -m http.server 8000).`;
      document.body.prepend(warn);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
