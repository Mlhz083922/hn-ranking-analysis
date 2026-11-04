(function () {
  "use strict";

  const { esc, fmtNum, initIcons } = window.RankingUI;
  const TREND_DEFS = [
    ["avgPrice", "均价($)", "price"],
    ["ratingMedian", "评分中位", "num"],
    ["reviewTotal", "评论总量", "int"],
    ["dailySales", "日销(估算)", "int"],
    ["top3Share", "Top3品牌商品数占比", "pct"],
    ["newShare", "新品占比(上架≤90天)", "pct"],
  ];

  let cachePromise = null;
  let cacheVersion = "";
  let trendChart = null;
  let trendResizeBound = false;
  let collapseSequence = 0;
  let batchHidden = true;
  let currentOptions = { metric: "avgPrice", trendRange: "8" };

  function metricText(value, kind) {
    if (value == null || Number.isNaN(Number(value))) return "-";
    if (kind === "pct") return `${Number(value).toFixed(2)}%`;
    if (kind === "price") return `$${Number(value).toFixed(2)}`;
    if (kind === "int") return Math.round(Number(value)).toLocaleString("zh-CN");
    return Number(value).toFixed(2);
  }

  function deltaText(delta, kind) {
    if (delta == null || Number.isNaN(Number(delta))) return `<span class="hint">—</span>`;
    if (Math.abs(delta) < 0.0001) return `<span class="hint">持平</span>`;
    const color = delta > 0 ? "var(--down)" : "var(--up)";
    const sign = delta > 0 ? "+" : "-";
    return `<span style="color:${color};font-weight:650">${sign}${metricText(Math.abs(delta), kind)}</span>`;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function compareStats(products) {
    const nums = (key) => products.map((product) => product[key]).filter((value) => value != null);
    const sum = (values) => values.reduce((left, right) => left + right, 0);
    const average = (values) => values.length ? sum(values) / values.length : null;
    const prices = nums("price");
    const ratings = nums("rating");
    const reviews = nums("reviews");
    const sales = nums("monthSales");
    const bsrs = nums("bsrSmall");
    const brandMap = {};
    products.forEach((product) => {
      const brand = String(product.brand || "").trim();
      if (brand) brandMap[brand] = (brandMap[brand] || 0) + 1;
    });
    const top3 = Object.values(brandMap).sort((a, b) => b - a).slice(0, 3).reduce((left, right) => left + right, 0);
    const dayValues = products.map((product) => product.days).filter((value) => value != null);
    return {
      n: products.length,
      avgPrice: average(prices),
      medianPrice: median(prices),
      ratingMedian: median(ratings),
      reviewTotal: sum(reviews),
      salesTotal: sum(sales),
      dailySales: Math.round(sum(sales) / 30),
      bsrMedian: median(bsrs),
      top3Share: products.length ? (top3 / products.length) * 100 : 0,
      newShare: products.length && dayValues.length
        ? (dayValues.filter((days) => days <= 90).length / products.length) * 100
        : null,
    };
  }

  function productListingKey(product) {
    return product.parentAsin || product.detailAsin || product.asin || "";
  }

  function rankMoves(cache, baseDate, currentDate, category, type) {
    const baseEntry = cache.byKey[`${baseDate}|${category}|${type}`];
    const currentEntry = cache.byKey[`${currentDate}|${category}|${type}`];
    const baseProducts = baseEntry ? baseEntry.products : [];
    const currentProducts = currentEntry ? currentEntry.products : [];
    const indexProducts = (products) => {
      const byParent = new Map();
      const byDetail = new Map();
      const byChild = new Map();
      const add = (map, key, product) => {
        if (!key) return;
        const old = map.get(key);
        if (!old || product.rank < old.rank) map.set(key, product);
      };
      products.forEach((product) => {
        add(byParent, product.parentAsin, product);
        add(byDetail, product.detailAsin, product);
        add(byChild, product.asin, product);
      });
      return { byParent, byDetail, byChild };
    };
    const match = (product, index) => index.byParent.get(product.parentAsin)
      || index.byChild.get(product.asin)
      || index.byDetail.get(product.detailAsin)
      || null;
    const baseIndex = indexProducts(baseProducts);
    const currentIndex = indexProducts(currentProducts);
    const newIn = [];
    const dropped = [];
    const rises = [];
    const drops = [];
    currentProducts.forEach((product) => {
      const base = match(product, baseIndex);
      if (!base) {
        newIn.push({ ...product, curRank: product.rank, prevRank: null });
        return;
      }
      const difference = base.rank - product.rank;
      const percentage = base.rank ? Math.abs(difference) / base.rank : 0;
      if (difference >= 10 && percentage >= 0.2) rises.push({ ...product, curRank: product.rank, prevRank: base.rank, diff: difference });
      else if (difference <= -10 && percentage >= 0.2) drops.push({ ...product, curRank: product.rank, prevRank: base.rank, diff: difference });
    });
    baseProducts.forEach((product) => {
      if (!match(product, currentIndex)) dropped.push({ ...product, curRank: null, prevRank: product.rank });
    });
    rises.sort((a, b) => b.diff - a.diff);
    drops.sort((a, b) => a.diff - b.diff);
    return { newIn, dropped, rises, drops };
  }

  function moveTable(title, products) {
    if (!products.length) return `<div class="hint" style="margin:6px 0">${esc(title)}：0 个</div>`;
    const toggleId = `cp-${++collapseSequence}`;
    const headers = ["主图", "ASIN", "现排名", "前排名", "变化", "品牌", "标题", "价格", "评分", "评论"];
    const rows = products.map((product) => [
      product.image || "",
      product.asin || productListingKey(product),
      product.curRank == null ? "-" : product.curRank,
      product.prevRank == null ? "-" : product.prevRank,
      product.diff != null ? (product.diff > 0 ? `+${product.diff}` : product.diff) : (product.curRank == null ? "跌出" : "新进"),
      product.brand || "",
      (product.title || "").slice(0, 40),
      product.price == null ? "" : product.price,
      product.rating == null ? "" : product.rating,
      product.reviews == null ? "" : product.reviews,
    ]);
    return `
      <div style="margin:8px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">
          <div style="font-weight:700">${esc(title)}（${products.length}）</div>
          <button class="btn btn-sm" type="button" data-collapse-toggle="${toggleId}" aria-expanded="true">
            <i data-lucide="eye-off"></i><span>隐藏</span>
          </button>
        </div>
        <div data-collapse-target="${toggleId}">${tableHtml(headers, rows)}</div>
      </div>`;
  }

  function bindCollapse(container) {
    container.querySelectorAll("[data-collapse-toggle]").forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        const target = container.querySelector(`[data-collapse-target="${button.dataset.collapseToggle}"]`);
        if (!target) return;
        const hidden = target.style.display === "none";
        target.style.display = hidden ? "" : "none";
        button.setAttribute("aria-expanded", String(!hidden));
        button.innerHTML = hidden
          ? `<i data-lucide="eye-off"></i><span>隐藏</span>`
          : `<i data-lucide="eye"></i><span>显示</span>`;
        syncBatchButton(container);
        initIcons();
      });
    });
  }

  function setAllCollapsed(container, hide) {
    batchHidden = hide;
    container.querySelectorAll('[data-collapse-target^="cp-"]').forEach((element) => {
      element.style.display = hide ? "none" : "";
    });
    container.querySelectorAll("[data-collapse-toggle]").forEach((button) => {
      const target = container.querySelector(`[data-collapse-target="${button.dataset.collapseToggle}"]`);
      const collapsed = target ? target.style.display === "none" : false;
      button.setAttribute("aria-expanded", String(!collapsed));
      button.innerHTML = collapsed
        ? `<i data-lucide="eye"></i><span>显示</span>`
        : `<i data-lucide="eye-off"></i><span>隐藏</span>`;
    });
    const allButton = container.querySelector("#compare-toggle-tables");
    if (allButton) {
      allButton.innerHTML = hide
        ? `<i data-lucide="eye"></i>批量显示产品表`
        : `<i data-lucide="eye-off"></i>批量隐藏产品表`;
    }
    initIcons();
  }

  function syncBatchButton(container) {
    const targets = Array.from(container.querySelectorAll('[data-collapse-target^="cp-"]'));
    batchHidden = targets.length > 0 && targets.every((element) => element.style.display === "none");
    const allButton = container.querySelector("#compare-toggle-tables");
    if (allButton) {
      allButton.innerHTML = batchHidden
        ? `<i data-lucide="eye"></i>批量显示产品表`
        : `<i data-lucide="eye-off"></i>批量隐藏产品表`;
    }
    initIcons();
  }

  function tableHtml(headers, rows) {
    const imageColumns = headers
      .map((header, index) => (/主图|图片/.test(String(header)) ? index : -1))
      .filter((index) => index >= 0);
    const asinColumn = headers.findIndex((header) => /^asin$/i.test(String(header).trim()));
    const cell = (row, columnIndex) => {
      const value = row[columnIndex] || "";
      if (imageColumns.includes(columnIndex)) {
        const asin = asinColumn >= 0 ? String(row[asinColumn] || "").trim() : "";
        if (/^(https?:\/\/|data:image\/)/i.test(String(value))) {
          return `<a href="https://www.amazon.com/dp/${encodeURIComponent(asin)}" target="_blank" rel="noopener" title="${esc(asin || "查看商品")}"><img src="${esc(value)}" alt="${esc(asin || "商品")}" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;display:block"></a>`;
        }
        return asin ? `<a href="https://www.amazon.com/dp/${encodeURIComponent(asin)}" target="_blank" rel="noopener">${esc(asin)}</a>` : esc(value);
      }
      return esc(value);
    };
    return `
      <div class="table-wrap" style="margin:6px 0 10px">
        <table class="data-table">
          <thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${cell(row, index)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function loadCache(manifest, loadPeriod, onProgress) {
    if (cachePromise && cacheVersion === manifest.meta.version) return cachePromise;
    cacheVersion = manifest.meta.version;
    cachePromise = (async () => {
      const byKey = {};
      const warnings = [];
      let completed = 0;
      const periodData = await Promise.all(manifest.periods.map(async (period) => {
        const data = await loadPeriod(period.date);
        completed++;
        if (onProgress) onProgress(completed, manifest.periods.length);
        return data;
      }));
      for (const period of periodData) {
        for (const category of manifest.meta.categories) {
          for (const type of ["bsr", "new"]) {
            const section = period.categories[category]?.[type];
            if (!section) {
              warnings.push(`${category} ${type === "new" ? "新品榜" : "热卖榜"} ${period.date} 数据缺失`);
              continue;
            }
            byKey[`${period.date}|${category}|${type.toUpperCase()}`] = {
              ...section,
              products: section.products.map((product) => ({
                ...product,
                monthSales: product.monthSales ?? product.sales,
              })),
            };
          }
        }
      }
      return {
        cats: manifest.meta.categories,
        periods: manifest.periods.map((period) => period.date),
        byKey,
        warnings,
      };
    })();
    return cachePromise;
  }

  function metricDefinitions() {
    return [
      ["产品数", "int", (stats) => stats.n],
      ["均价($)", "price", (stats) => stats.avgPrice],
      ["中位价($)", "price", (stats) => stats.medianPrice],
      ["评分中位", "num", (stats) => stats.ratingMedian],
      ["评论总量", "int", (stats) => stats.reviewTotal],
      ["月销合计", "int", (stats) => stats.salesTotal],
      ["Top3品牌商品数占比", "pct", (stats) => stats.top3Share],
      ["新品占比(≤90天)", "pct", (stats) => stats.newShare],
      ["小类BSR中位", "num", (stats) => stats.bsrMedian],
    ];
  }

  function compareTable(cache, options) {
    const categories = options.category === "全部" ? cache.cats : [options.category];
    const types = options.type === "全部" ? ["BSR", "NEW"] : [options.type];
    const definitions = metricDefinitions();
    const headers = ["类目/榜单", ...definitions.map((definition) => definition[0])];
    const rows = [];
    categories.forEach((category) => types.forEach((type) => {
      const base = cache.byKey[`${options.base}|${category}|${type}`];
      const current = cache.byKey[`${options.current}|${category}|${type}`];
      const label = `${category} ${type === "NEW" ? "新品" : "热卖"}`;
      if (!base || !current) {
        rows.push(`<tr><td style="white-space:nowrap;font-weight:600">${esc(label)}</td><td colspan="${definitions.length}" class="hint">数据缺失</td></tr>`);
        return;
      }
      const baseStats = compareStats(base.products);
      const currentStats = compareStats(current.products);
      rows.push(`<tr><td style="white-space:nowrap;font-weight:600">${esc(label)}</td>${definitions.map(([, kind, valueOf]) => {
        const baseValue = valueOf(baseStats);
        const currentValue = valueOf(currentStats);
        const delta = baseValue == null || currentValue == null ? null : currentValue - baseValue;
        return `<td title="基线 ${metricText(baseValue, kind)}"><div style="font-size:12.5px">${metricText(currentValue, kind)}</div><div style="font-size:11px">${deltaText(delta, kind)}</div></td>`;
      }).join("")}</tr>`);
    }));
    return `
      <div class="table-wrap" style="max-height:480px;overflow:auto">
        <table class="data-table">
          <thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  }

  function trendPeriods(cache, range) {
    const all = cache.periods.slice().sort((a, b) => b.localeCompare(a));
    const count = range === "all" ? all.length : Math.min(Number(range) || 8, all.length);
    return all.slice(0, count).sort((a, b) => a.localeCompare(b));
  }

  function trendCombos(cache, options) {
    const categories = options.category === "全部" ? cache.cats : [options.category];
    const types = options.type === "全部" ? ["BSR", "NEW"] : [options.type];
    const combos = [];
    categories.forEach((category) => types.forEach((type) => combos.push({ category, type })));
    return combos;
  }

  function disposeChart() {
    if (trendChart) {
      trendChart.dispose();
      trendChart = null;
    }
  }

  function mountTrendChart(container, cache, options) {
    const element = container.querySelector("#compare-trend-chart");
    if (!element) return;
    disposeChart();
    if (!window.echarts) {
      element.innerHTML = `<div class="hint">图表库未加载，请刷新页面</div>`;
      return;
    }
    const periods = trendPeriods(cache, options.trendRange);
    const combos = trendCombos(cache, options);
    const metric = TREND_DEFS.find((definition) => definition[0] === options.metric) || TREND_DEFS[0];
    const colors = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ca8a04", "#4f46e5"];
    const series = combos.map((combo, index) => ({
      name: `${combo.category} ${combo.type === "NEW" ? "新品" : "热卖"}`,
      type: "line",
      smooth: true,
      connectNulls: false,
      symbolSize: 6,
      color: colors[index % colors.length],
      data: periods.map((date) => {
        const entry = cache.byKey[`${date}|${combo.category}|${combo.type}`];
        const value = entry ? compareStats(entry.products)[metric[0]] : null;
        return value == null ? null : Number(value.toFixed(2));
      }),
    }));
    trendChart = window.echarts.init(element);
    trendChart.setOption({
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => value == null
          ? "-"
          : metric[2] === "pct"
          ? `${Number(value).toFixed(2)}%`
          : metricText(value, metric[2]),
      },
      legend: { type: "scroll", bottom: 0 },
      grid: { left: 64, right: 24, top: 28, bottom: 58 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: periods.map((date) => dateLabel(date)),
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { formatter: metric[2] === "pct" ? (value) => `${Number(value).toFixed(2)}%` : undefined },
      },
      dataZoom: periods.length > 12 ? [{ type: "inside" }, { type: "slider", height: 16, bottom: 24 }] : [],
      series,
    });
    if (!trendResizeBound) {
      trendResizeBound = true;
      window.addEventListener("resize", () => {
        if (trendChart) trendChart.resize();
      });
    }
  }

  function renderTrendControls(container, cache, options) {
    const periods = trendPeriods(cache, options.trendRange);
    container.innerHTML = `
      <div style="border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--panel-2);margin-bottom:10px">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:8px">
          <label style="font-size:13px">趋势指标
            <select id="compare-trend-metric" style="margin-left:6px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)">
              ${TREND_DEFS.map((definition) => `<option value="${definition[0]}" ${definition[0] === options.metric ? "selected" : ""}>${esc(definition[1])}</option>`).join("")}
            </select>
          </label>
          <label style="font-size:13px">周期范围
            <select id="compare-trend-range" style="margin-left:6px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)">
              <option value="4" ${options.trendRange === "4" ? "selected" : ""}>近4期</option>
              <option value="8" ${options.trendRange === "8" ? "selected" : ""}>近8期</option>
              <option value="12" ${options.trendRange === "12" ? "selected" : ""}>近12期</option>
              <option value="all" ${options.trendRange === "all" ? "selected" : ""}>全部</option>
            </select>
          </label>
          <span class="tag">${periods.length} 期</span>
        </div>
        <div id="compare-trend-chart" style="height:360px;width:100%"></div>
      </div>
    `;
    const metricSelect = container.querySelector("#compare-trend-metric");
    const rangeSelect = container.querySelector("#compare-trend-range");
    metricSelect.addEventListener("change", () => {
      currentOptions.metric = metricSelect.value;
      const trendSection = container.closest("#compare-content");
      if (trendSection) renderResult(trendSection, cache, { ...options, metric: metricSelect.value, trendRange: rangeSelect.value });
    });
    rangeSelect.addEventListener("change", () => {
      currentOptions.trendRange = rangeSelect.value;
      const trendSection = container.closest("#compare-content");
      if (trendSection) renderResult(trendSection, cache, { ...options, metric: metricSelect.value, trendRange: rangeSelect.value });
    });
  }

  function dateLabel(date) {
    return /^\d{8}$/.test(String(date))
      ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
      : date;
  }

  function renderResult(container, cache, options) {
    currentOptions = { ...currentOptions, ...options };
    const categories = options.category === "全部" ? cache.cats : [options.category];
    const types = options.type === "全部" ? ["BSR", "NEW"] : [options.type];
    const warnings = (cache.warnings || []).length
      ? `<div class="compare-warning">${cache.warnings.map((warning) => `<div>${esc(warning)}</div>`).join("")}</div>`
      : "";
    let html = warnings;
    html += `<h3 style="margin:14px 0 8px">双期指标对比 <span class="hint">${esc(options.base)} → ${esc(options.current)}</span></h3>`;
    html += compareTable(cache, options);
    html += `<h3 style="margin:18px 0 8px">榜单异动</h3>`;
    html += `<p class="hint">本页判定口径：排名变化 ≥10 位且 ≥20%。注意「导出汇总 / 分析工具」用的是 &gt;20 位，两处口径不同，不要混用。</p>`;
    categories.forEach((category) => types.forEach((type) => {
      const base = cache.byKey[`${options.base}|${category}|${type}`];
      const current = cache.byKey[`${options.current}|${category}|${type}`];
      if (!base || !current) return;
      const moves = rankMoves(cache, options.base, options.current, category, type);
      html += `
        <div style="border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--panel-2);margin-bottom:10px">
          <div style="font-weight:700">${esc(category)} · ${type === "NEW" ? "新品榜" : "热卖榜"} <span class="tag">${esc(options.base)} → ${esc(options.current)}</span></div>
          ${moveTable("新进 Top100", moves.newIn)}
          ${moveTable("跌出 Top100", moves.dropped)}
          ${moveTable("排名上升", moves.rises)}
          ${moveTable("排名下降", moves.drops)}
        </div>`;
    }));
    html += `<h3 style="margin:18px 0 8px">多期趋势</h3><section id="compare-trend-section"></section>`;
    container.querySelector("#compare-result").innerHTML = html;
    renderTrendControls(container.querySelector("#compare-trend-section"), cache, currentOptions);
    mountTrendChart(container, cache, currentOptions);
    bindCollapse(container);
    setAllCollapsed(container, batchHidden);
    initIcons();
  }

  function periodOptions(periods, selected) {
    return periods.map((period) => `<option value="${period.date}" ${period.date === selected ? "selected" : ""}>${esc(period.label)}</option>`).join("");
  }

  async function render(container, context) {
    const { manifest, loadPeriod } = context;
    container.innerHTML = `<div class="empty-state"><p>正在加载全量榜单数据…</p></div>`;
    try {
      const cache = await loadCache(manifest, loadPeriod, (done, total) => {
        container.innerHTML = `<div class="empty-state"><p>正在加载榜单 ${done}/${total} 期…</p></div>`;
      });
      const latest = cache.periods[0];
      const previous = cache.periods[1] || latest;
      container.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);margin-bottom:12px">
          <label style="font-size:13px">基线期
            <select id="compare-base" style="margin-left:6px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)">
              ${periodOptions(manifest.periods, previous)}
            </select>
          </label>
          <label style="font-size:13px">当期
            <select id="compare-current" style="margin-left:6px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)">
              ${periodOptions(manifest.periods, latest)}
            </select>
          </label>
          <label style="font-size:13px">类目
            <select id="compare-category" style="margin-left:6px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)">
              <option value="全部">全部</option>
              ${cache.cats.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}
            </select>
          </label>
          <label style="font-size:13px">榜单
            <select id="compare-type" style="margin-left:6px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)">
              <option value="全部">全部</option>
              <option value="BSR">热卖榜 BSR</option>
              <option value="NEW">新品榜 NEW</option>
            </select>
          </label>
          <button class="btn btn-sm" type="button" id="compare-refresh"><i data-lucide="refresh-cw"></i>重新加载数据</button>
          <button class="btn btn-sm" type="button" id="compare-toggle-tables"><i data-lucide="eye-off"></i>批量隐藏产品表</button>
        </div>
        <div id="compare-result"></div>`;
      const apply = () => renderResult(container, cache, {
        base: container.querySelector("#compare-base").value,
        current: container.querySelector("#compare-current").value,
        category: container.querySelector("#compare-category").value,
        type: container.querySelector("#compare-type").value,
        metric: currentOptions.metric,
        trendRange: currentOptions.trendRange,
      });
      ["compare-base", "compare-current", "compare-category", "compare-type"].forEach((id) => {
        container.querySelector(`#${id}`).addEventListener("change", apply);
      });
      container.querySelector("#compare-refresh").addEventListener("click", () => {
        cachePromise = null;
        render(container, context);
      });
      container.querySelector("#compare-toggle-tables").addEventListener("click", (event) => {
        const targets = Array.from(container.querySelectorAll('[data-collapse-target^="cp-"]'));
        setAllCollapsed(container, targets.some((element) => element.style.display !== "none"));
      });
      apply();
      initIcons();
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><p>跨期对比加载失败: ${esc(error.message || error)}</p></div>`;
    }
  }

  function reset() {
    cachePromise = null;
    disposeChart();
  }

  window.RankingCompare = { render, reset };
})();
