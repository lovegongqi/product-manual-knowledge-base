#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "knowledge-base" / "assets" / "manuals-data.js"
OUT_DIR = ROOT / "outputs" / "model_components_accessories"
JSON_OUT = OUT_DIR / "model_components_accessories.json"
CSV_OUT = OUT_DIR / "model_components_accessories.csv"


COMPONENT_KEYWORDS = [
    "产品组件",
    "产品部件",
    "各部件",
    "组件名称",
    "结构示意图",
]
ACCESSORY_KEYWORDS = [
    "装箱清单如下",
    "装箱清单",
    "包装清单",
    "本产品的所有组件都包含",
    "纸箱内还包括",
    "包装箱内",
    "彩盒内",
    "配件包",
    "组件包",
    "开箱",
]
STOP_KEYWORDS = [
    "三•产品功能",
    "三.产品功能",
    "三．产品功能",
    "产品功能",
    "产品特点",
    "技术参数",
    "结构示意图",
    "电气原理图",
    "水路图",
    "安装步骤",
    "产品安装",
    "安装说明",
    "安装旁通阀",
    "关闭供水系统",
    "安装进水",
    "安装水龙头",
    "部件连接",
    "安装提示",
    "确认整机",
    "质保范围",
    "使用说明",
    "注意事项",
    "故障",
    "环保清单",
    "有害物质",
    "质保条款",
    "保修卡",
    "维护",
]
NOISE_PATTERNS = [
    r"^目录$",
    r"^扫一扫.*$",
    r"^体验一站式.*$",
    r"^净享生活.*$",
    r"^FCOWATER$",
    r"^F9OWATER$",
    r"^SINCE 1925\\.?$",
]


def load_manuals() -> list[dict]:
    text = DATA_PATH.read_text(encoding="utf-8")
    match = re.search(r"window\.MANUALS\s*=\s*(\[.*\]);\s*$", text, re.S)
    if not match:
        raise ValueError(f"Could not find MANUALS data in {DATA_PATH}")
    return json.loads(match.group(1))


def clean_space(value: str) -> str:
    value = (value or "").replace("\u3000", " ")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n+", " ", value)
    return value.strip()


def normalize_item(value: str) -> str:
    value = clean_space(value)
    value = re.sub(r"^[（(]?[0-9一二三四五六七八九十]+[）).、\s]+", "", value)
    value = re.sub(r"^(一|二|三|四|五|六|七|八|九|十)[•．.、\s]+", "", value)
    value = re.sub(r"\s+", " ", value)
    value = value.strip(" ；;，,。:：-")
    return value


def compact_items(items: list[str], max_items: int = 30) -> str:
    cleaned: list[str] = []
    seen = set()
    for item in items:
        item = normalize_item(item)
        if len(item) < 2:
            continue
        if len(item) > 90:
            item = item[:90].rstrip(" ，,；;。") + "..."
        if any(re.match(pattern, item, re.I) for pattern in NOISE_PATTERNS):
            continue
        if item not in seen:
            cleaned.append(item)
            seen.add(item)
        if len(cleaned) >= max_items:
            break
    return "\n".join(cleaned)


def split_numbered_items(snippet: str) -> list[str]:
    text = clean_space(snippet)
    text = re.sub(r"[\(（]\s*([0-9]{1,2})\s*[\)）]", r" @@ITEM@@\1. ", text)
    text = re.sub(r"(?<![A-Za-z0-9])([0-9]{1,2})[\.、]\s+", r" @@ITEM@@\1. ", text)
    parts = [part for part in text.split("@@ITEM@@") if part.strip()]
    if len(parts) <= 1:
        return []
    return parts


def softener_box_items(snippet: str) -> list[str]:
    text = clean_space(snippet)
    if not re.search(r"纸箱内还包括|箱内包括|纸板箱中.*包括", text):
        return []
    items = []
    if re.search(r"小零件|零配件袋|配件袋", text):
        items.append("组装和安装所需小零件/零配件袋")
    if "本说明书" in text or "本手册" in text:
        items.append("本说明书/本手册")
    return items


def open_box_items(snippet: str) -> list[str]:
    text = clean_space(snippet)
    if not re.search(r"将包装打开|取出主机|检查.*附件", text):
        return []
    items = []
    if "主机" in text:
        items.append("主机")
    if "零件包" in text:
        items.append("零件包")
    if "附件" in text and not items:
        items.append("附件完整性检查")
    return items


def split_phrase_items(snippet: str) -> list[str]:
    text = clean_space(snippet)
    for stop in STOP_KEYWORDS:
        idx = text.find(stop)
        if idx > 20:
            text = text[:idx]
            break
    text = re.sub(r"^(产品组件|产品部件|各部件|零部件|结构示意图)\s*", "", text)
    text = re.sub(r"本产品的所有组件都包含.*?包括以下组件[:：]?", "", text)
    text = re.sub(r"装箱清单如下[:：]?", "", text)
    text = text.replace("；", " ").replace(";", " ").replace("，", " ")
    words = [normalize_item(word) for word in re.split(r"\s{1,}|/|、", text)]
    return [word for word in words if 2 <= len(word) <= 28]


def find_section(text: str, keywords: list[str], prefer_list: bool) -> tuple[str, str, str]:
    normalized = clean_space(text)
    candidates: list[tuple[int, int, str, str]] = []

    for keyword in keywords:
        start = 0
        while True:
            idx = normalized.find(keyword, start)
            if idx < 0:
                break
            chunk = normalized[idx : idx + 2200]
            score = 0
            if "（1" in chunk or "(1" in chunk or "1." in chunk:
                score += 20
            if "如下" in chunk:
                score += 10
            if re.search(r"箱内|包装箱|彩盒|清单|包含|包括|配件袋|零配件袋|零件包", chunk[:700]):
                score += 10
            if keyword == "开箱" and not re.search(
                r"纸箱内还包括|箱内包括|纸板箱中.*包括|零配件袋|配件袋|零件包",
                chunk[:700],
            ):
                score -= 25
            if "质保范围" in chunk[:300] or "人为损坏" in chunk[:300]:
                score -= 30
            if "目录" in normalized[max(0, idx - 20) : idx + 80]:
                score -= 15
            if keyword in ("装箱清单如下", "装箱清单", "包装清单"):
                score += 8
            if keyword == "开箱" and "纸箱内还包括" in chunk:
                score += 10
            if prefer_list and not ("（1" in chunk or "(1" in chunk or "如下" in chunk):
                score -= 4
            candidates.append((score, -idx, keyword, chunk))
            start = idx + len(keyword)

    if not candidates:
        return "", "", "not_found"

    candidates.sort(reverse=True)
    score, _, keyword, chunk = candidates[0]
    if prefer_list and score < 1:
        return "", "", "not_found"
    snippet = cut_at_stop(chunk, keyword)
    return snippet, keyword, "found"


def cut_at_stop(chunk: str, keyword: str) -> str:
    start = len(keyword)
    text = chunk[start:].strip(" :：-—")
    stop_positions = []
    for stop in STOP_KEYWORDS:
        pos = text.find(stop)
        if pos > 80:
            stop_positions.append(pos)
    if stop_positions:
        text = text[: min(stop_positions)]
    return text[:1600].strip()


def extract_list(snippet: str) -> str:
    if not snippet:
        return ""
    box_items = softener_box_items(snippet)
    if box_items:
        return compact_items(box_items)
    opened_items = open_box_items(snippet)
    if opened_items:
        return compact_items(opened_items)
    numbered = split_numbered_items(snippet)
    if numbered:
        return compact_items(numbered)
    return compact_items(split_phrase_items(snippet))


def short_context(snippet: str, max_len: int = 260) -> str:
    snippet = clean_space(snippet)
    return snippet[:max_len].rstrip()


def valid_model(token: str) -> bool:
    token = token.upper().strip(" -_")
    if not token:
        return False
    if token == "ESFX-M":
        return True
    if re.fullmatch(r"V\d{1,2}", token):
        return False
    if re.fullmatch(r"\d{5,}", token):
        return False
    if re.fullmatch(r"20\d{2}-\d{1,2}", token):
        return False
    if len(token) > 18 and "-" not in token and "_" not in token:
        return False
    return bool(re.search(r"\d", token))


def prepend_prefix(previous: str, token: str) -> str:
    prefix_match = re.match(r"([A-Z]+)", previous)
    if not prefix_match or len(prefix_match.group(1)) < 2:
        return token
    return prefix_match.group(1) + token


def models_from_filename(filename: str, fallback_models: list[str]) -> list[str]:
    stem = Path(filename).stem.upper()
    stem = re.sub(r"OWNER'?S?\s+MANUAL.*$", "", stem)
    stem = re.sub(r"用户手册|产品说明书|说明书|前置|型|系列|渠道|天猫|京东|工程款", " ", stem)
    stem = stem.replace("_", " ").replace("、", " ").replace("&", " ")

    patterns = [
        r"[A-Z]{1,8}-?[A-Z]?\d{1,4}[A-Z0-9]*(?:-[A-Z0-9]+)*",
        r"\d{2,4}[A-Z0-9]{1,8}(?:-[A-Z0-9]+)*",
        r"\d{2,4}-[A-Z0-9]+",
        r"\b\d{3,4}\b",
    ]
    raw: list[str] = []
    if "ESFX-M" in stem:
        raw.append("ESFX-M")
    raw.extend(re.findall(r"\d{3}(?:WHF|ECM)", stem))
    for pattern in patterns:
        raw.extend(re.findall(pattern, stem))
    if not raw and fallback_models:
        raw.extend(fallback_models)

    models: list[str] = []
    for token in raw:
        token = token.upper().strip(" -_")
        repeated = re.findall(r"\d{3}[A-Z]{2,5}", token)
        if len(repeated) >= 2 and "".join(repeated) == token:
            for item in repeated:
                if item not in models:
                    models.append(item)
            continue
        if not valid_model(token):
            continue
        if len(re.findall(r"WHF", token)) > 1 or len(re.findall(r"ECM", token)) > 1:
            continue
        if re.fullmatch(r"\d{2,4}", token) and any(
            existing.endswith(token) for existing in models
        ):
            continue
        if (
            re.fullmatch(r"\d{2,4}-[A-Z0-9]+", token)
            and any(existing.endswith(token) for existing in models)
        ):
            continue
        if re.fullmatch(r"\d{2,4}-[A-Z0-9]+", token) and models:
            token = prepend_prefix(models[-1], token)
        elif re.fullmatch(r"\d{2,4}[A-Z]+", token) and models:
            token = prepend_prefix(models[-1], token)
        if token not in models:
            models.append(token)

    filtered: list[str] = []
    for token in models:
        is_suffix_duplicate = False
        for other in models:
            if token == other:
                continue
            if len(other) > len(token) and (
                other.endswith("-" + token)
                or other.endswith(token)
                or token in other
            ):
                is_suffix_duplicate = True
                break
        if not is_suffix_duplicate and token not in filtered:
            filtered.append(token)
    models = filtered

    combined: list[str] = []
    skip_next = False
    for i, token in enumerate(models):
        if skip_next:
            skip_next = False
            continue
        nxt = models[i + 1] if i + 1 < len(models) else ""
        if nxt and re.fullmatch(r"(R|PF)\d{1,3}", nxt) and f"{token} {nxt}" in stem:
            combined.append(f"{token} {nxt}")
            skip_next = True
        else:
            combined.append(token)
    return combined or [Path(filename).stem]


def build_rows() -> tuple[list[dict], dict]:
    manuals = load_manuals()
    rows: list[dict] = []
    model_seen: Counter[str] = Counter()

    for manual in manuals:
        text = manual.get("text") or ""
        component_snippet, component_keyword, component_status = find_section(
            text, COMPONENT_KEYWORDS, prefer_list=False
        )
        accessory_snippet, accessory_keyword, accessory_status = find_section(
            text, ACCESSORY_KEYWORDS, prefer_list=True
        )

        components = extract_list(component_snippet)
        accessories = extract_list(accessory_snippet)
        if not accessories and component_keyword and "装箱清单" in component_snippet:
            accessories = components
            accessory_keyword = component_keyword
            accessory_status = "found_in_component_section"

        if not components:
            component_status = "not_found"
        if not accessories:
            accessory_status = "not_found"

        models = models_from_filename(manual["filename"], manual.get("models") or [])
        for model in models:
            model_seen[model] += 1
            rows.append(
                {
                    "型号": model,
                    "产品名称": manual.get("title", ""),
                    "产品类型": manual.get("category", ""),
                    "系列": manual.get("series", ""),
                    "产品组件": components or "未在可识别正文中找到明确产品组件清单",
                    "开箱配件/装箱清单": accessories
                    or "未在可识别正文中找到明确开箱配件或装箱清单",
                    "组件抽取状态": component_status,
                    "组件来源关键词": component_keyword,
                    "配件抽取状态": accessory_status,
                    "配件来源关键词": accessory_keyword,
                    "来源PDF": manual.get("filename", ""),
                    "PDF链接": unquote(manual.get("fileUrl", "")),
                    "组件来源片段": short_context(component_snippet),
                    "配件来源片段": short_context(accessory_snippet),
                }
            )

    for row in rows:
        row["型号重复次数"] = model_seen[row["型号"]]

    summary = {
        "manual_count": len(manuals),
        "row_count": len(rows),
        "unique_model_count": len(model_seen),
        "component_found_rows": sum(1 for row in rows if row["组件抽取状态"] != "not_found"),
        "accessory_found_rows": sum(1 for row in rows if row["配件抽取状态"] != "not_found"),
        "duplicate_model_rows": sum(1 for row in rows if row["型号重复次数"] > 1),
    }
    return rows, summary


def main() -> None:
    rows, summary = build_rows()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    payload = {"summary": summary, "rows": rows}
    JSON_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    fieldnames = [
        "型号",
        "产品名称",
        "产品类型",
        "系列",
        "产品组件",
        "开箱配件/装箱清单",
        "组件抽取状态",
        "组件来源关键词",
        "配件抽取状态",
        "配件来源关键词",
        "来源PDF",
        "PDF链接",
        "型号重复次数",
        "组件来源片段",
        "配件来源片段",
    ]
    with CSV_OUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(CSV_OUT)


if __name__ == "__main__":
    main()
