const DATA_PATH = "../data/";
const DEFAULT_THUMB = "../assets/default-thumb.svg";
const COMPACT_OFFICIAL_ORDER = [
  "cosmoline",
  "ferry-yakusima2",
  "kyusho-port",
  "tsurutaxi",
  "sunlight-zone",
  "t-max-bowl",
  "tsuruhome",
  "ichimaru-grp"
];

const state = {
  officialArticles: [],
  operationStatus: [],
  storeStatus: [],
  config: null
};

const $ = (selector) => document.querySelector(selector);

initTabs();
loadData();

function initTabs() {
  const tabs = [
    {
      button: $("#tab-official"),
      panel: $("#panel-official")
    },
    {
      button: $("#tab-store"),
      panel: $("#panel-store")
    }
  ];

  for (const current of tabs) {
    current.button.addEventListener("click", () => {
      for (const item of tabs) {
        const active = item === current;
        item.button.classList.toggle("is-active", active);
        item.button.setAttribute("aria-selected", String(active));
        item.panel.classList.toggle("is-active", active);
        item.panel.hidden = !active;
      }
    });
  }
}

async function loadData() {
  try {
    const [articles, operations, stores, config] = await Promise.all([
      getJson("official-articles.json"),
      getJson("operation-status.json"),
      getJson("store-status.json"),
      getJson("sources.config.json")
    ]);

    state.officialArticles = Array.isArray(articles) ? articles : [];
    state.operationStatus = Array.isArray(operations) ? operations : [];
    state.storeStatus = Array.isArray(stores) ? stores : [];
    state.config = config;

    renderOperations();
    renderOfficial();
    renderStores();
    renderFooter();
  } catch (error) {
    renderLoadError(error);
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

function renderOperations() {
  const list = $("#operation-list");
  list.replaceChildren();

  const operations = state.operationStatus;
  if (!operations.length) {
    list.append(empty("運航情報はまだ取得されていません。"));
    $("#operation-updated").textContent = "未取得";
    return;
  }

  for (const item of operations) {
    const card = document.createElement("a");
    card.className = "operation-card";
    card.href = item.url || item.detailUrl || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const main = document.createElement("span");
    main.className = "source-name";
    main.textContent = item.sourceName || "運航情報";

    const status = document.createElement("span");
    status.className = `status-label ${operationTone(item.statusLabel)}`;
    status.textContent = item.statusLabel || "確認中";

    card.append(main, status);
    list.append(card);
  }

  $("#operation-updated").textContent = latestCheckedAt(operations);
}

function renderOfficial() {
  const list = $("#official-list");
  list.replaceChildren();

  const sources = orderedOfficialSources(state.config?.officialSources || []);
  const latestBySource = new Map();

  for (const article of state.officialArticles) {
    const existing = latestBySource.get(article.sourceId);
    if (!existing || compareDate(article.publishedAt, existing.publishedAt) > 0) {
      latestBySource.set(article.sourceId, article);
    }
  }

  if (!sources.length) {
    list.append(empty("公式HPの取得対象が設定されていません。"));
    $("#official-count").textContent = "0件";
    return;
  }

  for (const source of sources) {
    const article = latestBySource.get(source.sourceId);
    list.append(article ? officialCard(article, source) : pendingOfficialCard(source));
  }

  const count = Array.from(latestBySource.keys()).length;
  $("#official-count").textContent = `${count}/${sources.length}サイト`;
}

function officialCard(article, source) {
  const card = document.createElement("a");
  card.className = "official-card";
  card.dataset.sourceId = article.sourceId || source.sourceId || "";
  card.href = article.url || source.baseUrl;
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  const img = document.createElement("img");
  img.className = "thumb is-icon";
  img.src = toAssetUrl(compactIcon(article, source));
  img.alt = "";
  img.loading = "lazy";

  const body = document.createElement("div");

  const sourceName = document.createElement("span");
  sourceName.className = "source-name";
  sourceName.textContent = article.sourceName || source.siteName;

  const date = document.createElement("p");
  date.className = "date";
  date.textContent = article.publishedAt ? `${formatDate(article.publishedAt)}掲載` : "掲載日未取得";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = article.title || "記事タイトル未取得";

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [article.categoryGroup, article.itemType, article.subCategory].filter(Boolean).join(" / ");

  body.append(sourceName, date, title, meta);
  card.append(img, body);
  return card;
}

function pendingOfficialCard(source) {
  const card = document.createElement("a");
  card.className = "official-card";
  card.dataset.sourceId = source.sourceId || "";
  card.href = source.baseUrl || "#";
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  const img = document.createElement("img");
  img.className = "thumb is-icon";
  img.src = toAssetUrl(compactIcon(null, source));
  img.alt = "";

  const body = document.createElement("div");
  const sourceName = document.createElement("span");
  sourceName.className = "source-name";
  sourceName.textContent = source.siteName;

  const date = document.createElement("p");
  date.className = "date";
  date.textContent = "未取得";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = "公式HP記事の取得を準備中です。";

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = source.categoryGroup || "";

  body.append(sourceName, date, title, meta);
  card.append(img, body);
  return card;
}

function renderStores() {
  const list = $("#store-list");
  list.replaceChildren();

  const configStores = state.config?.storeSources || [];
  const rows = state.storeStatus.length ? state.storeStatus : fallbackStoreRows(configStores);
  const grouped = groupStores(rows);

  if (!grouped.length) {
    list.append(empty("遊技店舗の取得対象が設定されていません。"));
    $("#store-count").textContent = "0店舗";
    return;
  }

  for (const group of grouped) {
    list.append(storeCard(group));
  }

  $("#store-count").textContent = `${grouped.length}店舗`;
}

function fallbackStoreRows(configStores) {
  return configStores.map((item) => ({
    type: "store-status",
    storeId: item.storeId,
    groupKey: item.groupKey || item.storeId,
    storeName: item.storeName,
    platform: item.platform,
    url: item.url,
    status: item.linkOnlyFallback ? "linkOnly" : "pending",
    checkedAt: ""
  }));
}

function groupStores(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = row.groupKey || normalizeStoreKey(row.storeName || row.storeId || row.url);
    if (!groups.has(key)) {
      groups.set(key, {
        storeName: row.storeName || "店舗名確認中",
        items: []
      });
    }
    const current = groups.get(key);
    if (row.platform === "DMMぱちタウン" && row.storeName) current.storeName = row.storeName;
    groups.get(key).items.push(row);
  }

  return Array.from(groups.values()).sort((a, b) => a.storeName.localeCompare(b.storeName, "ja"));
}

function storeCard(group) {
  const card = document.createElement("article");
  card.className = "store-card";

  const title = document.createElement("h3");
  title.className = "store-title";
  title.textContent = group.storeName;

  const links = document.createElement("div");
  links.className = "store-links";

  for (const item of group.items.sort((a, b) => a.platform.localeCompare(b.platform, "ja"))) {
    const link = document.createElement("a");
    link.className = "store-link";
    link.href = item.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const platform = document.createElement("span");
    platform.className = "platform";
    platform.textContent = item.platform || "外部掲載";

    const status = document.createElement("span");
    status.className = "store-state";
    status.textContent = storeLabel(item);

    link.append(platform, status);
    links.append(link);
  }

  card.append(title, links);
  return card;
}

function storeLabel(item) {
  if (item.lastUpdatedLabel) return `${item.lastUpdatedLabel}更新`;
  if (item.latestInfoUpdatedLabel) return `${item.latestInfoUpdatedLabel}更新`;
  if (item.machineInfoUpdatedLabel) return `機種 ${item.machineInfoUpdatedLabel}`;
  if (item.status === "linkOnly") return "店舗ページあり";
  return "取得確認中";
}

function renderFooter() {
  const checkedItems = [
    ...state.officialArticles.map((item) => item.fetchedAt),
    ...state.operationStatus.map((item) => item.checkedAt),
    ...state.storeStatus.map((item) => item.checkedAt)
  ].filter(Boolean);

  const latest = checkedItems.sort().at(-1);
  $("#last-updated").textContent = latest ? `最終確認: ${formatDateTime(latest)}` : "最終確認: 未取得";
}

function renderLoadError(error) {
  $("#operation-list").replaceChildren(empty("データの読み込みに失敗しました。時間をおいて再度確認してください。"));
  $("#official-list").replaceChildren(empty("公式HP記事を読み込めませんでした。"));
  $("#store-list").replaceChildren(empty("遊技店舗情報を読み込めませんでした。"));
  $("#last-updated").textContent = error.message;
}

function operationTone(label = "") {
  if (/運休|欠航|停止|見合わせ/.test(label)) return "is-stop";
  if (/条件|注意|一部|遅れ|変更/.test(label)) return "is-alert";
  return "";
}

function latestCheckedAt(items) {
  const latest = items.map((item) => item.checkedAt).filter(Boolean).sort().at(-1);
  return latest ? formatDateTime(latest) : "確認日時未取得";
}

function compareDate(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function orderedOfficialSources(sources) {
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  const ordered = COMPACT_OFFICIAL_ORDER.map((sourceId) => byId.get(sourceId)).filter(Boolean);
  const orderedIds = new Set(COMPACT_OFFICIAL_ORDER);
  return ordered.concat(sources.filter((source) => !orderedIds.has(source.sourceId)));
}

function compactIcon(article, source) {
  if (source?.sourceId === "t-max-bowl" && source.listIcon) {
    return source.listIcon;
  }
  return article?.favicon || source?.favicon || DEFAULT_THUMB;
}

function formatDate(value) {
  if (!value) return "";
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

function normalizeStoreKey(value = "") {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/[　・ー-]/g, "")
    .replace(/店$/g, "")
    .replace(/奄美大島/g, "奄美")
    .trim();
}

function empty(message) {
  const element = document.createElement("p");
  element.className = "empty-message";
  element.textContent = message;
  return element;
}
