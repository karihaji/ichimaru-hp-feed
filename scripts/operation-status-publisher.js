export const PUBLISHER_SCHEMA_VERSION = 1;

export const NORMALIZED_STATUSES = new Set([
  "NORMAL",
  "CONDITIONAL",
  "CANCELLED",
  "OTHER_VALID",
  "INVALID"
]);

export const SOURCE_AUTHORITIES = new Set([
  "official",
  "fallback",
  "none"
]);

const INVALID_STATUS_LABELS = new Set([
  "",
  "状態不明",
  "不明",
  "確認中",
  "未定",
  "取得失敗",
  "運航未定"
]);

export function buildPublisherStatusRecord({
  source,
  sourceId,
  checkedAt,
  generatedAt = checkedAt,
  primarySelected,
  fallbackSelected,
  primaryAttempts = [],
  fallbackAttempts = [],
  decision
}) {
  const today = checkedDate(checkedAt);
  const official = validPublishCandidate(primarySelected, today);
  const fallback = validPublishCandidate(fallbackSelected, today);
  const primaryExhausted = exhaustedPrimaryAttempts(primaryAttempts);

  if (official.valid) {
    return publisherRecord({
      source,
      sourceId,
      checkedAt,
      generatedAt,
      candidate: primarySelected,
      normalizedStatus: official.normalizedStatus,
      publishable: true,
      publicationReason: "current-day official status selected",
      selectedSourceAuthority: "official",
      statusReason: decision.reason,
      activeSource: decision.activeSource,
      primaryAttempts,
      fallbackAttempts
    });
  }

  if (primaryExhausted && fallback.valid) {
    return publisherRecord({
      source,
      sourceId,
      checkedAt,
      generatedAt,
      candidate: fallbackSelected,
      normalizedStatus: fallback.normalizedStatus,
      publishable: true,
      publicationReason: "official primary status unavailable after 3 attempts; current-day fallback selected",
      selectedSourceAuthority: "fallback",
      statusReason: "primary-failed-3-times-fallback-publisher",
      activeSource: "fallback",
      primaryAttempts,
      fallbackAttempts
    });
  }

  const candidate = decision.selected || primarySelected || fallbackSelected || null;
  return publisherRecord({
    source,
    sourceId,
    checkedAt,
    generatedAt,
    candidate,
    normalizedStatus: "INVALID",
    publishable: false,
    publicationReason: unpublishableReason({
      today,
      primarySelected,
      fallbackSelected,
      primaryAttempts,
      primaryExhausted,
      official,
      fallback,
      decision
    }),
    selectedSourceAuthority: "none",
    statusReason: decision.reason,
    activeSource: decision.activeSource,
    primaryAttempts,
    fallbackAttempts
  });
}

export function normalizeStatusLabel(label) {
  const normalized = String(label || "").replace(/\s+/g, "");
  if (INVALID_STATUS_LABELS.has(normalized)) return "INVALID";
  if (normalized.includes("条件付き運航") || normalized.includes("条件付運航")) return "CONDITIONAL";
  if (["欠航", "欠航中"].includes(normalized)) return "CANCELLED";
  if (["通常運航", "通常運航予定", "通常運航中", "平常運航"].includes(normalized)) return "NORMAL";
  if (normalized) return "OTHER_VALID";
  return "INVALID";
}

export function safeAttemptDiagnostics(attempts = []) {
  return attempts.map((attempt) => ({
    role: attempt.role || "",
    url: attempt.url || "",
    attempt: Number(attempt.attempt || 0),
    startedAt: attempt.startedAt || "",
    httpReachable: Boolean(attempt.httpReachable),
    httpStatus: attempt.httpStatus ?? null,
    parserStatus: attempt.parserStatus || "unknown",
    failureType: attempt.failureType || "",
    errorReason: attempt.errorReason || attempt.message || ""
  }));
}

function validPublishCandidate(candidate, today) {
  if (!candidate) return { valid: false, normalizedStatus: "INVALID", reason: "missing candidate" };
  const normalizedStatus = normalizeStatusLabel(candidate.statusLabel);
  if (normalizedStatus === "INVALID") {
    return { valid: false, normalizedStatus, reason: "invalid statusLabel" };
  }
  if (!candidate.targetDate) {
    return { valid: false, normalizedStatus, reason: "missing targetDate" };
  }
  if (candidate.targetDate !== today) {
    return { valid: false, normalizedStatus, reason: `targetDate is not current day: ${candidate.targetDate}` };
  }
  return { valid: true, normalizedStatus, reason: "ok" };
}

function exhaustedPrimaryAttempts(attempts = []) {
  const primaryAttempts = attempts.filter((attempt) => attempt.role === "official");
  if (primaryAttempts.length < 3) return false;
  return primaryAttempts.slice(0, 3).every((attempt) => attempt.parserStatus !== "success");
}

function unpublishableReason(context) {
  if (context.decision.selected?.statusMethod === "cached-official") {
    return "cached official status is not current-day publishable";
  }
  if (context.primarySelected && !context.official.valid) {
    return `official status is not publishable: ${context.official.reason}`;
  }
  if (context.fallbackSelected && !context.fallback.valid) {
    return `fallback status is not publishable: ${context.fallback.reason}`;
  }
  if (!context.primaryExhausted) {
    return "official primary status did not produce a current-day publishable result and fallback adoption requires 3 unsuccessful attempts";
  }
  return "no current-day publishable operation status";
}

function publisherRecord({
  source,
  sourceId,
  checkedAt,
  generatedAt,
  candidate,
  normalizedStatus,
  publishable,
  publicationReason,
  selectedSourceAuthority,
  statusReason,
  activeSource,
  primaryAttempts,
  fallbackAttempts
}) {
  return {
    schemaVersion: PUBLISHER_SCHEMA_VERSION,
    sourceId,
    sourceName: source.siteName,
    targetDate: candidate?.targetDate || "",
    checkedAt,
    statusLabel: candidate?.statusLabel || "",
    normalizedStatus,
    publishable,
    publicationReason,
    selectedSourceAuthority,
    statusMethod: candidate?.statusMethod || "",
    statusReason,
    activeSource,
    generatedAt,
    statusSource: candidate?.statusSource || "",
    diagnostics: {
      primaryAttempts: safeAttemptDiagnostics(primaryAttempts),
      fallbackAttempts: safeAttemptDiagnostics(fallbackAttempts)
    }
  };
}

function checkedDate(checkedAt) {
  if (/^\d{4}-\d{2}-\d{2}/.test(checkedAt || "")) return checkedAt.slice(0, 10);
  return "";
}
