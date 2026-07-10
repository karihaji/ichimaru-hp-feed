import {
  absoluteUrl,
  fetchText,
  nowJst,
  readJson,
  upsertFetchLogs,
  writeJson
} from "./utils.js";
import {
  extractOperationStatusCandidates,
  selectOperationStatus
} from "./operation-status-parser.js";

const config = await readJson("sources.config.json");
const checkedAt = nowJst();
const logs = [];
const results = [];

for (const source of config.officialSources || []) {
  const operation = source.operationStatus;
  if (!operation?.enabled) continue;

  const attempts = [];
  const candidates = [];

  for (const url of operationStatusUrls(operation)) {
    try {
      const documents = await fetchOperationDocuments(url, operation);
      let extractedCount = 0;

      for (const document of documents) {
        const extracted = extractOperationStatusCandidates(document.text, {
          checkedAt,
          sourceUrl: document.finalUrl || document.url,
          matchTerms: operation.matchTerms || []
        });
        extractedCount += extracted.length;
        candidates.push(...extracted);
      }

      attempts.push({
        url,
        status: "ok",
        message: `${extractedCount}候補/${documents.length}ページ`
      });
    } catch (error) {
      attempts.push({
        url,
        status: "failed",
        message: error.message
      });
    }
  }

  const uniqueCandidates = dedupeOperationCandidates(candidates);
  const selected = selectOperationStatus(uniqueCandidates);
  const currentCandidates = currentStatusCandidates(uniqueCandidates);
  const agreement = statusAgreement(currentCandidates);
  const result = toOperationResult(source, operation, selected, currentCandidates, agreement);
  results.push(result);

  logs.push(toOperationLog(source, operation, selected, attempts, agreement));
}

await writeJson("operation-status.json", results);
await upsertFetchLogs(logs);

console.log(`operation-status: ${results.length}件保存`);

function operationStatusUrls(operation) {
  const urls = operation.statusUrls || [operation.sourceUrl, operation.detailUrl];
  return Array.from(new Set(urls.filter(Boolean)));
}

async function fetchOperationDocuments(url, operation, depth = 0, seen = new Set()) {
  if (!url || seen.has(url)) return [];
  seen.add(url);

  const response = await fetchText(url, { timeoutMs: operation.timeoutMs || 12000 });
  const document = {
    url,
    finalUrl: response.finalUrl || url,
    text: response.text
  };
  const documents = [document];

  if (depth >= (operation.followFramesDepth ?? 3)) return documents;

  for (const frameUrl of frameUrls(response.text, response.finalUrl || url)) {
    try {
      documents.push(...await fetchOperationDocuments(frameUrl, operation, depth + 1, seen));
    } catch {
      // Frame pages are fallback inputs; keep the primary page result.
    }
  }

  return documents;
}

function frameUrls(html, baseUrl) {
  return Array.from(html.matchAll(/<frame\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi))
    .map((match) => absoluteUrl(match[1], baseUrl))
    .filter(Boolean);
}

function toOperationResult(source, operation, selected, currentCandidates, agreement) {
  return {
    type: "operation-status",
    sourceName: source.siteName,
    statusLabel: selected?.statusLabel || "確認中",
    targetDate: selected?.targetDate || "",
    url: operation.detailUrl || operation.sourceUrl,
    checkedAt,
    sourceId: `${source.sourceId}-operation`,
    statusSource: selected?.statusSource || "",
    statusMethod: selected?.statusMethod || "",
    statusEvidence: selected?.statusEvidence || "",
    statusAgreement: agreement,
    statusChecks: currentCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((candidate) => ({
        statusLabel: candidate.statusLabel,
        targetDate: candidate.targetDate,
        statusSource: candidate.statusSource,
        statusMethod: candidate.statusMethod,
        statusEvidence: candidate.statusEvidence
      }))
  };
}

function toOperationLog(source, operation, selected, attempts, agreement) {
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  const status = selected ? "ok" : failed.length === attempts.length ? "failed" : "warning";
  const attemptSummary = attempts.map((attempt) => `${attempt.url}: ${attempt.message}`).join(" / ");

  return {
    scope: "operation-status",
    source: source.siteName,
    url: selected?.statusSource || operation.sourceUrl,
    status,
    message: selected
      ? `${selected.statusLabel} (${selected.statusMethod}, ${agreement})`
      : `運航欄を判定できませんでした: ${attemptSummary}`,
    checkedAt
  };
}

function currentStatusCandidates(candidates) {
  const today = checkedAt.slice(0, 10);
  const current = candidates.filter((candidate) => !candidate.targetDate || candidate.targetDate === today);
  return current.length ? current : candidates;
}

function dedupeOperationCandidates(candidates) {
  const seen = new Set();
  const deduped = [];

  for (const candidate of candidates) {
    const key = [
      candidate.statusLabel,
      candidate.targetDate,
      candidate.statusSource,
      candidate.statusMethod,
      candidate.statusEvidence
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function statusAgreement(candidates) {
  const labels = new Set(candidates.map((candidate) => candidate.statusLabel).filter(Boolean));
  const sources = new Set(candidates.map((candidate) => candidate.statusSource).filter(Boolean));
  if (!labels.size) return "none";
  if (labels.size > 1) return "conflict";
  return sources.size > 1 ? "matched" : "single";
}
