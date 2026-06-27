import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.resolve(".");
const sourcePath = path.join(
  root,
  "outputs",
  "model_components_accessories",
  "model_components_accessories.json",
);
const outDir = path.join(root, "outputs", "model_type_review");
const xlsxPath = path.join(outDir, "型号机器类型备注表.xlsx");
const previewPath = path.join(outDir, "型号机器类型备注表预览.png");

const payload = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const rows = payload.rows;

const byModel = new Map();
for (const row of rows) {
  const model = safeCell(row["型号"] || "");
  if (!model) continue;
  if (!byModel.has(model)) {
    byModel.set(model, {
      model,
      categories: new Set(),
      series: new Set(),
      titles: [],
      pdfs: [],
    });
  }
  const item = byModel.get(model);
  if (row["产品类型"]) item.categories.add(safeCell(row["产品类型"]));
  if (row["系列"]) item.series.add(safeCell(row["系列"]));
  if (row["产品名称"] && !item.titles.includes(row["产品名称"])) {
    item.titles.push(safeCell(row["产品名称"]));
  }
  if (row["来源PDF"] && !item.pdfs.includes(row["来源PDF"])) {
    item.pdfs.push(safeCell(row["来源PDF"]));
  }
}

const uniqueRows = [...byModel.values()]
  .sort((a, b) => a.model.localeCompare(b.model, "zh-Hans-CN", { numeric: true }))
  .map((item) => ({
    型号: item.model,
    你备注的机器类型: "",
    当前系统分类: [...item.categories].join(" / "),
    系列: [...item.series].join(" / "),
    来源说明书数量: item.pdfs.length,
    代表说明书: item.titles[0] || "",
    所有来源说明书: item.titles.join("\n"),
    备注: "",
  }));

const detailRows = rows
  .map((row) => ({
    型号: safeCell(row["型号"] || ""),
    当前系统分类: safeCell(row["产品类型"] || ""),
    系列: safeCell(row["系列"] || ""),
    说明书标题: safeCell(row["产品名称"] || ""),
    来源PDF: safeCell(row["来源PDF"] || ""),
    PDF链接: safeCell(row["PDF链接"] || ""),
  }))
  .sort((a, b) => a.型号.localeCompare(b.型号, "zh-Hans-CN", { numeric: true }));

const categoryRows = [...countBy(uniqueRows, "当前系统分类").entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([category, count]) => [category || "未识别", count]);

const workbook = Workbook.create();
const review = workbook.worksheets.add("型号备注表");
const detail = workbook.worksheets.add("型号来源明细");
const summary = workbook.worksheets.add("当前分类统计");

writeSheet(review, uniqueRows, [
  "型号",
  "你备注的机器类型",
  "当前系统分类",
  "系列",
  "来源说明书数量",
  "代表说明书",
  "所有来源说明书",
  "备注",
]);
writeSheet(detail, detailRows, [
  "型号",
  "当前系统分类",
  "系列",
  "说明书标题",
  "来源PDF",
  "PDF链接",
]);

const summaryValues = [
  ["指标", "数值"],
  ["唯一型号数", uniqueRows.length],
  ["型号来源明细行数", detailRows.length],
  [],
  ["当前系统分类", "型号数"],
  ...categoryRows,
];
summary.getRange(`A1:B${summaryValues.length}`).values = summaryValues.map((row) =>
  row.map(safeCell),
);
summary.getRange(`A1:B${summaryValues.length}`).format = {
  font: { name: "Aptos", size: 11, color: "#18212F" },
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: "#E5E7EB" },
};
summary.getRange("A1:B1").format = headerFormat();
summary.getRange("A5:B5").format = headerFormat();
summary.getRange("A:A").format.columnWidthPx = 220;
summary.getRange("B:B").format.columnWidthPx = 110;

review.getRange("A:A").format.columnWidthPx = 120;
review.getRange("B:B").format.columnWidthPx = 170;
review.getRange("C:D").format.columnWidthPx = 140;
review.getRange("E:E").format.columnWidthPx = 90;
review.getRange("F:F").format.columnWidthPx = 240;
review.getRange("G:G").format.columnWidthPx = 330;
review.getRange("H:H").format.columnWidthPx = 180;

detail.getRange("A:A").format.columnWidthPx = 120;
detail.getRange("B:C").format.columnWidthPx = 140;
detail.getRange("D:D").format.columnWidthPx = 260;
detail.getRange("E:E").format.columnWidthPx = 260;
detail.getRange("F:F").format.columnWidthPx = 280;

await fs.mkdir(outDir, { recursive: true });

const inspect = await workbook.inspect({
  kind: "table",
  range: "型号备注表!A1:H12",
  include: "values",
  tableMaxRows: 12,
  tableMaxCols: 8,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const preview = await workbook.render({
  sheetName: "型号备注表",
  range: "A1:H18",
  scale: 1.5,
});
await fs.writeFile(previewPath, Buffer.from(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(xlsxPath);
console.log(JSON.stringify({ xlsxPath, previewPath, uniqueRows: uniqueRows.length, detailRows: detailRows.length }, null, 2));

function writeSheet(sheet, inputRows, headers) {
  const values = [
    headers.map(safeCell),
    ...inputRows.map((row) => headers.map((header) => safeCell(row[header] ?? ""))),
  ];
  const endCol = columnName(headers.length);
  sheet.getRange(`A1:${endCol}${values.length}`).values = values;
  sheet.getRange(`A1:${endCol}${values.length}`).format = {
    font: { name: "Aptos", size: 10, color: "#18212F" },
    verticalAlignment: "top",
    wrapText: true,
    borders: { preset: "inside", style: "thin", color: "#E5E7EB" },
  };
  sheet.getRange(`A1:${endCol}1`).format = headerFormat();
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(1);
  sheet.tables.add(`A1:${endCol}${values.length}`, true).name = tableName(sheet.name);
}

function countBy(inputRows, key) {
  const counts = new Map();
  for (const row of inputRows) {
    const value = row[key] || "未填写";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function headerFormat() {
  return {
    fill: "#0F766E",
    font: { name: "Aptos", size: 11, color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
}

function safeCell(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\uFFFE|\uFFFF/g, " ")
    .trim();
}

function columnName(index) {
  let value = "";
  let current = index;
  while (current > 0) {
    current -= 1;
    value = String.fromCharCode(65 + (current % 26)) + value;
    current = Math.floor(current / 26);
  }
  return value;
}

function tableName(sheetName) {
  if (sheetName === "型号备注表") return "ModelTypeReview";
  if (sheetName === "型号来源明细") return "ModelSourceDetail";
  return "SummaryTable";
}
