package youtube

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const APIBase = "https://www.googleapis.com/youtube/v3"

type Client struct {
	APIKey string
	Token  string
	HTTP   *http.Client
}

type Video struct {
	ID        string
	Title     string
	Channel   string
	URL       string
	Thumbnail string
}

type Playlist struct {
	ID  string
	URL string
}

func New(apiKey, token string) *Client {
	return &Client{APIKey: apiKey, Token: token, HTTP: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) request(method, path string, payload any) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil { return nil, err }
		body = bytes.NewReader(b)
	}
	u := APIBase + path
	sep := "?"
	if strings.Contains(u, "?") { sep = "&" }
	if c.APIKey != "" { u += sep + "key=" + url.QueryEscape(c.APIKey) }

	req, err := http.NewRequest(method, u, body)
	if err != nil { return nil, err }
	if c.Token != "" { req.Header.Set("Authorization", "Bearer "+c.Token) }
	if payload != nil { req.Header.Set("Content-Type", "application/json") }

	resp, err := c.HTTP.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("youtube API %s: %s", resp.Status, data)
	}
	return data, nil
}

func (c *Client) SearchVideos(query string, maxResults int) ([]Video, error) {
	if c.APIKey == "" { return nil, errors.New("YOUTUBE_API_KEY is required for search") }
	if maxResults < 1 { maxResults = 5 }
	if maxResults > 50 { maxResults = 50 }

	q := url.Values{
		"part": {"snippet"},
		"q": {query},
		"type": {"video"},
		"maxResults": {fmt.Sprint(maxResults)},
	}
	data, err := c.request("GET", "/search?"+q.Encode(), nil)
	if err != nil { return nil, err }

	var v struct {
		Items []struct {
			ID struct { VideoID string `json:"videoId"` } `json:"id"`
			Snippet struct {
				Title string `json:"title"`
				ChannelTitle string `json:"channelTitle"`
				Thumbnails struct {
					High struct { URL string `json:"url"` } `json:"high"`
				} `json:"thumbnails"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.Unmarshal(data, &v); err != nil { return nil, err }

	out := make([]Video, 0, len(v.Items))
	for _, item := range v.Items {
		out = append(out, Video{
			ID: item.ID.VideoID,
			Title: item.Snippet.Title,
			Channel: item.Snippet.ChannelTitle,
			URL: "https://www.youtube.com/watch?v=" + item.ID.VideoID,
			Thumbnail: item.Snippet.Thumbnails.High.URL,
		})
	}
	return out, nil
}

func (c *Client) CreatePlaylist(title, description, privacy string) (Playlist, error) {
	if c.Token == "" { return Playlist{}, errors.New("OAuth access token is required") }
	if privacy != "public" && privacy != "private" && privacy != "unlisted" {
		return Playlist{}, errors.New("privacy must be public, private, or unlisted")
	}

	data, err := c.request("POST", "/playlists?part=snippet,status", map[string]any{
		"snippet": map[string]string{
			"title": title,
			"description": description,
		},
		"status": map[string]string{"privacyStatus": privacy},
	})
	if err != nil { return Playlist{}, err }

	var v struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &v); err != nil { return Playlist{}, err }
	return Playlist{
		ID: v.ID,
		URL: "https://www.youtube.com/playlist?list=" + v.ID,
	}, nil
}

func (c *Client) AddVideos(playlistID string, videoIDs []string) error {
	if c.Token == "" { return errors.New("OAuth access token is required") }
	if playlistID == "" { return errors.New("playlist ID is required") }

	for _, videoID := range videoIDs {
		if videoID == "" { continue }
		_, err := c.request("POST", "/playlistItems?part=snippet", map[string]any{
			"snippet": map[string]any{
				"playlistId": playlistID,
				"resourceId": map[string]string{
					"kind": "youtube#video",
					"videoId": videoID,
				},
			},
		})
		if err != nil { return err }
	}
	return nil
}

func (c *Client) ListPlaylistVideos(playlistID string) ([]Video, error) {
	q := url.Values{
		"part": {"snippet"},
		"playlistId": {playlistID},
		"maxResults": {"50"},
	}
	var out []Video
	for {
		data, err := c.request("GET", "/playlistItems?"+q.Encode(), nil)
		if err != nil { return nil, err }
		var v struct {
			NextPageToken string `json:"nextPageToken"`
			Items []struct {
				Snippet struct {
					Title string `json:"title"`
					ChannelTitle string `json:"channelTitle"`
					ResourceID struct { VideoID string `json:"videoId"` } `json:"resourceId"`
				} `json:"snippet"`
			} `json:"items"`
		}
		if err := json.Unmarshal(data, &v); err != nil { return nil, err }
		for _, item := range v.Items {
			out = append(out, Video{
				ID: item.Snippet.ResourceID.VideoID,
				Title: item.Snippet.Title,
				Channel: item.Snippet.ChannelTitle,
				URL: "https://www.youtube.com/watch?v=" + item.Snippet.ResourceID.VideoID,
			})
		}
		if v.NextPageToken == "" { break }
		q.Set("pageToken", v.NextPageToken)
	}
	return out, nil
}
