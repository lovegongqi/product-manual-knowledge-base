import * as pdfjsLib from "./pdfjs/pdf.min.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/pdfjs/pdf.worker.min.js";

const params = new URLSearchParams(window.location.search);
const fileParam = params.get("file") || "";
const titleParam = params.get("title") || "说明书预览";
const downloadParam = params.get("download") || "";
const filenameParam = params.get("filename") || "";
const embedded = params.get("embedded") === "1";

const els = {
  title: document.getElementById("previewTitle"),
  status: document.getElementById("previewStatus"),
  pages: document.getElementById("pdfPages"),
  error: document.getElementById("previewError"),
  back: document.getElementById("backButton"),
  source: document.getElementById("sourceLink"),
  download: document.getElementById("downloadLink"),
  zoomOut: document.getElementById("zoomOut"),
  zoomIn: document.getElementById("zoomIn"),
  zoomValue: document.getElementById("zoomValue"),
};

let pdfDoc = null;
let zoom = 1;
const renderedPages = new Set();
const renderingPages = new Set();

function showError(message) {
  els.error.hidden = false;
  els.error.textContent = message;
  els.status.textContent = "加载失败";
}

function safePdfUrl(value) {
  if (!value || /^(?:https?:)?\/\//i.test(value)) return "";
  const url = new URL(value, window.location.href);
  if (url.origin !== window.location.origin) return "";
  if (!url.pathname.toLowerCase().endsWith(".pdf")) return "";
  return url.href;
}

function safeLink(value, fallback) {
  if (!value) return fallback;
  if (/^(?:https?:)?\/\//i.test(value)) return fallback;
  const url = new URL(value, window.location.href);
  return url.origin === window.location.origin ? url.href : fallback;
}

function updateZoomLabel() {
  els.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
}

function pageWidth(page) {
  const viewport = page.getViewport({ scale: 1 });
  const available = Math.max(260, els.pages.clientWidth - (embedded ? 20 : 36));
  const maxWidth = embedded ? available : Math.min(1040, available);
  return Math.max(0.35, (maxWidth / viewport.width) * zoom);
}

async function renderPage(pageNumber) {
  if (!pdfDoc || renderedPages.has(pageNumber) || renderingPages.has(pageNumber)) return;
  renderingPages.add(pageNumber);

  const pageEl = document.querySelector(`[data-page-number="${pageNumber}"]`);
  const wrap = pageEl?.querySelector(".canvas-wrap");
  if (!pageEl || !wrap) return;

  try {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageWidth(page) });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    wrap.innerHTML = "";
    wrap.appendChild(canvas);
    await page.render({ canvasContext: context, viewport }).promise;
    renderedPages.add(pageNumber);
  } catch (error) {
    wrap.innerHTML = `<div class="page-loading">第 ${pageNumber} 页加载失败</div>`;
  } finally {
    renderingPages.delete(pageNumber);
  }
}

function observePages() {
  const pages = Array.from(document.querySelectorAll(".pdf-page"));
  if (!("IntersectionObserver" in window)) {
    pages.slice(0, 4).forEach((page) => renderPage(Number(page.dataset.pageNumber)));
    window.addEventListener("scroll", renderVisiblePages, { passive: true });
    renderVisiblePages();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          renderPage(Number(entry.target.dataset.pageNumber));
        }
      });
    },
    { rootMargin: "900px 0px" },
  );
  pages.forEach((page) => observer.observe(page));
}

function renderVisiblePages() {
  document.querySelectorAll(".pdf-page").forEach((page) => {
    const rect = page.getBoundingClientRect();
    if (rect.top < window.innerHeight + 900 && rect.bottom > -900) {
      renderPage(Number(page.dataset.pageNumber));
    }
  });
}

function resetRenderedPages() {
  renderedPages.clear();
  renderingPages.clear();
  document.querySelectorAll(".canvas-wrap").forEach((wrap) => {
    wrap.innerHTML = `<div class="page-loading">正在渲染</div>`;
  });
  renderVisiblePages();
}

async function loadPdf() {
  const fileUrl = safePdfUrl(fileParam);
  if (!fileUrl) {
    showError("PDF 文件地址无效。");
    return;
  }

  document.title = titleParam;
  els.title.textContent = titleParam;
  els.source.href = fileUrl;
  els.download.href = safeLink(downloadParam, fileUrl);
  if (filenameParam) els.download.setAttribute("download", filenameParam);
  if (embedded) document.body.classList.add("embedded");
  updateZoomLabel();

  try {
    const loadingTask = pdfjsLib.getDocument({ url: fileUrl });
    let loadDone = false;
    loadingTask.onProgress = (progress) => {
      if (loadDone) return;
      if (!progress.total) return;
      const percent = Math.round((progress.loaded / progress.total) * 100);
      els.status.textContent = `正在加载 ${percent}%`;
    };
    pdfDoc = await loadingTask.promise;
    loadDone = true;
    els.status.textContent = `${pdfDoc.numPages} 页`;
    els.pages.innerHTML = Array.from({ length: pdfDoc.numPages }, (_, index) => {
      const pageNumber = index + 1;
      return `
        <section class="pdf-page" data-page-number="${pageNumber}">
          <div class="page-label">第 ${pageNumber} / ${pdfDoc.numPages} 页</div>
          <div class="canvas-wrap"><div class="page-loading">等待渲染</div></div>
        </section>
      `;
    }).join("");
    observePages();
    renderVisiblePages();
  } catch (error) {
    showError("PDF 预览加载失败，可以尝试点击“原文件”或“下载”。");
  }
}

els.back.addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.href = "index.html";
  }
});

els.zoomOut.addEventListener("click", () => {
  zoom = Math.max(0.6, Math.round((zoom - 0.1) * 10) / 10);
  updateZoomLabel();
  resetRenderedPages();
});

els.zoomIn.addEventListener("click", () => {
  zoom = Math.min(1.8, Math.round((zoom + 0.1) * 10) / 10);
  updateZoomLabel();
  resetRenderedPages();
});

els.zoomValue.addEventListener("click", () => {
  zoom = 1;
  updateZoomLabel();
  resetRenderedPages();
});

window.addEventListener("resize", () => {
  clearTimeout(window.__previewResizeTimer);
  window.__previewResizeTimer = setTimeout(resetRenderedPages, 180);
});

loadPdf();
