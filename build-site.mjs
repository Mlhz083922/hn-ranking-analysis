import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORKBENCH_DIR = process.env.RANKING_WORKBENCH_DIR
  || path.join(os.homedir(), "Desktop", "AGENTS", "Codex", "亚马逊运营工作台");
const WORKSPACE_DIR = process.env.RANKING_WORKSPACE_DIR
  || path.join(os.homedir(), "Desktop", "AMZ- auto");
const RANKING_DIR = path.join(WORKSPACE_DIR, "榜单Data");
const RAW_DIR = path.join(RANKING_DIR, "Raw");
const OUTPUT_DIR = path.join(RANKING_DIR, "Output");
const SOURCE_DIR = path.join(ROOT, "site");
const DOCS_DIR = path.join(ROOT, "docs");
const DATA_DIR = path.join(DOCS_DIR, "data");
const CATEGORY_ORDER = ["坦基尼套装", "比基尼", "连体", "坦基尼上衣"];
const TYPE_LABELS = { bsr: "热卖榜 BSR", new: "新品榜 NEW" };

const { parseXlsxTable } = await import(
  pathToFileURL(path.join(WORKBENCH_DIR, "hotsearch-lib", "xlsx.mjs")).href
);
const requireDependency = createRequire(pathToFileURL(path.join(WORKBENCH_DIR, "server.mjs")));
const JSZip = requireDependency("jszip");
const sax = requireDependency("sax");
const { xml2js } = requireDependency("xml-js");

function dateFromName(name) {
  return (String(name || "").match(/(\d{8})/) || [""])[0];
}

function dateLabel(date) {
  return /^\d{8}$/.test(date)
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;
}

function cleanCell(value) {
  return String(value == null ? "" : value).trim();
}

function parseNumber(value) {
  const text = cleanCell(value).replace(/[, $]/g, "").replace(/%$/, "");
  if (!text || /^[-–—]+$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function columnIndex(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const value = cleanCell(headers[i]);
    if (patterns.some((pattern) => pattern.test(value))) return i;
  }
  return null;
}

function findHeaderRow(rows) {
  return rows.findIndex((row) => {
    const cells = row.map(cleanCell);
    const hasAsin = cells.some((cell) => /^asin$/i.test(cell));
    const hasTitle = cells.some((cell) => /标题|title/i.test(cell));
    return hasAsin && hasTitle;
  });
}

function asinFromUrl(value) {
  return (cleanCell(value).match(/\/dp\/([A-Z0-9]+)/i) || [])[1] || "";
}

function imageUrl(value) {
  const url = cleanCell(value);
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace(/^http:\/\//i, "https://");
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function excelColumnIndex(ref) {
  const match = /^([A-Z]+)/.exec(String(ref || ""));
  if (!match) return -1;
  let index = 0;
  for (const char of match[1]) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseSharedStringsXml(xml) {
  return new Promise((resolve, reject) => {
    const strings = [];
    const parser = sax.parser(true);
    let current = null;
    let inText = false;
    let text = "";
    parser.onopentag = (node) => {
      if (node.name === "si") current = "";
      else if (node.name === "t" && current !== null) {
        inText = true;
        text = "";
      }
    };
    parser.ontext = (value) => {
      if (inText) text += value;
    };
    parser.onclosetag = (name) => {
      if (name === "t" && current !== null) {
        current += text;
        inText = false;
      } else if (name === "si") {
        strings.push(current || "");
        current = null;
      }
    };
    parser.onerror = (error) => {
      parser.error = null;
      reject(error);
    };
    parser.onend = () => resolve(strings);
    parser.write(xml);
    parser.close();
  });
}

function parseSheetXml(xml, sharedStrings) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = sax.parser(true);
    let rowCells = null;
    let cellRef = null;
    let cellType = null;
    let cellText = "";
    let inValue = false;
    let inInlineText = false;

    const commitCell = () => {
      if (cellRef !== null && rowCells) {
        const index = excelColumnIndex(cellRef);
        if (index >= 0) {
          rowCells[index] = cellType === "s"
            ? sharedStrings[Number(cellText)] ?? ""
            : cellText;
        }
      }
      cellRef = null;
      cellType = null;
      cellText = "";
      inValue = false;
      inInlineText = false;
    };
    const commitRow = () => {
      if (rowCells && rowCells.some((value) => cleanCell(value))) rows.push(rowCells);
      rowCells = null;
    };

    parser.onopentag = (node) => {
      if (node.name === "row") rowCells = [];
      else if (node.name === "c" && rowCells) {
        cellRef = node.attributes.r;
        cellType = node.attributes.t || null;
        cellText = "";
      } else if (node.name === "v" && cellRef !== null) {
        inValue = true;
        cellText = "";
      } else if (node.name === "t" && cellRef !== null && cellType === "inlineStr") {
        inInlineText = true;
        cellText = "";
      }
    };
    parser.ontext = (value) => {
      if (inValue || inInlineText) cellText += value;
    };
    parser.onclosetag = (name) => {
      if (name === "v" && cellRef !== null) {
        inValue = false;
        commitCell();
      } else if (name === "t" && inInlineText) {
        inInlineText = false;
        commitCell();
      } else if (name === "c") {
        if (cellRef !== null) commitCell();
      } else if (name === "row" && rowCells) {
        commitRow();
      }
    };
    parser.onerror = (error) => {
      parser.error = null;
      reject(error);
    };
    parser.onend = () => resolve(rows);
    parser.write(xml);
    parser.close();
  });
}

async function parseWorkbookSheets(filePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const sharedFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedFile ? await parseSharedStringsXml(await sharedFile.async("string")) : [];
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const workbook = xml2js(workbookXml, { compact: true });
  const relationships = xml2js(relsXml, { compact: true });
  const relMap = new Map(
    asArray(relationships.Relationships.Relationship).map((relationship) => [
      relationship._attributes.Id,
      relationship._attributes.Target || "",
    ])
  );
  const result = [];
  for (const sheet of asArray(workbook.workbook.sheets.sheet)) {
    const name = sheet._attributes.name || `Sheet${result.length + 1}`;
    const relationId = sheet._attributes["r:id"] || sheet._attributes.rId;
    let target = relMap.get(relationId) || "";
    if (target.startsWith("/")) target = target.replace(/^\//, "");
    else if (target && !target.startsWith("xl/")) target = `xl/${target}`;
    const sheetFile = zip.file(target);
    if (!sheetFile) continue;
    result.push({
      name,
      rows: await parseSheetXml(await sheetFile.async("string"), sharedStrings),
    });
  }
  return result;
}

async function parseRankingFile(filePath, type) {
  const rows = await parseXlsxTable(await fs.readFile(filePath));
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) throw new Error(`${path.basename(filePath)} 未识别到 ASIN/标题表头`);
  const headers = rows[headerIndex].map((cell, index) => cleanCell(cell) || `列${index + 1}`);
  const col = {
    rank: columnIndex(headers, [/^#|排名/]),
    asin: columnIndex(headers, [/^asin$|asin码|商品编码/i]),
    parentAsin: columnIndex(headers, [/^父ASIN$/i]),
    title: columnIndex(headers, [/标题|title/i]),
    brand: columnIndex(headers, [/品牌|brand/i]),
    price: columnIndex(headers, [/^价格|^price|^售价/i]),
    prime: columnIndex(headers, [/^prime价格/i]),
    coupon: columnIndex(headers, [/^coupon$/i]),
    reviews: columnIndex(headers, [/^评分数$|^评论数$|^评论$|reviews?$/i]),
    newReviews: columnIndex(headers, [/^月新增评分数$|^月新增评论$|new ?reviews?/i]),
    rating: columnIndex(headers, [/^评分$|^rating$|^星级$/i]),
    sales: columnIndex(headers, [/^月销量$|^月销$|month.*sale/i]),
    salesGrowth: columnIndex(headers, [/^月销量增长率$|sales.*growth/i]),
    bsrBig: columnIndex(headers, [/^大类bsr$/i]),
    bsrSmall: columnIndex(headers, [/^小类bsr$/i]),
    days: columnIndex(headers, [/^上架天数$|days? ?on ?amazon/i]),
    listed: columnIndex(headers, [/^上架时间$|listing ?date|street ?date/i]),
    image: columnIndex(headers, [/^商品主图$|^主图$|image/i]),
    detailUrl: columnIndex(headers, [/商品详情页链接|详情页链接/i]),
  };
  if (col.asin == null && col.title == null) return [];

  const products = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const get = (key) => (col[key] == null ? "" : row[col[key]]);
    const title = cleanCell(get("title"));
    const asin = cleanCell(get("asin")).toUpperCase();
    if (!title && !asin) continue;
    if (/^asin$/i.test(asin) || /标题|title/i.test(title)) continue;
    const detailUrl = cleanCell(get("detailUrl"));
    const rank = parseNumber(get("rank")) || products.length + 1;
    if (rank > 100) continue;
    products.push({
      rank,
      asin,
      parentAsin: cleanCell(get("parentAsin")).toUpperCase(),
      detailAsin: asinFromUrl(detailUrl),
      title,
      brand: cleanCell(get("brand")),
      price: parseNumber(get("price")),
      prime: parseNumber(get("prime")),
      coupon: cleanCell(get("coupon")),
      reviews: parseNumber(get("reviews")),
      newReviews: parseNumber(get("newReviews")),
      rating: parseNumber(get("rating")),
      sales: parseNumber(get("sales")),
      monthSales: parseNumber(get("sales")),
      salesGrowth: parseNumber(get("salesGrowth")),
      bsrBig: parseNumber(get("bsrBig")),
      bsrSmall: parseNumber(get("bsrSmall")),
      days: parseNumber(get("days")),
      listed: cleanCell(get("listed")),
      image: imageUrl(get("image")),
      url: detailUrl || (asin ? `https://www.amazon.com/dp/${encodeURIComponent(asin)}` : ""),
      type,
    });
    if (products.length >= 100) break;
  }
  return products;
}

function numeric(values) {
  return values.filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
}

function average(values) {
  const list = numeric(values);
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

function median(values) {
  const list = numeric(values);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

function buildStats(products) {
  const prices = numeric(products.map((product) => product.price));
  const ratings = numeric(products.map((product) => product.rating));
  const reviews = numeric(products.map((product) => product.reviews));
  const sales = numeric(products.map((product) => product.sales));
  const brandCount = new Map();
  const brandSales = new Map();
  for (const product of products) {
    const brand = cleanCell(product.brand);
    if (!brand || /^(generic|unknown|none|n\/a|未知)$/i.test(brand)) continue;
    brandCount.set(brand, (brandCount.get(brand) || 0) + 1);
    if (product.sales != null) brandSales.set(brand, (brandSales.get(brand) || 0) + product.sales);
  }
  const topBrands = Array.from(new Set([...brandSales.keys(), ...brandCount.keys()]))
    .map((brand) => ({
      brand,
      count: brandCount.get(brand) || 0,
      sales: brandSales.get(brand) || 0,
    }))
    .sort((a, b) => b.sales - a.sales || b.count - a.count || a.brand.localeCompare(b.brand))
    .slice(0, 5);
  return {
    count: products.length,
    avgPrice: average(prices),
    medianPrice: median(prices),
    priceMin: prices[0] ?? null,
    priceMax: prices[prices.length - 1] ?? null,
    avgRating: average(ratings),
    avgReviews: average(reviews),
    totalSales: sales.reduce((sum, value) => sum + value, 0),
    avgSales: average(sales),
    zeroReviews: products.filter((product) => product.reviews === 0 || product.reviews == null).length,
    new60: products.filter((product) => product.days != null && product.days <= 60).length,
    topBrands,
  };
}

function productKey(product) {
  return {
    parent: cleanCell(product.parentAsin).toUpperCase(),
    detail: cleanCell(product.detailAsin).toUpperCase(),
    child: cleanCell(product.asin).toUpperCase(),
  };
}

function matchPreviousRank(product, previousProducts) {
  if (!previousProducts || !previousProducts.length) return null;
  const key = productKey(product);
  const match = previousProducts.find((candidate) => {
    const prev = productKey(candidate);
    return (key.parent && prev.parent === key.parent)
      || (key.detail && prev.detail === key.detail)
      || (key.child && prev.child === key.child);
  });
  return match ? match.rank : null;
}

async function listRankingSources() {
  const sources = new Map(CATEGORY_ORDER.map((category) => [category, { bsr: [], new: [] }]));
  for (const category of CATEGORY_ORDER) {
    const categoryDir = path.join(RAW_DIR, category);
    const entries = await fs.readdir(categoryDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !/\.xlsx$/i.test(entry.name)) continue;
      const type = /^bsr/i.test(entry.name) ? "bsr" : /^new/i.test(entry.name) ? "new" : "";
      const date = dateFromName(entry.name);
      if (!type || !date) continue;
      sources.get(category)[type].push({
        name: entry.name,
        path: path.join(categoryDir, entry.name),
        date,
      });
    }
    for (const type of ["bsr", "new"]) {
      sources.get(category)[type].sort((a, b) => b.date.localeCompare(a.date) || b.name.localeCompare(a.name));
    }
  }
  return sources;
}

function sourceForPeriod(sources, date) {
  const result = new Map();
  for (const category of CATEGORY_ORDER) {
    result.set(category, {});
    for (const type of ["bsr", "new"]) {
      const files = sources.get(category)[type];
      const selected = files.find((file) => file.date === date) || null;
      result.get(category)[type] = selected;
    }
  }
  return result;
}

function textOf(row) {
  return cleanCell(row && row[0]);
}

function firstTextContaining(rows, text) {
  return rows.findIndex((row) => row.some((cell) => cleanCell(cell).includes(text)));
}

function parseComparison(rows, label) {
  const start = rows.findIndex((row) => textOf(row) === label);
  if (start < 0) return { title: label, categories: [], rows: [] };
  const header = rows.slice(start + 1).find((row) => textOf(row) === "指标") || [];
  const categories = header.slice(1).map(cleanCell).filter(Boolean);
  const result = [];
  for (const row of rows.slice(start + 2)) {
    const metric = textOf(row);
    if (!metric || metric === "新品榜(NR)" || metric.startsWith("二、")) break;
    result.push({ metric, values: categories.map((_, index) => cleanCell(row[index + 1])) });
  }
  return { title: label, categories, rows: result };
}

function parseSummaryBrief(rows) {
  const trendIndex = firstTextContaining(rows, "跨类目共性趋势词");
  const detailStart = firstTextContaining(rows, "三、各子类目详情");
  const findingStart = firstTextContaining(rows, "四、本周关键发现");
  const actionStart = firstTextContaining(rows, "五、行动建议");

  const categoryDetails = [];
  if (detailStart >= 0 && findingStart > detailStart) {
    let current = null;
    for (const row of rows.slice(detailStart + 1, findingStart)) {
      const text = textOf(row);
      const heading = text.match(/^【(.+)】$/);
      if (heading) {
        current = { name: heading[1], metrics: [], conclusion: "" };
        categoryDetails.push(current);
        continue;
      }
      if (!current || !text) continue;
      if (text === "指标") {
        current.metricHeaders = row.slice(1).map(cleanCell).filter(Boolean);
      } else if (current.metricHeaders && row.length > 1) {
        current.metrics.push({
          metric: text,
          values: current.metricHeaders.map((_, index) => cleanCell(row[index + 1])),
        });
      } else {
        current.conclusion = current.conclusion ? `${current.conclusion} ${text}` : text;
      }
    }
  }

  const findings = [];
  if (findingStart >= 0 && actionStart > findingStart) {
    let current = null;
    for (const row of rows.slice(findingStart + 1, actionStart)) {
      const text = textOf(row);
      if (!text) continue;
      if (text.startsWith("▶")) {
        current = { name: text.replace(/^▶\s*/, ""), points: [] };
        findings.push(current);
      } else if (current) {
        current.points.push(text);
      }
    }
  }

  const actions = [];
  if (actionStart >= 0) {
    let current = null;
    for (const row of rows.slice(actionStart + 1)) {
      const text = textOf(row);
      if (!text) continue;
      if (text.startsWith("【建议")) {
        current = { title: text, paragraphs: [] };
        actions.push(current);
      } else if (current) {
        current.paragraphs.push(text);
      }
    }
  }

  return {
    title: textOf(rows[0]) || "Amazon泳装类目周度分析报告",
    period: cleanCell((rows[0] || [])[1]),
    exportedAt: cleanCell((rows[1] || [])[1]),
    comparison: {
      bsr: parseComparison(rows, "BSR热卖榜"),
      new: parseComparison(rows, "新品榜(NR)"),
    },
    trend: trendIndex >= 0 ? textOf(rows[trendIndex]) : "",
    categoryDetails,
    findings,
    actions,
  };
}

function addImagesToReportSheets(sheets, imageByAsin) {
  for (const sheet of sheets) {
    const headerIndex = sheet.rows.findIndex((row) => row.some((cell) => cleanCell(cell) === "主图")
      && row.some((cell) => /^ASIN$/i.test(cleanCell(cell))));
    if (headerIndex < 0) continue;
    const headers = sheet.rows[headerIndex].map(cleanCell);
    const imageIndex = headers.indexOf("主图");
    const asinIndex = headers.findIndex((header) => /^ASIN$/i.test(header));
    if (imageIndex < 0 || asinIndex < 0) continue;
    for (const row of sheet.rows.slice(headerIndex + 1)) {
      const asin = cleanCell(row[asinIndex]).toUpperCase();
      if (!asin) break;
      if (!cleanCell(row[imageIndex]) && imageByAsin.has(asin)) {
        row[imageIndex] = imageByAsin.get(asin);
      }
    }
  }
}

async function loadReports(imageByAsin) {
  const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isFile() && /分析汇总_\d{8}\.xlsx$/i.test(entry.name))
    .map((entry) => ({ name: entry.name, date: dateFromName(entry.name) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const reports = [];
  for (const source of candidates) {
    try {
      const sourcePath = path.join(OUTPUT_DIR, source.name);
      const [sheets, fileStat] = await Promise.all([
        parseWorkbookSheets(sourcePath),
        fs.stat(sourcePath),
      ]);
      if (!sheets.length) throw new Error("工作簿没有可读取的工作表");
      const kind = /^类目分析汇总/.test(source.name) ? "category" : "ranking";
      addImagesToReportSheets(sheets, imageByAsin);
      reports.push({
        key: `report_${source.date}_${kind}`,
        date: source.date,
        label: dateLabel(source.date),
        kind,
        brief: parseSummaryBrief(sheets[0].rows || []),
        sheets,
        sourceFile: source.name,
        name: source.name,
        size: fileStat.size,
        mtime: fileStat.mtimeMs,
      });
    } catch (error) {
      console.warn(`summary skipped: ${source.name}: ${error.message}`);
    }
  }
  for (const report of reports) {
    const sameDate = reports.filter((item) => item.date === report.date);
    report.label = `${report.label}${sameDate.length > 1 && report.kind === "category" ? " · 类目" : ""}`;
    if (sameDate.length > 1 && report.kind === "ranking") {
      report.label = `${report.label} · 榜单`;
    }
  }
  return reports;
}

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function build() {
  const sources = await listRankingSources();
  const dates = Array.from(new Set(
    CATEGORY_ORDER.flatMap((category) => ["bsr", "new"].flatMap((type) => sources.get(category)[type].map((file) => file.date)))
  )).sort((a, b) => b.localeCompare(a));
  if (!dates.length) throw new Error("榜单Data/Raw 没有可发布的 BSR/NEW 文件");
  const periods = [];

  for (const date of dates) {
    const selected = sourceForPeriod(sources, date);
    const categories = {};
    for (const category of CATEGORY_ORDER) {
      categories[category] = {};
      for (const type of ["bsr", "new"]) {
        const source = selected.get(category)[type];
        if (!source) continue;
        const products = await parseRankingFile(source.path, type);
        categories[category][type] = {
          file: source.name,
          actualDate: source.date,
          actualLabel: dateLabel(source.date),
          products,
          stats: buildStats(products),
        };
      }
    }
    periods.push({ date, label: dateLabel(date), categories });
  }

  for (let periodIndex = 0; periodIndex < periods.length; periodIndex++) {
    const previous = periods[periodIndex + 1];
    for (const category of CATEGORY_ORDER) {
      for (const type of ["bsr", "new"]) {
        const currentSection = periods[periodIndex].categories[category]?.[type];
        if (!currentSection) continue;
        const previousProducts = previous?.categories?.[category]?.[type]?.products || [];
        for (const product of currentSection.products) {
          const previousRank = matchPreviousRank(product, previousProducts);
          product.previousRank = previousRank;
          product.rankDelta = previousRank == null ? null : previousRank - product.rank;
          product.isNewEntry = previousProducts.length > 0 && previousRank == null;
        }
      }
    }
  }

  const latestDate = periods[0].date;
  const imageByAsin = new Map();
  for (const period of periods) {
    for (const category of Object.values(period.categories)) {
      for (const section of Object.values(category)) {
        for (const product of section.products) {
          if (product.asin && product.image) imageByAsin.set(product.asin.toUpperCase(), product.image);
        }
      }
    }
  }
  const reports = await loadReports(imageByAsin);
  const productCount = Object.values(periods[0].categories)
    .flatMap((category) => Object.values(category))
    .reduce((sum, section) => sum + section.products.length, 0);
  const manifest = {
    meta: {
      title: "HN Ranking Analysis",
      subtitle: "Amazon US Swimwear 周度榜单分析",
      latestDate,
      latestLabel: dateLabel(latestDate),
      previousDate: periods[1]?.date || "",
      generatedAt: `${latestDate.slice(0, 4)}-${latestDate.slice(4, 6)}-${latestDate.slice(6, 8)}T00:00:00.000Z`,
      categories: CATEGORY_ORDER,
      typeLabels: TYPE_LABELS,
      productCount,
      periodCount: dates.length,
      summaryReportCount: reports.length,
      availablePeriods: dates,
    },
    periods: periods.map((period) => ({ date: period.date, label: period.label })),
    reports: reports.map((report) => ({
      key: report.key,
      date: report.date,
      label: report.label,
      kind: report.kind,
      sourceFile: report.sourceFile,
      sheetCount: report.sheets.length,
      size: report.size,
      mtime: report.mtime,
    })),
  };
  const versionHash = createHash("sha256");
  versionHash.update(JSON.stringify(manifest));
  periods.forEach((period) => versionHash.update(JSON.stringify(period)));
  reports.forEach((report) => versionHash.update(JSON.stringify(report.sheets)));
  const version = versionHash.digest("hex").slice(0, 12);
  manifest.meta.version = version;

  await fs.rm(DOCS_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(DATA_DIR, "periods"), { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, "reports"), { recursive: true });
  await copyFile(path.join(SOURCE_DIR, "index.html"), path.join(DOCS_DIR, "index.html"));
  await copyFile(path.join(SOURCE_DIR, "styles.css"), path.join(DOCS_DIR, "styles.css"));
  await copyFile(path.join(SOURCE_DIR, "ui-common.js"), path.join(DOCS_DIR, "ui-common.js"));
  await copyFile(path.join(SOURCE_DIR, "app.js"), path.join(DOCS_DIR, "app.js"));
  await copyFile(path.join(SOURCE_DIR, "report-viewer.js"), path.join(DOCS_DIR, "report-viewer.js"));
  await copyFile(path.join(SOURCE_DIR, "compare-viewer.js"), path.join(DOCS_DIR, "compare-viewer.js"));
  await copyFile(
    path.join(WORKBENCH_DIR, "public", "vendor", "lucide.min.js"),
    path.join(DOCS_DIR, "vendor", "lucide.min.js")
  );
  await copyFile(
    path.join(WORKBENCH_DIR, "public", "vendor", "echarts.min.js"),
    path.join(DOCS_DIR, "vendor", "echarts.min.js")
  );
  await fs.writeFile(path.join(DATA_DIR, "index.json"), JSON.stringify(manifest), "utf8");
  for (const period of periods) {
    await fs.writeFile(
      path.join(DATA_DIR, "periods", `${period.date}.json`),
      JSON.stringify(period),
      "utf8"
    );
  }
  for (const report of reports) {
    await fs.writeFile(
      path.join(DATA_DIR, "reports", `${report.key}.json`),
      JSON.stringify({
        key: report.key,
        date: report.date,
        label: report.label,
        kind: report.kind,
        name: report.name,
        sourceFile: report.sourceFile,
        sheets: report.sheets,
      }),
      "utf8"
    );
  }
  await fs.writeFile(path.join(DOCS_DIR, ".nojekyll"), "", "utf8");

  console.log(`built ${DOCS_DIR}`);
  console.log(`periods: ${periods.map((period) => period.date).join(", ")}`);
  console.log(`summary reports: ${reports.length}`);
  console.log(`products: ${productCount}`);
  console.log(`version: ${version}`);
}

await build();
