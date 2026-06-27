import {
  fetchDecodedText,
  fetchText,
  findFirstText,
  nowJst,
  readJson,
  stripHtml,
  upsertFetchLogs,
  writeJson
} from "./utils.js";

const config = await readJson("sources.config.json");
const checkedAt = nowJst();
const logs = [];
const results = [];

for (const store of config.storeSources || []) {
  try {
    const response = store.platform === "P-WORLD"
      ? await fetchDecodedText(store.url)
      : await fetchText(store.url);

    const parsed = parseStoreHtml(response.text, store);
    results.push({
      type: "store-status",
      storeId: store.storeId,
      groupKey: store.groupKey || store.storeId,
      storeName: parsed.storeName || store.storeName,
      categoryGroup: "遊技店舗",
      platform: store.platform,
      url: store.url,
      lastUpdatedLabel: parsed.lastUpdatedLabel,
      latestInfoUpdatedLabel: parsed.latestInfoUpdatedLabel,
      machineInfoUpdatedLabel: parsed.machineInfoUpdatedLabel,
      checkedAt,
      status: parsed.status
    });

    logs.push({
      scope: "store-status",
      source: `${store.platform} ${store.storeName}`,
      url: store.url,
      status: "ok",
      message: parsed.lastUpdatedLabel || parsed.latestInfoUpdatedLabel || parsed.status,
      checkedAt
    });
  } catch (error) {
    results.push({
      type: "store-status",
      storeId: store.storeId,
      groupKey: store.groupKey || store.storeId,
      storeName: store.storeName,
      categoryGroup: "遊技店舗",
      platform: store.platform,
      url: store.url,
      lastUpdatedLabel: "",
      latestInfoUpdatedLabel: "",
      machineInfoUpdatedLabel: "",
      checkedAt,
      status: store.linkOnlyFallback ? "linkOnly" : "failed"
    });

    logs.push({
      scope: "store-status",
      source: `${store.platform} ${store.storeName}`,
      url: store.url,
      status: "failed",
      message: error.message,
      checkedAt
    });
  }
}

await writeJson("store-status.json", results);
await upsertFetchLogs(logs);

console.log(`store-status: ${results.length}件保存`);

function parseStoreHtml(html, store) {
  const text = stripHtml(html);
  const storeName = extractStoreName(html, text);

  if (store.platform === "DMMぱちタウン") {
    return {
      storeName,
      lastUpdatedLabel: extractLabel(text, ["最終更新日", "最終更新"]),
      latestInfoUpdatedLabel: extractLabel(text, ["最新情報"]),
      machineInfoUpdatedLabel: extractLabel(text, ["機種情報"]),
      status: "ok"
    };
  }

  const updated = extractLabel(text, ["更新日", "最終更新", "新台入替", "最新情報"]);
  return {
    storeName,
    lastUpdatedLabel: updated,
    latestInfoUpdatedLabel: "",
    machineInfoUpdatedLabel: "",
    status: updated ? "ok" : "linkOnly"
  };
}

function extractStoreName(html, text) {
  const fromHeading = findFirstText(html, [
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    /<h2\b[^>]*>([\s\S]*?)<\/h2>/i,
    /<title\b[^>]*>([\s\S]*?)<\/title>/i
  ]);

  const value = fromHeading || text.split(/\s{2,}|｜|\||-/)[0] || "";
  return value
    .replace(/DMMぱちタウン.*$/g, "")
    .replace(/P-WORLD.*$/g, "")
    .replace(/店舗情報.*$/g, "")
    .trim();
}

function extractLabel(text, keywords) {
  for (const keyword of keywords) {
    const index = text.indexOf(keyword);
    if (index < 0) continue;

    const window = text.slice(index, index + 80);
    const match = window.match(/(\d{1,2}[/-]\d{1,2}(?:\s*[（(][^)）]+[)）])?|\d{4}[./-]\d{1,2}[./-]\d{1,2})/);
    if (match) return match[1].replace(/\s+/g, "");
  }

  return "";
}
