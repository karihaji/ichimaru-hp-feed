import {
  absoluteUrl,
  collectBlocks,
  extractAnchors,
  extractImage,
  fetchText,
  findDate,
  hash,
  normalizeUrl,
  nowJst,
  readJson,
  stripHtml,
  upsertFetchLogs,
  writeJson
} from "./utils.js";

const MAX_ARTICLES = 500;
const SUB_CATEGORIES = [
  "おやっとさぁリーグ",
  "シングルスリーグ",
  "ダブルスリーグ",
  "チャレンジマッチ",
  "モーニングバトル",
  "その他大会",
  "E-LEAGUE",
  "T-LEAGUE",
  "T-1",
  "グランドチャンピオン戦優勝者"
];

const config = await readJson("sources.config.json");
const existing = await readJson("official-articles.json", []);
const fetchedAt = nowJst();
const logs = [];
const articlesById = new Map(
  existing
    .filter((item) => item.url && item.publishedAt)
    .map((item) => [item.id || hash(normalizeUrl(item.url)), item])
);

for (const source of config.officialSources || []) {
  for (const target of source.sources || []) {
    try {
      const response = await fetchText(target.url);
      const articles = extractArticles(response.text, source, target, fetchedAt);

      for (const article of articles) {
        const previous = articlesById.get(article.id);
        articlesById.set(article.id, mergeArticle(previous, article));
      }

      logs.push({
        scope: "official-articles",
        source: source.siteName,
        url: target.url,
        status: "ok",
        message: `${articles.length}件取得`,
        checkedAt: fetchedAt
      });
    } catch (error) {
      logs.push({
        scope: "official-articles",
        source: source.siteName,
        url: target.url,
        status: "failed",
        message: error.message,
        checkedAt: fetchedAt
      });
    }
  }
}

const articles = Array.from(articlesById.values())
  .sort(compareArticles)
  .slice(0, MAX_ARTICLES);

await writeJson("official-articles.json", articles);
await upsertFetchLogs(logs);

console.log(`official-articles: ${articles.length}件保存`);

function extractArticles(html, source, target, fetchedAt) {
  const contentHtml = html;
  const blocks = collectBlocks(contentHtml);
  const candidates = [];
  let sourceOrder = 0;

  for (const block of blocks) {
    const date = findDate(block);
    const image = extractImage(block, target.url);
    const anchors = extractAnchors(block, target.url)
      .filter((anchor) => isArticleLink(anchor, source, target))
      .slice(0, 3);

    for (const anchor of anchors) {
      const context = contextAround(block, anchor.index);
      const itemDate = findDate(anchor.text) || findDate(context) || date;
      const itemImage = extractImage(context, target.url) || image;
      const article = toArticle(anchor, context, itemDate, itemImage, source, target, fetchedAt);
      if (article) {
        article.sourceOrder = sourceOrder++;
        candidates.push(article);
      }
    }
  }

  if (!candidates.length) {
    const anchors = extractAnchors(contentHtml, target.url).filter((anchor) => isArticleLink(anchor, source, target));
    for (const anchor of anchors.slice(0, 20)) {
      const context = contextAround(contentHtml, anchor.index);
      const article = toArticle(anchor, context, findDate(anchor.text) || findDate(context), extractImage(context, target.url), source, target, fetchedAt);
      if (article) {
        article.sourceOrder = sourceOrder++;
        candidates.push(article);
      }
    }
  }

  const byId = new Map();
  for (const item of candidates) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }

  return Array.from(byId.values()).slice(0, 30);
}

function toArticle(anchor, block, date, image, source, target, fetchedAt) {
  const normalizedUrl = normalizeUrl(anchor.url);
  if (!normalizedUrl) return null;

  const title = cleanupTitle(anchor.text);
  if (!title || title.length < 3) return null;

  const text = stripHtml(block);
  const publishedAt = date || findDate(text);
  if (!publishedAt) return null;

  const subCategory = SUB_CATEGORIES.find((label) => title.includes(label)) ||
    SUB_CATEGORIES.find((label) => text.includes(label)) ||
    "";
  const important = /重要|大事|緊急|運休|欠航/.test(text) || /重要|大事|緊急/.test(title);

  return {
    id: hash(normalizedUrl),
    type: "official-article",
    sourceName: source.siteName,
    categoryGroup: source.categoryGroup,
    itemType: target.itemType || target.label || "お知らせ",
    subCategory,
    title,
    url: normalizedUrl,
    publishedAt,
    important,
    thumbnail: image || "",
    favicon: source.favicon || "",
    fetchedAt,
    sourceOrder: 0,
    sourceId: source.sourceId
  };
}

function mergeArticle(previous, next) {
  if (!previous) return next;

  return {
    ...previous,
    ...next,
    publishedAt: bestPublishedAt(previous.publishedAt, next.publishedAt),
    important: Boolean(previous.important || next.important),
    thumbnail: next.thumbnail || previous.thumbnail || "",
    favicon: next.favicon || previous.favicon || "",
    subCategory: next.subCategory || previous.subCategory || "",
    sourceOrder: Math.min(
      Number.isFinite(previous.sourceOrder) ? previous.sourceOrder : Number.POSITIVE_INFINITY,
      Number.isFinite(next.sourceOrder) ? next.sourceOrder : Number.POSITIVE_INFINITY
    )
  };
}

function compareArticles(a, b) {
  const byDate = String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
  if (byDate !== 0) return byDate;

  if (a.sourceId === b.sourceId) {
    const bySourceOrder = (a.sourceOrder ?? 9999) - (b.sourceOrder ?? 9999);
    if (bySourceOrder !== 0) return bySourceOrder;
  }

  const byUrlNumber = articleNumber(b.url) - articleNumber(a.url);
  if (byUrlNumber !== 0) return byUrlNumber;

  return String(b.fetchedAt || "").localeCompare(String(a.fetchedAt || ""));
}

function articleNumber(url = "") {
  const match = url.match(/(?:\/|-)(\d+)(?:\.html)?\/?$/);
  return match ? Number(match[1]) : 0;
}

function bestPublishedAt(previousDate = "", nextDate = "") {
  const validDates = [previousDate, nextDate].filter(Boolean).filter((date) => !isFutureDate(date));
  if (validDates.length) return validDates.sort().at(-1);
  return [previousDate, nextDate].filter(Boolean).sort().at(-1) || "";
}

function isFutureDate(value = "") {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return date > tomorrow;
}

function isArticleLink(anchor, source, target) {
  if (!anchor.url || !anchor.text) return false;
  const url = absoluteUrl(anchor.url, target.url);
  if (!url.startsWith(source.baseUrl)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|pdf|zip)(\?|$)/i.test(url)) return false;
  if (/#|\/category\/?|\/tag\/?|\/page\/\d+\/?$/i.test(url)) return false;

  const title = cleanupTitle(anchor.text);
  if (!title || title.length < 3) return false;
  if (/^(more|read more|詳しく|詳細|一覧|次へ|前へ|ホーム|home|\d+|>)$/i.test(title)) return false;

  const path = new URL(url).pathname;
  const normalizedPath = path.replace(/\/$/, "") || "/";
  const targetPath = new URL(target.url).pathname.replace(/\/$/, "") || "/";
  const basePath = new URL(source.baseUrl).pathname.replace(/\/$/, "") || "/";

  if (normalizedPath === targetPath || normalizedPath === basePath) return false;
  if (isStaticPath(normalizedPath)) return false;

  return /\/post-\d+\/?$/i.test(path) ||
    /\/\d+\/?$/i.test(path) ||
    /\/\d+\.html$/i.test(path) ||
    /\/(?:news|information|info|topics)\/[^/]+\/?$/i.test(path);
}

function isStaticPath(path) {
  return /\/(?:terms|privacy|company|contact|access|guide|faq|link|sitemap|recruit|business|howto|facility|movein|daycare|floor-guide|price-list|event-calendar|bowling-school|reserve|amusement|terminal|timetable|about|agreement|ship-guide|boarding-|platform-|tanegashima-|conditions-of-carriage|translate)(?:\/|$)/i.test(path);
}


function cleanupTitle(value = "") {
  return value
    .replace(/\s+/g, " ")
    .replace(/^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s*/, "")
    .replace(/^20\d{2}年\s*\d{1,2}月\s*\d{1,2}日\s*/, "")
    .replace(/^(重要なお知らせ|大事なお知らせ|おすすめ情報|お知らせ|新着情報|イベント情報|大会結果)\s+/, "")
    .replace(/^(詳しく見る|詳細|more)\s*/i, "")
    .trim();
}

function contextAround(html, index, size = 900) {
  return html.slice(Math.max(0, index - size), index + size);
}
