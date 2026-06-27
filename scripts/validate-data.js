import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, readJson, repoRoot } from "./utils.js";

const requiredFiles = [
  "compact/index.html",
  "compact/compact.css",
  "compact/compact.js",
  "list/index.html",
  "list/list.css",
  "list/list.js",
  "data/sources.config.json",
  "data/official-articles.json",
  "data/operation-status.json",
  "data/store-status.json",
  "data/fetch-log.json"
];

for (const file of requiredFiles) {
  await fs.access(path.join(repoRoot, file));
}

const config = await readJson("sources.config.json");
const articles = await readJson("official-articles.json");
const operations = await readJson("operation-status.json");
const stores = await readJson("store-status.json");
const logs = await readJson("fetch-log.json");

assert(Array.isArray(config.officialSources), "officialSources must be an array");
assert(Array.isArray(config.storeSources), "storeSources must be an array");
assert(Array.isArray(articles), "official-articles.json must be an array");
assert(Array.isArray(operations), "operation-status.json must be an array");
assert(Array.isArray(stores), "store-status.json must be an array");
assert(Array.isArray(logs), "fetch-log.json must be an array");

for (const source of config.officialSources) {
  assert(source.sourceId, "official source requires sourceId");
  assert(source.siteName, "official source requires siteName");
  assert(source.baseUrl, "official source requires baseUrl");
  assert(Array.isArray(source.sources), `${source.siteName} requires sources`);
}

for (const file of await fs.readdir(dataDir)) {
  if (file.endsWith(".json")) {
    JSON.parse(await fs.readFile(path.join(dataDir, file), "utf8"));
  }
}

console.log("validate: ok");
console.log(`official sources: ${config.officialSources.length}`);
console.log(`store sources: ${config.storeSources.length}`);
console.log(`official articles: ${articles.length}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
