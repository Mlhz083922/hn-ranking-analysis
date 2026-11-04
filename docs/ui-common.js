(function () {
  "use strict";

  const esc = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const fmtNum = (value, digits) => value == null || !Number.isFinite(Number(value))
    ? "-"
    : Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: digits == null ? 0 : digits,
      maximumFractionDigits: digits == null ? 0 : digits,
    });

  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function toast(message, kind) {
    const root = document.querySelector("#toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = `toast${kind ? ` ${kind}` : ""}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  async function fetchJSON(url, options) {
    const separator = String(url).includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}v=${Date.now()}`, {
      cache: "no-cache",
      ...options,
    });
    if (!response.ok) throw new Error(`数据加载失败 ${response.status}`);
    return response.json();
  }

  window.RankingUI = { esc, fmtNum, initIcons, toast, fetchJSON };
})();
