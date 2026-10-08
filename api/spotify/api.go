package spotify

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	APIBase = "https://api.spotify.com/v1"
	AccountsURL = "https://accounts.spotify.com/api/token"
)

type Client struct {
	Token string
	HTTP  *http.Client
}

type Track struct {
	ID     string
	Name   string
	Artist string
	URI    string
	URL    string
}

type Playlist struct {
	ID  string
	URI string
	URL string
}

func New(token string) *Client {
	return &Client{Token: token, HTTP: &http.Client{Timeout: 30 * time.Second}}
}

func ClientCredentials(clientID, clientSecret string) (string, error) {
	if clientID == "" || clientSecret == "" {
		return "", errors.New("spotify client credentials are required")
	}
	form := url.Values{"grant_type": {"client_credentials"}}
	req, err := http.NewRequest("POST", AccountsURL, strings.NewReader(form.Encode()))
	if err != nil { return "", err }
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(clientID+":"+clientSecret)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil { return "", err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 { return "", fmt.Errorf("spotify token: %s: %s", resp.Status, body) }

	var v struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &v); err != nil { return "", err }
	return v.AccessToken, nil
}

func (c *Client) do(method, path string, payload any) ([]byte, error) {
	var r io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil { return nil, err }
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, APIBase+path, r)
	if err != nil { return nil, err }
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if payload != nil { req.Header.Set("Content-Type", "application/json") }

	resp, err := c.HTTP.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("spotify API %s: %s: %s", resp.Status, path, body)
	}
	return body, nil
}

func (c *Client) SearchTracks(query string, limit int) ([]Track, error) {
	if limit < 1 { limit = 5 }
	if limit > 10 { limit = 10 }

	q := url.Values{
		"q": {query},
		"type": {"track"},
		"limit": {strconv.Itoa(limit)},
	}
	body, err := c.do("GET", "/search?"+q.Encode(), nil)
	if err != nil { return nil, err }

	var v struct {
		Tracks struct {
			Items []struct {
				ID string `json:"id"`
				Name string `json:"name"`
				URI string `json:"uri"`
				Artists []struct {
					Name string `json:"name"`
				} `json:"artists"`
				ExternalURLs map[string]string `json:"external_urls"`
			} `json:"items"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(body, &v); err != nil { return nil, err }

	out := make([]Track, 0, len(v.Tracks.Items))
	for _, t := range v.Tracks.Items {
		artist := ""
		if len(t.Artists) > 0 { artist = t.Artists[0].Name }
		out = append(out, Track{
			ID: t.ID, Name: t.Name, Artist: artist,
			URI: t.URI, URL: t.ExternalURLs["spotify"],
		})
	}
	return out, nil
}

func (c *Client) CreatePlaylist(name, description string, public bool) (Playlist, error) {
	body, err := c.do("POST", "/me/playlists", map[string]any{
		"name": name, "description": description, "public": public,
	})
	if err != nil { return Playlist{}, err }

	var v struct {
		ID string `json:"id"`
		URI string `json:"uri"`
		ExternalURLs map[string]string `json:"external_urls"`
	}
	if err := json.Unmarshal(body, &v); err != nil { return Playlist{}, err }
	return Playlist{ID: v.ID, URI: v.URI, URL: v.ExternalURLs["spotify"]}, nil
}

func (c *Client) AddItems(playlistID string, uris []string) error {
	if playlistID == "" { return errors.New("playlist ID is required") }

	for len(uris) > 0 {
		n := 100
		if len(uris) < n { n = len(uris) }
		if _, err := c.do("POST", "/playlists/"+url.PathEscape(playlistID)+"/items",
			map[string]any{"uris": uris[:n]}); err != nil {
			return err
		}
		uris = uris[n:]
	}
	return nil
}
