const manuals = Array.isArray(window.MANUALS) ? window.MANUALS : [];
const build = window.KB_BUILD || {};
const packingLists =
  window.PACKING_LISTS && typeof window.PACKING_LISTS === "object" ? window.PACKING_LISTS : {};
const packingBuild = window.PACKING_BUILD || {};

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
  packingModal: document.getElementById("packingModal"),
  packingTitle: document.getElementById("packingTitle"),
  packingSubtitle: document.getElementById("packingSubtitle"),
  packingBody: document.getElementById("packingBody"),
};

const statusLabel = {
  indexed: "正文可检索",
  needs_ocr: "正文待 OCR",
  extract_failed: "抽取失败",
};

const packingStatusLabel = {
  found: "已找到清单",
  text_only: "已找到文字",
  not_found: "未找到明确清单",
};

const tocLikeItems = new Set([
  "产品安装",
  "安装说明",
  "使用说明",
  "注意事项",
  "故障诊断",
  "环保清单",
  "有害物质",
  "产品保养",
  "维修记录",
  "保修卡",
  "质保条款",
]);

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

function downloadFileUrl(fileUrl) {
  const value = String(fileUrl || "");
  if (value.startsWith("../")) return `../download/${value.slice(3)}`;
  if (value.startsWith("/")) return `/download${value}`;
  return `download/${value}`;
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

function packingFor(manualOrId) {
  const id = typeof manualOrId === "object" ? manualOrId?.id : manualOrId;
  return packingLists[String(id)] || null;
}

function packingButtonHtml(manual, className) {
  if (!packingFor(manual)) return "";
  return `<button class="${className}" type="button" data-id="${escapeHtml(manual.id)}">装箱清单</button>`;
}

function tableItemsFromText(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/序号\s+名称\s+(.+?)\s+数量\s+(.+?)(?:\s+技术参数|\s+产品型号|\s+备注|$)/);
  if (!match) return [];

  const names = match[1].split(/\s+/).filter(Boolean);
  const quantities = match[2].split(/\s+/).filter(Boolean);
  if (!names.length || !quantities.length || quantities.length > names.length + 2) return [];

  return names.slice(0, quantities.length).map((name, index) => `${name}：${quantities[index]}`);
}

function packingItemList(items) {
  const tableItems = tableItemsFromText(items);
  if (tableItems.length) return tableItems;

  if (Array.isArray(items)) {
    return items.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(items || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLikelyTocList(items) {
  if (items.length < 3) return false;
  const tocHits = items.filter((item) => tocLikeItems.has(item)).length;
  return tocHits / items.length >= 0.6;
}

function renderPackingItems(title, items) {
  const cleaned = packingItemList(items);
  if (!cleaned.length) return "";
  if (title === "产品组件" && isLikelyTocList(cleaned)) return "";

  return `
    <section class="packing-section">
      <h3>${escapeHtml(title)}</h3>
      <table class="packing-table">
        <tbody>
          ${cleaned
            .map(
              (item, index) => `
                <tr>
                  <th scope="row">${index + 1}</th>
                  <td>${escapeHtml(item)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderPackingText(title, text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return `
    <section class="packing-section">
      <h3>${escapeHtml(title)}</h3>
      <pre class="packing-source">${escapeHtml(value)}</pre>
    </section>
  `;
}

function openPackingModal(id) {
  const item = packingFor(id);
  if (!item || !els.packingModal) return;

  const status = item.status || "not_found";
  const meta = [
    (item.models || []).join(" / "),
    (item.machineTypes || []).join(" / "),
    item.page ? `第 ${item.page} 页` : "",
    item.keyword || "",
  ].filter(Boolean);
  const imageHtml = (item.imageUrls || [])
    .map(
      (src) =>
        `<img class="packing-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.title)} 装箱清单截图" loading="lazy" />`,
    )
    .join("");
  const keyword = item.keyword || "";
  const accessorySource =
    item.accessories || (/装箱|包装|随箱|配件/.test(keyword) ? item.pageText : "");
  const rawTextTitle = item.pageText ? "清单页文字" : "清单原文";
  const rawText = item.pageText || item.sourceText;
  const textHtml = [
    renderPackingItems("产品组件", item.components),
    renderPackingItems("装箱/随箱配件", accessorySource),
    renderPackingText(rawTextTitle, rawText),
  ].join("");

  els.packingTitle.textContent = item.title || "装箱清单";
  els.packingSubtitle.textContent = meta.join(" · ");
  els.packingBody.innerHTML = `
    <div class="packing-status ${escapeHtml(status)}">
      ${escapeHtml(packingStatusLabel[status] || status)}
    </div>
    ${
      imageHtml
        ? `<div class="packing-images">${imageHtml}</div>`
        : `<div class="packing-note">这份说明书暂未生成清单截图，请以文字提取结果或原 PDF 为准。</div>`
    }
    ${textHtml || `<div class="packing-note">未在当前说明书中找到明确的装箱清单文字。</div>`}
  `;
  els.packingModal.hidden = false;
  document.body.classList.add("packing-open");
}

function closePackingModal() {
  if (!els.packingModal) return;
  els.packingModal.hidden = true;
  document.body.classList.remove("packing-open");
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
      const downloadUrl = downloadFileUrl(manual.fileUrl);
      const packingButton = packingButtonHtml(manual, "manual-card-action packing-list-action");
      return `
        <article class="manual-card${active}">
          <button class="manual-card-main" type="button" data-id="${escapeHtml(manual.id)}" data-file-url="${escapeHtml(manual.fileUrl)}">
            <img src="${escapeHtml(manual.thumbUrl)}" alt="" loading="lazy" onerror="this.src='assets/thumbs/placeholder.svg'" />
            <span class="manual-card-content">
              <span class="manual-title">${escapeHtml(manual.title)}</span>
              <span class="manual-meta">
                <span class="tag category">${escapeHtml(manual.category)}</span>
                <span class="tag">${escapeHtml(models)}</span>
                <span class="tag">${manual.pages || 0} 页</span>
                ${statusTag(manual)}
              </span>
            </span>
          </button>
          <span class="manual-card-actions">
            <a class="manual-card-action" href="${escapeHtml(manual.fileUrl)}" data-id="${escapeHtml(manual.id)}">打开PDF</a>
            <a class="manual-card-action" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(manual.filename)}" data-id="${escapeHtml(manual.id)}">下载PDF</a>
            ${packingButton}
          </span>
        </article>
      `;
    })
    .join("");

  els.manualList.querySelectorAll(".manual-card-main").forEach((button) => {
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

  els.manualList.querySelectorAll(".manual-card-action").forEach((link) => {
    link.addEventListener("click", (event) => {
      const selectedId = Number(link.dataset.id) || link.dataset.id;
      state.selectedId = selectedId;
      if (link.classList.contains("packing-list-action")) {
        event.preventDefault();
        openPackingModal(selectedId);
        return;
      }
      saveReturnState();
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
  const downloadUrl = downloadFileUrl(manual.fileUrl);
  const packingButton = packingButtonHtml(manual, "link-button packing-detail-action");
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
            <a class="link-button" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(manual.filename)}">下载 PDF</a>
            ${packingButton}
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
  els.manualDetail.querySelector(".packing-detail-action")?.addEventListener("click", () => {
    openPackingModal(manual.id);
  });
}

function renderSummary() {
  const counts = build.statusCounts || {};
  const indexed = counts.indexed || 0;
  const needsOcr = counts.needs_ocr || 0;
  const failed = counts.extract_failed || 0;
  const foundPacking = packingBuild.foundCount || 0;
  els.buildSummary.textContent = `${manuals.length} 份 PDF · ${indexed} 份正文可检索 · ${needsOcr} 份待 OCR · ${failed} 份抽取失败 · ${foundPacking} 份装箱清单`;
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
    if (event.key !== "Escape") return;
    if (els.packingModal && !els.packingModal.hidden) {
      closePackingModal();
      return;
    }
    if (state.mobileDetailOpen) {
      state.mobileDetailOpen = false;
      render();
    }
  });
  els.packingModal?.querySelectorAll("[data-packing-close]").forEach((button) => {
    button.addEventListener("click", closePackingModal);
  });
  window.addEventListener("resize", syncMobileDetailState);
}

initFilters();
restoreReturnState();
bindEvents();
render();
