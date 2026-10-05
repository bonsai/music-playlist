# music-playlist

Music research → JSONL → YouTube / Spotify playlists.

## Spotify CLI

The CLI separates **search**, **human candidate confirmation**, and **playlist creation**.

### 1. Configure Spotify app credentials

Create a Spotify Web API app and set:

```sh
export SPOTIFY_CLIENT_ID="..."
export SPOTIFY_CLIENT_SECRET="..."
```

Search uses the Client Credentials flow. Playlist creation requires a user access token:

```sh
export SPOTIFY_ACCESS_TOKEN="..."
```

The token must include `playlist-modify-public` for public playlists or `playlist-modify-private` for private playlists.

### 2. Search candidates

```sh
go run ./cmd/spotifypl search \
  --file georgia/1975.jsonl \
  --out spotify/candidates.jsonl
```

### 3. Confirm candidates

Interactive:

```sh
go run ./cmd/spotifypl confirm \
  --file spotify/candidates.jsonl \
  --out spotify/confirmed.jsonl
```

Or automatically accept only high-confidence matches:

```sh
go run ./cmd/spotifypl confirm --all
```

### 4. Create playlist

```sh
go run ./cmd/spotifypl create \
  --file spotify/confirmed.jsonl \
  --name "Georgia Prog 1975" \
  --public=false
```

The CLI never guesses a track silently: Spotify candidates are written to JSONL first, then explicitly confirmed before playlist creation.

## Data flow

```
research JSONL
    ↓
spotify search
    ↓
spotify/candidates.jsonl
    ↓
human confirmation
    ↓
spotify/confirmed.jsonl
    ↓
Spotify playlist
```


## Spotify API package

The reusable Go package is in `spotify/api.go`.

It exposes:

- `spotify.ClientCredentials()`
- `spotify.New(token)`
- `Client.SearchTracks()`
- `Client.CreatePlaylist()`
- `Client.AddItems()`

It uses Spotify's current Web API playlist endpoints: `POST /me/playlists` and `POST /playlists/{id}/items`.
