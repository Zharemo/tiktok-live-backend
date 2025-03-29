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
  
  // Get username from URL parameters
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const username = urlParams.get('username');
  
  if (!username) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Username is required' 
    }));
    return;
  }
  
  console.log(`Connecting to @${username}'s livestream...`);
  
  // Connect to TikTok
  const tiktokLive = new WebcastPushConnection(username);
  
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
    
    // Forward gifts
    tiktokLive.on('gift', data => {
      ws.send(JSON.stringify({
        type: 'gift',
        uniqueId: data.uniqueId,
        giftName: data.giftName,
        diamondCount: data.diamondCount || 0
      }));
    });
    
    // Forward stream end event
    tiktokLive.on('streamEnd', () => {
      ws.send(JSON.stringify({ type: 'streamEnd' }));
      tiktokLive.disconnect();
    });
    
  }).catch(err => {
    console.error(`Failed to connect: ${err.message}`);
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: err.toString() 
    }));
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log(`Connection closed for ${username}`);
    tiktokLive.disconnect();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
