#!/usr/bin/env python3
"""Build the water approval report static page from the Ecowater admin API."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


API_BASE = "https://learn.ecowaterchina.net.cn/welearning/api"
REFERER = "https://learn.ecowaterchina.net.cn/admin/resources/content"
RESOURCE_HOST = "https://eco-strong.oss-cn-hangzhou.aliyuncs.com/"
COMPANY_CODE = "ecowater"
PDFINFO = Path("/Users/gongqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdfinfo")
PDFTOPPM = Path("/Users/gongqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm")


def request_json(url: str, *, data: dict[str, object] | None = None) -> dict:
    body = None
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": REFERER,
    }
    method = "GET"
    if data is not None:
        body = urllib.parse.urlencode(data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8"
        method = "POST"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def get_reports(certificate: str) -> list[dict]:
    params = {
        "keyword": "水批",
        "status": "show",
        "orderType": "latestShowTime",
        "orderAsc": "false",
        "showFields": "title,keyword,categoryNames,type,departmentFullName,studyNum,latestShowTime,addWatermark,addIntegral",
        "pageNo": 1,
        "pageSize": 200,
        "needTotalSize": "true",
        "companyCode": COMPANY_CODE,
        "certificate": certificate,
    }
    url = f"{API_BASE}/content/findByPage?{urllib.parse.urlencode(params)}"
    payload = request_json(url)
    if payload.get("errorCode") != 0:
        raise RuntimeError(payload.get("errorMassage") or "content/findByPage failed")
    data = payload.get("data") or {}
    records = data.get("records") or []
    total = data.get("totalSize")
    if total and len(records) != int(total):
        raise RuntimeError(f"Expected {total} reports, got {len(records)}")
    return [record for record in records if record.get("type") == "文档"]


def get_report_detail(certificate: str, content_id: int) -> dict:
    payload = request_json(
        f"{API_BASE}/content/findById",
        data={"id": content_id, "companyCode": COMPANY_CODE, "certificate": certificate},
    )
    if payload.get("errorCode") != 0:
        raise RuntimeError(payload.get("errorMassage") or f"content/findById failed: {content_id}")
    return payload.get("data") or {}


def safe_filename(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r'[\\/:*?"<>|]+', "_", value)
    value = value.rstrip(". ")
    return value or "water-approval"


def model_from_title(title: str) -> str:
    cleaned = re.sub(r"\s*水批报告\s*$", "", title, flags=re.I)
    cleaned = re.sub(r"\s*水批\s*$", "", cleaned, flags=re.I)
    return cleaned.strip() or title.strip()


def normalize_oss_url(doc_url: str) -> str:
    if doc_url.startswith("oss://eco-strong/"):
        return RESOURCE_HOST + doc_url.removeprefix("oss://eco-strong/")
    return doc_url


def download_pdf(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": REFERER,
        },
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        content_type = resp.headers.get("content-type", "")
        data = resp.read()
    if not data.startswith(b"%PDF"):
        raise RuntimeError(f"Downloaded file is not a PDF: {content_type}")
    tmp.write_bytes(data)
    tmp.replace(target)


def pdf_pages(path: Path) -> int | None:
    if not PDFINFO.exists():
        return None
    try:
        result = subprocess.run(
            [str(PDFINFO), str(path)],
            check=True,
            text=True,
            capture_output=True,
            timeout=30,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    match = re.search(r"^Pages:\s+(\d+)", result.stdout, flags=re.M)
    return int(match.group(1)) if match else None


def make_thumb(pdf_path: Path, thumb_path: Path) -> None:
    if not PDFTOPPM.exists():
        return
    thumb_path.parent.mkdir(parents=True, exist_ok=True)
    prefix = thumb_path.with_suffix("")
    generated = Path(f"{prefix}-1.png")
    try:
        subprocess.run(
            [str(PDFTOPPM), "-png", "-f", "1", "-singlefile", "-scale-to", "420", str(pdf_path), str(prefix)],
            check=True,
            text=True,
            capture_output=True,
            timeout=45,
        )
    except (subprocess.SubprocessError, OSError):
        return
    if generated.exists():
        generated.replace(thumb_path)
    elif prefix.with_suffix(".png").exists():
        prefix.with_suffix(".png").replace(thumb_path)


def js_string(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write_data_js(reports: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = "window.WATER_APPROVALS = " + js_string(reports) + ";\n"
    out_path.write_text(payload, encoding="utf-8")


def report_filename(record: dict, duplicate_names: set[str]) -> str:
    title = record.get("title") or f"水批报告 {record.get('id')}"
    model = model_from_title(title)
    stem = f"{model} 水批报告"
    if safe_filename(stem + ".pdf") in duplicate_names:
        stem += f"-{record.get('id')}"
    return safe_filename(stem + ".pdf")


def enrich_one(args: tuple[dict, str, Path, Path, str]) -> dict:
    record, certificate, pdf_dir, thumbs_dir, filename = args
    content_id = int(record["id"])
    detail = get_report_detail(certificate, content_id)
    content = detail.get("content") or {}
    file_info = detail.get("fileInfoBean") or {}
    title = content.get("title") or record.get("title") or f"水批报告 {content_id}"
    model = model_from_title(title)
    pdf_path = pdf_dir / filename
    download_url = file_info.get("filePathUrl") or normalize_oss_url(content.get("docUrl") or "")
    if not download_url:
        raise RuntimeError(f"No PDF URL for {title}")
    if not pdf_path.exists() or pdf_path.stat().st_size < 100:
        download_pdf(download_url, pdf_path)
    thumb_name = pdf_path.with_suffix(".png").name
    thumb_path = thumbs_dir / thumb_name
    if not thumb_path.exists():
        make_thumb(pdf_path, thumb_path)
    latest = content.get("latestShowTime") or record.get("latestShowTime")
    updated = content.get("updateTime") or record.get("updateTime")
    return {
        "id": str(content_id),
        "title": title,
        "model": model,
        "keyword": content.get("keyword") or record.get("keyword") or "",
        "category": "水批报告",
        "filename": filename,
        "fileUrl": "pdfs/" + urllib.parse.quote(filename),
        "downloadUrl": "pdfs/" + urllib.parse.quote(filename),
        "thumbUrl": "assets/thumbs/" + urllib.parse.quote(thumb_name) if thumb_path.exists() else "",
        "pages": pdf_pages(pdf_path),
        "sizeBytes": pdf_path.stat().st_size,
        "sourceFileName": file_info.get("fileName") or "",
        "contentNum": content.get("contentNum") or record.get("contentNum") or "",
        "latestShowTime": latest,
        "updateTime": updated,
        "latestShowDate": ts_to_date(latest),
        "updateDate": ts_to_date(updated),
    }


def ts_to_date(value: object) -> str:
    if not value:
        return ""
    try:
        seconds = int(value) / 1000
    except (TypeError, ValueError):
        return ""
    return dt.datetime.fromtimestamp(seconds).strftime("%Y-%m-%d")


def build(certificate: str, out_dir: Path, workers: int) -> list[dict]:
    pdf_dir = out_dir / "pdfs"
    thumbs_dir = out_dir / "assets" / "thumbs"
    reports = get_reports(certificate)
    names = [safe_filename(f"{model_from_title(record.get('title') or '')} 水批报告.pdf") for record in reports]
    duplicate_names = {name for name in names if names.count(name) > 1}
    tasks = [
        (record, certificate, pdf_dir, thumbs_dir, report_filename(record, duplicate_names))
        for record in reports
    ]
    enriched: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(enrich_one, task) for task in tasks]
        for i, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            item = future.result()
            enriched.append(item)
            print(f"[{i:02d}/{len(tasks)}] {item['title']} -> {item['filename']}")
    order = {str(record["id"]): i for i, record in enumerate(reports)}
    enriched.sort(key=lambda item: order.get(item["id"], 10_000))
    cleanup_generated_files(pdf_dir, thumbs_dir, enriched)
    write_data_js(enriched, out_dir / "assets" / "reports-data.js")
    return enriched


def cleanup_generated_files(pdf_dir: Path, thumbs_dir: Path, reports: list[dict]) -> None:
    keep_pdfs = {item["filename"] for item in reports}
    keep_thumbs = {Path(urllib.parse.unquote(item["thumbUrl"])).name for item in reports if item.get("thumbUrl")}
    for path in pdf_dir.glob("*.pdf"):
        if path.name not in keep_pdfs:
            path.unlink()
    for path in thumbs_dir.glob("*.png"):
        if path.name not in keep_thumbs:
            path.unlink()


def extract_certificate_from_assets() -> str:
    candidates: list[str] = []
    for path in Path("tmp/admin-js").glob("*.js"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        candidates += re.findall(r"certificate=([A-Fa-f0-9]{64,})", text)
    if not candidates:
        return ""
    return candidates[-1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--certificate", default=os.environ.get("ECOWATER_CERTIFICATE", ""))
    parser.add_argument("--out-dir", default="water-approvals")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    certificate = args.certificate or extract_certificate_from_assets()
    if not certificate:
        print("Missing certificate. Pass --certificate or ECOWATER_CERTIFICATE.", file=sys.stderr)
        return 2
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    reports = build(certificate, out_dir, max(1, args.workers))
    print(f"Built {len(reports)} water approval records in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
