# 产品说明书知识库

这是一个静态离线产品知识库，包含 151 份 PDF 说明书、83 份水批报告 PDF 和已生成好的网页数据。

## 目录

- `index.html`: 知识库主页，可跳转到产品说明书和水批报告。
- `knowledge-base/`: 产品说明书静态网页入口和前端资源。
- `knowledge-base/index.html`: 网页入口。
- `knowledge-base/assets/manuals-data.js`: 已抽取并 OCR 后的全文索引数据。
- `knowledge-base/assets/thumbs/`: PDF 首页缩略图。
- `water-approvals/`: 水批报告静态网页、PDF 文件和缩略图。
- `water-approvals/index.html`: 水批报告网页入口。
- `*.pdf`: 原始说明书文件。网页的“打开 PDF”和“下载 PDF”链接依赖这些文件位于仓库根目录。
- `outputs/model_components_accessories/`: 每个型号的产品组件和开箱配件清单。
- `scripts/`: 生成知识库和配件清单的脚本。

## 本地预览

```bash
cd product-manual-knowledge-base
python3 -m http.server 8000
```

然后打开：

```text
http://127.0.0.1:8000/
```

说明书入口：

```text
http://127.0.0.1:8000/knowledge-base/
```

水批报告入口：

```text
http://127.0.0.1:8000/water-approvals/
```

## 云服务器部署

把仓库完整拉到服务器后，用任意静态文件服务器把仓库根目录暴露出来即可。

如果只暴露 `knowledge-base/` 目录，需要额外确保上一级目录的 PDF 文件仍可通过 `../文件名.pdf` 被访问；如果只暴露 `water-approvals/` 目录，需要保留其中的 `pdfs/` 和 `assets/` 子目录。最简单的方式是直接以仓库根目录作为静态站点根目录。

示例：

```bash
git clone <repo-url>
cd product-manual-knowledge-base
python3 -m http.server 8080
```

访问：

```text
http://服务器IP:8080/
```
