const DATA_PATH = "../data/";
const DEFAULT_THUMB = "../assets/default-thumb.svg";
const PAGE_SIZE = 16;

const app = {
  articles: [],
  sources: new Map(),
  visibleCount: PAGE_SIZE,
  filters: {
    source: "",
    category: "",
    month: "",
    keyword: ""
  }
};

const $ = (selector) => document.querySelector(selector);

loadData();
attachEvents();

async function loadData() {
  try {
    const [articles, config] = await Promise.all([
      getJson("official-articles.json"),
      getJson("sources.config.json")
    ]);
    app.sources = new Map((config.officialSources || []).map((source) => [source.sourceId, source]));
    app.articles = Array.isArray(articles)
      ? articles.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")))
      : [];

    populateFilters();
    render();
    renderFooter();
  } catch (error) {
    $("#article-grid").replaceChildren(empty("公式HP記事を読み込めませんでした。"));
    $("#result-count").textContent = "読み込み失敗";
    $("#last-updated").textContent = error.message;
  }
}

async function getJson(fileName) {
  const response = await fetch(`${DATA_PATH}${fileName}?v=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`${fileName} を読み込めませんでした`);
  }

  return response.json();
}

function attachEvents() {
  $("#source-filter").addEventListener("change", (event) => {
    app.filters.source = event.target.value;
    resetAndRender();
  });

  $("#category-filter").addEventListener("change", (event) => {
    app.filters.category = event.target.value;
    resetAndRender();
  });

  $("#month-filter").addEventListener("change", (event) => {
    app.filters.month = event.target.value;
    resetAndRender();
  });

  $("#keyword-filter").addEventListener("input", (event) => {
    app.filters.keyword = event.target.value.trim();
    resetAndRender();
  });

  $("#more-button").addEventListener("click", () => {
    app.visibleCount += PAGE_SIZE;
    render();
  });
}

function populateFilters() {
  const sources = unique(app.articles.map((item) => item.sourceName).filter(Boolean));
  const categories = unique(app.articles.map((item) => item.categoryGroup).filter(Boolean));
  const months = unique(app.articles.map((item) => toMonth(item.publishedAt)).filter(Boolean));

  fillSelect($("#source-filter"), sources);
  fillSelect($("#category-filter"), categories);
  fillSelect($("#month-filter"), months, formatMonth);
}

function fillSelect(select, values, labelFn = (value) => value) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelFn(value);
    select.append(option);
  }
}

function resetAndRender() {
  app.visibleCount = PAGE_SIZE;
  render();
}

function render() {
  const grid = $("#article-grid");
  grid.replaceChildren();

  const filtered = filteredArticles();
  const visible = filtered.slice(0, app.visibleCount);

  if (!visible.length) {
    grid.append(empty(app.articles.length ? "条件に一致する記事はありません。" : "公式HP記事はまだ取得されていません。"));
  } else {
    for (const article of visible) {
      grid.append(articleCard(article));
    }
  }

  $("#result-count").textContent = `${filtered.length}件中 ${Math.min(visible.length, filtered.length)}件表示`;
  $("#more-button").hidden = filtered.length <= app.visibleCount;
}

function filteredArticles() {
  const keyword = app.filters.keyword.toLowerCase();

  return app.articles.filter((article) => {
    if (app.filters.source && article.sourceName !== app.filters.source) return false;
    if (app.filters.category && article.categoryGroup !== app.filters.category) return false;
    if (app.filters.month && toMonth(article.publishedAt) !== app.filters.month) return false;

    if (keyword) {
      const target = [
        article.title,
        article.sourceName,
        article.categoryGroup,
        article.itemType,
        article.subCategory
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return target.includes(keyword);
    }

    return true;
  });
}

function articleCard(article) {
  const card = document.createElement("a");
  card.className = "article-card";
  card.dataset.sourceId = article.sourceId || "";
  card.href = article.url || "#";
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  const sourceConfig = app.sources.get(article.sourceId);
  const img = document.createElement("img");
  img.className = "thumb is-icon";
  img.src = toAssetUrl(sourceConfig?.listIcon || sourceConfig?.favicon || article.favicon || DEFAULT_THUMB);
  img.alt = "";
  img.loading = "lazy";

  const body = document.createElement("div");
  body.className = "article-body";

  const sourceRow = document.createElement("div");
  sourceRow.className = "source-row";

  const source = document.createElement("span");
  source.className = "source-name";
  source.textContent = article.sourceName || "掲載元未取得";

  const badge = document.createElement("span");
  badge.className = `badge ${article.important ? "is-important" : ""}`;
  badge.textContent = article.important ? "重要" : article.categoryGroup || "公式HP";

  sourceRow.append(source, badge);

  const date = document.createElement("p");
  date.className = "date";
  date.textContent = article.publishedAt ? `${formatDate(article.publishedAt)}掲載` : "掲載日未取得";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = article.title || "記事タイトル未取得";

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [article.itemType, article.subCategory].filter(Boolean).join(" / ");

  body.append(sourceRow, date, title, meta);
  card.append(img, body);
  return card;
}

function renderFooter() {
  const latest = app.articles.map((item) => item.fetchedAt).filter(Boolean).sort().at(-1);
  $("#last-updated").textContent = latest ? `最終確認: ${formatDateTime(latest)}` : "最終確認: 未取得";
}

function unique(values) {
  return Array.from(new Set(values)).sort((a, b) => b.localeCompare(a, "ja"));
}

function toMonth(value) {
  return /^\d{4}-\d{2}/.test(value || "") ? value.slice(0, 7) : "";
}

function formatMonth(value) {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toAssetUrl(value) {
  if (!value) return DEFAULT_THUMB;
  if (/^https?:\/\//.test(value) || value.startsWith("../")) return value;
  return `../${value.replace(/^\/+/, "")}`;
}

function empty(message) {
  const element = document.createElement("p");
  element.className = "empty-message";
  element.textContent = message;
  return element;
}
