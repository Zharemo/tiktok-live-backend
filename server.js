const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ConnectionWrapper = require('./connectionWrapper');
const RequestRateLimiter = require('./requestRateLimiter');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

let activeConnections = {};
let rateLimiter = new RequestRateLimiter();

app.get('/', (req, res) => {
  res.send('TikTok Live Server Running');
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Wait for client to send their TikTok username
  socket.on('setUniqueId', async (username) => {
    if (!username) return;

    console.log(`[${socket.id}] Connecting to TikTok user: ${username}`);

    const conn = new ConnectionWrapper(username);

    // Save connection to manage/disconnect later if needed
    activeConnections[socket.id] = conn;

    conn.on('event', (eventName, eventData) => {
      if (rateLimiter.shouldProcess(eventData)) {
        socket.emit(eventName, eventData);
      }
    });

    try {
      await conn.connect(username);
    } catch (err) {
      console.error(`Failed to connect to ${username}:`, err);
      socket.emit('error', { message: 'Failed to connect to live stream.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (activeConnections[socket.id]) {
      activeConnections[socket.id].disconnect?.();
      delete activeConnections[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
