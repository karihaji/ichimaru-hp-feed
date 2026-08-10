# 市丸グループ 外部発信・更新情報パーツ

SharePoint社内広報ポータルに埋め込むための、GitHub Pagesベースの外部発信・更新情報パーツです。

## ページ

- `compact/` - SharePointトップページ埋め込み用の軽量表示
- `list/` - SharePoint別ページ埋め込み用の公式HP記事一覧

GitHub Pages公開後の想定URL:

- `https://karihaji.github.io/ichimaru-hp-feed/compact/`
- `https://karihaji.github.io/ichimaru-hp-feed/list/`

## ローカル確認

```bash
npm run serve
```

表示:

- `http://localhost:4173/compact/`
- `http://localhost:4173/list/`

## データ取得

```bash
npm run fetch
```

取得結果は `data/*.json` に保存されます。1サイトの取得に失敗しても全体処理は継続し、`data/fetch-log.json` に記録します。

公式HP由来のサイトアイコンを更新する場合:

```bash
npm run fetch:icons
```

## 運航情報JSON

運航情報には用途の異なる2種類のJSONがあります。

- `data/operation-status.json` - 既存の共有・表示用JSONです。取得側が選んだ代表状態を公開し、compact表示などの後方互換を維持します。
- `data/operation-status-publisher.json` - Xや将来のInstagramなど、自動配信処理が参照する投稿用JSONです。投稿可否の判断責任はこの生成側に集約します。

自動配信処理は `operation-status.json` の `statusChecks` を直接解釈せず、`operation-status-publisher.json` を参照してください。

### 投稿用JSONスキーマ

`data/operation-status-publisher.json` は配列です。各レコードは次のフィールドを持ちます。

| field | type | description |
| --- | --- | --- |
| `schemaVersion` | number | 現行は `1` |
| `sourceId` | string | 例: `ferry-yakusima2-operation` |
| `sourceName` | string | 表示名 |
| `targetDate` | string | `YYYY-MM-DD`。投稿可能時は `checkedAt` の日本時間日付と一致 |
| `checkedAt` | string | ISO 8601日時。日本時間で生成 |
| `statusLabel` | string | 取得した運航状態 |
| `normalizedStatus` | string | `NORMAL`, `CONDITIONAL`, `CANCELLED`, `OTHER_VALID`, `INVALID` |
| `publishable` | boolean | 自動投稿してよい場合だけ `true` |
| `publicationReason` | string | 投稿可否判断の理由 |
| `selectedSourceAuthority` | string | `official`, `fallback`, `none` |
| `statusMethod` | string | 採用候補の抽出方式 |
| `statusReason` | string | 取得側の判断理由 |
| `activeSource` | string | 共有JSON側のアクティブ情報源 |
| `generatedAt` | string | 投稿用JSON生成日時 |
| `statusSource` | string | 採用候補の参照元URL |
| `diagnostics` | object | primary/fallback試行の安全な診断要約 |

### 投稿可否の優先順位

優先1は当日の公式一次情報です。公式一次取得が成功し、`targetDate` が日本時間の当日で、`statusLabel` が `NORMAL`、`CONDITIONAL`、`CANCELLED`、`OTHER_VALID` のいずれかへ正規化できる場合、`publishable=true`、`selectedSourceAuthority=official` とします。

優先2は当日のfallback情報です。公式一次情報を同一workflow run内で3回試行しても投稿可能な候補を得られず、fallbackが当日・有効状態・有効時刻である場合のみ、`publishable=true`、`selectedSourceAuthority=fallback` とします。現在の推奨試行間隔は既存の `retryDelayMs=1200` ミリ秒で、GitHub Actionsの実行時間を過度に延ばさないため短めにしています。

前日以前の `cached-official` は、共有JSONでは代表状態として残る場合がありますが、投稿用JSONでは当日情報として扱いません。`publishable=false`、`selectedSourceAuthority=none`、`normalizedStatus=INVALID` とし、`targetDate` を当日に書き換えません。

`publishable=false` は、自動配信処理が外部投稿を行わず安全停止すべき状態です。「確認中」などの代替投稿は生成しません。既存の `data/operation-status.json` は後方互換のため、構造・URL・代表状態の選択意味を維持します。

## GitHub Pages

GitHub Pagesは repository root を公開元にしてください。`.github/workflows/update-feed.yml` が1日4回データ取得を実行し、差分があれば `data/*.json` をコミットします。

自動更新時刻:

- 07:10 JST - 船関連の早朝発表後。コスモラインは公式ページに「当日の運航状況は朝7時に発表」と記載あり
- 10:00 JST - 朝の確認
- 12:00 JST - 昼の確認
- 15:00 JST - 業務時間内の午後確認

GitHub Actions の cron はUTC指定のため、ワークフロー内ではそれぞれ `22:10`, `01:00`, `03:00`, `06:00` UTC として設定しています。
