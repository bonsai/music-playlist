from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import json
import sqlite3
import urllib.parse
import urllib.request
from typing import List, Optional
from datetime import datetime
import asyncio
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

DATA_ROOT = Path("/home/bons/music-playlist/data")
DB_PATH = Path("/home/bons/music-playlist/webapp/music.db")
LMSTUDIO_API_URL = os.getenv("LMSTUDIO_API_URL", "http://localhost:1234/v1")
LMSTUDIO_BIN_PATH = os.getenv("LMSTUDIO_BIN_PATH", "/mnt/c/Users/0501JP/.lmstudio/bin/lms.exe")
LMSTUDIO_PROCESS = None

from contextlib import asynccontextmanager

# Import LM Studio bridge
import sys
sys.path.insert(0, str(Path(__file__).parent))
from lmstudio_bridge import bridge, register_lmstudio_routes

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_jsonl_to_db()
    import asyncio
    start_jsonl_watcher(asyncio.get_event_loop())
    yield

app = FastAPI(title="Music Playlist API", lifespan=lifespan)

# Register LM Studio routes after app is created
register_lmstudio_routes(app)

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT,
            artist_latin TEXT,
            title TEXT,
            year INTEGER,
            country TEXT,
            region TEXT,
            city TEXT,
            genres TEXT,
            tags TEXT,
            status TEXT,
            note TEXT,
            source TEXT,
            youtubeId TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def load_jsonl_to_db():
    init_db()
    conn = get_db()
    conn.execute("DELETE FROM tracks")
    for jsonl_file in DATA_ROOT.rglob("*.jsonl"):
        with open(jsonl_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        record = json.loads(line)
                        conn.execute("""
                            INSERT INTO tracks (artist, artist_latin, title, year, country, region, city, genres, tags, status, note, source, youtubeId)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            record.get("artist"),
                            record.get("artist_latin"),
                            record.get("title"),
                            record.get("year"),
                            record.get("country"),
                            record.get("region"),
                            record.get("city"),
                            json.dumps(record.get("genres", [])) if record.get("genres") else None,
                            json.dumps(record.get("tags", [])) if record.get("tags") else None,
                            record.get("status"),
                            record.get("note"),
                            record.get("source"),
                            record.get("youtubeId"),
                        ))
                    except json.JSONDecodeError:
                        pass
    conn.commit()
    conn.close()

# ============= WebSocket Manager =============

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        disconnected = []
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except Exception:
                disconnected.append(conn)
        for conn in disconnected:
            try:
                self.disconnect(conn)
            except Exception:
                pass

manager = ConnectionManager()

# JSONL file watcher — broadcasts when data changes
class JSONLHandler(FileSystemEventHandler):
    def __init__(self, loop):
        self.loop = loop

    def on_modified(self, event):
        if event.src_path.endswith(".jsonl"):
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({"type": "tracks_updated", "file": event.src_path}),
                self.loop,
            )

jsonl_observer = None
jsonl_loop = None

def start_jsonl_watcher(loop):
    global jsonl_observer, jsonl_loop
    jsonl_loop = loop
    event_handler = JSONLHandler(loop)
    jsonl_observer = Observer()
    jsonl_observer.schedule(event_handler, str(DATA_ROOT), recursive=True)
    jsonl_observer.start()

# ============= WebSocket endpoints =============

@app.websocket("/ws/playlist")
async def websocket_playlist(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue
            # CRX sends new track JSONL lines
            if msg.get("type") == "append_tracks" and msg.get("lines"):
                append_lines_to_jsonl(msg["lines"])
                await manager.broadcast({"type": "tracks_appended", "count": len(msg["lines"])})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

def append_lines_to_jsonl(lines):
    """Append JSONL lines to Japan file."""
    out_path = DATA_ROOT / "japan" / "tracks.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "a", encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")

# ============= DB-driven endpoints =============

@app.get("/api/tracks")
def get_tracks(
    q: Optional[str] = None,
    artist: Optional[str] = None,
    country: Optional[str] = None,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0
):
    conn = get_db()
    query = "SELECT * FROM tracks WHERE 1=1"
    params = []
    if q:
        query += " AND (artist LIKE ? OR title LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
    if artist:
        query += " AND artist LIKE ?"
        params.append(f"%{artist}%")
    if country:
        query += " AND country = ?"
        params.append(country)
    if year:
        query += " AND year = ?"
        params.append(year)
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/tracks/{track_id}")
def get_track(track_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return {"error": "Track not found"}

@app.get("/api/stats")
def get_stats():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
    countries = conn.execute("SELECT country, COUNT(*) as cnt FROM tracks GROUP BY country ORDER BY cnt DESC").fetchall()
    artists = conn.execute("SELECT artist, COUNT(*) as cnt FROM tracks GROUP BY artist ORDER BY cnt DESC LIMIT 20").fetchall()
    conn.close()
    return {
        "total_tracks": total,
        "countries": [dict(r) for r in countries],
        "top_artists": [dict(r) for r in artists]
    }

# ============= External API query endpoints (query-only, no full fetch) =============

@app.get("/api/search/lastfm")
def search_lastfm(artist: str, title: str, limit: int = 10):
    """Query Last.fm API for track info (search only, no bulk fetch)"""
    API_KEY = "37846a2e6f380ab917b4f51e09a8f8bd"
    q = urllib.parse.urlencode({
        "method": "track.search",
        "track": title,
        "artist": artist,
        "api_key": API_KEY,
        "format": "json",
        "limit": limit
    })
    url = f"https://ws.audioscrobbler.com/2.0/?{q}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        tracks = data.get("results", {}).get("trackmatches", {}).get("track", [])
        if isinstance(tracks, dict):
            tracks = [tracks]
        return {"source": "lastfm", "query": {"artist": artist, "title": title}, "results": tracks}
    except Exception as e:
        return {"source": "lastfm", "error": str(e)}

@app.get("/api/search/spotify")
def search_spotify(artist: str, title: str, limit: int = 10):
    """Query Spotify API (requires client credentials in env/config)"""
    import os
    import base64
    cid = os.getenv("SPOTIFY_CLIENT_ID")
    csec = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not cid or not csec:
        return {"source": "spotify", "error": "Spotify credentials not configured"}
    
    # Get app token
    token_url = "https://accounts.spotify.com/api/token"
    auth = base64.b64encode(f"{cid}:{csec}".encode()).decode()
    req = urllib.request.Request(
        token_url,
        data=b"grant_type=client_credentials",
        headers={"Authorization": f"Basic {auth}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            token_data = json.loads(resp.read())
        access_token = token_data["access_token"]
        
        # Search
        q = urllib.parse.urlencode({"q": f"artist:{artist} track:{title}", "type": "track", "limit": limit})
        search_url = f"https://api.spotify.com/v1/search?{q}"
        req = urllib.request.Request(search_url, headers={"Authorization": f"Bearer {access_token}"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        tracks = data.get("tracks", {}).get("items", [])
        return {"source": "spotify", "query": {"artist": artist, "title": title}, "results": tracks}
    except Exception as e:
        return {"source": "spotify", "error": str(e)}

@app.get("/api/search/youtube")
def search_youtube(artist: str, title: str, limit: int = 10):
    """Query YouTube Data API (requires API key in env)"""
    import os
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        return {"source": "youtube", "error": "YouTube API key not configured"}
    
    query = urllib.parse.quote(f"{artist} {title}")
    url = f"https://www.googleapis.com/youtube/v3/search?part=snippet&q={query}&type=video&maxResults={limit}&key={api_key}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        videos = data.get("items", [])
        return {"source": "youtube", "query": {"artist": artist, "title": title}, "results": videos}
    except Exception as e:
        return {"source": "youtube", "error": str(e)}

@app.get("/api/search/multi")
def search_multi(artist: str, title: str, sources: str = "lastfm,spotify,youtube", limit: int = 5):
    """Query multiple sources in parallel"""
    src_list = sources.split(",")
    results = {}
    
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    
    def fetch_lastfm():
        return search_lastfm(artist, title, limit)
    
    def fetch_spotify():
        return search_spotify(artist, title, limit)
    
    def fetch_youtube():
        return search_youtube(artist, title, limit)
    
    fetchers = {
        "lastfm": fetch_lastfm,
        "spotify": fetch_spotify,
        "youtube": fetch_youtube,
    }
    
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {src: executor.submit(fetchers[src]) for src in src_list if src in fetchers}
        for src, future in futures.items():
            results[src] = future.result()
    
    return {"query": {"artist": artist, "title": title}, "results": results}

# ============= Sidebar-optimized HTML =============

SIDEBAR_HTML = """
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Music Playlist Sidebar</title>
    <style>
        * { box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; padding: 8px; 
            background: #fafafa; 
            width: 360px;  /* sidebar width */
            height: 100vh;
            overflow-y: auto;
        }
        .header { 
            display: flex; justify-content: space-between; align-items: center;
            padding: 8px 0; border-bottom: 1px solid #eee; margin-bottom: 8px;
        }
        .header h1 { font-size: 1rem; color: #333; margin: 0; }
        .search-box { 
            width: 100%; padding: 8px 12px; 
            border: 1px solid #ddd; border-radius: 6px; 
            font-size: 0.85rem; outline: none;
            transition: border-color 0.2s;
        }
        .search-box:focus { border-color: #007bff; }
        .track { 
            background: white; padding: 10px; margin: 6px 0; 
            border-radius: 8px; border: 1px solid #eee;
            cursor: pointer; transition: all 0.2s;
        }
        .track:hover { border-color: #007bff; box-shadow: 0 2px 8px rgba(0,123,255,0.1); }
        .artist { font-size: 0.85rem; font-weight: 600; color: #007bff; margin-bottom: 2px; }
        .title { font-size: 0.85rem; color: #333; margin-bottom: 4px; }
        .meta { font-size: 0.7rem; color: #888; display: flex; gap: 8px; flex-wrap: wrap; }
        .genres { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 4px; }
        .genre { background: #e3f2fd; padding: 2px 6px; border-radius: 10px; font-size: 0.65rem; color: #1565c0; }
        .actions { display: flex; gap: 4px; margin-top: 6px; }
        .btn { 
            padding: 3px 8px; font-size: 0.65rem; 
            border: 1px solid #ddd; border-radius: 4px; 
            background: white; cursor: pointer;
            transition: all 0.2s;
        }
        .btn:hover { background: #f0f0f0; }
        .btn-primary { background: #007bff; color: white; border-color: #007bff; }
        .btn-primary:hover { background: #0056b3; }
        .btn-yt { color: #ff0000; border-color: #ff0000; }
        .btn-yt:hover { background: #fff0f0; }
        .btn-lfm { color: #d51007; border-color: #d51007; }
        .btn-lfm:hover { background: #fff0f0; }
        .btn-sp { color: #1db954; border-color: #1db954; }
        .btn-sp:hover { background: #f0fff4; }
        .empty { text-align: center; padding: 20px; color: #999; font-size: 0.8rem; }
        .loading { text-align: center; padding: 20px; color: #666; font-size: 0.8rem; }
        .stats-bar { 
            display: flex; gap: 8px; padding: 8px 0; 
            border-bottom: 1px solid #eee; margin-bottom: 8px;
            font-size: 0.7rem; color: #666;
        }
        .stat { background: white; padding: 4px 8px; border-radius: 4px; border: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎵 Music Playlist</h1>
    </div>
    <div class="stats-bar" id="statsBar"></div>
    <input type="text" class="search-box" id="search" placeholder="Search: artist, title, country..." autocomplete="off">
    <div id="tracks"></div>
    <script>
        let debounceTimer;
        
        async function loadStats() {
            try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                document.getElementById('statsBar').innerHTML = `
                    <span class="stat">🎵 ${data.total_tracks} tracks</span>
                    <span class="stat">🌍 ${data.countries.length} countries</span>
                `;
            } catch (e) {
                console.error('Stats load failed:', e);
            }
        }
        
        async function search() {
            const q = document.getElementById('search').value.trim();
            document.getElementById('tracks').innerHTML = '<div class="loading">Loading...</div>';
            
            const params = new URLSearchParams();
            if (q) params.append('q', q);
            params.append('limit', '30');
            
            try {
                const res = await fetch(`/api/tracks?${params}`);
                const tracks = await res.json();
                renderTracks(tracks);
            } catch (e) {
                document.getElementById('tracks').innerHTML = '<div class="empty">Error loading tracks</div>';
            }
        }
        
        function renderTracks(tracks) {
            if (!tracks.length) {
                document.getElementById('tracks').innerHTML = '<div class="empty">No tracks found</div>';
                return;
            }
            document.getElementById('tracks').innerHTML = tracks.map(t => `
                <div class="track" data-id="${t.id}">
                    <div class="artist">${escapeHtml(t.artist || '')}</div>
                    <div class="title">${escapeHtml(t.title || '')}</div>
                    <div class="meta">
                        ${t.year ? `<span>${t.year}</span>` : ''}
                        ${t.country ? `<span>${t.country}</span>` : ''}
                        ${t.region ? `<span>${t.region}</span>` : ''}
                    </div>
                    ${t.genres ? `<div class="genres">${JSON.parse(t.genres).map(g => `<span class="genre">${escapeHtml(g)}</span>`).join('')}</div>` : ''}
                    <div class="actions">
                        ${t.youtubeId ? `<button class="btn btn-yt" onclick="event.stopPropagation(); openYt('${t.youtubeId}')">YouTube</button>` : ''}
                        <button class="btn btn-lfm" onclick="event.stopPropagation(); searchExt('lastfm', '${escapeJs(t.artist)}', '${escapeJs(t.title)}')">Last.fm</button>
                        <button class="btn btn-sp" onclick="event.stopPropagation(); searchExt('spotify', '${escapeJs(t.artist)}', '${escapeJs(t.title)}')">Spotify</button>
                        <button class="btn btn-primary" onclick="event.stopPropagation(); openDetail(${t.id})">Details</button>
                    </div>
                </div>
            `).join('');
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        function escapeJs(text) {
            return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
        }
        
        function openYt(id) {
            window.open(`https://youtube.com/watch?v=${id}`, '_blank');
        }
        
        function searchExt(source, artist, title) {
            window.open(`/api/search/${source}?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`, '_blank');
        }
        
        function openDetail(id) {
            window.open(`/track/${id}`, '_blank');
        }
        
        document.getElementById('search').addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(search, 200);
        });
        
        loadStats();
        search();
    </script>
</body>
</html>
"""

@app.get("/playlist", response_class=HTMLResponse)
def playlist():
    html_path = Path(__file__).parent / "playlist.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))

@app.get("/sidebar", response_class=HTMLResponse)
def sidebar():
    return SIDEBAR_HTML

@app.get("/track/{track_id}", response_class=HTMLResponse)
def track_detail(track_id: int):
    track = get_track(track_id)
    if "error" in track:
        return HTMLResponse("<h1>Track not found</h1>", status_code=404)
    
    genres = json.loads(track.get("genres", "[]")) if track.get("genres") else []
    tags = json.loads(track.get("tags", "[]")) if track.get("tags") else []
    
    html = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{track.get('title')} - {track.get('artist')}</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #fafafa; }}
            .card {{ background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
            h1 {{ margin: 0 0 8px; font-size: 1.5rem; color: #333; }}
            .artist {{ color: #007bff; font-size: 1.1rem; margin-bottom: 16px; }}
            .meta {{ color: #666; font-size: 0.9rem; margin-bottom: 16px; }}
            .tags {{ display: flex; gap: 6px; flex-wrap: wrap; margin: 16px 0; }}
            .tag {{ background: #e3f2fd; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; color: #1565c0; }}
            .actions {{ display: flex; gap: 8px; margin-top: 16px; }}
            .btn {{ padding: 8px 16px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; text-decoration: none; display: inline-block; }}
            .btn-primary {{ background: #007bff; color: white; border: none; }}
            .btn-yt {{ background: #ff0000; color: white; border: none; }}
            .btn-lfm {{ background: #d51007; color: white; border: none; }}
            .btn-sp {{ background: #1db954; color: white; border: none; }}
            .source {{ margin-top: 16px; font-size: 0.8rem; color: #888; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>{track.get('title', '')}</h1>
            <div class="artist">{track.get('artist', '')}</div>
            <div class="meta">
                {f"Year: {track.get('year')}" if track.get('year') else ''}
                {f" | Country: {track.get('country')}" if track.get('country') else ''}
                {f" | Region: {track.get('region')}" if track.get('region') else ''}
                {f" | City: {track.get('city')}" if track.get('city') else ''}
            </div>
            {f'<div class="tags">{"".join(f"<span class=\"tag\">{g}</span>" for g in genres)}</div>' if genres else ''}
            {f'<div class="tags">{"".join(f"<span class=\"tag\">{t}</span>" for t in tags)}</div>' if tags else ''}
            {f'<div class="source">Source: {track.get("source")}</div>' if track.get('source') else ''}
            <div class="actions">
                {f'<a class="btn btn-yt" href="https://youtube.com/watch?v={track.get("youtubeId")}" target="_blank">Open YouTube</a>' if track.get('youtubeId') else ''}
                <a class="btn btn-lfm" href="/api/search/lastfm?artist={urllib.parse.quote(track.get('artist',''))}&title={urllib.parse.quote(track.get('title',''))}" target="_blank">Search Last.fm</a>
                <a class="btn btn-sp" href="/api/search/spotify?artist={urllib.parse.quote(track.get('artist',''))}&title={urllib.parse.quote(track.get('title',''))}" target="_blank">Search Spotify</a>
                <a class="btn btn-primary" href="/api/search/youtube?artist={urllib.parse.quote(track.get('artist',''))}&title={urllib.parse.quote(track.get('title',''))}" target="_blank">Search YouTube</a>
            </div>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(html)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)