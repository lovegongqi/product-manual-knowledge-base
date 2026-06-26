const manuals = Array.isArray(window.MANUALS) ? window.MANUALS : [];
const build = window.KB_BUILD || {};

const els = {
  buildSummary: document.getElementById("buildSummary"),
  resultTotal: document.getElementById("resultTotal"),
  searchInput: document.getElementById("searchInput"),
  categoryFilter: document.getElementById("categoryFilter"),
  seriesFilter: document.getElementById("seriesFilter"),
  textStatusFilter: document.getElementById("textStatusFilter"),
  clearFilters: document.getElementById("clearFilters"),
  manualList: document.getElementById("manualList"),
  manualDetail: document.getElementById("manualDetail"),
  detailPane: document.querySelector(".detail-pane"),
};

const statusLabel = {
  indexed: "正文可检索",
  needs_ocr: "正文待 OCR",
  extract_failed: "抽取失败",
};

const collator = new Intl.Collator("zh-Hans-CN", {
  numeric: true,
  sensitivity: "base",
});

const returnStateKey = "product-kb-return-state";
let pendingScrollRestore = null;

const state = {
  query: "",
  category: "",
  series: "",
  textStatus: "",
  selectedId: manuals[0]?.id ?? null,
  mobileDetailOpen: false,
};

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function optionHtml(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort(collator.compare);
}

function initFilters() {
  const categoryOrder = Array.isArray(build.categoryOrder) ? build.categoryOrder : [];
  const categories = uniqueSorted(manuals.map((manual) => manual.category));
  const orderedCategories = [
    ...categoryOrder.filter((category) => categories.includes(category)),
    ...categories.filter((category) => !categoryOrder.includes(category)),
  ];

  els.categoryFilter.innerHTML =
    optionHtml("", "全部") + orderedCategories.map((value) => optionHtml(value, value)).join("");
  els.seriesFilter.innerHTML =
    optionHtml("", "全部") +
    uniqueSorted(manuals.map((manual) => manual.series))
      .map((value) => optionHtml(value, value))
      .join("");
}

function scoreManual(manual, terms) {
  if (!terms.length) return 0;

  const titleCorpus = normalize([
    manual.title,
    manual.filename,
    manual.sourceTitle,
    (manual.models || []).join(" "),
  ].join(" "));
  const metaCorpus = normalize([manual.category, manual.series].join(" "));
  const textCorpus = normalize(manual.text);
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
    if (textCorpus && textCorpus.includes(needle)) {
      score += 8;
      hit = true;
    }
    if (!hit) return null;
  }

  return score;
}

function filteredManuals() {
  const terms = state.query.trim().split(/\s+/).filter(Boolean);

  return manuals
    .map((manual) => {
      if (state.category && manual.category !== state.category) return null;
      if (state.series && manual.series !== state.series) return null;
      if (state.textStatus && manual.textStatus !== state.textStatus) return null;

      const score = scoreManual(manual, terms);
      if (score === null) return null;
      return { manual, score };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return collator.compare(a.manual.title, b.manual.title);
    })
    .map((item) => item.manual);
}

function statusTag(manual) {
  const status = manual.textStatus || "needs_ocr";
  return `<span class="tag ${escapeHtml(status)}">${escapeHtml(statusLabel[status] || status)}</span>`;
}

function renderList(results) {
  els.resultTotal.textContent = `${results.length} 份`;

  if (!results.length) {
    els.manualList.innerHTML = `<div class="empty-list">没有匹配的说明书</div>`;
    els.manualDetail.innerHTML = `<div class="detail-empty">没有匹配的说明书</div>`;
    state.mobileDetailOpen = false;
    syncMobileDetailState();
    return;
  }

  if (!results.some((manual) => manual.id === state.selectedId)) {
    state.selectedId = results[0].id;
  }

  els.manualList.innerHTML = results
    .map((manual) => {
      const active = manual.id === state.selectedId ? " is-active" : "";
      const models = (manual.models || []).slice(0, 4).join(" / ") || "未识别型号";
      return `
        <button class="manual-card${active}" type="button" data-id="${escapeHtml(manual.id)}" data-file-url="${escapeHtml(manual.fileUrl)}">
          <img src="${escapeHtml(manual.thumbUrl)}" alt="" loading="lazy" onerror="this.src='assets/thumbs/placeholder.svg'" />
          <span>
            <span class="manual-title">${escapeHtml(manual.title)}</span>
            <span class="manual-meta">
              <span class="tag category">${escapeHtml(manual.category)}</span>
              <span class="tag">${escapeHtml(models)}</span>
              <span class="tag">${manual.pages || 0} 页</span>
              ${statusTag(manual)}
            </span>
          </span>
        </button>
      `;
    })
    .join("");

  els.manualList.querySelectorAll(".manual-card").forEach((button) => {
    button.addEventListener("click", () => {
      const selectedId = Number(button.dataset.id) || button.dataset.id;
      const manual = results.find((item) => String(item.id) === String(selectedId));
      state.selectedId = manual?.id ?? selectedId;
      if (isMobileLayout() && button.dataset.fileUrl) {
        saveReturnState();
        window.location.assign(button.dataset.fileUrl);
        return;
      }
      state.mobileDetailOpen = isMobileLayout();
      render();
    });
  });
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

function matchingSnippet(manual) {
  const text = manual.text || "";
  const terms = state.query.trim().split(/\s+/).filter(Boolean);
  if (!text || !terms.length) {
    return manual.textStatus === "indexed"
      ? "正文已纳入检索。"
      : "该文件目前按标题、型号和分类索引。";
  }

  const lower = text.toLowerCase();
  const found = terms
    .map((term) => ({ term, index: lower.indexOf(term.toLowerCase()) }))
    .find((item) => item.index >= 0);

  if (!found) {
    return "标题、型号或分类命中。";
  }

  const start = Math.max(0, found.index - 70);
  const end = Math.min(text.length, found.index + found.term.length + 110);
  let snippet = `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
  for (const term of terms) {
    if (!term) continue;
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    snippet = snippet.replace(new RegExp(safe, "gi"), (match) => `<mark>${escapeHtml(match)}</mark>`);
  }
  return snippet;
}

function renderDetail(results) {
  const manual = results.find((item) => item.id === state.selectedId) || results[0];
  if (!manual) return;

  const models = (manual.models || []).join(" / ") || "未识别型号";
  els.manualDetail.innerHTML = `
    <article class="detail-card">
      <div class="mobile-pdf-bar">
        <span class="mobile-pdf-title">${escapeHtml(manual.title)}</span>
        <button class="mobile-back" type="button" aria-label="返回说明书列表">返回列表</button>
      </div>
      <header class="detail-header">
        <img src="${escapeHtml(manual.thumbUrl)}" alt="" onerror="this.src='assets/thumbs/placeholder.svg'" />
        <div>
          <h2>${escapeHtml(manual.title)}</h2>
          <div class="detail-meta">
            <span class="tag category">${escapeHtml(manual.category)}</span>
            <span class="tag">${escapeHtml(manual.series)}</span>
            <span class="tag">${escapeHtml(models)}</span>
            <span class="tag">${manual.pages || 0} 页</span>
            <span class="tag">${formatSize(manual.sizeBytes)}</span>
            ${statusTag(manual)}
          </div>
          <div class="detail-actions">
            <a class="primary-action" href="${escapeHtml(manual.fileUrl)}" target="_blank" rel="noreferrer">打开 PDF</a>
            <a class="link-button" href="${escapeHtml(manual.fileUrl)}" download="${escapeHtml(manual.filename)}">下载 PDF</a>
          </div>
        </div>
      </header>
      <div class="detail-body">
        <div class="snippet">${matchingSnippet(manual)}</div>
        <iframe class="pdf-frame" title="${escapeHtml(manual.title)}" src="${escapeHtml(manual.fileUrl)}"></iframe>
      </div>
    </article>
  `;

  els.manualDetail.querySelector(".mobile-back")?.addEventListener("click", () => {
    state.mobileDetailOpen = false;
    render();
  });
}

function renderSummary() {
  const counts = build.statusCounts || {};
  const indexed = counts.indexed || 0;
  const needsOcr = counts.needs_ocr || 0;
  const failed = counts.extract_failed || 0;
  els.buildSummary.textContent = `${manuals.length} 份 PDF · ${indexed} 份正文可检索 · ${needsOcr} 份待 OCR · ${failed} 份抽取失败`;
}

function render() {
  const results = filteredManuals();
  renderSummary();
  renderList(results);
  renderDetail(results);
  syncMobileDetailState();
  restoreScrollPosition();
}

function saveReturnState() {
  try {
    sessionStorage.setItem(
      returnStateKey,
      JSON.stringify({
        query: state.query,
        category: state.category,
        series: state.series,
        textStatus: state.textStatus,
        selectedId: state.selectedId,
        listScrollTop: els.manualList.scrollTop,
        windowScrollY: window.scrollY,
      }),
    );
  } catch {
    // Returning from the PDF still works; this only improves position restore.
  }
}

function restoreReturnState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(returnStateKey) || "null");
    if (!saved || typeof saved !== "object") return;
    state.query = saved.query || "";
    state.category = saved.category || "";
    state.series = saved.series || "";
    state.textStatus = saved.textStatus || "";
    state.selectedId = saved.selectedId ?? state.selectedId;
    els.searchInput.value = state.query;
    els.categoryFilter.value = state.category;
    els.seriesFilter.value = state.series;
    els.textStatusFilter.value = state.textStatus;
    pendingScrollRestore = {
      listScrollTop: Number(saved.listScrollTop) || 0,
      windowScrollY: Number(saved.windowScrollY) || 0,
    };
  } catch {
    pendingScrollRestore = null;
  }
}

function restoreScrollPosition() {
  if (!pendingScrollRestore) return;
  const target = pendingScrollRestore;
  pendingScrollRestore = null;
  requestAnimationFrame(() => {
    els.manualList.scrollTop = target.listScrollTop;
    window.scrollTo(0, target.windowScrollY);
  });
}

function bindEvents() {
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    state.mobileDetailOpen = false;
    render();
  });
  els.categoryFilter.addEventListener("change", () => {
    state.category = els.categoryFilter.value;
    state.mobileDetailOpen = false;
    render();
  });
  els.seriesFilter.addEventListener("change", () => {
    state.series = els.seriesFilter.value;
    state.mobileDetailOpen = false;
    render();
  });
  els.textStatusFilter.addEventListener("change", () => {
    state.textStatus = els.textStatusFilter.value;
    state.mobileDetailOpen = false;
    render();
  });
  els.clearFilters.addEventListener("click", () => {
    state.query = "";
    state.category = "";
    state.series = "";
    state.textStatus = "";
    els.searchInput.value = "";
    els.categoryFilter.value = "";
    els.seriesFilter.value = "";
    els.textStatusFilter.value = "";
    state.mobileDetailOpen = false;
    render();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.mobileDetailOpen) {
      state.mobileDetailOpen = false;
      render();
    }
  });
  window.addEventListener("resize", syncMobileDetailState);
}

initFilters();
restoreReturnState();
bindEvents();
render();
