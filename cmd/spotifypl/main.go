package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Record struct {
	Artist       string   `json:"artist"`
	ArtistLatin  string   `json:"artist_latin"`
	Title        string   `json:"title"`
	Year         int      `json:"year"`
	RecordedYear int      `json:"recorded_year,omitempty"`
}

type Candidate struct {
	Index       int    `json:"index"`
	Artist      string `json:"artist"`
	Title       string `json:"title"`
	SpotifyID   string `json:"spotify_id"`
	SpotifyURI  string `json:"spotify_uri"`
	SpotifyURL  string `json:"spotify_url"`
	MatchedName string `json:"matched_name"`
	MatchedArtist string `json:"matched_artist"`
	Confidence  string `json:"confidence"`
	Confirmed   bool   `json:"confirmed"`
}

type tokenResponse struct { AccessToken string `json:"access_token"` }

type searchResponse struct {
	Tracks struct {
		Items []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Artists []struct {
				Name string `json:"name"`
			} `json:"artists"`
			ExternalURLs map[string]string `json:"external_urls"`
		} `json:"items"`
	} `json:"tracks"`
}

func usage() {
	fmt.Println("spotifypl search   --file georgia/1975.jsonl --out spotify/candidates.jsonl")
	fmt.Println("spotifypl confirm  --file spotify/candidates.jsonl --out spotify/confirmed.jsonl")
	fmt.Println("spotifypl create   --file spotify/confirmed.jsonl --name 'Georgia Prog 1975' [--public=false]")
	fmt.Println()
	fmt.Println("env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET for search; SPOTIFY_ACCESS_TOKEN for create")
}

func spotifyRequest(token, method, endpoint string, body []byte) ([]byte, int, error) {
	req, err := http.NewRequest(method, endpoint, bytes.NewReader(body))
	if err != nil { return nil, 0, err }
	req.Header.Set("Authorization", "Bearer "+token)
	if len(body) > 0 { req.Header.Set("Content-Type", "application/json") }
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil { return nil, 0, err }
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	return data, resp.StatusCode, err
}

func clientCredentialsToken() (string, error) {
	id, secret := os.Getenv("SPOTIFY_CLIENT_ID"), os.Getenv("SPOTIFY_CLIENT_SECRET")
	if id == "" || secret == "" { return "", errors.New("set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET") }
	form := url.Values{"grant_type": {"client_credentials"}}
	req, _ := http.NewRequest("POST", "https://accounts.spotify.com/api/token", strings.NewReader(form.Encode()))
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(id+":"+secret)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil { return "", err }
	defer resp.Body.Close()
	if resp.StatusCode >= 300 { b,_:=io.ReadAll(resp.Body); return "", fmt.Errorf("token: %s: %s", resp.Status, b) }
	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil { return "", err }
	return tr.AccessToken, nil
}

func readJSONL(path string, dst func([]byte) error) error {
	f, err := os.Open(path); if err != nil { return err }; defer f.Close()
	s := bufio.NewScanner(f); s.Buffer(make([]byte, 4096), 1024*1024)
	for s.Scan() { line:=bytes.TrimSpace(s.Bytes()); if len(line)>0 { if err:=dst(line); err!=nil{return err} } }
	return s.Err()
}

func writeJSONL(path string, rows []any) error {
	if err:=os.MkdirAll(filepathDir(path),0755); err!=nil{return err}
	f,err:=os.Create(path);if err!=nil{return err};defer f.Close()
	enc:=json.NewEncoder(f); for _,r:=range rows { if err:=enc.Encode(r);err!=nil{return err} }
	return nil
}

func filepathDir(p string) string {
	i:=strings.LastIndexAny(p, "/\\"); if i<0{return "."}; if i==0{return p[:1]}; return p[:i]
}

func searchCommand(args []string) error {
	fs:=flag.NewFlagSet("search",flag.ExitOnError)
	in:=fs.String("file","georgia/1975.jsonl","JSONL input")
	out:=fs.String("out","spotify/candidates.jsonl","JSONL output")
	limit:=fs.Int("limit",5,"candidates per record")
	fs.Parse(args)
	token:=os.Getenv("SPOTIFY_ACCESS_TOKEN")
	if token=="" { var err error; token,err=clientCredentialsToken(); if err!=nil{return err} }
	var records []Record
	if err:=readJSONL(*in,func(b []byte)error{var r Record; if err:=json.Unmarshal(b,&r);err!=nil{return err};records=append(records,r);return nil});err!=nil{return err}
	var rows []any
	for i,r:=range records {
		q:=r.ArtistLatin+" "+r.Title
		if q==" "+r.Title {q=r.Artist+" "+r.Title}
		u:="https://api.spotify.com/v1/search?"+url.Values{"q":{q},"type":{"track"},"limit":{strconv.Itoa(*limit)}}.Encode()
		data,status,err:=spotifyRequest(token,"GET",u,nil);if err!=nil{return err}
		if status>=300{return fmt.Errorf("search %q: %s",q,data)}
		var sr searchResponse;if err:=json.Unmarshal(data,&sr);err!=nil{return err}
		for j,t:=range sr.Tracks.Items {
			artist:="";if len(t.Artists)>0{artist=t.Artists[0].Name}
			conf:="low";if strings.EqualFold(artist,r.ArtistLatin)||strings.EqualFold(artist,r.Artist){conf="high"} else if strings.Contains(strings.ToLower(artist),strings.ToLower(r.ArtistLatin)){conf="medium"}
			rows=append(rows,Candidate{Index:i,Artist:r.ArtistLatin,Title:r.Title,SpotifyID:t.ID,SpotifyURI:"spotify:track:"+t.ID,SpotifyURL:t.ExternalURLs["spotify"],MatchedName:t.Name,MatchedArtist:artist,Confidence:conf})
			_ = j
		}
	}
	return writeJSONL(*out,rows)
}

func confirmCommand(args []string) error {
	fs:=flag.NewFlagSet("confirm",flag.ExitOnError)
	in:=fs.String("file","spotify/candidates.jsonl","candidates")
	out:=fs.String("out","spotify/confirmed.jsonl","confirmed")
	all:=fs.Bool("all",false,"confirm all candidates marked high")
	fs.Parse(args)
	var cs []Candidate
	if err:=readJSONL(*in,func(b []byte)error{var c Candidate;if err:=json.Unmarshal(b,&c);err!=nil{return err};cs=append(cs,c);return nil});err!=nil{return err}
	reader:=bufio.NewReader(os.Stdin)
	var confirmed []any
	for i:=0;i<len(cs);i++ {
		c:=cs[i]
		fmt.Printf("[%d] %s — %s  =>  %s — %s (%s)\n",i,c.Artist,c.Title,c.MatchedArtist,c.MatchedName,c.Confidence)
		ok:=*all&&c.Confidence=="high"
		if !ok { fmt.Print("  confirm? [y/N/q] "); s,_:=reader.ReadString('\n'); s=strings.TrimSpace(strings.ToLower(s)); if s=="q"{break};ok=s=="y" }
		if ok {c.Confirmed=true;confirmed=append(confirmed,c)}
	}
	return writeJSONL(*out,confirmed)
}

func createCommand(args []string) error {
	fs:=flag.NewFlagSet("create",flag.ExitOnError)
	in:=fs.String("file","spotify/confirmed.jsonl","confirmed candidates")
	name:=fs.String("name","Georgia Prog 1975","playlist name")
	public:=fs.Bool("public",false,"make public")
	description:=fs.String("description","Generated from bonsai/music-playlist research.","playlist description")
	fs.Parse(args)
	token:=os.Getenv("SPOTIFY_ACCESS_TOKEN");if token==""{return errors.New("set SPOTIFY_ACCESS_TOKEN for playlist creation")}
	var cs []Candidate
	if err:=readJSONL(*in,func(b []byte)error{var c Candidate;if err:=json.Unmarshal(b,&c);err!=nil{return err};if c.Confirmed{cs=append(cs,c)};return nil});err!=nil{return err}
	if len(cs)==0{return errors.New("no confirmed candidates")}
	payload,_:=json.Marshal(map[string]any{"name":*name,"public":*public,"description":*description})
	data,status,err:=spotifyRequest(token,"POST","https://api.spotify.com/v1/me/playlists",payload);if err!=nil{return err}
	if status>=300{return fmt.Errorf("create playlist: %s: %s",status,data)}
	var pl struct{ID string `json:"id"`;URL map[string]string `json:"external_urls"`}
	if err:=json.Unmarshal(data,&pl);err!=nil{return err}
	uris:=make([]string,0,len(cs));for _,c:=range cs{uris=append(uris,c.SpotifyURI)}
	body,_:=json.Marshal(map[string]any{"uris":uris})
	data,status,err=spotifyRequest(token,"POST","https://api.spotify.com/v1/playlists/"+pl.ID+"/items",body);if err!=nil{return err}
	if status>=300{return fmt.Errorf("add items: %s: %s",status,data)}
	fmt.Printf("created: %s\n",pl.URL["spotify"])
	return nil
}

func main() {
	if len(os.Args)<2{usage();return}
	var err error
	switch os.Args[1]{case "search":err=searchCommand(os.Args[2:]);case "confirm":err=confirmCommand(os.Args[2:]);case "create":err=createCommand(os.Args[2:]);default:usage();return}
	if err!=nil{fmt.Fprintln(os.Stderr,"error:",err);os.Exit(1)}
}
