#!/usr/bin/env python3
"""SpotipyFree(非公式API) で ordered.json の各曲を検索し URI を引当する。

公式 API が 429（共有アプリ日次クォータ枯渇）のときの代替。
認証不要の公開API (SpotAPI) 経由なのでクォータに影響されない。

出力: matched.json = ordered.json + {uri, matched} or {uri: null}
使い方: python3 search_spotify_free.py
"""
import json, time
from pathlib import Path

sys_path = "/home/sexy/.hermes/venv/lib/python3.12/site-packages"
import sys
if sys_path not in sys.path:
    sys.path.insert(0, sys_path)

from SpotipyFree import Spotify

IN = str(Path(__file__).parent / "ordered.json")
OUT = str(Path(__file__).parent / "matched.json")

sp = Spotify()
tracks = json.load(open(IN))
out, miss = [], []

def norm(s):
    return s.lower().replace("（", "(").replace("）", ")").replace("　", " ").strip()

for i, t in enumerate(tracks, 1):
    q = f"{t['artist']} {t['title']}"
    hit = None
    try:
        res = sp.search(q, type="track")
        items = res["tracks"]["items"]
        if items:
            hit = items[0]
    except Exception as e:
        print(f"  !! search error: {e}")

    if hit:
        t2 = dict(t, uri="spotify:track:" + hit["track_id"],
                  matched=f"{hit['artists'][0]['name']} - {hit['name']}")
    else:
        t2 = dict(t, uri=None, matched=None)
        miss.append(f"{t['artist']} - {t['title']}")
    out.append(t2)
    if i % 20 == 0 or not hit:
        print(f"[{i}/{len(tracks)}] {'OK ' if hit else 'MISS'} {t['artist']} - {t['title']}"
              + (f" -> {t2['matched']}" if hit else ""))
    time.sleep(0.1)

json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
ok = sum(1 for t in out if t["uri"])
print(f"\nmatched {ok}/{len(out)}")
if miss:
    print("missing:")
    for m in miss:
        print("  -", m)
