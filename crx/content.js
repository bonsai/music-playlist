// Radiooooo.com トラック抽出
// player プロファイルから情報抽出
element.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const title = document.querySelector('.track-title, .song-title, .now-playing-title')?.textContent || '';
    const artist = document.querySelector('.track-artist, .song-artist, .now-playing-artist')?.textContent || '';
    const source = 'radiooooo';
    const country = 'Japan'; // or detect from UI
    const year = new Date().getFullYear();
    if (title && artist) {
      const jsonl = JSON.stringify({
        artist,
        artist_latin: artist.toLowerCase(),
        title,
        year,
        country,
        region: 'Japan',
        genres: ['Unknown'],
        tags: ['Radiooooo'],
        status: 'pending',
        youtubeId: '',
        source
      }) + '\n';
      // WebSocket で送信
      if (window.wsSocket) {
        window.wsSocket.send(JSON.stringify({type: 'append_tracks', lines: [jsonl]}));
      }
    }
  }
});