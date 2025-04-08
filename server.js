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

const streamerId = process.env.TIKTOK_USERNAME || 'example_username';

let connection = new ConnectionWrapper(streamerId, {
  enableExtendedGiftInfo: true,
  processInitialData: true,
  requestPollingIntervalMs: 1000,
  clientParams: {
    app_language: "en-US",
    device_platform: "web",
    referer: "https://www.tiktok.com/",
  },
});

let rateLimiter = new RequestRateLimiter();

app.get('/', (req, res) => {
  res.send('TikTok Live Server Running');
});

io.on('connection', (socket) => {
  console.log('Client connected');

  // When a client wants to set uniqueId dynamically
  socket.on('setUniqueId', async (uniqueId) => {
    console.log(`Setting up connection for ${uniqueId}`);
    await connection.connect(uniqueId);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

connection.on('event', (eventName, eventData) => {
  // Optional: throttle/frequency limit using your limiter
  if (rateLimiter.shouldProcess(eventData)) {
    io.emit(eventName, eventData);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
