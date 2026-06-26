import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.resolve(".");
const outDir = path.join(root, "outputs", "model_components_accessories");
const jsonPath = path.join(outDir, "model_components_accessories.json");
const xlsxPath = path.join(outDir, "产品组件与开箱配件清单.xlsx");
const previewPath = path.join(outDir, "组件配件清单预览.png");

const payload = JSON.parse(await fs.readFile(jsonPath, "utf8"));
const rows = payload.rows;
const summary = payload.summary;

const workbook = Workbook.create();

const main = workbook.worksheets.add("组件配件清单");
const stats = workbook.worksheets.add("抽取统计");

const headers = [
  "型号",
  "产品名称",
  "产品类型",
  "系列",
  "产品组件",
  "开箱配件/装箱清单",
  "组件抽取状态",
  "配件抽取状态",
  "来源PDF",
  "组件来源关键词",
  "配件来源关键词",
  "型号重复次数",
  "组件来源片段",
  "配件来源片段",
];

const values = [
  headers.map(safeCell),
  ...rows.map((row) => headers.map((header) => safeCell(row[header] ?? ""))),
];
main.getRange(`A1:N${values.length}`).values = values;

const used = main.getRange(`A1:N${values.length}`);
used.format = {
  font: { name: "Aptos", size: 10, color: "#18212F" },
  verticalAlignment: "top",
  wrapText: true,
  borders: { preset: "inside", style: "thin", color: "#E5E7EB" },
};
main.getRange("A1:N1").format = {
  fill: "#0F766E",
  font: { name: "Aptos", size: 10, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};

main.getRange("A:A").format.columnWidthPx = 118;
main.getRange("B:B").format.columnWidthPx = 210;
main.getRange("C:D").format.columnWidthPx = 112;
main.getRange("E:F").format.columnWidthPx = 310;
main.getRange("G:H").format.columnWidthPx = 94;
main.getRange("I:I").format.columnWidthPx = 235;
main.getRange("J:K").format.columnWidthPx = 96;
main.getRange("L:L").format.columnWidthPx = 82;
main.getRange("M:N").format.columnWidthPx = 300;
main.freezePanes.freezeRows(1);
main.freezePanes.freezeColumns(1);
main.tables.add(`A1:N${values.length}`, true).name = "ModelComponentsAccessories";

const statusLabels = {
  found: "找到明确清单/章节",
  not_found: "未找到明确清单",
  found_in_component_section: "在产品组件段中找到",
};
const componentStatus = countBy(rows, "组件抽取状态");
const accessoryStatus = countBy(rows, "配件抽取状态");
const categoryCounts = countBy(rows, "产品类型");

const statsRows = [
  ["指标", "数值"],
  ["说明书数量", summary.manual_count],
  ["表格行数", summary.row_count],
  ["唯一型号数", summary.unique_model_count],
  ["产品组件命中行数", summary.component_found_rows],
  ["配件/装箱清单命中行数", summary.accessory_found_rows],
  ["型号重复行数", summary.duplicate_model_rows],
  [],
  ["组件抽取状态", "行数"],
  ...Object.entries(componentStatus).map(([status, count]) => [
    statusLabels[status] || status,
    count,
  ]),
  [],
  ["配件抽取状态", "行数"],
  ...Object.entries(accessoryStatus).map(([status, count]) => [
    statusLabels[status] || status,
    count,
  ]),
  [],
  ["产品类型", "行数"],
  ...Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]),
];

stats.getRange(`A1:B${statsRows.length}`).values = statsRows.map((row) =>
  row.map(safeCell),
);
stats.getRange(`A1:B${statsRows.length}`).format = {
  font: { name: "Aptos", size: 11, color: "#18212F" },
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: "#E5E7EB" },
};
stats.getRange("A1:B1").format = headerFormat();
stats.getRange("A9:B9").format = headerFormat();
const accessoryHeaderRow = 10 + Object.keys(componentStatus).length + 1;
stats.getRange(`A${accessoryHeaderRow}:B${accessoryHeaderRow}`).format = headerFormat();
const categoryHeaderRow =
  accessoryHeaderRow + Object.keys(accessoryStatus).length + 2;
stats.getRange(`A${categoryHeaderRow}:B${categoryHeaderRow}`).format = headerFormat();
stats.getRange("A:A").format.columnWidthPx = 220;
stats.getRange("B:B").format.columnWidthPx = 110;
stats.freezePanes.freezeRows(1);

await fs.mkdir(outDir, { recursive: true });

const inspect = await workbook.inspect({
  kind: "table",
  range: "组件配件清单!A1:H12",
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
  sheetName: "组件配件清单",
  range: "A1:H16",
  scale: 1.5,
});
await fs.writeFile(previewPath, Buffer.from(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(xlsxPath);
console.log(JSON.stringify({ xlsxPath, previewPath, rows: rows.length }, null, 2));

function countBy(inputRows, key) {
  const counts = {};
  for (const row of inputRows) {
    const value = row[key] || "未填写";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function headerFormat() {
  return {
    fill: "#0F766E",
    font: { name: "Aptos", size: 11, color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
}

function safeCell(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\uFFFE|\uFFFF/g, " ")
    .trim();
}
