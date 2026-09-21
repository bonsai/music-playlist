#!/usr/bin/env python3
"""Last.fm user.getrecenttracks から再生順（タイムスタンプ順）のリストを作る。

出力: ordered.json  = [{artist, title, album, utc_ts}, ...] 古い順
使い方: python3 fetch_lastfm_order.py [件数=100]
"""
import json, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = "37846a2e6f380ab917b4f51e09a8f8bd"  # user=kanalsound (コミット禁止)
USER = "kanalsound"
OUT = str(Path(__file__).parent / "ordered.json")

def fetch_page(limit=200, page=1):
    q = urllib.parse.urlencode({
        "method": "user.getrecenttracks", "user": USER, "api_key": API_KEY,
        "format": "json", "limit": limit, "page": page, "extended": "0",
    })
    url = f"https://ws.audioscrobbler.com/2.0/?{q}"
    return json.loads(urllib.request.urlopen(url, timeout=20).read())["recenttracks"]

def main():
    want = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    got, page = [], 1
    while len(got) < want:
        rt = fetch_page(200, page)
        tracks = rt["track"]
        if isinstance(tracks, dict):
            tracks = [tracks]
        for t in tracks:
            # now-playing はタイムスタンプ無し → 未完了なので除外
            d = t.get("date")
            if not d:
                continue
            got.append({
                "artist": t["artist"]["#text"],
                "title": t["name"],
                "album": t.get("album", {}).get("#text", ""),
                "utc_ts": int(d["uts"]),
            })
        total = int(rt["@attr"]["totalPages"])
        if page >= total:
            break
        page += 1
        time.sleep(0.3)

    got = got[:want]              # 新しい順で入ってる
    got.reverse()                 # 古い順 = 実際に聴いた順

    # 直前と完全同一の連続重複（二重スクロブル）だけ潰す。意図的なリピートは残す。
    dedup = []
    for t in got:
        if dedup and dedup[-1]["artist"] == t["artist"] and dedup[-1]["title"] == t["title"]:
            continue
        dedup.append(t)

    json.dump(dedup, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(f"fetched={len(got)} deduped={len(dedup)} -> {OUT}")
    for i, t in enumerate(dedup[:5], 1):
        ts = datetime.fromtimestamp(t["utc_ts"], timezone.utc).strftime("%m-%d %H:%M")
        print(f"  {i:3d}. [{ts} UTC] {t['artist']} - {t['title']}")
    print("  ...")
    for i, t in enumerate(dedup[-3:], len(dedup) - 2):
        ts = datetime.fromtimestamp(t["utc_ts"], timezone.utc).strftime("%m-%d %H:%M")
        print(f"  {i:3d}. [{ts} UTC] {t['artist']} - {t['title']}")

if __name__ == "__main__":
    main()
