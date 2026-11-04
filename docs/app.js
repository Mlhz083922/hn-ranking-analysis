(function () {
  "use strict";

  const PASSWORD_HASH = "c47ad772ab8141e427d2982db0fd7060cffad4806d218e87d3644fccaf07a461";
  const AUTH_KEY = "hnRankingReadonlyAuthTs";
  const { esc, fmtNum, initIcons, toast, fetchJSON } = window.RankingUI;
  const state = {
    manifest: null,
    periodIndex: 0,
    currentPeriod: null,
    periodCache: new Map(),
    periodPromise: null,
    reportIndex: 0,
    reportCache: new Map(),
    category: "坦基尼套装",
    type: "bsr",
    mode: "grid",
    view: "rankings",
    query: "",
    compareStarted: false,
  };

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const money = (value) => value == null ? "-" : `$${fmtNum(value, Number(value) < 100 ? 1 : 0)}`;

  async function sha256(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function requireAuth() {
    let last = 0;
    try { last = Number(localStorage.getItem(AUTH_KEY) || 0); } catch (error) { /* ignore */ }
    if (last && Date.now() - last < 24 * 60 * 60 * 1000) {
      $("#auth-gate")?.remove();
      return;
    }
    const gate = $("#auth-gate");
    const form = $("#auth-form");
    const input = $("#auth-pass");
    const error = $("#auth-error");
    await new Promise((resolve) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (await sha256(input.value) === PASSWORD_HASH) {
          try { localStorage.setItem(AUTH_KEY, String(Date.now())); } catch (authError) { /* ignore */ }
          gate.remove();
          resolve();
        } else {
          error.hidden = false;
          input.value = "";
          input.focus();
        }
      });
    });
  }

  async function loadManifest() {
    const status = $("#load-status");
    status.hidden = false;
    status.textContent = "正在加载榜单索引…";
    try {
      state.manifest = await fetchJSON("./data/index.json");
      state.periodIndex = 0;
      state.category = state.manifest.meta.categories[0];
    } finally {
      status.hidden = true;
    }
  }

  async function loadPeriodByDate(date) {
    if (state.periodCache.has(date)) return state.periodCache.get(date);
    const data = await fetchJSON(`./data/periods/${encodeURIComponent(date)}.json`);
    state.periodCache.set(date, data);
    return data;
  }

  async function loadCurrentPeriod() {
    const date = state.manifest.periods[state.periodIndex].date;
    if (state.currentPeriod?.date === date) return state.currentPeriod;
    if (state.periodPromise) return state.periodPromise;
    state.periodPromise = loadPeriodByDate(date)
      .then((period) => {
        if (state.manifest.periods[state.periodIndex].date === date) state.currentPeriod = period;
        return period;
      })
      .finally(() => { state.periodPromise = null; });
    return state.periodPromise;
  }

  function activeSection(period) {
    return period?.categories?.[state.category]?.[state.type] || null;
  }

  function renderHeader() {
    const meta = state.manifest.meta;
    $("#period-pill").textContent = `${meta.periodCount} 期 · 最新 ${meta.latestLabel}`;
    $("#generated-at").textContent = `${meta.summaryReportCount} 份汇总报告`;
  }

  function renderControls() {
    const meta = state.manifest.meta;
    $("#category-tabs").innerHTML = meta.categories.map((category) => `
      <button type="button" data-category="${esc(category)}" class="${category === state.category ? "is-active" : ""}">
        ${esc(category)}
      </button>
    `).join("");
    $("#period-select").innerHTML = state.manifest.periods.map((period, index) => `
      <option value="${index}" ${index === state.periodIndex ? "selected" : ""}>${esc(period.label)}</option>
    `).join("");
    $$("#type-tabs [data-type]").forEach((button) => button.classList.toggle("is-active", button.dataset.type === state.type));
    $$("#mode-tabs [data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  }

  function renderStats(section) {
    const stats = section.stats;
    const topBrands = stats.topBrands.slice(0, 3).map((item) => item.brand).join(" · ") || "-";
    const cards = [
      { label: "榜单产品", value: fmtNum(stats.count), note: state.type === "bsr" ? "热卖榜 Top100" : "新品榜收录" },
      { label: "平均价格", value: money(stats.avgPrice), note: `中位价 ${money(stats.medianPrice)}` },
      { label: "平均月销", value: fmtNum(stats.avgSales), note: `合计 ${fmtNum(stats.totalSales)}` },
      { label: "平均评分", value: stats.avgRating == null ? "-" : stats.avgRating.toFixed(1), note: `零评论 ${fmtNum(stats.zeroReviews)} 款` },
      { label: "主要品牌", value: topBrands, note: `近 60 天上架 ${fmtNum(stats.new60)} 款` },
    ];
    $("#stats-grid").innerHTML = cards.map((card) => `
      <div class="stat-card">
        <div class="stat-label">${esc(card.label)}</div>
        <div class="stat-value" title="${esc(card.value)}">${esc(card.value)}</div>
        <div class="stat-note" title="${esc(card.note)}">${esc(card.note)}</div>
      </div>
    `).join("");
  }

  function rankMove(product) {
    if (product.rankDelta > 0) return `<span class="rank-move up">↑ ${product.rankDelta}</span>`;
    if (product.rankDelta < 0) return `<span class="rank-move down">↓ ${Math.abs(product.rankDelta)}</span>`;
    if (product.isNewEntry) return `<span class="rank-move new">新进榜</span>`;
    return "";
  }

  function filterProducts(products) {
    const query = state.query.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) => [product.asin, product.brand, product.title]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }

  function renderProductGrid(products) {
    if (!products.length) {
      $("#ranking-content").innerHTML = `<div class="empty-state"><p>没有匹配的产品</p></div>`;
      return;
    }
    $("#ranking-content").innerHTML = `
      <div class="product-grid">
        ${products.map((product) => {
          const rankClass = product.rank <= 3 ? `rank-${product.rank}` : "";
          const image = product.image
            ? `<img src="${esc(product.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
            : "";
          return `
            <a class="product-card" href="${esc(product.url || "#")}" target="_blank" rel="noopener">
              <div class="product-image">
                ${image}
                <div class="image-fallback" ${product.image ? "hidden" : ""}><i data-lucide="image-off"></i></div>
                <span class="rank-badge ${rankClass}">#${product.rank}</span>
              </div>
              <div class="product-info">
                <div class="product-brand-line">
                  <span title="${esc(product.brand)}">${esc(product.brand || "未标注品牌")}</span>
                  ${rankMove(product)}
                </div>
                <div class="product-title" title="${esc(product.title)}">${esc(product.title)}</div>
                <div class="product-price">${money(product.price)}</div>
                <div class="product-metrics">
                  <span>月销 ${fmtNum(product.sales)}</span>
                  <span>${product.rating == null ? "-" : product.rating.toFixed(1)}★ · ${fmtNum(product.reviews)}评</span>
                </div>
                <div class="product-tags">
                  <span class="tag accent">${esc(product.asin || "ASIN待补")}</span>
                  ${product.days != null ? `<span class="tag">上架 ${fmtNum(product.days)} 天</span>` : ""}
                  ${product.coupon ? `<span class="tag amber">${esc(product.coupon)}</span>` : ""}
                </div>
              </div>
            </a>`;
        }).join("")}
      </div>`;
  }

  function renderProductTable(products) {
    if (!products.length) {
      $("#ranking-content").innerHTML = `<div class="empty-state"><p>没有匹配的产品</p></div>`;
      return;
    }
    $("#ranking-content").innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>#</th><th>ASIN</th><th>品牌</th><th>标题</th><th>价格</th><th>评分</th><th>评论</th><th>月销</th><th>小类 BSR</th><th>上架天数</th><th>榜位变化</th>
          </tr></thead>
          <tbody>
            ${products.map((product) => `
              <tr>
                <td class="num">${product.rank}</td>
                <td class="num"><a href="${esc(product.url || "#")}" target="_blank" rel="noopener">${esc(product.asin || "-")}</a></td>
                <td>${esc(product.brand || "-")}</td>
                <td class="title-cell" title="${esc(product.title)}">${esc(product.title)}</td>
                <td class="num">${money(product.price)}</td>
                <td class="num">${product.rating == null ? "-" : product.rating.toFixed(1)}</td>
                <td class="num">${fmtNum(product.reviews)}</td>
                <td class="num">${fmtNum(product.sales)}</td>
                <td class="num">${fmtNum(product.bsrSmall)}</td>
                <td class="num">${fmtNum(product.days)}</td>
                <td class="num">${rankMove(product) || "-"}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  async function renderRankings() {
    const periodIndex = state.periodIndex;
    const category = state.category;
    const type = state.type;
    $("#ranking-context").textContent = "正在加载数据期…";
    $("#ranking-title").textContent = category;
    $("#stats-grid").innerHTML = "";
    $("#ranking-content").innerHTML = `<div class="empty-state"><p>正在加载榜单…</p></div>`;
    try {
      const period = await loadCurrentPeriod();
      if (periodIndex !== state.periodIndex || category !== state.category || type !== state.type) return;
      const section = activeSection(period);
      const typeLabel = state.manifest.meta.typeLabels[state.type];
      $("#ranking-context").textContent = `${period.label} · 亚马逊美国站 · ${typeLabel}`;
      $("#ranking-title").textContent = state.category;
      if (!section) {
        $("#ranking-content").innerHTML = `<div class="empty-state"><p>该数据期暂无${esc(typeLabel)}数据</p></div>`;
        return;
      }
      renderStats(section);
      const products = filterProducts(section.products);
      if (state.mode === "table") renderProductTable(products);
      else renderProductGrid(products);
      initIcons();
    } catch (error) {
      $("#ranking-content").innerHTML = `<div class="empty-state"><p>榜单加载失败: ${esc(error.message || error)}</p></div>`;
    }
  }

  function renderReportTabs() {
    const reports = state.manifest.reports || [];
    $("#report-tabs").innerHTML = reports.map((report, index) => `
      <button type="button" data-report-index="${index}" class="${index === state.reportIndex ? "is-active" : ""}">
        ${esc(report.label)}
      </button>
    `).join("");
    $("#insights-title").textContent = `汇总报告 · ${reports.length} 份`;
  }

  async function showReport(index) {
    const reports = state.manifest.reports || [];
    const reportMeta = reports[index];
    if (!reportMeta) return;
    state.reportIndex = index;
    $$("#report-tabs [data-report-index]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.reportIndex) === index);
    });
    $("#summary-file").textContent = reportMeta.sourceFile;
    $("#insights-content").innerHTML = `<div class="empty-state"><p>正在加载 ${esc(reportMeta.sourceFile)}…</p></div>`;
    try {
      let report = state.reportCache.get(reportMeta.key);
      if (!report) {
        report = await fetchJSON(`./data/reports/${encodeURIComponent(reportMeta.key)}.json`);
        state.reportCache.set(reportMeta.key, report);
      }
      if (state.reportIndex !== index) return;
      window.RankingReportViewer.render($("#insights-content"), report);
    } catch (error) {
      $("#insights-content").innerHTML = `<div class="empty-state"><p>报告加载失败: ${esc(error.message || error)}</p></div>`;
    }
  }

  function renderReports() {
    renderReportTabs();
    showReport(state.reportIndex);
  }

  function renderCompare() {
    $("#compare-period-count").textContent = `${state.manifest.meta.periodCount} 个榜单数据期`;
    if (state.compareStarted) return;
    state.compareStarted = true;
    window.RankingCompare.render($("#compare-content"), {
      manifest: state.manifest,
      loadPeriod: loadPeriodByDate,
    });
  }

  function switchView(view) {
    state.view = view;
    $$(".view-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
    $("#rankings-view").classList.toggle("view-hidden", view !== "rankings");
    $("#insights-view").classList.toggle("view-hidden", view !== "insights");
    $("#compare-view").classList.toggle("view-hidden", view !== "compare");
    if (view === "rankings") renderRankings();
    else if (view === "insights") renderReports();
    else if (view === "compare") renderCompare();
    initIcons();
  }

  function bindEvents() {
    $("#category-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category;
      state.query = "";
      $("#product-search").value = "";
      renderControls();
      renderRankings();
    });
    $("#type-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-type]");
      if (!button) return;
      state.type = button.dataset.type;
      renderControls();
      renderRankings();
    });
    $("#mode-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");
      if (!button) return;
      state.mode = button.dataset.mode;
      renderControls();
      renderRankings();
    });
    $("#period-select").addEventListener("change", (event) => {
      state.periodIndex = Number(event.target.value || 0);
      state.currentPeriod = null;
      renderControls();
      renderRankings();
    });
    $("#product-search").addEventListener("input", (event) => {
      state.query = event.target.value;
      if (state.currentPeriod) renderRankings();
    });
    $("#report-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-report-index]");
      if (!button) return;
      showReport(Number(button.dataset.reportIndex || 0));
    });
    $$(".view-tab").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });
    $("#lock-site").addEventListener("click", () => {
      try { localStorage.removeItem(AUTH_KEY); } catch (error) { /* ignore */ }
      location.reload();
    });
  }

  async function init() {
    try {
      await requireAuth();
      $("#app").hidden = false;
      await loadManifest();
      renderHeader();
      renderControls();
      bindEvents();
      switchView("rankings");
      initIcons();
    } catch (error) {
      const status = $("#load-status");
      status.hidden = false;
      status.textContent = error.message || "页面加载失败";
      toast(error.message || "页面加载失败");
    }
  }

  init();
})();
