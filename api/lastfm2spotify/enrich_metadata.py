#!/usr/bin/env python3
"""ordered.json (Last.fm 再生順) をメタデータ充実 jsonl DB と XML に変換する。

- track number は持たない（順序はファイル内の並び=再生順で表現）
- 各レコード: artist, title, album, utc_ts に加えて
  iso (ISO8601 UTC), jst (日本時間), weekday (JST曜日), duration_min (再生間隔の推定)

出力: ordered.jsonl / ordered.xml（スクリプトと同じディレクトリ）
使い方: python3 enrich_metadata.py
"""
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

HERE = Path(__file__).parent
IN = HERE / "ordered.json"
OUT_JSONL = HERE / "ordered.jsonl"
OUT_XML = HERE / "ordered.xml"

JST = timezone(timedelta(hours=9))
WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"]

def enrich(tracks):
    out = []
    for i, t in enumerate(tracks):
        utc = datetime.fromtimestamp(t["utc_ts"], timezone.utc)
        jst = utc.astimezone(JST)
        rec = {
            "artist": t["artist"],
            "title": t["title"],
            "album": t.get("album", ""),
            "utc_ts": t["utc_ts"],
            "iso": utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "jst": jst.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
            "weekday": WEEKDAYS[jst.weekday()],
        }
        # 再生間隔（次の曲との差、分）— 最後は None
        if i + 1 < len(tracks):
            rec["interval_min"] = round((tracks[i + 1]["utc_ts"] - t["utc_ts"]) / 60, 1)
        else:
            rec["interval_min"] = None
        out.append(rec)
    return out

def to_xml(recs):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<playlist order=\"chronological\">"]
    for r in recs:
        lines.append("  <track>")
        for k in ["artist", "title", "album"]:
            lines.append(f"    <{k}>{xml_esc(r[k])}</{k}>")
        lines.append(f"    <played utc=\"{r['utc_ts']}\" iso=\"{r['iso']}\" jst=\"{r['jst']}\" weekday=\"{r['weekday']}\" interval_min=\"{r['interval_min']}\"/>")
        lines.append("  </track>")
    lines.append("</playlist>")
    return "\n".join(lines) + "\n"

def xml_esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))

def main():
    tracks = json.load(open(IN))
    recs = enrich(tracks)

    with open(OUT_JSONL, "w") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(OUT_XML, "w") as f:
        f.write(to_xml(recs))

    print(f"records: {len(recs)}")
    print(f"jsonl: {OUT_JSONL} ({OUT_JSONL.stat().st_size} bytes)")
    print(f"xml:   {OUT_XML} ({OUT_XML.stat().st_size} bytes)")
    print("sample:")
    for r in recs[:2]:
        print(" ", json.dumps(r, ensure_ascii=False))

if __name__ == "__main__":
    main()
