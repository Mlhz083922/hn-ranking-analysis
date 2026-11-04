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
    reportPeriod: "",
    reportCache: new Map(),
    category: "坦基尼套装",
    type: "bsr",
    mode: "grid",
    visible: 50,
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
      state.reportPeriod = state.manifest.reports?.[0]?.date || "";
      state.reportIndex = 0;
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
    $("#period-pill").textContent = `最新榜单 ${meta.latestLabel}`;
    const latestReport = state.manifest.reports?.[0];
    $("#generated-at").textContent = latestReport ? `最新汇总 ${latestReport.label}` : "暂无汇总报告";
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

  function renderProductGrid(products) {
    $("#ranking-content").innerHTML = `
      <div class="rank-image-grid">
        ${products.map((product) => `
          <a class="rank-image-card" href="${esc(product.url || `https://www.amazon.com/dp/${encodeURIComponent(product.asin)}`)}" target="_blank" rel="noopener" title="${esc(product.title)}">
            <div class="rank-img-wrap">
              <span class="rank-badge">${product.rank}</span>
              ${product.image
                ? `<img src="${esc(product.image)}" alt="${esc(product.title || product.asin)}" loading="lazy" onerror="this.closest('.rank-image-card').style.opacity='0.35'">`
                : `<div class="rank-img-placeholder"><i data-lucide="image-off"></i></div>`}
            </div>
            <div class="rank-img-info">
              <div class="rank-img-price">${product.price != null ? `$${fmtNum(product.price)}` : "-"}</div>
              <div class="rank-img-title">${esc(product.title || product.asin)}</div>
              <div class="rank-img-sales">月销 ${product.sales != null ? fmtNum(product.sales, 0) : "-"} · ${product.reviews != null ? fmtNum(product.reviews, 0) : "-"}评</div>
              <div class="rank-img-rating">${product.rating != null ? `★ ${product.rating.toFixed(1)}` : ""}${product.bsrSmall != null ? ` · BSR ${fmtNum(product.bsrSmall, 0)}` : ""}</div>
              <div class="rank-img-listed">上架 ${product.listed ? esc(product.listed) : "-"}</div>
            </div>
          </a>`).join("")}
      </div>
      <p class="hint" style="margin-top:10px">点击图片查看该产品在亚马逊的详情页（新窗口打开）</p>`;
  }

  function renderProductTable(products) {
    $("#ranking-content").innerHTML = `
      <div class="table-wrap" style="max-height:560px;overflow:auto;margin-top:14px">
        <table class="data-table">
          <thead><tr>
            <th>#</th><th>ASIN</th><th>品牌</th><th>标题</th><th>价格</th><th>评论</th><th>评分</th><th>月销</th><th>小类BSR</th><th>上架天数</th><th>Coupon</th>
          </tr></thead>
          <tbody>
            ${products.map((product) => `
              <tr>
                <td class="num">${product.rank}</td>
                <td class="num" style="font-size:11.5px"><a href="${esc(product.url || `https://www.amazon.com/dp/${encodeURIComponent(product.asin)}`)}" target="_blank" rel="noopener">${esc(product.asin)}</a></td>
                <td>${esc(product.brand)}</td>
                <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(product.title)}">${esc(product.title)}</td>
                <td class="num">${money(product.price)}</td>
                <td class="num">${fmtNum(product.reviews)}</td>
                <td class="num">${product.rating == null ? "-" : product.rating.toFixed(1)}</td>
                <td class="num">${fmtNum(product.sales)}</td>
                <td class="num">${product.bsrSmall != null ? fmtNum(product.bsrSmall) : "-"}</td>
                <td class="num">${product.days != null ? fmtNum(product.days) : "-"}</td>
                <td>${product.coupon ? esc(product.coupon) : "-"}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderRankingProducts(products) {
    const visible = Math.min(products.length, state.visible);
    const pageProducts = products.slice(0, visible);
    if (state.mode === "table") renderProductTable(pageProducts);
    else renderProductGrid(pageProducts);
    if (products.length > visible) {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "text-align:center;margin-top:14px";
      wrapper.innerHTML = `
        <button class="btn btn-primary" type="button" id="ranking-load-more">
          <i data-lucide="chevron-down"></i>加载更多（剩余 ${products.length - visible}）
        </button>`;
      $("#ranking-content").appendChild(wrapper);
      $("#ranking-load-more").addEventListener("click", () => {
        state.visible = Math.min(products.length, state.visible + 50);
        renderRankingProducts(products);
        initIcons();
      });
    }
  }

  async function renderRankings() {
    const periodIndex = state.periodIndex;
    const category = state.category;
    const type = state.type;
    $("#ranking-title").textContent = category;
    $("#ranking-content").innerHTML = `<div class="empty-state"><p>正在加载榜单…</p></div>`;
    try {
      const period = await loadCurrentPeriod();
      if (periodIndex !== state.periodIndex || category !== state.category || type !== state.type) return;
      const section = activeSection(period);
      const typeLabel = state.manifest.meta.typeLabels[state.type];
      if (!section) {
        $("#ranking-title").textContent = `${state.category} · ${typeLabel}`;
        $("#ranking-content").innerHTML = `<div class="empty-state"><p>该数据期暂无${esc(typeLabel)}数据</p></div>`;
        return;
      }
      $("#ranking-title").innerHTML = `
        <i data-lucide="${state.type === "bsr" ? "flame" : "sparkles"}"></i>
        ${esc(state.category)} · ${esc(typeLabel)}
        <span class="tag blue">${esc(period.label)}</span>
        <span class="tag">${section.products.length} 款产品</span>`;
      renderRankingProducts(section.products);
      initIcons();
    } catch (error) {
      $("#ranking-content").innerHTML = `<div class="empty-state"><p>榜单加载失败: ${esc(error.message || error)}</p></div>`;
    }
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }

  function reportMatchesPeriod(report) {
    return !state.reportPeriod || report.date === state.reportPeriod;
  }

  function renderReportList() {
    const reports = state.manifest.reports || [];
    const filtered = reports
      .map((report, index) => ({ report, index }))
      .filter(({ report }) => reportMatchesPeriod(report));
    $("#report-count").textContent = String(filtered.length);
    const periodSelect = $("#report-period-filter");
    periodSelect.innerHTML = `
      <option value="">全部</option>
      ${Array.from(new Set(reports.map((report) => report.date))).map((date) => `
        <option value="${esc(date)}" ${date === state.reportPeriod ? "selected" : ""}>${esc(date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8))}</option>
      `).join("")}`;
    $("#report-list").innerHTML = filtered.map(({ report, index }) => {
      const date = new Date(report.mtime || 0);
      const time = date.getTime()
        ? date.toLocaleString("zh-CN", { hour12: false })
        : "-";
      return `
        <div class="file-row">
          <div class="file-icon xlsx"><i data-lucide="file-spreadsheet"></i></div>
          <div class="file-info">
            <div class="file-name">${esc(report.sourceFile)}</div>
            <div class="file-meta">${esc(time)} · ${esc(formatFileSize(report.size))}</div>
          </div>
          <div class="file-actions">
            <button class="btn btn-sm btn-primary" type="button" data-report-index="${index}">
              <i data-lucide="eye"></i>查看
            </button>
          </div>
        </div>`;
    }).join("");
    initIcons();
    return filtered;
  }

  async function showReport(index) {
    const reports = state.manifest.reports || [];
    const reportMeta = reports[index];
    if (!reportMeta) return;
    state.reportIndex = index;
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
    const filtered = renderReportList();
    const selectedIsVisible = filtered.some(({ index }) => index === state.reportIndex);
    if (!selectedIsVisible && filtered.length) state.reportIndex = filtered[0].index;
    if (filtered.length) showReport(state.reportIndex);
    else $("#insights-content").innerHTML = `<div class="empty-state"><p>暂无汇总报告</p></div>`;
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
      state.visible = 50;
      renderControls();
      renderRankings();
    });
    $("#type-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-type]");
      if (!button) return;
      state.type = button.dataset.type;
      state.visible = 50;
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
      state.visible = 50;
      renderControls();
      renderRankings();
    });
    $("#report-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-report-index]");
      if (!button) return;
      showReport(Number(button.dataset.reportIndex || 0));
    });
    $("#report-period-filter").addEventListener("change", (event) => {
      state.reportPeriod = event.target.value;
      renderReports();
    });
    $$(".view-tab").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
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
