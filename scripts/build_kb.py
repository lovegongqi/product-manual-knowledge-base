#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "下载清单.json"
OUT_DIR = ROOT / "knowledge-base"
ASSETS_DIR = OUT_DIR / "assets"
THUMB_DIR = ASSETS_DIR / "thumbs"
DATA_PATH = ASSETS_DIR / "manuals-data.js"
VISION_OCR_SOURCE = ROOT / "scripts" / "vision_ocr.swift"
TMP_DIR = ROOT / "tmp" / "pdfs" / "kb_ocr"
MODEL_TYPE_OVERRIDE_PATH = ROOT / "scripts" / "model_type_overrides.json"

TEXT_CHAR_LIMIT = 80_000
LOW_TEXT_THRESHOLD = 500
CATEGORY_ORDER = [
    "反渗透净水机",
    "超滤机",
    "净热一体机",
    "管线机",
    "商用直饮机",
    "前置过滤器",
    "中央净水机",
    "软水机",
    "净化软水机",
    "壁挂软水机",
    "管线机/饮水机",
    "商用直饮",
    "复合/中央净水",
    "其他",
]
SERIES_MARKERS = [
    "纯E系列",
    "Slim S1",
    "云钻系列",
    "黑钻系列",
    "清滤宝",
    "清滤卫士",
    "怡可飘",
    "净雅",
    "安饮",
    "柔净",
    "超柔",
    "银钻系列",
    "享爱系列",
    "臻爱系列",
    "挚爱系列",
    "柔爱系列",
    "纯饮",
    "清饮",
    "智柔",
    "润柔",
    "轻柔",
    "工程款",
    "电商渠道",
    "天猫",
    "京东",
]
NON_MODEL_TOKENS = {
    "OWNER",
    "OWNERS",
    "MANUAL",
    "REV",
    "REVA",
    "REVB",
    "REVC",
    "PDF",
    "PLUS",
    "VER",
}


def bundled_tool(name: str) -> str:
    env_name = name.upper().replace("-", "_")
    if os.environ.get(env_name):
        return os.environ[env_name]

    local = shutil.which(name)
    if local:
        return local

    bundled = (
        Path.home()
        / ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin"
        / name
    )
    if bundled.exists():
        return str(bundled)

    raise FileNotFoundError(f"Missing required tool: {name}")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def clean_title(filename: str, source_title: str) -> str:
    title = source_title or ""
    title = re.sub(r"^【?产品说明书】?", "", title).strip()
    title = title.strip(" -_")
    return title or Path(filename).stem


def extract_models(*values: str) -> list[str]:
    text = " ".join(v or "" for v in values).upper()
    text = text.replace("_", " ").replace("、", " ").replace("&", " ")
    pattern = re.compile(
        r"(?<![A-Z0-9])("
        r"[A-Z]{1,8}\d[A-Z0-9]*(?:-[A-Z0-9]+)*"
        r"|\d{2,4}[A-Z]{1,5}(?:-[A-Z0-9]+)*"
        r"|\d{3,4}(?:-[A-Z0-9]+)?"
        r")(?![A-Z0-9])"
    )

    models: list[str] = []
    for raw in pattern.findall(text):
        token = raw.strip("-_")
        if not token or token in NON_MODEL_TOKENS:
            continue
        if token.isdigit() and len(token) > 4:
            continue
        if token not in models:
            models.append(token)
    return models[:10]


def detect_category(title: str, filename: str) -> str:
    hay = f"{title} {filename}"
    upper = hay.upper()

    if "商用" in hay or "EWSH" in upper:
        return "商用直饮"
    if (
        "管线" in hay
        or "饮水机" in hay
        or "净热" in hay
        or "净饮" in hay
        or "即热" in hay
        or "台式" in hay
        or "嵌入" in hay
        or upper.startswith(("EWD", "ECD", "EED", "ERH"))
    ):
        return "管线机/饮水机"
    if (
        "前置" in hay
        or "清滤" in hay
        or upper.startswith(("ESF", "EPSF", "ESFX"))
    ):
        return "前置过滤器"
    if "软水" in hay or "SOFTENER" in upper or "ECM" in upper:
        return "软水机"
    if (
        "反渗透" in hay
        or "直饮" in hay
        or "纯饮" in hay
        or "RO" in upper
        or upper.startswith(("ERO", "EROK"))
    ):
        return "反渗透净水机"
    if (
        "中央净" in hay
        or "净水机" in hay
        or "复合" in hay
        or "安饮" in hay
        or "净雅" in hay
        or "WHF" in upper
    ):
        return "复合/中央净水"
    return "其他"


def load_model_type_overrides() -> dict[str, str]:
    if not MODEL_TYPE_OVERRIDE_PATH.exists():
        return {}
    payload = json.loads(MODEL_TYPE_OVERRIDE_PATH.read_text(encoding="utf-8"))
    return {
        str(model).strip().upper(): str(machine_type or "").strip()
        for model, machine_type in payload.items()
    }


def compact_model(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", value.upper())


def lookup_model_type(
    model: str,
    title: str,
    filename: str,
    model_types: dict[str, str],
) -> str:
    key = model.upper()
    if key in model_types:
        return model_types[key]

    hay = f"{title} {filename}".upper()
    compact_hay = compact_model(hay)
    compact_key = compact_model(key)

    title_matches = []
    for model_key, machine_type in model_types.items():
        compact_candidate = compact_model(model_key)
        if not compact_candidate or len(compact_candidate) < 4 or not machine_type:
            continue
        if compact_candidate in compact_hay:
            title_matches.append((len(compact_candidate), machine_type))
    if title_matches:
        title_matches.sort(reverse=True)
        return title_matches[0][1]

    compact_matches = []
    for model_key, machine_type in model_types.items():
        compact_candidate = compact_model(model_key)
        if not compact_candidate or not machine_type:
            continue
        if compact_candidate == compact_key:
            return machine_type
        if (
            compact_key
            and compact_candidate.startswith(compact_key)
            and compact_candidate in compact_hay
        ):
            compact_matches.append((len(compact_candidate), machine_type))
    if compact_matches:
        compact_matches.sort(reverse=True)
        return compact_matches[0][1]

    return ""


def category_from_model_types(
    models: list[str],
    title: str,
    filename: str,
    model_types: dict[str, str],
) -> str:
    if not model_types:
        return ""

    ordered_types = []
    hay = f"{title} {filename}".upper()
    compact_hay = compact_model(hay)
    title_matches = []
    for model_key, machine_type in model_types.items():
        compact_candidate = compact_model(model_key)
        if not compact_candidate or len(compact_candidate) < 4 or not machine_type:
            continue
        if compact_candidate in compact_hay:
            title_matches.append((compact_hay.index(compact_candidate), machine_type))
    for _, machine_type in sorted(title_matches):
        if machine_type not in ordered_types:
            ordered_types.append(machine_type)

    for model in models:
        machine_type = lookup_model_type(model, title, filename, model_types)
        if machine_type and machine_type not in ordered_types:
            ordered_types.append(machine_type)
    return " / ".join(ordered_types)


def detect_series(title: str, filename: str, category: str) -> str:
    hay = f"{title} {filename}"
    for marker in SERIES_MARKERS:
        if marker in hay:
            return marker
    return category


def load_manifest() -> dict[str, dict]:
    items = json.loads(MANIFEST_PATH.read_text(encoding="utf-8-sig"))
    return {
        item.get("savedName", ""): item
        for item in items
        if item.get("status") == "ok" and item.get("savedName")
    }


def load_existing_data() -> dict[str, dict]:
    if not DATA_PATH.exists():
        return {}

    text = DATA_PATH.read_text(encoding="utf-8")
    match = re.search(r"window\.MANUALS\s*=\s*(\[.*\]);\s*$", text, re.DOTALL)
    if not match:
        return {}

    try:
        manuals = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}
    return {item.get("filename", ""): item for item in manuals if item.get("filename")}


def page_count(pdf_path: Path, pdfinfo: str) -> int:
    try:
        result = subprocess.run(
            [pdfinfo, str(pdf_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        match = re.search(r"^Pages:\s+(\d+)", result.stdout, re.MULTILINE)
        if match:
            return int(match.group(1))
    except Exception:
        pass

    try:
        return len(PdfReader(str(pdf_path)).pages)
    except Exception:
        return 0


def write_placeholder() -> str:
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    placeholder = THUMB_DIR / "placeholder.svg"
    placeholder.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320">
<rect width="240" height="320" rx="10" fill="#eef2f7"/>
<path d="M58 42h92l32 32v204H58z" fill="#ffffff" stroke="#cbd5e1" stroke-width="4"/>
<path d="M150 42v34h32" fill="none" stroke="#cbd5e1" stroke-width="4"/>
<text x="120" y="182" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#64748b">PDF</text>
</svg>
""",
        encoding="utf-8",
    )
    return "assets/thumbs/placeholder.svg"


def render_thumbnail(
    pdf_path: Path,
    manual_id: str,
    pdftoppm: str,
    placeholder_url: str,
    force: bool,
) -> str:
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "-", manual_id)
    prefix = THUMB_DIR / f"manual-{safe_id}"
    png_path = prefix.with_suffix(".png")
    rel_path = f"assets/thumbs/{png_path.name}"

    if png_path.exists() and not force:
        return rel_path

    try:
        subprocess.run(
            [
                pdftoppm,
                "-f",
                "1",
                "-l",
                "1",
                "-singlefile",
                "-png",
                "-scale-to",
                "360",
                str(pdf_path),
                str(prefix),
            ],
            check=True,
            capture_output=True,
            timeout=25,
        )
        if png_path.exists():
            return rel_path
    except Exception:
        pass

    return placeholder_url


def extract_text_with_timeout(pdf_path: Path, timeout: int, max_chars: int) -> tuple[str, str]:
    try:
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).resolve()),
                "--extract-one",
                str(pdf_path),
                "--max-chars",
                str(max_chars),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return "", "needs_ocr"

    if result.returncode != 0:
        return "", "extract_failed"

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return "", "extract_failed"

    text = normalize_text(payload.get("text", ""))
    if len(text) < LOW_TEXT_THRESHOLD:
        return "", "needs_ocr"
    return text[:max_chars], "indexed"


def compile_ocr_tool() -> Path | None:
    swiftc = shutil.which("swiftc")
    if not swiftc or not VISION_OCR_SOURCE.exists():
        return None

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    tool_path = TMP_DIR / "vision_ocr"
    if (
        tool_path.exists()
        and tool_path.stat().st_mtime >= VISION_OCR_SOURCE.stat().st_mtime
    ):
        return tool_path

    try:
        subprocess.run(
            [swiftc, str(VISION_OCR_SOURCE), "-o", str(tool_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
        )
    except Exception as exc:
        print(f"OCR tool compile failed: {exc}", file=sys.stderr)
        return None
    return tool_path


def ocr_pdf(
    pdf_path: Path,
    pages: int,
    pdftoppm: str,
    ocr_tool: Path,
    dpi: int,
    timeout: int,
    max_chars: int,
    max_pages: int | None,
) -> tuple[str, str]:
    page_limit = min(pages or 0, max_pages or pages or 0)
    if page_limit <= 0:
        return "", "needs_ocr"

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pages_", dir=TMP_DIR) as temp_dir:
        temp_path = Path(temp_dir)
        prefix = temp_path / "page"
        try:
            render_timeout = max(30, timeout * max(1, page_limit))
            subprocess.run(
                [
                    pdftoppm,
                    "-f",
                    "1",
                    "-l",
                    str(page_limit),
                    "-png",
                    "-r",
                    str(dpi),
                    str(pdf_path),
                    str(prefix),
                ],
                check=True,
                capture_output=True,
                timeout=render_timeout,
            )
        except Exception as exc:
            print(f"OCR render failed for {pdf_path.name}: {exc}", file=sys.stderr)
            return "", "needs_ocr"

        images = sorted(temp_path.glob("page-*.png"))
        if not images:
            single = prefix.with_suffix(".png")
            if single.exists():
                images = [single]
        if not images:
            return "", "needs_ocr"

        try:
            result = subprocess.run(
                [str(ocr_tool), *map(str, images)],
                check=False,
                capture_output=True,
                text=True,
                timeout=max(30, timeout * max(1, len(images))),
            )
        except subprocess.TimeoutExpired:
            return "", "needs_ocr"

        if result.returncode != 0:
            print(
                f"OCR failed for {pdf_path.name}: {result.stderr.strip()}",
                file=sys.stderr,
            )
            return "", "needs_ocr"

        try:
            page_results = json.loads(result.stdout)
        except json.JSONDecodeError:
            return "", "needs_ocr"

        chunks: list[str] = []
        for item in page_results:
            text = normalize_text(item.get("text", ""))
            if text:
                chunks.append(text)
            if sum(len(chunk) for chunk in chunks) >= max_chars:
                break
        text = normalize_text(" ".join(chunks))[:max_chars]
        if len(text) < LOW_TEXT_THRESHOLD:
            return "", "needs_ocr"
        return text, "indexed"


def extract_one(pdf_path: Path, max_chars: int) -> None:
    reader = PdfReader(str(pdf_path))
    chunks: list[str] = []
    total = 0
    for page in reader.pages:
        text = normalize_text(page.extract_text() or "")
        if not text:
            continue
        chunks.append(text)
        total += len(text)
        if total >= max_chars:
            break
    text = normalize_text(" ".join(chunks))[:max_chars]
    print(json.dumps({"text": text}, ensure_ascii=False))


def build(args: argparse.Namespace) -> None:
    pdfinfo = bundled_tool("pdfinfo")
    pdftoppm = bundled_tool("pdftoppm")
    manifest = load_manifest()
    existing_data = load_existing_data()
    model_type_overrides = load_model_type_overrides()
    ocr_tool = compile_ocr_tool() if args.ocr_needs else None
    pdfs = sorted(ROOT.glob("*.pdf"), key=lambda path: path.name.lower())

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    placeholder_url = write_placeholder()

    manuals: list[dict] = []
    status_counts = {"indexed": 0, "needs_ocr": 0, "extract_failed": 0}

    for index, pdf_path in enumerate(pdfs, start=1):
        item = manifest.get(pdf_path.name, {})
        manual_id = str(item.get("id") or index)
        source_title = item.get("title", "")
        title = clean_title(pdf_path.name, source_title)
        models = extract_models(title, pdf_path.name, item.get("originalFileName", ""))
        detected_category = detect_category(title, pdf_path.name)
        category = (
            category_from_model_types(models, title, pdf_path.name, model_type_overrides)
            or detected_category
        )
        series = detect_series(title, pdf_path.name, category)
        pages = page_count(pdf_path, pdfinfo)
        thumb_url = render_thumbnail(
            pdf_path,
            manual_id,
            pdftoppm,
            placeholder_url,
            args.force_thumbs,
        )
        existing = existing_data.get(pdf_path.name, {})
        existing_text = normalize_text(existing.get("text", ""))
        if (
            not args.refresh_text
            and existing.get("textStatus") == "indexed"
            and len(existing_text) >= LOW_TEXT_THRESHOLD
        ):
            text, text_status = existing_text[: args.max_chars], "indexed"
        elif (
            args.ocr_needs
            and not args.refresh_text
            and existing.get("textStatus") == "needs_ocr"
            and ocr_tool
        ):
            text, text_status = ocr_pdf(
                pdf_path,
                pages,
                pdftoppm,
                ocr_tool,
                args.ocr_dpi,
                args.ocr_timeout,
                args.max_chars,
                args.ocr_max_pages,
            )
        else:
            text, text_status = extract_text_with_timeout(
                pdf_path,
                args.extract_timeout,
                args.max_chars,
            )
            if args.ocr_needs and text_status == "needs_ocr" and ocr_tool:
                text, text_status = ocr_pdf(
                    pdf_path,
                    pages,
                    pdftoppm,
                    ocr_tool,
                    args.ocr_dpi,
                    args.ocr_timeout,
                    args.max_chars,
                    args.ocr_max_pages,
                )
        status_counts[text_status] = status_counts.get(text_status, 0) + 1

        manuals.append(
            {
                "id": item.get("id") or index,
                "title": title,
                "models": models,
                "category": category,
                "series": series,
                "filename": pdf_path.name,
                "fileUrl": "../" + quote(pdf_path.name),
                "thumbUrl": thumb_url,
                "pages": pages,
                "sizeBytes": pdf_path.stat().st_size,
                "sourceTitle": source_title,
                "text": text,
                "textStatus": text_status,
            }
        )
        print(
            f"[{index:03}/{len(pdfs)}] {text_status:13} "
            f"{pages:2} pages {pdf_path.name}",
            flush=True,
        )

    build_info = {
        "manualCount": len(manuals),
        "pdfCount": len(pdfs),
        "manifestOkCount": len(manifest),
        "categoryOrder": CATEGORY_ORDER,
        "statusCounts": status_counts,
    }
    DATA_PATH.write_text(
        "window.KB_BUILD = "
        + json.dumps(build_info, ensure_ascii=False, separators=(",", ":"))
        + ";\nwindow.MANUALS = "
        + json.dumps(manuals, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    missing = sorted(set(manifest) - {pdf.name for pdf in pdfs})
    if missing:
        print("Missing PDFs from manifest:", ", ".join(missing), file=sys.stderr)
    print(json.dumps(build_info, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the product manual knowledge base.")
    parser.add_argument("--extract-one", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--max-chars", type=int, default=TEXT_CHAR_LIMIT)
    parser.add_argument("--extract-timeout", type=int, default=12)
    parser.add_argument("--force-thumbs", action="store_true")
    parser.add_argument("--refresh-text", action="store_true")
    parser.add_argument("--ocr-needs", action="store_true")
    parser.add_argument("--ocr-dpi", type=int, default=180)
    parser.add_argument("--ocr-timeout", type=int, default=8)
    parser.add_argument("--ocr-max-pages", type=int)
    args = parser.parse_args()

    if args.extract_one:
        extract_one(args.extract_one, args.max_chars)
        return

    build(args)


if __name__ == "__main__":
    main()
