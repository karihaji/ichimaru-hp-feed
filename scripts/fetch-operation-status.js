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
import {
  buildPublisherStatusRecord,
  safeAttemptDiagnostics
} from "./operation-status-publisher.js";

const config = await readJson("sources.config.json");
const previousHealth = toHealthMap(await readJson("operation-status-health.json", []));
const checkedAt = nowJst();
const logs = [];
const results = [];
const healthEntries = [];
const publisherResults = [];

for (const source of config.officialSources || []) {
  const operation = source.operationStatus;
  if (!operation?.enabled) continue;

  const sourceId = `${source.sourceId}-operation`;
  const primaryGroup = statusGroup(operation.primary || operation, operation, "official");
  const fallbackGroup = operation.fallback ? statusGroup(operation.fallback, operation, "fallback") : null;

  const primaryFetch = await fetchStatusGroup(primaryGroup);
  const fallbackFetch = fallbackGroup ? await fetchStatusGroup(fallbackGroup) : emptyFetch("fallback");

  const primaryCandidates = dedupeOperationCandidates(primaryFetch.candidates);
  const fallbackCandidates = dedupeOperationCandidates(fallbackFetch.candidates);
  const primarySelected = selectCurrentOperationStatus(primaryCandidates);
  const fallbackSelected = selectCurrentOperationStatus(fallbackCandidates);

  const decision = decideOperationStatus({
    source,
    operation,
    sourceId,
    previous: previousHealth.get(sourceId),
    primarySelected,
    fallbackSelected
  });
  const checks = [
    ...currentStatusCandidates(primaryCandidates),
    ...currentStatusCandidates(fallbackCandidates)
  ];

  results.push(toOperationResult(source, operation, sourceId, decision, checks));
  const publisherGeneratedAt = nowJst();
  publisherResults.push(buildPublisherStatusRecord({
    source,
    sourceId,
    checkedAt,
    generatedAt: publisherGeneratedAt,
    primarySelected,
    fallbackSelected,
    primaryAttempts: primaryFetch.attempts,
    fallbackAttempts: fallbackFetch.attempts,
    decision
  }));
  healthEntries.push(toHealthEntry(source, sourceId, decision, fallbackSelected, primaryFetch.attempts, fallbackFetch.attempts));
  logs.push(toOperationLog(source, operation, decision, [...primaryFetch.attempts, ...fallbackFetch.attempts]));
}

await writeJson("operation-status.json", results);
await writeJson("operation-status-publisher.json", publisherResults);
await writeJson("operation-status-health.json", healthEntries);
await upsertFetchLogs(logs);

console.log(`operation-status: ${results.length}件保存`);

function statusGroup(group, operation, role) {
  const urls = group.statusUrls || operation.statusUrls || [group.sourceUrl, group.detailUrl, operation.sourceUrl, operation.detailUrl];

  return {
    role,
    statusUrls: Array.from(new Set(urls.filter(Boolean))),
    statusMethods: group.statusMethods || operation.statusMethods || [],
    matchTerms: group.matchTerms || operation.matchTerms || [],
    retryCount: Number(group.retryCount || operation.retryCount || (role === "official" ? 3 : 1)),
    retryDelayMs: Number(group.retryDelayMs || operation.retryDelayMs || 1200),
    timeoutMs: Number(group.timeoutMs || operation.timeoutMs || 12000),
    followFramesDepth: group.followFramesDepth ?? operation.followFramesDepth ?? 3,
    activateAfterFailures: Number(group.activateAfterFailures || operation.fallbackActivateAfterFailures || 3)
  };
}

async function fetchStatusGroup(group) {
  const attempts = [];
  const candidates = [];

  for (const url of group.statusUrls) {
    for (let attempt = 1; attempt <= group.retryCount; attempt += 1) {
      const startedAt = nowJst();
      try {
        const documents = await fetchOperationDocuments(url, group);
        const extracted = [];

        for (const document of documents) {
          extracted.push(...extractOperationStatusCandidates(document.text, {
            checkedAt,
            sourceUrl: document.finalUrl || document.url,
            matchTerms: group.matchTerms
          }));
        }

        const filtered = filterOperationCandidates(extracted, group).map((candidate) => ({
          ...candidate,
          statusSourceRole: group.role
        }));
        candidates.push(...filtered);
        const completedAt = nowJst();

        attempts.push({
          role: group.role,
          url,
          attempt,
          startedAt,
          completedAt,
          status: filtered.length ? "ok" : "warning",
          message: `${filtered.length}候補/${documents.length}ページ`,
          httpReachable: documents.length > 0,
          httpStatus: firstHttpStatus(documents),
          parserStatus: filtered.length ? "success" : "no-candidate",
          failureType: filtered.length ? "" : "parser-no-candidate",
          errorReason: filtered.length ? "" : `${documents.length}ページから対象候補を抽出できませんでした`,
          candidateSources: unique(filtered.map((candidate) => candidate.statusSource).filter(Boolean))
        });

        if (filtered.length || attempt === group.retryCount) break;
        await sleep(group.retryDelayMs);
      } catch (error) {
        const completedAt = nowJst();
        attempts.push({
          role: group.role,
          url,
          attempt,
          startedAt,
          completedAt,
          status: "failed",
          message: error.message,
          httpReachable: Boolean(httpStatusFromError(error.message)),
          httpStatus: httpStatusFromError(error.message),
          parserStatus: "not-run",
          failureType: httpStatusFromError(error.message) ? "http-error" : "fetch-error",
          errorReason: safeErrorReason(error.message)
        });

        if (attempt < group.retryCount) await sleep(group.retryDelayMs);
      }
    }
  }

  return {
    role: group.role,
    attempts,
    candidates
  };
}

function emptyFetch(role) {
  return {
    role,
    attempts: [],
    candidates: []
  };
}

function filterOperationCandidates(candidates, group) {
  if (!group.statusMethods?.length) return candidates;

  const allowed = new Set(group.statusMethods);
  return candidates.filter((candidate) => allowed.has(candidate.statusMethod));
}

async function fetchOperationDocuments(url, group, depth = 0, seen = new Set()) {
  if (!url || seen.has(url)) return [];
  seen.add(url);

  const response = await fetchText(url, { timeoutMs: group.timeoutMs });
  const document = {
    url,
    finalUrl: response.finalUrl || url,
    text: response.text,
    httpStatus: response.status
  };
  const documents = [document];

  if (depth >= group.followFramesDepth) return documents;

  for (const frameUrl of frameUrls(response.text, response.finalUrl || url)) {
    try {
      documents.push(...await fetchOperationDocuments(frameUrl, group, depth + 1, seen));
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

function decideOperationStatus({ source, operation, sourceId, previous = {}, primarySelected, fallbackSelected }) {
  const fallbackThreshold = Number(operation.fallback?.activateAfterFailures || operation.fallbackActivateAfterFailures || 3);
  const primaryFailureCount = primarySelected ? 0 : Number(previous.primaryFailureCount || 0) + 1;
  const fallbackCandidate = fallbackSelected ? {
    ...fallbackSelected,
    statusSourceRole: "fallback"
  } : null;
  let selected = null;
  let activeSource = "official";
  let reason = "primary-ok";

  if (primarySelected) {
    selected = {
      ...primarySelected,
      statusSourceRole: "official"
    };
  } else if (fallbackCandidate && primaryFailureCount >= fallbackThreshold) {
    selected = fallbackCandidate;
    activeSource = "fallback";
    reason = `primary-failed-${fallbackThreshold}-times`;
  } else if (previous.lastPrimaryStatusLabel) {
    selected = cachedPrimaryCandidate(source, operation, previous);
    reason = "primary-failed-retaining-last";
  } else if (fallbackCandidate) {
    selected = fallbackCandidate;
    activeSource = "fallback";
    reason = "primary-failed-no-primary-cache";
  } else {
    reason = "primary-unavailable";
  }

  const lastPrimary = primarySelected ? primarySelected : previousPrimarySnapshot(previous);

  return {
    selected,
    activeSource,
    reason,
    primaryFailureCount,
    lastPrimarySuccessAt: primarySelected ? checkedAt : previous.lastPrimarySuccessAt || "",
    lastPrimaryStatusLabel: lastPrimary?.statusLabel || "",
    lastPrimaryTargetDate: lastPrimary?.targetDate || "",
    lastPrimaryStatusSource: lastPrimary?.statusSource || "",
    fallbackStatusLabel: fallbackCandidate?.statusLabel || previous.fallbackStatusLabel || "",
    fallbackCheckedAt: fallbackCandidate ? checkedAt : previous.fallbackCheckedAt || "",
    agreement: statusAgreementForDecision(primarySelected, fallbackCandidate, selected, activeSource)
  };
}

function cachedPrimaryCandidate(source, operation, previous) {
  return {
    statusLabel: previous.lastPrimaryStatusLabel,
    targetDate: previous.lastPrimaryTargetDate || "",
    statusEvidence: previous.lastPrimaryStatusLabel,
    statusSource: previous.lastPrimaryStatusSource || operation.sourceUrl || source.baseUrl || "",
    statusMethod: "cached-official",
    statusSourceRole: "official",
    score: 60,
    sourceOrder: 0
  };
}

function previousPrimarySnapshot(previous) {
  if (!previous.lastPrimaryStatusLabel) return null;

  return {
    statusLabel: previous.lastPrimaryStatusLabel,
    targetDate: previous.lastPrimaryTargetDate || "",
    statusSource: previous.lastPrimaryStatusSource || ""
  };
}

function statusAgreementForDecision(primarySelected, fallbackSelected, selected, activeSource) {
  if (primarySelected && fallbackSelected) {
    return primarySelected.statusLabel === fallbackSelected.statusLabel ? "matched" : "conflict";
  }
  if (primarySelected) return "official-only";
  if (activeSource === "fallback" && fallbackSelected) return "fallback";
  if (selected?.statusMethod === "cached-official") return fallbackSelected ? "cached-with-fallback" : "cached-official";
  return "none";
}

function toOperationResult(source, operation, sourceId, decision, checks) {
  const selected = decision.selected;

  return {
    type: "operation-status",
    sourceName: source.siteName,
    statusLabel: selected?.statusLabel || "確認中",
    targetDate: selected?.targetDate || "",
    url: operation.detailUrl || operation.sourceUrl,
    checkedAt,
    sourceId,
    statusSource: selected?.statusSource || "",
    statusSourceRole: selected?.statusSourceRole || "",
    statusMethod: selected?.statusMethod || "",
    statusEvidence: publicEvidence(selected),
    statusAgreement: decision.agreement,
    activeSource: decision.activeSource,
    statusReason: decision.reason,
    statusChecks: checks
      .sort((a, b) => {
        const byRole = sourceRoleRank(a) - sourceRoleRank(b);
        if (byRole !== 0) return byRole;
        return b.score - a.score;
      })
      .slice(0, 6)
      .map(publicCandidate)
  };
}

function toHealthEntry(source, sourceId, decision, fallbackSelected, primaryAttempts, fallbackAttempts) {
  return {
    sourceId,
    sourceName: source.siteName,
    primaryFailureCount: decision.primaryFailureCount,
    lastPrimarySuccessAt: decision.lastPrimarySuccessAt,
    lastPrimaryStatusLabel: decision.lastPrimaryStatusLabel,
    lastPrimaryTargetDate: decision.lastPrimaryTargetDate,
    lastPrimaryStatusSource: decision.lastPrimaryStatusSource,
    fallbackStatusLabel: fallbackSelected?.statusLabel || decision.fallbackStatusLabel || "",
    fallbackCheckedAt: fallbackSelected ? checkedAt : decision.fallbackCheckedAt,
    activeSource: decision.activeSource,
    reason: decision.reason,
    updatedAt: checkedAt,
    diagnostics: {
      primaryAttempts: safeAttemptDiagnostics(primaryAttempts),
      fallbackAttempts: safeAttemptDiagnostics(fallbackAttempts),
      fallbackResult: fallbackSelected ? "candidate" : "none"
    }
  };
}

function toOperationLog(source, operation, decision, attempts) {
  const selected = decision.selected;
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  const status = selected ? "ok" : failed.length === attempts.length ? "failed" : "warning";
  const attemptSummary = attempts
    .map((attempt) => `${attempt.role}:${attempt.url}#${attempt.attempt} ${attempt.message}`)
    .join(" / ");

  return {
    scope: "operation-status",
    source: source.siteName,
    url: selected?.statusSource || operation.sourceUrl,
    status,
    message: selected
      ? `${selected.statusLabel} (${selected.statusMethod}, ${decision.agreement}, ${decision.reason})`
      : `運航欄を判定できませんでした: ${attemptSummary}`,
    checkedAt
  };
}

function selectCurrentOperationStatus(candidates) {
  return selectOperationStatus(currentStatusCandidates(candidates));
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
      candidate.statusEvidence,
      candidate.statusSourceRole
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function publicCandidate(candidate) {
  return {
    statusLabel: candidate.statusLabel,
    targetDate: candidate.targetDate,
    statusSource: candidate.statusSource,
    statusSourceRole: candidate.statusSourceRole || "",
    statusMethod: candidate.statusMethod,
    statusEvidence: publicEvidence(candidate)
  };
}

function publicEvidence(candidate) {
  if (!candidate) return "";
  if (candidate.statusSourceRole === "fallback") return candidate.statusLabel;
  return candidate.statusEvidence || candidate.statusLabel || "";
}

function sourceRoleRank(candidate) {
  if (candidate.statusSourceRole === "official") return 0;
  if (candidate.statusSourceRole === "fallback") return 1;
  return 2;
}

function toHealthMap(entries) {
  return new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.sourceId, entry]));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstHttpStatus(documents) {
  return documents.find((document) => document.httpStatus)?.httpStatus ?? null;
}

function httpStatusFromError(message = "") {
  const match = String(message).match(/^HTTP\s+(\d{3})/);
  return match ? Number(match[1]) : null;
}

function safeErrorReason(message = "") {
  return String(message || "unknown error").slice(0, 160);
}

function unique(values) {
  return Array.from(new Set(values));
}
