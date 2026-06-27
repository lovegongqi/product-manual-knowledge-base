(function () {
  const reports = Array.isArray(window.WATER_APPROVALS) ? window.WATER_APPROVALS : [];
  const els = {
    buildSummary: document.getElementById("buildSummary"),
    resultTotal: document.getElementById("resultTotal"),
    searchInput: document.getElementById("searchInput"),
    clearSearch: document.getElementById("clearSearch"),
    reportList: document.getElementById("reportList"),
    emptyState: document.getElementById("emptyState"),
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function searchableText(report) {
    return normalize(
      [
        report.title,
        report.model,
        report.keyword,
        report.filename,
        report.contentNum,
        report.latestShowDate,
        report.updateDate,
      ].join(" ")
    );
  }

  function filterReports() {
    const query = normalize(els.searchInput.value);
    if (!query) return reports;
    return reports.filter((report) => searchableText(report).includes(query));
  }

  function reportCard(report) {
    const pages = report.pages ? `${report.pages} 页` : "页数未知";
    const size = formatBytes(report.sizeBytes);
    const date = report.latestShowDate || report.updateDate || "";
    const keyword = report.keyword || "水批报告";
    const thumb = report.thumbUrl
      ? `<img class="report-thumb" src="${report.thumbUrl}" alt="${escapeHtml(report.title)}" loading="lazy" />`
      : `<div class="report-thumb" aria-hidden="true"></div>`;
    return `
      <article class="report-card">
        <a class="report-main" href="${report.fileUrl}" target="_blank" rel="noopener">
          ${thumb}
          <div class="report-info">
            <h2 class="report-title">${escapeHtml(report.title)}</h2>
            <div class="report-tags">
              <span class="tag">${escapeHtml(report.model)}</span>
              <span class="tag is-blue">${pages}</span>
            </div>
            <div class="report-meta">${escapeHtml(size)}${date ? ` · ${escapeHtml(date)}` : ""}</div>
            <div class="report-keyword">${escapeHtml(keyword)}</div>
          </div>
        </a>
        <div class="report-actions">
          <a class="report-action" href="${report.fileUrl}" target="_blank" rel="noopener">打开 PDF</a>
          <a class="report-action" href="${report.downloadUrl}" download="${escapeHtml(report.filename)}">下载 PDF</a>
        </div>
      </article>
    `;
  }

  function render() {
    const filtered = filterReports();
    els.resultTotal.textContent = `${filtered.length} 份`;
    els.reportList.innerHTML = filtered.map(reportCard).join("");
    els.emptyState.hidden = filtered.length !== 0;
  }

  els.buildSummary.textContent = `${reports.length} 份水批 PDF，离线静态网页`;
  els.searchInput.addEventListener("input", render);
  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    els.searchInput.focus();
    render();
  });
  render();
})();
