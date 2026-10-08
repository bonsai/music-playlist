// background.js — WebSocket connection to FastAPI server
let ws = null;

chrome.runtime.onInstalled.addListener(async () => {
  // Initial connection
  connectWS();
});

// Reconnect when network changes
chrome.networking.onNetworkChanged.addListener(connectWS);

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//localhost:8000/ws/playlist`);

  ws.onopen = () => {
    console.log('WS connected to FastAPI');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log('WS msg:', msg);
    // Handle type messages
    if (msg.type === 'tracks_updated') {
      console.log('Tracks updated:', msg.file);
    }
  };

  ws.onclose = () => {
    console.log('WS disconnected, reconnecting...');
    setTimeout(connectWS, 3000);
  };

  ws.onerror = (err) => {
    console.log('WS error:', err);
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'append_tracks' && ws) {
    ws.send(JSON.stringify({ lines: message.lines }));
    sendResponse({status: 'sent'});
  }
  return true;
});