const express = require('express');
const { WebcastPushConnection } = require('tiktok-live-connector');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  }
});

app.use(cors());
app.use(express.json());

let tiktokUsername = null;
let connection = null;

app.post('/connect', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  tiktokUsername = username;

  // Close previous connection if exists
  if (connection) {
    await connection.disconnect();
  }

  connection = new WebcastPushConnection(tiktokUsername);

  connection.on('streamEnd', () => {
    console.log('Stream ended');
    io.emit('streamEnd');
  });

  connection.on('chat', data => {
    console.log(`${data.uniqueId} > ${data.comment}`);
    io.emit('chat', {
      uniqueId: data.uniqueId,
      comment: data.comment,
    });
  });

  connection.on('gift', data => {
    console.log(`${data.uniqueId} sent gift: ${data.giftName} x${data.repeatCount}`);
    io.emit('gift', {
      uniqueId: data.uniqueId,
      giftName: data.giftName,
      repeatCount: data.repeatCount
    });
  });

  connection.on('like', data => {
    console.log(`${data.uniqueId} liked the stream (total: ${data.totalLikeCount})`);
    io.emit('like', {
      uniqueId: data.uniqueId,
      totalLikeCount: data.totalLikeCount
    });
  });

  connection.on('viewer', data => {
    io.emit('viewer', {
      viewerCount: data.viewerCount
    });
  });

  connection.on('join', data => {
    console.log(`${data.uniqueId} joined`);
    io.emit('join', {
      uniqueId: data.uniqueId
    });
  });

  connection.on('error', err => {
    console.error('Connection error:', err);
    io.emit('error', { message: 'Connection error', error: err });
  });

  try {
    await connection.connect();
    console.log(`Connected to ${tiktokUsername}'s livestream`);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to connect:', err);
    res.status(500).json({ error: 'Failed to connect to TikTok live' });
  }
});

app.post('/disconnect', async (req, res) => {
  if (connection) {
    await connection.disconnect();
    connection = null;
    tiktokUsername = null;
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'No active connection' });
  }
});

server.listen(3000, () => {
  console.log('Server listening on port 3000');
});
