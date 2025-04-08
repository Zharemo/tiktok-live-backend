const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { TikTokConnectionWrapper } = require('./utils/connectionWrapper');
const { clientBlocked } = require('./utils/rateLimiter');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active TikTok connections
const activeConnections = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`New client connected: ${socket.id}`);

  // Check if client is blocked by rate limiter
  if (clientBlocked(io, socket)) {
    socket.emit('error', 'Rate limit exceeded');
    socket.disconnect();
    return;
  }

  // Handle TikTok connection requests
  socket.on('connectToTikTok', async ({ username }) => {
    try {
      if (activeConnections.has(username)) {
        socket.emit('error', 'Connection already exists for this username');
        return;
      }

      const tiktokConnection = new TikTokConnectionWrapper(username);
      activeConnections.set(username, tiktokConnection);

      // Forward TikTok events to the client
      tiktokConnection.on('connected', (state) => {
        socket.emit('connected', state);
      });

      tiktokConnection.on('disconnected', (reason) => {
        socket.emit('disconnected', reason);
        activeConnections.delete(username);
      });

      tiktokConnection.on('error', (error) => {
        socket.emit('error', error);
      });

      // Forward TikTok events
      ['gift', 'chat', 'like', 'follow', 'share', 'join'].forEach(event => {
        tiktokConnection.on(event, (data) => {
          socket.emit(event, data);
        });
      });

      await tiktokConnection.connect();
    } catch (error) {
      logger.error('Error connecting to TikTok:', error);
      socket.emit('error', error.message);
    }
  });

  // Handle disconnection requests
  socket.on('disconnectFromTikTok', ({ username }) => {
    if (activeConnections.has(username)) {
      const connection = activeConnections.get(username);
      connection.disconnect();
      activeConnections.delete(username);
      socket.emit('disconnected', 'Client requested disconnect');
    }
  });

  // Handle client disconnection
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
    // Clean up any TikTok connections associated with this socket
    activeConnections.forEach((connection, username) => {
      connection.disconnect();
      activeConnections.delete(username);
    });
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
