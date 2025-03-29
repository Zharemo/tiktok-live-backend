const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Status endpoint
app.get('/', (req, res) => {
  res.send('TikTok Live Backend Running');
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('New connection received');
  
  // Get parameters from URL
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const username = urlParams.get('username');
  const sessionId = urlParams.get('sessionid');
  const csrfToken = urlParams.get('tt_csrf_token');
  
  if (!username) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Username is required' 
    }));
    return;
  }
  
  console.log(`Connecting to @${username}'s livestream...`);
  
  // Setup connection options
  const connectionOptions = {
    uniqueId: username,
    processInitialData: true,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
    clientParams: {
      "app_language": "en-US",
      "device_platform": "web",
      "browser_name": "Mozilla",
      "browser_version": "5.0",
      "cookie_enabled": true,
      "screen_width": 1920,
      "screen_height": 1080
    }
  };

  // Add authentication if provided
  if (sessionId) {
    connectionOptions.sessionId = sessionId;
    if (csrfToken) {
      connectionOptions.csrfToken = csrfToken;
    }
  }
  
  // Connect to TikTok with options
  const tiktokLive = new WebcastPushConnection(connectionOptions);
  
  tiktokLive.connect().then(() => {
    console.log(`Connected to @${username}'s livestream!`);
    ws.send(JSON.stringify({ 
      type: 'connected',
      message: `Connected to @${username}'s livestream`
    }));
    
    // Forward chat messages
    tiktokLive.on('chat', data => {
      console.log(`Chat from ${data.uniqueId}: ${data.comment}`);
      ws.send(JSON.stringify({
        type: 'chat',
        uniqueId: data.uniqueId,
        comment: data.comment
      }));
    });
    
    // Forward stream end event
    tiktokLive.on('streamEnd', () => {
      ws.send(JSON.stringify({ type: 'streamEnd' }));
      tiktokLive.disconnect();
    });

    // Handle room data
    tiktokLive.on('roomInfo', data => {
      console.log('Room info received:', data);
      ws.send(JSON.stringify({
        type: 'roomInfo',
        data: data
      }));
    });
    
  }).catch(err => {
    console.error(`Failed to connect: ${err.message}`);
    
    // Handle specific error cases
    let errorMessage = err.message;
    if (err.message.includes('Failed to retrieve the initial room data')) {
      errorMessage = 'TikTok login required to view this stream';
    } else if (err.message.includes('User not found')) {
      errorMessage = 'TikTok user not found';
    } else if (err.message.includes('rate limit')) {
      errorMessage = 'TikTok rate limit reached - try again later';
    }
    
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: errorMessage
    }));
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log(`Connection closed for ${username}`);
    tiktokLive.disconnect();
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
