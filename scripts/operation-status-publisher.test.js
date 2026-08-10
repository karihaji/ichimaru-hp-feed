import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublisherStatusRecord,
  normalizeStatusLabel
} from "./operation-status-publisher.js";

const source = { siteName: "フェリー屋久島2" };
const sourceId = "ferry-yakusima2-operation";
const checkedAt = "2026-08-10T07:49:02+09:00";
const generatedAt = "2026-08-10T07:50:00+09:00";
const officialCompletedAt = "2026-08-10T07:49:10+09:00";
const fallbackCompletedAt = "2026-08-10T07:49:20+09:00";
const today = "2026-08-10";
const yesterday = "2026-08-09";

test("publishes current-day official primary status", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: candidate({ statusLabel: "通常運航", statusMethod: "status-label", statusSourceRole: "official" }),
    primaryAttempts: [successAttempt("official", 1)]
  }));

  assert.equal(record.publishable, true);
  assert.equal(record.selectedSourceAuthority, "official");
  assert.equal(record.normalizedStatus, "NORMAL");
  assert.equal(record.checkedAt, officialCompletedAt);
  assert.equal(record.generatedAt, generatedAt);
});

test("uses official when primary succeeds after one failed attempt", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: candidate({ statusLabel: "欠航", statusSourceRole: "official" }),
    fallbackSelected: candidate({ statusLabel: "欠航", statusSourceRole: "fallback" }),
    primaryAttempts: [failedAttempt("official", 1), successAttempt("official", 2)]
  }));

  assert.equal(record.publishable, true);
  assert.equal(record.selectedSourceAuthority, "official");
});

test("uses official when primary succeeds after two failed attempts", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: candidate({ statusLabel: "条件付運航", statusSourceRole: "official" }),
    fallbackSelected: candidate({ statusLabel: "欠航", statusSourceRole: "fallback" }),
    primaryAttempts: [failedAttempt("official", 1), failedAttempt("official", 2), successAttempt("official", 3)]
  }));

  assert.equal(record.publishable, true);
  assert.equal(record.selectedSourceAuthority, "official");
  assert.equal(record.normalizedStatus, "CONDITIONAL");
});

test("uses current-day fallback after three unsuccessful primary attempts", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: null,
    fallbackSelected: candidate({ statusLabel: "欠航", statusMethod: "matched-block", statusSourceRole: "fallback" }),
    primaryAttempts: threeFailedPrimaryAttempts(),
    fallbackAttempts: [successAttempt("fallback", 1)]
  }));

  assert.equal(record.publishable, true);
  assert.equal(record.selectedSourceAuthority, "fallback");
  assert.equal(record.normalizedStatus, "CANCELLED");
  assert.equal(record.checkedAt, fallbackCompletedAt);
  assert.match(record.publicationReason, /fallback/);
});

test("publisher feed uses current-day fallback while shared decision remains cached official", () => {
  const decision = {
    selected: candidate({
      statusLabel: "欠航",
      targetDate: yesterday,
      checkedAt: "2026-08-09T15:50:24+09:00",
      statusMethod: "cached-official",
      statusSourceRole: "official"
    }),
    reason: "primary-failed-retaining-last",
    activeSource: "official"
  };
  const record = buildPublisherStatusRecord(base({
    primarySelected: null,
    fallbackSelected: candidate({ statusLabel: "欠航", statusMethod: "matched-block", statusSourceRole: "fallback" }),
    primaryAttempts: threeFailedPrimaryAttempts(),
    fallbackAttempts: [successAttempt("fallback", 1)],
    decision
  }));

  assert.equal(decision.selected.targetDate, yesterday);
  assert.equal(decision.selected.statusMethod, "cached-official");
  assert.equal(record.publishable, true);
  assert.equal(record.targetDate, today);
  assert.equal(record.selectedSourceAuthority, "fallback");
  assert.equal(record.checkedAt, fallbackCompletedAt);
});

test("does not publish when only previous-day cached official exists", () => {
  const decision = {
    selected: candidate({
      statusLabel: "欠航",
      targetDate: yesterday,
      statusMethod: "cached-official",
      statusSourceRole: "official"
    }),
    reason: "primary-failed-retaining-last",
    activeSource: "official"
  };
  const record = buildPublisherStatusRecord(base({
    primarySelected: null,
    fallbackSelected: null,
    primaryAttempts: threeFailedPrimaryAttempts(),
    decision
  }));

  assert.equal(record.publishable, false);
  assert.equal(record.normalizedStatus, "INVALID");
  assert.equal(record.selectedSourceAuthority, "none");
  assert.equal(record.targetDate, yesterday);
  assert.equal(record.checkedAt, "2026-08-10T07:49:13+09:00");
  assert.notEqual(record.checkedAt, "2026-08-09T15:50:24+09:00");
});

test("does not publish previous-day fallback", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: null,
    fallbackSelected: candidate({ statusLabel: "欠航", targetDate: yesterday, statusSourceRole: "fallback" }),
    primaryAttempts: threeFailedPrimaryAttempts(),
    fallbackAttempts: [successAttempt("fallback", 1)]
  }));

  assert.equal(record.publishable, false);
  assert.equal(record.normalizedStatus, "INVALID");
  assert.equal(record.selectedSourceAuthority, "none");
});

test("does not publish fallback with unpublishable status label", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: null,
    fallbackSelected: candidate({ statusLabel: "確認中", statusSourceRole: "fallback" }),
    primaryAttempts: threeFailedPrimaryAttempts(),
    fallbackAttempts: [successAttempt("fallback", 1)]
  }));

  assert.equal(record.publishable, false);
  assert.equal(record.normalizedStatus, "INVALID");
});

test("does not rewrite previous-day cached official targetDate", () => {
  const cached = candidate({
    statusLabel: "欠航",
    targetDate: yesterday,
    statusMethod: "cached-official",
    statusSourceRole: "official"
  });
  const record = buildPublisherStatusRecord(base({
    primarySelected: null,
    fallbackSelected: null,
    primaryAttempts: threeFailedPrimaryAttempts(),
    decision: {
      selected: cached,
      reason: "primary-failed-retaining-last",
      activeSource: "official"
    }
  }));

  assert.equal(record.targetDate, yesterday);
  assert.equal(cached.targetDate, yesterday);
});

test("publisher timestamps are ISO 8601 and checkedAt is not after generatedAt", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: candidate({ statusLabel: "通常運航", statusMethod: "status-label", statusSourceRole: "official" }),
    primaryAttempts: [successAttempt("official", 1)]
  }));

  assert.match(record.checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  assert.match(record.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  assert.ok(record.checkedAt <= record.generatedAt);
});

test("normalizes publisher statuses consistently", () => {
  assert.equal(normalizeStatusLabel("通常運航予定"), "NORMAL");
  assert.equal(normalizeStatusLabel("条件付き運航"), "CONDITIONAL");
  assert.equal(normalizeStatusLabel("欠航"), "CANCELLED");
  assert.equal(normalizeStatusLabel("臨時ダイヤ"), "OTHER_VALID");
  assert.equal(normalizeStatusLabel("確認中"), "INVALID");
});

test("reconstructs the 2026-08-10 publisher contract case", () => {
  const record = buildPublisherStatusRecord(base({
    primarySelected: null,
    fallbackSelected: candidate({ statusLabel: "欠航", statusMethod: "matched-block", statusSourceRole: "fallback" }),
    primaryAttempts: threeFailedPrimaryAttempts(),
    fallbackAttempts: [successAttempt("fallback", 1)],
    decision: {
      selected: candidate({
        statusLabel: "欠航",
        targetDate: yesterday,
        statusMethod: "cached-official",
        statusSourceRole: "official"
      }),
      reason: "primary-failed-retaining-last",
      activeSource: "official"
    }
  }));

  assert.equal(record.publishable, true);
  assert.equal(record.targetDate, today);
  assert.equal(record.statusLabel, "欠航");
  assert.equal(record.normalizedStatus, "CANCELLED");
  assert.equal(record.selectedSourceAuthority, "fallback");
  assert.equal(record.checkedAt, fallbackCompletedAt);
});

function base(overrides = {}) {
  return {
    source,
    sourceId,
    checkedAt,
    generatedAt,
    primarySelected: null,
    fallbackSelected: null,
    primaryAttempts: [],
    fallbackAttempts: [],
    decision: {
      selected: null,
      reason: "primary-unavailable",
      activeSource: "official"
    },
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    statusLabel: "通常運航",
    targetDate: today,
    statusEvidence: overrides.statusLabel || "通常運航",
    statusSource: "https://example.test/status",
    statusSourceRole: "official",
    statusMethod: "status-label",
    score: 120,
    sourceOrder: 0,
    ...overrides
  };
}

function successAttempt(role, attempt) {
  return {
    role,
    url: role === "official" ? "https://ferryyakusima2.com/" : "http://www.norimono-info.com/area_main.php?disp=area&pref=kago&lang=",
    attempt,
    startedAt: checkedAt,
    completedAt: role === "official" ? officialCompletedAt : fallbackCompletedAt,
    httpReachable: true,
    httpStatus: 200,
    parserStatus: "success",
    failureType: "",
    errorReason: "",
    candidateSources: ["https://example.test/status"]
  };
}

function failedAttempt(role, attempt) {
  return {
    role,
    url: "https://ferryyakusima2.com/",
    attempt,
    startedAt: checkedAt,
    completedAt: `2026-08-10T07:49:1${attempt}+09:00`,
    httpReachable: false,
    httpStatus: null,
    parserStatus: "not-run",
    failureType: "fetch-error",
    errorReason: "fetch failed"
  };
}

function threeFailedPrimaryAttempts() {
  return [
    failedAttempt("official", 1),
    failedAttempt("official", 2),
    failedAttempt("official", 3)
  ];
}
