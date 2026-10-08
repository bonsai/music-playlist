# radiooooo-scrobbler

Radioooo（app.radiooooo.com）の再生を Last.fm に Now Playing / Scrobble として送る
Chrome 拡張（Manifest V3 + TypeScript、依存ゼロ）。

```
Radiooooo  ─┬─ fetch /track/play/<id>   ──> メタデータ（artist/title/album/length/cover）
            ├─ navigator.mediaSession    ──> メタデータ（album なし・title に "| US 2022" が付く）
            └─ <audio> element           ──> 再生位置・実再生時間

                        │  chrome.runtime.sendMessage
                        ▼
          service worker ── track.updateNowPlaying / track.scrobble
                        └─ chrome.storage.local: 認証情報 + 失敗時の再送キュー + 再生履歴
```

## 導入

### 1. Last.fm API key

<https://www.last.fm/api/account/create> で登録。**API key** と **Shared secret** を
取得します。

### 2. 設定ページで認証

```bash
npm install
npm run check          # typecheck + unit tests + build
npm run build:win      # → C:\Users\0501JP\radiooooo-scrobbler-dist
```

Chrome / Edge で `chrome://extensions` → 開発者モード → **dist フォルダーを読み込み**
（`build:win` 出力、または WSL 上の `dist`）。

設定ページの「API key」「Shared secret」を記入 → 「保存」→
「Last.fm で許可」→ 出てきたタブで承認 → 戻ってきたらセッションが結びます。
token が拾えなかったら「token」欄に貼り付けて「確定」。

### 3. 再生履歴の閲覧

「3. 再生履歴（ローカル JSONL）」で検出履歴を閲覧・絞り込み・
JSONL としてダウンロードできます。

## メタデータの取得は 3 段構え

| tier | 出所 | album | duration | 備考 |
| --- | --- | --- | --- | --- |
| `network` | MAIN world の `fetch`/`XMLHttpRequest` 横取り | ✅ | ✅ | `/track/play/<id>` などのレスポンス。`_id` も取れる |
| `media-session` | `navigator.mediaSession.metadata` | △ | ✅ | Radioooo が Web platform 上で明示 |
| `dom` | `.track-container` / `aside.now` | △ | ✅ | album が `.artist` に `— Album` と混ざる |

上位の tier が決定権を持ち、下位 tier は**空のフィールドだけ**を埋めます
（`mergeMeta`）。DOM 単独でも動くようにはなっていますが、album が落ちるので
`tier: dom` が常に出たら MAIN world bridge が死んでいる疑いがあります。

Radioooo の UI は `this.ui.artist.innerHTML += " — " + album` と組み立てるため、
DOM からは album を正しく分離できません。network tier が本命です。

## Scrobble 判定

Last.fm 仕様に合わせています。

- 30 秒以下の曲は scrobble しない
- 閾値 = `min(duration / 2, 240)` 秒（3 分曲 → 90 秒、8 分曲 → 240 秒）
- duration 不明時は 240 秒ルールにフォールバック

再生時間は wall clock ではなく**実際に鳴っていた時間を累積**します。pause 中は
加算されないので Chorus を聞かずに放置した場合は scrobble されません。

`chosenByUser=0` で送信します。Radiooooo はユーザの明示的な選択ではなく
年代・ムードからのレコメンド再生だからです。

## 再生履歴（JSONL）

検出した曲を 1 行 1 JSON で `chrome.storage.local` に溜めます。自動再生でも記録され、
10 件単位で保存（デフォルト 2000 件、上限調整可）されます。

```json
{"source":"radiooooo","tier":"network","artist":"Way Dynamic","track":"Not A Fan","album":"Not A Fan","duration":188,"started_at":"2026-10-06T09:30:00.000Z","listened_sec":188,"scrobbled":true}
```

「JSONL ダウンロード」で履歴全体を `radioooo-plays-YYYYMMDDHHmmss.jsonl` として
書き出します。

## キューと再送

`track.scrobble` が失敗した場合は `chrome.storage.local` に残り、1 分ごとの alarm
と次回起動時に 50 件ずつ再送します。`queueTtlMs`（既定 14 日）を超えた場合は捨てます。
認証エラー（Last.fm error 9 / 14）のように再送しても無駄なものはキューから抜いて
イベントログに残します。

## テスト

```bash
npm test          # md5 / scrobble ルール / メタデータ正規化（20 tests）
npm run smoke     # 実 Chromium に読み込み、実 Radiooooo で 1 周させる
```

`npm run smoke` はログイン不要の無料再生を使い、実 Radiooooo で `/track/play` を捕まえて
service worker まで届いているかを確認します。ネットワーク必須です。

## 構成

```
src/
├── manifest.json
├── shared/          # SW・content・UI 共通の純粋コード
│   ├── lastfm.ts        # API クライアント（md5 署名、write 系、getInfo）
│   ├── md5.ts           # crypto.subtle に無い MD5 の自前実装
│   ├── jsonl.ts         # 保存・export 用の JSONL 変換
│   ├── normalize.ts     # 3 段メタデータの正規化・統合
│   ├── scrobble.ts      # Scrobble 判定ルール（純関数）
│   └── types.ts
├── content/
│   ├── bridge.ts        # MAIN world。fetch/XHR を横取り
│   ├── detector.ts      # ISOLATED world。再生追従＋判定
│   └── token-sniffer.ts # last.fm 上の token 回収
├── background/service-worker.ts
└── ui/                 # popup / options
```

## 既知の制限

- 曲の artist / duration は Radiooooo の DB 依存。`album` が空の曲が
  `media-session` / `dom` に落ちると、album は送られません
- `country` は Radiooooo が `USA` / `AUS` の 3 文字コードで返すので、ISO 2 文字では
  ありません
- Last.fm の自動補正は Last.fm 側が自動適用を推奨していないため、`track.getInfo`
  は実装のみで UI には繋げていません。必要なら「候補を提示 → ユーザが承認 → 採用」
  のフローを足すこと
- Background service worker は idle 停止するため、現在の再生進捗は
  `chrome.storage.local` に 10 秒間隔で永続化されています
