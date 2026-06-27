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

## GitHub Pages

GitHub Pagesは repository root を公開元にしてください。`.github/workflows/update-feed.yml` が1日4回データ取得を実行し、差分があれば `data/*.json` をコミットします。

自動更新時刻:

- 07:10 JST - 船関連の早朝発表後。コスモラインは公式ページに「当日の運航状況は朝7時に発表」と記載あり
- 10:00 JST - 朝の確認
- 12:00 JST - 昼の確認
- 15:00 JST - 業務時間内の午後確認

GitHub Actions の cron はUTC指定のため、ワークフロー内ではそれぞれ `22:10`, `01:00`, `03:00`, `06:00` UTC として設定しています。
