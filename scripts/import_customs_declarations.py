#!/usr/bin/env python3
"""Import downloaded Ecowater customs PDFs/images without replacing other reports."""

import argparse
import json
import shutil
import urllib.parse
from pathlib import Path

from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from build_water_approvals import make_thumb, pdf_pages, safe_filename, write_data_js


def import_customs(source_dir: Path, out_dir: Path) -> None:
    manifest = json.loads((source_dir / "manifest.json").read_text())
    data_path = out_dir / "assets/reports-data.js"
    text = data_path.read_text()
    reports = json.loads(text.removeprefix("window.WATER_APPROVALS = ").strip().removesuffix(";"))
    imported = []
    for item in manifest:
        filename = safe_filename(item["title"] + ".pdf")
        target = out_dir / "pdfs" / filename
        sources = [source_dir / name for name in item["files"]]
        if not sources or any(not source.is_file() for source in sources):
            raise ValueError(f"Missing source files: {item['id']}")
        if len(sources) == 1 and sources[0].suffix.lower() == ".pdf":
            shutil.copyfile(sources[0], target)
        else:
            document = canvas.Canvas(str(target))
            document.setTitle(item["title"])
            for source in sources:
                with Image.open(source) as image:
                    width, height = image.size
                    document.setPageSize((width * 0.48, height * 0.48))
                    document.drawImage(ImageReader(image), 0, 0, width * 0.48, height * 0.48)
                    document.showPage()
            document.save()
        thumb = out_dir / "assets/thumbs" / (target.stem + ".png")
        make_thumb(target, thumb)
        pages = pdf_pages(target)
        if not pages or not thumb.is_file():
            raise ValueError(f"Invalid PDF or missing thumbnail: {target}")
        imported.append({
            "id": item["id"], "title": item["title"], "model": item["title"].removesuffix("报关单"),
            "keyword": item["keyword"], "category": "报关单", "filename": filename,
            "fileUrl": "pdfs/" + urllib.parse.quote(filename),
            "downloadUrl": "pdfs/" + urllib.parse.quote(filename),
            "thumbUrl": "assets/thumbs/" + urllib.parse.quote(thumb.name),
            "pages": pages, "sizeBytes": target.stat().st_size,
            "sourceUrls": item["sourceUrls"], "sourceType": item["sourceType"],
            "contentNum": item["contentNum"], "latestShowTime": item["latestShowTime"],
            "updateTime": item["updateTime"],
        })
        print(f"{item['title']}: {pages} pages")
    ids = {item["id"] for item in imported}
    combined = [item for item in reports if item["id"] not in ids] + imported
    if len({item["filename"] for item in combined}) != len(combined):
        raise ValueError("Duplicate output filenames")
    write_data_js(combined, data_path)
    print(f"Imported {len(imported)} customs declarations; total {len(combined)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("water-approvals"))
    args = parser.parse_args()
    import_customs(args.source_dir, args.out_dir)
