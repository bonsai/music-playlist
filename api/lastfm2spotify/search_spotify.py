#!/usr/bin/env python3
"""ordered.json の各曲を Spotify で検索し、URI を引当する。

出力: matched.json = ordered.json + {uri, matched_name} or {uri: null}
使い方: python3 search_spotify.py
"""
import base64, json, time, urllib.parse, urllib.request
from pathlib import Path

CFG = "/home/sexy/.config/spotdl/config.json"
IN = str(Path(__file__).parent / "ordered.json")
OUT = str(Path(__file__).parent / "matched.json")

cfg = json.load(open(CFG))
cid, csec = cfg["client_id"], cfg["client_secret"]

def app_token():
    r = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=b"grant_type=client_credentials",
        headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{csec}".encode()).decode()},
    )
    return json.loads(urllib.request.urlopen(r, timeout=15).read())["access_token"]

def search(tok, artist, title):
    q = urllib.parse.urlencode({"q": f"artist:{artist} track:{title}", "type": "track", "limit": 3})
    req = urllib.request.Request(
        f"https://api.spotify.com/v1/search?{q}",
        headers={"Authorization": f"Bearer {tok}"},
    )
    try:
        items = json.loads(urllib.request.urlopen(req, timeout=15).read())["tracks"]["items"]
        return items[0] if items else None
    except Exception as e:
        print("  !! search error:", e)
        return None

tok = app_token()
tracks = json.load(open(IN))
out, miss = [], []
for i, t in enumerate(tracks, 1):
    hit = search(tok, t["artist"], t["title"])
    if not hit:  # フォールバック: 生クエリ
        q = urllib.parse.urlencode({"q": f"{t['artist']} {t['title']}", "type": "track", "limit": 1})
        req = urllib.request.Request(f"https://api.spotify.com/v1/search?{q}",
                                     headers={"Authorization": f"Bearer {tok}"})
        try:
            items = json.loads(urllib.request.urlopen(req, timeout=15).read())["tracks"]["items"]
            hit = items[0] if items else None
        except Exception:
            hit = None
    if hit:
        t2 = dict(t, uri=hit["uri"], matched=f"{hit['artists'][0]['name']} - {hit['name']}")
    else:
        t2 = dict(t, uri=None, matched=None)
        miss.append(f"{t['artist']} - {t['title']}")
    out.append(t2)
    if i % 20 == 0 or not hit:
        print(f"[{i}/{len(tracks)}] {'OK ' if hit else 'MISS'} {t['artist']} - {t['title']}"
              + (f" -> {t2['matched']}" if hit else ""))
    time.sleep(0.12)

json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
ok = sum(1 for t in out if t["uri"])
print(f"\nmatched {ok}/{len(out)}")
if miss:
    print("missing:")
    for m in miss:
        print("  -", m)
