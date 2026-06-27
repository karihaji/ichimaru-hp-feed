import {
  fetchText,
  findDate,
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

for (const source of config.officialSources || []) {
  const operation = source.operationStatus;
  if (!operation?.enabled) continue;

  try {
    const response = await fetchText(operation.sourceUrl);
    const text = stripHtml(response.text);
    const statusLabel = extractStatusLabel(text);
    const targetDate = findDate(statusDateContext(text, statusLabel));

    results.push({
      type: "operation-status",
      sourceName: source.siteName,
      statusLabel,
      targetDate,
      url: operation.detailUrl || operation.sourceUrl,
      checkedAt,
      sourceId: `${source.sourceId}-operation`
    });

    logs.push({
      scope: "operation-status",
      source: source.siteName,
      url: operation.sourceUrl,
      status: "ok",
      message: statusLabel,
      checkedAt
    });
  } catch (error) {
    logs.push({
      scope: "operation-status",
      source: source.siteName,
      url: operation.sourceUrl,
      status: "failed",
      message: error.message,
      checkedAt
    });
  }
}

await writeJson("operation-status.json", results);
await upsertFetchLogs(logs);

console.log(`operation-status: ${results.length}件保存`);

function extractStatusLabel(text) {
  const explicit = findFirstText(text, [
    /(通常運航|平常運航|条件付運航|一部運休|運休|欠航|運航見合わせ|運航未定)/,
    /(通常通り運航|平常通り運航|条件付きで運航)/
  ]);

  if (explicit) {
    return explicit
      .replace("通常通り運航", "通常運航")
      .replace("平常通り運航", "通常運航")
      .replace("条件付きで運航", "条件付運航");
  }

  if (/運休|欠航|見合わせ/.test(text)) return "運休";
  if (/条件|一部/.test(text)) return "条件付運航";
  if (/通常|平常|出航/.test(text)) return "通常運航";
  return "確認中";
}

function statusContext(text, label) {
  const index = text.indexOf(label);
  if (index < 0) {
    const fallback = text.search(/運航状況|運行状況|運航情報/);
    if (fallback < 0) return "";
    return text.slice(Math.max(0, fallback - 120), fallback + 260);
  }
  return text.slice(Math.max(0, index - 140), index + 260);
}

function statusDateContext(text, label) {
  const index = text.indexOf(label);
  if (index < 0) return statusContext(text, label);
  return text.slice(Math.max(0, index - 180), index + label.length + 28);
}
