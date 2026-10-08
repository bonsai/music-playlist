---
name: lastfm2spotify
description: Last.fm の再生履歴（recenttracks、タイムスタンプ順）を取得し、Spotify で検索マッチングしてプレイリスト順を作る。user=kanalsound。「lastfm」「再生履歴」「プレイリスト順」「scrobble 順」で発動。
---

# lastfm2spotify

Last.fm の再生順（タイムスタンプ順）を取得し、Spotify でマッチングする 2 段構成。

## 手順

```
cd ~/.agents/skills/lastfm2spotify

# 1) Last.fm から再生順リスト作成（古い順）→ ordered.json
python3 fetch_lastfm_order.py [件数=100]

# 2) メタデータ充実 jsonl DB + XML 生成（track number なし）
python3 enrich_metadata.py
#    → ordered.jsonl / ordered.xml

# (任意) Spotify 検索でマッチング → matched.json
python3 search_spotify.py        # 公式API（クォータ注意）
python3 search_spotify_free.py   # SpotipyFree 非公式API（429回避、要 hermes venv）
```

## 出力

- `ordered.json` — `[{artist, title, album, utc_ts}, ...]` 古い順（曲順の正）
- `ordered.jsonl` — 曲順を jsonl DB 化（track number なし）
  各レコード: artist, title, album, utc_ts, iso, jst, weekday, interval_min
- `ordered.xml` — 同上の XML 版（`<playlist order="chronological">`）
- `matched.json` — Spotify 検索結果とのマッチ

## 設定

- Last.fm API key: スクリプト内（user=kanalsound、**コミット禁止**）
- Spotify 認証: `~/.config/spotdl/config.json`

## 注意

- 出力パスはスクリプト自身のディレクトリ基準（`Path(__file__).parent`）。移動しても壊れない。
- 公式 API は共有アプリの日次クォータで 429 になるため、マッチングは
  `search_spotify_free.py`（SpotipyFree、hermes venv の python3 で実行）を推奨。
  曲順だけが要る場合は enrich_metadata.py までで十分。
