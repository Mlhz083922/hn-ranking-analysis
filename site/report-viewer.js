(function () {
  "use strict";

  const { esc, initIcons } = window.RankingUI;

  function tableHtml(headers, dataRows) {
    if (!headers || headers.length === 0) return "";
    const imageColumns = headers
      .map((header, index) => (/主图|图片/.test(String(header)) ? index : -1))
      .filter((index) => index >= 0);
    const asinColumn = headers.findIndex((header) => /^asin$/i.test(String(header).trim()));
    const cellHtml = (row, columnIndex) => {
      const value = row[columnIndex] || "";
      if (imageColumns.includes(columnIndex)) {
        const asin = asinColumn >= 0 ? String(row[asinColumn] || "").trim() : "";
        if (/^(https?:\/\/|data:image\/)/i.test(String(value))) {
          return `<a href="https://www.amazon.com/dp/${encodeURIComponent(asin)}" target="_blank" rel="noopener" title="${esc(asin || "查看商品")}"><img src="${esc(value)}" alt="${esc(asin || "商品")}" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block"></a>`;
        }
        return asin
          ? `<a href="https://www.amazon.com/dp/${encodeURIComponent(asin)}" target="_blank" rel="noopener">${esc(asin)}</a>`
          : esc(value);
      }
      return esc(value);
    };
    return `
      <div class="table-wrap" style="margin:6px 0 10px">
        <table class="data-table">
          <thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${dataRows.map((row) => `<tr>${headers.map((_, index) => `<td>${cellHtml(row, index)}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderSummarySheet(sheet) {
    const rows = sheet.rows || [];
    if (!rows.length) return `<p class="hint">汇总表为空</p>`;
    let html = "";
    let index = 0;
    if (rows[0] && rows[0][0]) {
      const title = String(rows[0][0]).trim();
      const extra = rows[0].slice(1).filter((cell) => cell !== "").join(" · ");
      html += `<div style="margin-bottom:14px"><div style="font-size:17px;font-weight:700">${esc(title)}</div>${extra ? `<div class="hint" style="margin-top:2px">${esc(extra)}</div>` : ""}</div>`;
      index = 1;
    }

    while (index < rows.length) {
      const row = rows[index];
      const cells = row.map((cell) => String(cell == null ? "" : cell).trim());
      const first = cells[0] || "";
      if (!first) {
        index++;
        continue;
      }
      if (/^[一二三四五六七八九十]+、/.test(first)) {
        html += `<div style="font-size:15px;font-weight:700;color:var(--accent-dark);margin:16px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--accent-soft)">${esc(first)}</div>`;
        index++;
        continue;
      }
      if (first === "BSR热卖榜" || first === "新品榜(NR)" || first === "新品榜") {
        html += `<div style="font-size:13.5px;font-weight:700;margin:12px 0 6px;color:var(--ink)">${esc(first)}</div>`;
        index++;
        continue;
      }
      if (/^【/.test(first)) {
        html += `<div style="font-size:14px;font-weight:700;margin:14px 0 6px;color:var(--ink);background:var(--panel-soft);padding:6px 10px;border-radius:6px">${esc(first)}</div>`;
        index++;
        continue;
      }
      const looksHeader = cells.length >= 2
        && cells.some((cell) => /指标|排名|品牌|价格|评论|评分|销量|上架|占比|名称|榜单/.test(cell));
      if (looksHeader && index + 1 < rows.length) {
        const headers = cells;
        const dataRows = [];
        let nextIndex = index + 1;
        while (nextIndex < rows.length) {
          const dataRow = rows[nextIndex].map((cell) => String(cell == null ? "" : cell).trim());
          if (!dataRow[0]) break;
          if (/^[一二三四五六七八九十]+、/.test(dataRow[0])) break;
          if (dataRow[0] === "BSR热卖榜" || dataRow[0] === "新品榜(NR)" || dataRow[0] === "新品榜" || /^【/.test(dataRow[0])) break;
          if (dataRow.length < 2) break;
          if (/^(均价|平均|中位|P\d|Top品牌|Top|热卖词|产品数|品牌|总|零|高销|评分|评论|月销|Coupon|新品|区间|主力|指标)/.test(dataRow[0]) || /^[\d.%$,\-]+$/.test(dataRow[0])) {
            dataRows.push(dataRow);
            nextIndex++;
          } else {
            break;
          }
        }
        if (dataRows.length) {
          html += tableHtml(headers, dataRows);
          index = nextIndex;
          continue;
        }
      }
      if (cells.length >= 2 && !looksHeader) {
        const key = cells[0];
        const values = cells.slice(1);
        html += `<div style="display:flex;gap:10px;padding:3px 0;font-size:13px;flex-wrap:wrap">
          <span style="font-weight:600;color:var(--ink-2);min-width:110px">${esc(key)}</span>
          ${values.map((value, valueIndex) => `<span style="color:${valueIndex === 0 ? "var(--ink)" : "var(--accent-dark)"};font-weight:${valueIndex === 0 ? "500" : "600"};font-variant-numeric:tabular-nums">${esc(value)}</span>`).join("<span style='color:var(--muted)'> | </span>")}
        </div>`;
        index++;
        continue;
      }
      html += `<div style="padding:3px 0;color:var(--ink-2);font-size:13px">${esc(first)}</div>`;
      index++;
    }
    return html;
  }

  function renderDetailSheet(sheet) {
    const rows = sheet.rows || [];
    let html = "";
    let currentModule = "";
    let tableRows = [];
    let headers = null;
    let index = 0;
    let toggleSequence = 0;

    const flush = () => {
      if (!headers) return;
      const table = `<div style="margin:4px 0 10px">${tableHtml(headers, tableRows)}</div>`;
      if (/^❹/.test(currentModule)) {
        const toggleId = `report-top100-${++toggleSequence}`;
        html += `
          <div style="display:flex;justify-content:flex-end;margin:2px 0">
            <button class="btn btn-sm" type="button" data-collapse-toggle="${toggleId}" aria-expanded="true">
              <i data-lucide="eye-off"></i><span>隐藏产品表</span>
            </button>
          </div>
          <div data-collapse-target="${toggleId}">${table}</div>`;
      } else {
        html += table;
      }
      headers = null;
      tableRows = [];
    };

    while (index < rows.length) {
      const row = rows[index];
      const first = (row[0] || "").toString().trim();
      if (!first) {
        index++;
        continue;
      }
      const looksHeaderLike = row.some((cell) => /排名|ASIN|标题|价格|评论|销量|评分|上架/.test(String(cell)))
        && row.length >= 4;
      if (/^[❶❷❸❹❺❻❼❽]/.test(first)) {
        flush();
        currentModule = first;
        html += `<div style="font-size:13.5px;font-weight:700;margin:14px 0 6px;color:var(--ink)">${esc(first)}</div>`;
        index++;
        continue;
      }
      if (/^(BSR热卖榜|新品榜\(NR\))\s*-\s*Top\s*\d+\s*深度分析/.test(first)) {
        flush();
        html += `<div style="font-size:15px;font-weight:800;margin:14px 0 8px;padding:8px 12px;background:var(--accent-soft);border-left:4px solid var(--accent);border-radius:6px;color:var(--accent-dark)">${esc(first)}</div>`;
        index++;
        continue;
      }
      if (/^⓿/.test(first) || /^[▲▼]/.test(first)) {
        flush();
        const color = first.startsWith("▼") ? "#e74c3c" : first.startsWith("▲") ? "#27ae60" : "var(--ink)";
        html += `<div style="font-size:13.5px;font-weight:700;margin:12px 0 6px;color:${color}">${esc(first)}</div>`;
        index++;
        continue;
      }
      if (row.length >= 4 && row.every((cell, cellIndex) => cellIndex === 0
        ? /^(Top|品牌|平均|近|月|评分|价格|Coupon|新品|中位|P\d)/.test(String(cell))
        : String(cell).includes("%") || /^[\d.]+$/.test(String(cell)) || cell === "")) {
        flush();
        html += `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:4px 0">${row.filter((cell) => cell !== "").map((cell) => `<span class="tag">${esc(cell)}</span>`).join("")}</div>`;
        index++;
        continue;
      }
      if (/^●/.test(first)) {
        flush();
        const parts = first.split("|").map((part) => part.trim()).filter(Boolean);
        const label = parts[0] || first;
        const refs = parts.slice(1);
        html += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:3px 0;padding:5px 10px;background:var(--panel-soft);border-radius:6px">
          <span style="font-weight:600;font-size:13px">${esc(label)}</span>
          ${refs.map((asin) => `<a href="${esc(asin.startsWith("http") ? asin : "https://www.amazon.com/dp/" + asin)}" target="_blank" rel="noopener" class="tag accent" style="text-decoration:none">${esc(asin.startsWith("http") ? "查看商品" : asin)}</a>`).join("")}
        </div>`;
        index++;
        continue;
      }
      if (headers) {
        tableRows.push(row);
        index++;
        continue;
      }
      if (first.includes("|") && !looksHeaderLike) {
        const parts = first.split("|").map((part) => part.trim()).filter(Boolean);
        if (parts.length > 1) {
          flush();
          html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0">${parts.map((part) => `<span class="tag">${esc(part)}</span>`).join("")}</div>`;
          index++;
          continue;
        }
      }
      if (first.includes(":")) {
        flush();
        const [key, ...rest] = first.split(":");
        html += `<div style="padding:2px 0;font-size:13px"><span style="font-weight:600">${esc(key)}</span><span style="color:var(--ink-2)">: ${esc(rest.join(":"))}</span></div>`;
        index++;
        continue;
      }
      if (looksHeaderLike) {
        flush();
        headers = row.map((header, columnIndex) => (header === "" ? `列${columnIndex + 1}` : String(header)));
        tableRows = [];
        index++;
        continue;
      }
      html += `<div style="padding:2px 0;font-size:13px;color:var(--ink-2)">${esc(first)}</div>`;
      index++;
    }
    flush();
    return html;
  }

  function bindCollapse(container) {
    container.querySelectorAll("[data-collapse-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = container.querySelector(`[data-collapse-target="${button.dataset.collapseToggle}"]`);
        if (!target) return;
        const hidden = target.style.display === "none";
        target.style.display = hidden ? "" : "none";
        button.setAttribute("aria-expanded", String(!hidden));
        button.innerHTML = hidden
          ? `<i data-lucide="eye-off"></i><span>隐藏产品表</span>`
          : `<i data-lucide="eye"></i><span>显示产品表</span>`;
        initIcons();
      });
    });
    const allButton = container.querySelector("[data-collapse-all-top100]");
    if (!allButton) return;
    allButton.addEventListener("click", () => {
      const targets = Array.from(container.querySelectorAll('[data-collapse-target^="report-top100-"]'));
      const anyVisible = targets.some((target) => target.style.display !== "none");
      targets.forEach((target) => {
        target.style.display = anyVisible ? "none" : "";
      });
      container.querySelectorAll("[data-collapse-toggle]").forEach((button) => {
        button.setAttribute("aria-expanded", String(!anyVisible));
        button.innerHTML = anyVisible
          ? `<i data-lucide="eye"></i><span>显示产品表</span>`
          : `<i data-lucide="eye-off"></i><span>隐藏产品表</span>`;
      });
      allButton.setAttribute("aria-expanded", String(!anyVisible));
      allButton.innerHTML = anyVisible
        ? `<i data-lucide="eye"></i><span>批量显示产品表</span>`
        : `<i data-lucide="eye-off"></i><span>批量隐藏产品表</span>`;
      initIcons();
    });
  }

  function render(container, report) {
    if (!report || !Array.isArray(report.sheets) || !report.sheets.length) {
      container.innerHTML = `<div class="empty-state"><p>汇总报告为空</p></div>`;
      return;
    }
    const summary = report.sheets[0];
    const detailSheets = report.sheets.slice(1);
    let html = `
      <article class="report-sheet">
        <div class="report-sheet-head">
          <div>
            <p class="eyebrow">${esc(report.label || "")}</p>
            <h2><i data-lucide="file-spreadsheet"></i>${esc(report.name || report.sourceFile || "")}</h2>
          </div>
          <span class="tag accent">${report.sheets.length} 个工作表</span>
        </div>
        ${renderSummarySheet(summary)}
      </article>`;
    if (detailSheets.length) {
      html += `
        <div style="display:flex;justify-content:flex-end;margin:8px 0">
          <button class="btn btn-sm" type="button" data-collapse-all-top100 aria-expanded="true">
            <i data-lucide="eye-off"></i><span>批量隐藏产品表</span>
          </button>
        </div>`;
      detailSheets.forEach((sheet) => {
        html += `
          <article class="report-sheet">
            <div class="report-sheet-head">
              <h2><i data-lucide="layers"></i>${esc(sheet.name)}</h2>
              <span class="tag">${sheet.rows.length} 行</span>
            </div>
            ${renderDetailSheet(sheet)}
          </article>`;
      });
    }
    container.innerHTML = html;
    initIcons();
    bindCollapse(container);
  }

  window.RankingReportViewer = { render };
})();
