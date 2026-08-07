// Build-time: copy serveable files into ./public/ so wrangler
// only uploads those (and skips the1.29 GiB .git/objects/pack file).

import { cp, mkdir, readdir, rm } from "node:fs/promises";

const SRC = ".";
const OUT = "public";

const TOP_FILES = new Set([
  "index.html",
  "CNAME",
  "下载清单.csv",
  "下载清单.json",
]);

const SUB_DIRS = new Set(["knowledge-base", "water-approvals"]);

const SKIP_DIRS = new Set([
  ".git",
  ".github",
  "node_modules",
  "scripts",
  "outputs",
  "tmp",
  "public",
]);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const entries = await readdir(SRC, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isFile()) {
    if (TOP_FILES.has(entry.name) || entry.name.toLowerCase().endsWith(".pdf")) {
      await cp(`${SRC}/${entry.name}`, `${OUT}/${entry.name}`);
    }
  } else if (entry.isDirectory()) {
    if (SUB_DIRS.has(entry.name)) {
      await cp(`${SRC}/${entry.name}`, `${OUT}/${entry.name}`, { recursive: true });
    }
  }
}
