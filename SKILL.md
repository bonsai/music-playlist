---
name: music-playlist
description: 音楽プレイリスト運用の統合スキル。Last.fm 再生履歴→Spotify マッチングで曲順作成（lastfm2spotify）、Spotify プレイリスト「0829LOFIてざわりNY」のローカル増分同期（spotdl/trickle）、auto-dj 60min 構成（12軸評価・状態機械選曲）。「プレイリスト」「lastfm」「再生履歴」「scrobble 順」「spotify 同期」「LOFIてざわり」「spotdl」「差分DL」「auto-dj」「DJセット」で発動。
---

# music-playlist — 音楽プレイリスト運用

3 つのサブ機能を持つ広範スキル。スクリプトは `music-playlist/lastfm2spotify/` に集約。

## 1. Last.fm 曲順 → メタデータ充実（lastfm2spotify）

```
cd ~/.agents/skills/music-playlist/lastfm2spotify

# 1) Last.fm から再生順リスト作成（古い順）→ ordered.json
python3 fetch_lastfm_order.py [件数=100]

# 2) メタデータ充実 jsonl DB + XML 生成（track number なし）
python3 enrich_metadata.py
#    → ordered.jsonl / ordered.xml

# (任意) Spotify 検索でマッチング → matched.json
python3 search_spotify.py        # 公式API（共有アプリは日次クォータで429になる）
python3 search_spotify_free.py   # SpotipyFree 非公式API（429回避、hermes venv の python3 で実行）
```

- 出力: `ordered.json`（曲順の正）/ `ordered.jsonl`（jsonl DB: iso/jst/weekday/interval_min）/ `ordered.xml`
- Last.fm API key はスクリプト内（user=kanalsound、**コミット禁止**）
- Spotify 認証: `~/.config/spotdl/config.json`

## 2. Spotify プレイリスト増分同期（spotify-sync）

対象: 「0829LOFIてざわりNY」https://open.spotify.com/playlist/6bFjKxrAskG62YN3SG2Qtv
出力先: `/mnt/c/Users/dance/Music/0829LOFIてざわりNY`（`NN - アーティスト - タイトル.mp3`）
- 共有アプリ 429（クォータ枯渇）時: embed スクレイプ → 差分 → 五月雨式DL → finalize → HTML再生成
- **spotdl のドイツ語バグ**: `ytmusic.py` が `YTMusic(language="de")` 固定だと shelf タイトルが
  「Titel」になり全曲 No results found。両方の spotdl（~/.local と ~/.hermes/venv）を
  `language="en"` にパッチ済み。アップグレードで再発注意。
- YTM で見つからない曲は yt-dlp 直接検索 → ffmpeg 320k mp3 + タグ付けのフォールバック（実績あり）

## 3. auto-dj 60min 構成（room/data/auto-dj/）

- 作業場: `~/room/data/auto-dj/0829LOFI/`（DB.md が正、JSON は中間生成物）
- 12軸つながり評価（TEMPO/KEY/ENERGY/TIMBRE/BRIGHTNESS/VOCAL + 巨視6軸）で趣向分析
- 状態機械（ムード状態を型に）で選曲・遷移・評価・選択
- 出力: `auto_dj_60min.m3u` + ffmpeg acrossfade でミックス mp3
