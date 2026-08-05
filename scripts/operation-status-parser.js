import { findDate, stripHtml } from "./utils.js";

const STATUS_PATTERNS = [
  {
    label: "条件付運航",
    pattern: /条件\s*(?:付|付き)?\s*(?:運航|出航|出港)(?!とは|の場合)|条件付きで運航/
  },
  {
    label: "欠航",
    pattern: /欠航(?!証明書)/
  },
  {
    label: "運航見合わせ",
    pattern: /運航\s*(?:見合わせ|中止)|見合わせ/
  },
  {
    label: "一部運休",
    pattern: /一部\s*運休/
  },
  {
    label: "運休",
    pattern: /運休(?!日|予定日)/
  },
  {
    label: "通常運航",
    pattern: /(?:通常|平常)\s*(?:通り)?\s*(?:運航|出航|出港)(?:予定)?|(?:^|[\s、。．])(?:運航|出航)予定(?:です|[。．\s]|$)/
  },
  {
    label: "運航未定",
    pattern: /運航未定|確認中|未定/
  }
];

const STATUS_CLASS_PATTERN =
  /<[^>]+\bclass\s*=\s*["'][^"']*(?:status|operation)[^"']*(?:label|text|content)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
const OPERATION_BLOCK_PATTERN =
  /<(figure|section|div|a)\b[^>]*\bclass\s*=\s*["'][^"']*(?:p-status|p-top-bar|operation|ship-information)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;

export function extractOperationStatusCandidates(html, options = {}) {
  const sourceUrl = options.sourceUrl || "";
  const checkedAt = options.checkedAt || "";
  const matchTerms = options.matchTerms || [];
  const candidates = [];

  for (const match of html.matchAll(STATUS_CLASS_PATTERN)) {
    pushCandidate(candidates, match[1], {
      sourceUrl,
      checkedAt,
      method: "status-label",
      score: 120,
      assumeCurrentDate: true
    });
  }

  for (const match of html.matchAll(OPERATION_BLOCK_PATTERN)) {
    pushCandidate(candidates, match[0], {
      sourceUrl,
      checkedAt,
      method: "operation-block",
      score: 100,
      assumeCurrentDate: true
    });
  }

  for (const block of targetBlocks(html, matchTerms)) {
    pushCandidate(candidates, block, {
      sourceUrl,
      checkedAt,
      method: "matched-block",
      score: 145,
      assumeCurrentDate: false
    });
  }

  if (matchTerms.length) {
    return dedupeCandidates(candidates);
  }

  const text = stripHtml(html);
  for (const snippet of datedStatusSnippets(text)) {
    pushCandidate(candidates, snippet, {
      sourceUrl,
      checkedAt,
      method: "dated-status-line",
      score: 95,
      assumeCurrentDate: false
    });
  }

  for (const snippet of operationContextSnippets(text)) {
    pushCandidate(candidates, snippet, {
      sourceUrl,
      checkedAt,
      method: "operation-context",
      score: 80,
      assumeCurrentDate: true
    });
  }

  return dedupeCandidates(candidates);
}

export function selectOperationStatus(candidates) {
  return [...candidates].sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;

    const byDate = String(b.targetDate || "").localeCompare(String(a.targetDate || ""));
    if (byDate !== 0) return byDate;

    return a.sourceOrder - b.sourceOrder;
  })[0] || null;
}

function pushCandidate(candidates, raw, options) {
  const text = cleanupStatusText(raw);
  if (!text) return;

  const parsed = parseStatusText(text, options.checkedAt);
  if (!parsed) return;
  const targetDate = parsed.targetDate || (options.assumeCurrentDate ? checkedDate(options.checkedAt) : "");

  candidates.push({
    statusLabel: parsed.statusLabel,
    targetDate,
    statusEvidence: text.slice(0, 180),
    statusSource: options.sourceUrl,
    statusMethod: options.method,
    score: options.score + (targetDate === checkedDate(options.checkedAt) ? 40 : 0),
    sourceOrder: candidates.length
  });
}

function parseStatusText(text, checkedAt) {
  const dated = parseDatedStatuses(text, checkedAt);
  if (dated.length) {
    const today = checkedDate(checkedAt);
    return dated.find((item) => item.targetDate === today) || dated[0];
  }

  return firstStatusByPosition(text);
}

function parseDatedStatuses(text, checkedAt) {
  const results = [];
  const pattern = /((?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}月\s*\d{1,2}日|\d{1,2}\s*\/\s*\d{1,2})\s*[^。．\n\r]{0,140})/g;

  for (const match of text.matchAll(pattern)) {
    const fragment = match[1];
    const parsed = firstStatusByPosition(fragment);
    if (!parsed) continue;

    results.push({
      ...parsed,
      targetDate: findOperationDate(fragment, checkedAt) || parsed.targetDate
    });
  }

  return results;
}

function firstStatusByPosition(text) {
  const matches = [];

  for (const item of STATUS_PATTERNS) {
    const match = text.match(item.pattern);
    if (match) {
      matches.push({
        statusLabel: item.label,
        targetDate: "",
        index: match.index || 0
      });
    }
  }

  return matches.sort((a, b) => a.index - b.index)[0] || null;
}

function findOperationDate(text, checkedAt) {
  const ranged = findCheckedDateInRange(text, checkedAt);
  if (ranged) return ranged;

  const explicit = findDate(text);
  if (explicit) return explicit;

  const match = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!match) return "";

  return monthDayToIsoDate(Number(match[1]), Number(match[2]), checkedAt);
}

function findCheckedDateInRange(text, checkedAt) {
  const current = checkedDate(checkedAt);
  const currentDate = new Date(`${current}T00:00:00+09:00`);
  if (Number.isNaN(currentDate.getTime())) return "";

  const monthDayList = text.match(/(\d{1,2})月\s*((?:\d{1,2}\s*日?\s*(?:[・･、,]|と|及び|および)?\s*){2,})/);
  if (monthDayList) {
    const month = Number(monthDayList[1]);
    const days = Array.from(monthDayList[2].matchAll(/(\d{1,2})\s*日?/g), (match) => Number(match[1]));
    if (days.some((day) => monthDayToIsoDate(month, day, checkedAt) === current)) return current;
  }

  const slashDayList = text.match(/(\d{1,2})\s*\/\s*((?:\d{1,2}\s*(?:[・･、,]|と|及び|および)?\s*){2,})/);
  if (slashDayList) {
    const month = Number(slashDayList[1]);
    const days = Array.from(slashDayList[2].matchAll(/(\d{1,2})/g), (match) => Number(match[1]));
    if (days.some((day) => monthDayToIsoDate(month, day, checkedAt) === current)) return current;
  }

  const monthDayRange = text.match(/(\d{1,2})月\s*(\d{1,2})日\s*(?:[・･、,~〜～\-－]|から|と)\s*(\d{1,2})日/);
  if (monthDayRange) {
    const month = Number(monthDayRange[1]);
    const startDay = Number(monthDayRange[2]);
    const endDay = Number(monthDayRange[3]);
    const start = new Date(`${monthDayToIsoDate(month, startDay, checkedAt)}T00:00:00+09:00`);
    const end = new Date(`${monthDayToIsoDate(month, endDay, checkedAt)}T23:59:59+09:00`);
    if (currentDate >= start && currentDate <= end) return current;
  }

  const slashRange = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:[・･、,~〜～\-－]|から|と)\s*(\d{1,2})/);
  if (slashRange) {
    const month = Number(slashRange[1]);
    const startDay = Number(slashRange[2]);
    const endDay = Number(slashRange[3]);
    const start = new Date(`${monthDayToIsoDate(month, startDay, checkedAt)}T00:00:00+09:00`);
    const end = new Date(`${monthDayToIsoDate(month, endDay, checkedAt)}T23:59:59+09:00`);
    if (currentDate >= start && currentDate <= end) return current;
  }

  return "";
}

function monthDayToIsoDate(month, day, checkedAt) {
  if (!month || !day) return "";

  const base = checkedAt ? new Date(checkedAt) : new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = Number.isNaN(base.getTime()) ? new Date().getFullYear() : base.getFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const tomorrow = new Date(Date.UTC(year, base.getMonth(), base.getDate() + 1));
  const resolvedYear = candidate > tomorrow ? year - 1 : year;
  const pad = (value) => String(value).padStart(2, "0");

  return `${resolvedYear}-${pad(month)}-${pad(day)}`;
}

function datedStatusSnippets(text) {
  return Array.from(text.matchAll(/(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}月\s*\d{1,2}日|\d{1,2}\s*\/\s*\d{1,2})\s*[^。．\n\r]{0,48}/g))
    .map((match) => match[0]);
}

function operationContextSnippets(text) {
  const snippets = [];
  const pattern = /運[航行](?:情報|状況)|運航状況/g;

  for (const match of text.matchAll(pattern)) {
    const index = match.index || 0;
    snippets.push(text.slice(Math.max(0, index - 80), index + 260));
  }

  return snippets;
}

function targetBlocks(html, matchTerms) {
  if (!matchTerms.length) return [];

  const patterns = [
    /<tr\b[\s\S]*?<\/tr>/gi,
    /<table\b[\s\S]*?<\/table>/gi,
    /<(?:section|div|article|li)\b[\s\S]*?<\/(?:section|div|article|li)>/gi
  ];
  const blocks = [];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const text = cleanupStatusText(match[0]);
      if (matchTerms.some((term) => text.includes(term))) {
        blocks.push(match[0]);
      }
    }
  }

  return Array.from(new Set(blocks));
}

function cleanupStatusText(value = "") {
  return stripHtml(value)
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeCandidates(candidates) {
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

function checkedDate(checkedAt) {
  if (/^\d{4}-\d{2}-\d{2}/.test(checkedAt || "")) {
    return checkedAt.slice(0, 10);
  }

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}
