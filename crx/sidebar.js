// sidebar.js — WebSocket でプレイリスト更新をリアルタイム表示
let ws = null;

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//localhost:8000/ws/playlist`);

  ws.onopen = () => {
    console.log('Sidebar WS connected');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log('Sidebar WS msg:', msg);
    if (msg.type === 'tracks_appended') {
      // 新しいトラック追通知を表示
      showNotification(`新曲 ${msg.count} 曲 追加されました`);
    } else if (msg.type === 'tracks_updated') {
      console.log('Tracks file updated:', msg.file);
    }
  };

  ws.onclose = () => {
    console.log('Sidebar WS disconnected');
    setTimeout(connectWS, 3000);
  };

  ws.onerror = (err) => {
    console.log('Sidebar WS error:', err);
  };
}

function showNotification(msg) {
  // Simple notification - could use Chrome notifications API
  const existing = document.getElementById('last-notif');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'last-notif';
  div.style = 'position: fixed; bottom: 20px; right: 20px; background: #4caf50; color: white; padding: 10px 20px; border-radius: 6px; z-index: 9999; font-size: 0.9rem;';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

// Connect on load
connectWS();