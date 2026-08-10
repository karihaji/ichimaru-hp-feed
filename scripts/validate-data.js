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
  "data/operation-status-publisher.json",
  "data/operation-status-health.json",
  "data/store-status.json",
  "data/fetch-log.json"
];

for (const file of requiredFiles) {
  await fs.access(path.join(repoRoot, file));
}

const config = await readJson("sources.config.json");
const articles = await readJson("official-articles.json");
const operations = await readJson("operation-status.json");
const publisherOperations = await readJson("operation-status-publisher.json");
const operationHealth = await readJson("operation-status-health.json");
const stores = await readJson("store-status.json");
const logs = await readJson("fetch-log.json");

assert(Array.isArray(config.officialSources), "officialSources must be an array");
assert(Array.isArray(config.storeSources), "storeSources must be an array");
assert(Array.isArray(articles), "official-articles.json must be an array");
assert(Array.isArray(operations), "operation-status.json must be an array");
assert(Array.isArray(publisherOperations), "operation-status-publisher.json must be an array");
assert(Array.isArray(operationHealth), "operation-status-health.json must be an array");
assert(Array.isArray(stores), "store-status.json must be an array");
assert(Array.isArray(logs), "fetch-log.json must be an array");

for (const source of config.officialSources) {
  assert(source.sourceId, "official source requires sourceId");
  assert(source.siteName, "official source requires siteName");
  assert(source.baseUrl, "official source requires baseUrl");
  assert(Array.isArray(source.sources), `${source.siteName} requires sources`);
}

for (const item of publisherOperations) {
  validatePublisherOperation(item);
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

function validatePublisherOperation(item) {
  const normalizedStatuses = new Set(["NORMAL", "CONDITIONAL", "CANCELLED", "OTHER_VALID", "INVALID"]);
  const authorities = new Set(["official", "fallback", "none"]);

  assert(item.schemaVersion === 1, `${item.sourceId || "publisher record"} requires schemaVersion=1`);
  assert(item.sourceId, "publisher record requires sourceId");
  assert(typeof item.targetDate === "string", `${item.sourceId} requires targetDate field`);
  assert(!item.targetDate || isIsoDate(item.targetDate), `${item.sourceId} targetDate must be ISO date when present`);
  assert(isIsoDateTime(item.checkedAt), `${item.sourceId} requires ISO checkedAt`);
  assert(normalizedStatuses.has(item.normalizedStatus), `${item.sourceId} has invalid normalizedStatus`);
  assert(typeof item.publishable === "boolean", `${item.sourceId} requires boolean publishable`);
  assert(authorities.has(item.selectedSourceAuthority), `${item.sourceId} has invalid selectedSourceAuthority`);
  assert(isIsoDateTime(item.generatedAt), `${item.sourceId} requires ISO generatedAt`);

  const checkedDate = item.checkedAt.slice(0, 10);
  if (item.publishable) {
    assert(isIsoDate(item.targetDate), `${item.sourceId} publishable data requires ISO targetDate`);
    assert(item.targetDate === checkedDate, `${item.sourceId} publishable data must target the checked day`);
    assert(item.normalizedStatus !== "INVALID", `${item.sourceId} publishable data must not be INVALID`);
    assert(item.statusLabel, `${item.sourceId} publishable data requires statusLabel`);
    assert(item.statusMethod, `${item.sourceId} publishable data requires statusMethod`);
  }

  if (item.selectedSourceAuthority === "fallback") {
    const primaryAttempts = item.diagnostics?.primaryAttempts || [];
    assert(primaryAttempts.length >= 3, `${item.sourceId} fallback publisher data requires at least 3 primary attempts`);
    assert(/fallback/i.test(item.publicationReason || ""), `${item.sourceId} fallback publisher data requires fallback publicationReason`);
  }

  if (item.statusMethod === "cached-official" && item.targetDate !== checkedDate) {
    assert(item.publishable === false, `${item.sourceId} previous cached official must not be publishable`);
  }
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}
