import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const dataDir = path.join(repoRoot, "data");

const userAgent = [
  "ichimaru-hp-feed/0.1",
  "(GitHub Pages data updater; contact: https://github.com/karihaji/ichimaru-hp-feed)"
].join(" ");

export async function readJson(fileName, fallback = null) {
  try {
    const raw = await fs.readFile(path.join(dataDir, fileName), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

export async function writeJson(fileName, value) {
  await fs.mkdir(dataDir, { recursive: true });
  const output = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(path.join(dataDir, fileName), output, "utf8");
}

export function nowJst() {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+09:00`
  ].join("");
}

export function hash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

export function normalizeUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  url.hash = "";

  for (const key of Array.from(url.searchParams.keys())) {
    if (/^utm_/i.test(key) || ["fbclid", "gclid", "yclid", "msclkid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  const output = url.toString();
  return output.endsWith("/") ? output.slice(0, -1) : output;
}

export function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return "";
  }
}

export async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs || 18000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim();
    const encoding = options.encoding || charset || "utf-8";
    const text = decodeBuffer(buffer, encoding);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {
      text,
      buffer,
      contentType,
      finalUrl: response.url,
      status: response.status
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDecodedText(url, encodings = ["shift_jis", "cp932", "euc-jp", "utf-8"]) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  for (const encoding of encodings) {
    try {
      const text = decodeBuffer(buffer, encoding);
      if (!/�{2,}/.test(text)) {
        return {
          text,
          buffer,
          encoding,
          finalUrl: response.url,
          status: response.status
        };
      }
    } catch {
      // Try the next declared encoding.
    }
  }

  return {
    text: decodeBuffer(buffer, "utf-8"),
    buffer,
    encoding: "utf-8",
    finalUrl: response.url,
    status: response.status
  };
}

export function decodeBuffer(buffer, encoding) {
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

export function stripHtml(value = "") {
  return decodeHtml(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

export function extractAttr(tag = "", name) {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return decodeHtml(tag.match(pattern)?.[1] || "");
}

export function collectBlocks(html) {
  const blocks = [];
  const patterns = [
    /<article\b[\s\S]*?<\/article>/gi,
    /<li\b[\s\S]*?<\/li>/gi,
    /<div\b[^>]*(?:post|news|entry|article|information|topics|event)[^>]*>[\s\S]*?<\/div>/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (match[0].length < 12000) blocks.push(match[0]);
    }
  }

  return Array.from(new Set(blocks));
}

export function extractAnchors(html, baseUrl) {
  const anchors = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = extractAttr(match[1], "href");
    const url = absoluteUrl(href, baseUrl);
    const text = stripHtml(match[2]) || extractAttr(match[1], "title");
    if (url && text) {
      anchors.push({
        url,
        href,
        text,
        raw: match[0],
        index: match.index || 0
      });
    }
  }

  return anchors;
}

export function extractImage(html, baseUrl) {
  const match = html.match(/<img\b([^>]*)>/i);
  if (!match) return "";

  const src =
    extractAttr(match[1], "src") ||
    extractAttr(match[1], "data-src") ||
    extractAttr(match[1], "data-lazy-src");

  return absoluteUrl(src, baseUrl);
}

export function findDate(value = "") {
  const normalized = decodeHtml(value);
  const datetime = normalized.match(/datetime=["']([^"']+)["']/i)?.[1];
  if (datetime) {
    const date = toIsoDate(datetime);
    if (date) return date;
  }

  const patterns = [
    /20\d{2}[./-]\d{1,2}[./-]\d{1,2}/,
    /20\d{2}年\s*\d{1,2}月\s*\d{1,2}日/,
    /\d{1,2}月\s*\d{1,2}日/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const date = toIsoDate(match[0]);
      if (date) return date;
    }
  }

  return "";
}

export function toIsoDate(value = "") {
  const pad = (number) => String(number).padStart(2, "0");
  const text = String(value).trim();
  let match = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;

  match = text.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;

  match = text.match(/(\d{1,2})月\s*(\d{1,2})日/);
  if (match) {
    const year = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
    return `${year}-${pad(match[1])}-${pad(match[2])}`;
  }

  return "";
}

export function findFirstText(value = "", patterns) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return stripHtml(match[1]);
    if (match?.[0]) return stripHtml(match[0]);
  }
  return "";
}

export async function upsertFetchLogs(entries) {
  const existing = await readJson("fetch-log.json", []);
  const next = [...entries, ...existing];
  const seen = new Set();
  const deduped = [];

  for (const entry of next) {
    const key = [entry.scope || "", entry.source || "", entry.url || ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  await writeJson("fetch-log.json", deduped.slice(0, 300));
}
