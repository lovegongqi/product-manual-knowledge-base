(function () {
  const reports = Array.isArray(window.WATER_APPROVALS) ? window.WATER_APPROVALS : [];
  const els = {
    buildSummary: document.getElementById("buildSummary"),
    resultTotal: document.getElementById("resultTotal"),
    searchInput: document.getElementById("searchInput"),
    clearSearch: document.getElementById("clearSearch"),
    reportList: document.getElementById("reportList"),
    reportDetail: document.getElementById("reportDetail"),
    detailPane: document.querySelector(".detail-pane"),
  };

  const collator = new Intl.Collator("zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });

  const state = {
    query: "",
    selectedId: reports[0]?.id ?? null,
    mobileDetailOpen: false,
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "-";
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function previewFileUrl(report, embedded = false) {
    const fileUrl = `../water-approvals/${report.fileUrl || ""}`;
    const params = new URLSearchParams({
      file: fileUrl,
      title: report.title || "水批报告预览",
      download: `../water-approvals/${report.downloadUrl || report.fileUrl || ""}`,
      filename: report.filename || "",
    });
    if (embedded) params.set("embedded", "1");
    return `../knowledge-base/preview.html?${params.toString()}`;
  }

  function scoreReport(report, terms) {
    if (!terms.length) return 0;

    const titleCorpus = normalize([report.title, report.model, report.filename].join(" "));
    const metaCorpus = normalize([report.keyword, report.category, report.contentNum].join(" "));
    const dateCorpus = normalize([report.latestShowDate, report.updateDate].join(" "));
    let score = 0;

    for (const term of terms) {
      const needle = normalize(term);
      if (!needle) continue;

      let hit = false;
      if (titleCorpus.includes(needle)) {
        score += 60;
        hit = true;
      }
      if (metaCorpus.includes(needle)) {
        score += 24;
        hit = true;
      }
      if (dateCorpus.includes(needle)) {
        score += 6;
        hit = true;
      }
      if (!hit) return null;
    }

    return score;
  }

  function filteredReports() {
    const terms = state.query.trim().split(/\s+/).filter(Boolean);
    return reports
      .map((report) => {
        const score = scoreReport(report, terms);
        if (score === null) return null;
        return { report, score };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return collator.compare(a.report.title, b.report.title);
      })
      .map((item) => item.report);
  }

  function reportMetaTags(report) {
    const tags = [
      `<span class="tag category">${escapeHtml(report.category || "水批报告")}</span>`,
      `<span class="tag">${escapeHtml(report.model || "未识别型号")}</span>`,
      report.pages ? `<span class="tag">${report.pages} 页</span>` : "",
      report.sizeBytes ? `<span class="tag">${formatBytes(report.sizeBytes)}</span>` : "",
    ].filter(Boolean);
    return tags.join("");
  }

  function reportSnippet(report) {
    const parts = [
      report.keyword,
      report.contentNum ? `编号：${report.contentNum}` : "",
      report.latestShowDate ? `发布日期：${report.latestShowDate}` : "",
    ].filter(Boolean);
    return parts.join(" · ") || "水批报告已纳入本地静态网页。";
  }

  function isMobileLayout() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function syncMobileDetailState() {
    const mobileOpen = state.mobileDetailOpen && isMobileLayout();
    document.body.classList.toggle("mobile-detail-open", mobileOpen);
    if (isMobileLayout()) {
      els.detailPane?.setAttribute("aria-hidden", mobileOpen ? "false" : "true");
    } else {
      els.detailPane?.removeAttribute("aria-hidden");
    }
  }

  function renderList(results) {
    els.resultTotal.textContent = `${results.length} 份`;

    if (!results.length) {
      els.reportList.innerHTML = `<div class="empty-list">没有匹配的水批报告</div>`;
      els.reportDetail.innerHTML = `<div class="detail-empty">没有匹配的水批报告</div>`;
      state.mobileDetailOpen = false;
      syncMobileDetailState();
      return;
    }

    if (!results.some((report) => String(report.id) === String(state.selectedId))) {
      state.selectedId = results[0].id;
    }

    els.reportList.innerHTML = results
      .map((report) => {
        const active = String(report.id) === String(state.selectedId) ? " is-active" : "";
        const previewUrl = previewFileUrl(report);
        const thumb = report.thumbUrl || "assets/thumbs/placeholder.svg";
        return `
          <article class="manual-card${active}">
            <button class="manual-card-main" type="button" data-id="${escapeHtml(report.id)}" data-preview-url="${escapeHtml(previewUrl)}">
              <img src="${escapeHtml(thumb)}" alt="" loading="lazy" onerror="this.src='assets/thumbs/placeholder.svg'" />
              <span class="manual-card-content">
                <span class="manual-title">${escapeHtml(report.title)}</span>
                <span class="manual-meta">${reportMetaTags(report)}</span>
              </span>
            </button>
            <span class="manual-card-actions">
              <a class="manual-card-action" href="${escapeHtml(previewUrl)}" data-id="${escapeHtml(report.id)}">打开PDF</a>
              <a class="manual-card-action" href="${escapeHtml(report.downloadUrl || report.fileUrl)}" download="${escapeHtml(report.filename)}" data-id="${escapeHtml(report.id)}">下载PDF</a>
            </span>
          </article>
        `;
      })
      .join("");

    els.reportList.querySelectorAll(".manual-card-main").forEach((button) => {
      button.addEventListener("click", () => {
        const selectedId = button.dataset.id;
        state.selectedId = selectedId;
        if (isMobileLayout() && button.dataset.previewUrl) {
          window.location.assign(button.dataset.previewUrl);
          return;
        }
        state.mobileDetailOpen = isMobileLayout();
        render();
      });
    });

    els.reportList.querySelectorAll(".manual-card-action").forEach((link) => {
      link.addEventListener("click", () => {
        state.selectedId = link.dataset.id;
      });
    });
  }

  function renderDetail(results) {
    const report = results.find((item) => String(item.id) === String(state.selectedId)) || results[0];
    if (!report) return;

    const previewUrl = previewFileUrl(report);
    const embeddedPreviewUrl = previewFileUrl(report, true);
    const thumb = report.thumbUrl || "assets/thumbs/placeholder.svg";
    els.reportDetail.innerHTML = `
      <article class="detail-card">
        <div class="mobile-pdf-bar">
          <span class="mobile-pdf-title">${escapeHtml(report.title)}</span>
          <button class="mobile-back" type="button" aria-label="返回水批报告列表">返回列表</button>
        </div>
        <header class="detail-header">
          <img src="${escapeHtml(thumb)}" alt="" onerror="this.src='assets/thumbs/placeholder.svg'" />
          <div>
            <h2>${escapeHtml(report.title)}</h2>
            <div class="detail-meta">${reportMetaTags(report)}</div>
            <div class="detail-actions">
              <a class="primary-action" href="${escapeHtml(previewUrl)}">打开 PDF</a>
              <a class="link-button" href="${escapeHtml(report.downloadUrl || report.fileUrl)}" download="${escapeHtml(report.filename)}">下载 PDF</a>
            </div>
          </div>
        </header>
        <div class="detail-body">
          <div class="snippet">${escapeHtml(reportSnippet(report))}</div>
          <iframe class="pdf-frame" title="${escapeHtml(report.title)}" src="${escapeHtml(embeddedPreviewUrl)}"></iframe>
        </div>
      </article>
    `;

    els.reportDetail.querySelector(".mobile-back")?.addEventListener("click", () => {
      state.mobileDetailOpen = false;
      render();
    });
  }

  function renderSummary() {
    els.buildSummary.textContent = `${reports.length} 份水批 PDF，离线静态网页`;
  }

  function render() {
    const results = filteredReports();
    renderSummary();
    renderList(results);
    renderDetail(results);
    syncMobileDetailState();
  }

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    state.mobileDetailOpen = false;
    render();
  });

  els.clearSearch.addEventListener("click", () => {
    state.query = "";
    els.searchInput.value = "";
    els.searchInput.focus();
    state.mobileDetailOpen = false;
    render();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    state.mobileDetailOpen = false;
    render();
  });

  window.addEventListener("resize", syncMobileDetailState);

  render();
})();
