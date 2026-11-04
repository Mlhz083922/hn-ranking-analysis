(function () {
  "use strict";

  const PASSWORD_HASH = "c47ad772ab8141e427d2982db0fd7060cffad4806d218e87d3644fccaf07a461";
  const AUTH_KEY = "hnRankingReadonlyAuthTs";
  const state = {
    data: null,
    periodIndex: 0,
    reportIndex: 0,
    category: "坦基尼套装",
    type: "bsr",
    mode: "grid",
    view: "rankings",
    query: "",
  };

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const esc = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const num = (value, digits) => value == null || !Number.isFinite(Number(value))
    ? "-"
    : Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: digits == null ? 0 : digits,
      maximumFractionDigits: digits == null ? 0 : digits,
    });
  const money = (value) => value == null ? "-" : `$${num(value, Number(value) < 100 ? 1 : 0)}`;

  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function toast(message, kind) {
    const root = $("#toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = `toast${kind ? ` ${kind}` : ""}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

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

  async function loadData() {
    const status = $("#load-status");
    status.hidden = false;
    status.textContent = "正在加载榜单快照…";
    try {
      const response = await fetch("./data/rankings.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`数据加载失败 ${response.status}`);
      state.data = await response.json();
      state.periodIndex = 0;
      state.category = state.data.meta.categories[0];
    } finally {
      status.hidden = true;
    }
  }

  function activePeriod() {
    return state.data.periods[state.periodIndex];
  }

  function activeSection() {
    return activePeriod().categories[state.category]?.[state.type] || null;
  }

  function activeBrief() {
    return state.data.briefs[state.reportIndex] || null;
  }

  function renderHeader() {
    const meta = state.data.meta;
    $("#period-pill").textContent = `最新期 ${meta.latestLabel}`;
    $("#generated-at").textContent = `生成 ${new Date(meta.generatedAt).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}`;
  }

  function renderControls() {
    const meta = state.data.meta;
    $("#category-tabs").innerHTML = meta.categories.map((category) => `
      <button type="button" data-category="${esc(category)}" class="${category === state.category ? "is-active" : ""}">
        ${esc(category)}
      </button>
    `).join("");
    $("#period-select").innerHTML = state.data.periods.map((period, index) => `
      <option value="${index}" ${index === state.periodIndex ? "selected" : ""}>${esc(period.label)}</option>
    `).join("");
    $$("#type-tabs [data-type]").forEach((button) => button.classList.toggle("is-active", button.dataset.type === state.type));
    $$("#mode-tabs [data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  }

  function renderStats(section) {
    const stats = section.stats;
    const topBrands = stats.topBrands.slice(0, 3).map((item) => item.brand).join(" · ") || "-";
    const cards = [
      { label: "榜单产品", value: num(stats.count), note: state.type === "bsr" ? "热卖榜 Top100" : "新品榜收录" },
      { label: "平均价格", value: money(stats.avgPrice), note: `中位价 ${money(stats.medianPrice)}` },
      { label: "平均月销", value: num(stats.avgSales), note: `合计 ${num(stats.totalSales)}` },
      { label: "平均评分", value: stats.avgRating == null ? "-" : stats.avgRating.toFixed(1), note: `零评论 ${num(stats.zeroReviews)} 款` },
      { label: "主要品牌", value: topBrands, note: `近 60 天上架 ${num(stats.new60)} 款` },
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
                  <span>月销 ${num(product.sales)}</span>
                  <span>${product.rating == null ? "-" : product.rating.toFixed(1)}★ · ${num(product.reviews)}评</span>
                </div>
                <div class="product-tags">
                  <span class="tag accent">${esc(product.asin || "ASIN待补")}</span>
                  ${product.days != null ? `<span class="tag">上架 ${num(product.days)} 天</span>` : ""}
                  ${product.coupon ? `<span class="tag amber">${esc(product.coupon)}</span>` : ""}
                </div>
              </div>
            </a>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderProductTable(products) {
    if (!products.length) {
      $("#ranking-content").innerHTML = `<div class="empty-state"><p>没有匹配的产品</p></div>`;
      return;
    }
    $("#ranking-content").innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ASIN</th>
              <th>品牌</th>
              <th>标题</th>
              <th>价格</th>
              <th>评分</th>
              <th>评论</th>
              <th>月销</th>
              <th>小类 BSR</th>
              <th>上架天数</th>
              <th>榜位变化</th>
            </tr>
          </thead>
          <tbody>
            ${products.map((product) => `
              <tr>
                <td class="num">${product.rank}</td>
                <td class="num"><a href="${esc(product.url || "#")}" target="_blank" rel="noopener">${esc(product.asin || "-")}</a></td>
                <td>${esc(product.brand || "-")}</td>
                <td class="title-cell" title="${esc(product.title)}">${esc(product.title)}</td>
                <td class="num">${money(product.price)}</td>
                <td class="num">${product.rating == null ? "-" : product.rating.toFixed(1)}</td>
                <td class="num">${num(product.reviews)}</td>
                <td class="num">${num(product.sales)}</td>
                <td class="num">${num(product.bsrSmall)}</td>
                <td class="num">${num(product.days)}</td>
                <td class="num">${rankMove(product) || "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderRankings() {
    const period = activePeriod();
    const section = activeSection();
    const categoryLabel = state.category;
    const typeLabel = state.data.meta.typeLabels[state.type];
    $("#ranking-context").textContent = `${period.label} · 亚马逊美国站 · ${typeLabel}`;
    $("#ranking-title").textContent = categoryLabel;
    if (!section) {
      $("#stats-grid").innerHTML = "";
      $("#ranking-content").innerHTML = `<div class="empty-state"><p>该数据期暂无${esc(typeLabel)}数据</p></div>`;
      return;
    }
    renderStats(section);
    const products = filterProducts(section.products);
    if (state.mode === "table") renderProductTable(products);
    else renderProductGrid(products);
    initIcons();
  }

  function renderComparison(section) {
    if (!section || !section.categories.length) return "";
    return `
      <div class="comparison-block">
        <h4>${esc(section.title)}</h4>
        <div class="table-wrap">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>指标</th>
                ${section.categories.map((category) => `<th>${esc(category)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${section.rows.map((row) => `
                <tr>
                  <td>${esc(row.metric)}</td>
                  ${row.values.map((value) => `<td>${esc(value || "-")}</td>`).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderInsights() {
    const briefs = state.data.briefs || [];
    const brief = activeBrief();
    $("#insights-title").textContent = `汇总报告 · ${briefs.length} 期`;
    $("#summary-file").textContent = brief?.sourceFile || "暂无汇总报告";
    $("#report-tabs").innerHTML = briefs.map((item, index) => `
      <button type="button" data-report-index="${index}" class="${index === state.reportIndex ? "is-active" : ""}">
        ${esc(item.sourceLabel || item.period || item.sourceDate)}
      </button>
    `).join("");
    if (!brief) {
      $("#insights-content").innerHTML = `<div class="empty-state"><p>该数据期暂无汇总分析报告</p></div>`;
      return;
    }
    const details = brief.categoryDetails || [];
    const findings = brief.findings || [];
    const actions = brief.actions || [];
    $("#insights-content").innerHTML = `
      <div class="insight-panel">
        <h3>四大子类目对比</h3>
        <div class="comparison-grid">
          ${renderComparison(brief.comparison.bsr)}
          ${renderComparison(brief.comparison.new)}
        </div>
        ${brief.trend ? `<p class="trend-callout" style="margin-top:16px">${esc(brief.trend)}</p>` : ""}
      </div>

      <div class="insight-panel">
        <h3>子类目详情</h3>
        <div class="detail-grid">
          ${details.map((detail) => `
            <div class="detail-block">
              <h4>${esc(detail.name)}</h4>
              <table class="comparison-table">
                <thead>
                  <tr>
                    <th>指标</th>
                    ${(detail.metricHeaders || ["BSR", "NEW"]).map((header) => `<th>${esc(header)}</th>`).join("")}
                  </tr>
                </thead>
                <tbody>
                  ${detail.metrics.map((row) => `
                    <tr>
                      <td>${esc(row.metric)}</td>
                      ${row.values.map((value) => `<td>${esc(value || "-")}</td>`).join("")}
                    </tr>
                  `).join("")}
                </tbody>
              </table>
              ${detail.conclusion ? `<p class="detail-note">${esc(detail.conclusion)}</p>` : ""}
            </div>
          `).join("")}
        </div>
      </div>

      <div class="insight-panel">
        <h3>关键发现</h3>
        <div class="finding-list">
          ${findings.map((finding) => `
            <div class="finding-group">
              <h4>${esc(finding.name)}</h4>
              <ul>${finding.points.map((point) => `<li>${esc(point)}</li>`).join("")}</ul>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="insight-panel">
        <h3>行动建议</h3>
        ${actions.map((action) => `
          <div class="action-block">
            <h4>${esc(action.title)}</h4>
            <ol>${action.paragraphs.map((paragraph) => `<li>${esc(paragraph)}</li>`).join("")}</ol>
          </div>
        `).join("")}
      </div>
    `;
  }

  function render() {
    renderHeader();
    renderControls();
    renderRankings();
    renderInsights();
  }

  function bindEvents() {
    $("#category-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category;
      state.query = "";
      $("#product-search").value = "";
      render();
    });
    $("#type-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-type]");
      if (!button) return;
      state.type = button.dataset.type;
      render();
    });
    $("#mode-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");
      if (!button) return;
      state.mode = button.dataset.mode;
      render();
    });
    $("#period-select").addEventListener("change", (event) => {
      state.periodIndex = Number(event.target.value || 0);
      render();
    });
    $("#product-search").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderRankings();
    });
    $("#report-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-report-index]");
      if (!button) return;
      state.reportIndex = Number(button.dataset.reportIndex || 0);
      renderInsights();
    });
    $$(".view-tab").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view;
        $$(".view-tab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
        $("#rankings-view").classList.toggle("view-hidden", state.view !== "rankings");
        $("#insights-view").classList.toggle("view-hidden", state.view !== "insights");
        initIcons();
      });
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
      await loadData();
      bindEvents();
      render();
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
