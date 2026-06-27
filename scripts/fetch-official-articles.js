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
    .filter((item) => item.url)
    .map((item) => [item.id || hash(normalizeUrl(item.url)), item])
);

for (const source of config.officialSources || []) {
  for (const target of source.sources || []) {
    try {
      const response = await fetchText(target.url);
      const articles = extractArticles(response.text, source, target, fetchedAt);

      for (const article of articles) {
        const previous = articlesById.get(article.id);
        articlesById.set(article.id, {
          ...previous,
          ...article
        });
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
  .sort((a, b) => {
    const byDate = String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
    if (byDate !== 0) return byDate;
    return String(b.fetchedAt || "").localeCompare(String(a.fetchedAt || ""));
  })
  .slice(0, MAX_ARTICLES);

await writeJson("official-articles.json", articles);
await upsertFetchLogs(logs);

console.log(`official-articles: ${articles.length}件保存`);

function extractArticles(html, source, target, fetchedAt) {
  const blocks = collectBlocks(html);
  const candidates = [];

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
      if (article) candidates.push(article);
    }
  }

  if (!candidates.length) {
    const anchors = extractAnchors(html, target.url).filter((anchor) => isArticleLink(anchor, source, target));
    for (const anchor of anchors.slice(0, 20)) {
      const article = toArticle(anchor, htmlAround(html, anchor.url), "", "", source, target, fetchedAt);
      if (article) candidates.push(article);
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
  const subCategory = SUB_CATEGORIES.find((label) => text.includes(label)) || "";
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
    publishedAt: date || findDate(text),
    important,
    thumbnail: image || "",
    favicon: source.favicon || "",
    fetchedAt,
    sourceId: source.sourceId
  };
}

function isArticleLink(anchor, source, target) {
  if (!anchor.url || !anchor.text) return false;
  const url = absoluteUrl(anchor.url, target.url);
  if (!url.startsWith(source.baseUrl)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|pdf|zip)(\?|$)/i.test(url)) return false;
  if (/#|\/category\/?$|\/tag\/?$/.test(url)) return false;

  const title = cleanupTitle(anchor.text);
  if (!title || title.length < 3) return false;
  if (/^(more|read more|詳しく|詳細|一覧|次へ|前へ)$/i.test(title)) return false;

  const path = new URL(url).pathname;
  return /news|information|info|topics|event|league|post|20\d{2}/i.test(path) || target.type.startsWith("home");
}

function cleanupTitle(value = "") {
  return value
    .replace(/\s+/g, " ")
    .replace(/^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s*/, "")
    .replace(/^20\d{2}年\s*\d{1,2}月\s*\d{1,2}日\s*/, "")
    .replace(/^(詳しく見る|詳細|more)\s*/i, "")
    .trim();
}

function htmlAround(html, url) {
  const index = html.indexOf(url);
  if (index < 0) return html.slice(0, 2000);
  return html.slice(Math.max(0, index - 1000), index + 1000);
}

function contextAround(html, index, size = 900) {
  return html.slice(Math.max(0, index - size), index + size);
}
