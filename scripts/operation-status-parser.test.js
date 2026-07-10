import assert from "node:assert/strict";
import test from "node:test";
import {
  extractOperationStatusCandidates,
  selectOperationStatus
} from "./operation-status-parser.js";

const checkedAt = "2026-07-10T09:10:18+09:00";

test("extracts Ferry Yakushima 2 status from the dedicated status label", () => {
  const html = `
    <figure class="p-status">
      <figcaption class="p-status__label">欠航</figcaption>
    </figure>
    <section class="p-top-bar">
      <div class="p-top-bar__title">運行状況</div>
      <a class="p-top-bar__content">
        <div class="p-top-bar__content-text">
          <time class="js-today-text" datetime="2024-03-27T00:00:00"></time>は 欠航 です。
        </div>
      </a>
    </section>
    <p>欠航証明書など各種証明書は窓口で発行できます。</p>
  `;

  const selected = selectOperationStatus(extractOperationStatusCandidates(html, {
    checkedAt,
    sourceUrl: "https://ferryyakusima2.com/"
  }));

  assert.equal(selected.statusLabel, "欠航");
  assert.equal(selected.targetDate, "2026-07-10");
  assert.equal(selected.statusMethod, "status-label");
});

test("prefers today's dated operation line over later scheduled cancellations", () => {
  const html = `
    <h1>運航情報</h1>
    <ul>
      <li>7/10 条件付運航</li>
      <li>7/11 通常運航予定</li>
      <li>7/12 運休</li>
    </ul>
    <h2>条件付出港とは</h2>
    <p>条件付出港の場合、引き返した場合は欠航となります。</p>
  `;

  const selected = selectOperationStatus(extractOperationStatusCandidates(html, {
    checkedAt,
    sourceUrl: "https://cosmoline.jp/ship-information"
  }));

  assert.equal(selected.statusLabel, "条件付運航");
  assert.equal(selected.targetDate, "2026-07-10");
});

test("extracts Ferry Yakushima 2 status from norimono-info target row only", () => {
  const html = `
    <table><tr>
      <td>鹿児島～奄美～沖縄/フェリーあけぼの</td>
      <td>2026年7月10日 欠航</td>
    </tr></table>
    <table><tr>
      <td>鹿児島（本港南ふ頭）～屋久島（宮之浦港）<br>（折田汽船（株））</td>
      <td>7月9日・10日のフェリー屋久島２は海上シケのため鹿児島⇔屋久島間 欠航いたします。</td>
    </tr></table>
  `;

  const selected = selectOperationStatus(extractOperationStatusCandidates(html, {
    checkedAt,
    sourceUrl: "http://www.norimono-info.com/area_main.php?disp=area&pref=kago&lang=",
    matchTerms: ["フェリー屋久島", "折田汽船", "鹿児島（本港南ふ頭）～屋久島"]
  }));

  assert.equal(selected.statusLabel, "欠航");
  assert.equal(selected.targetDate, "2026-07-10");
  assert.equal(selected.statusMethod, "matched-block");
  assert.match(selected.statusEvidence, /折田汽船/);
});

test("does not treat unrelated FAQ text as an operation status", () => {
  const html = `
    <h2>条件付出港とは</h2>
    <p>条件付出港の場合、引き返した場合は欠航となります。</p>
    <p>欠航証明書は窓口で発行できます。</p>
  `;

  const candidates = extractOperationStatusCandidates(html, {
    checkedAt,
    sourceUrl: "https://example.test/"
  });

  assert.equal(candidates.length, 0);
});
