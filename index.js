const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');
const logger = require('./utils/logger');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store active connections
const activeConnections = new Map();

io.on('connection', (socket) => {
  logger.info(`New client connected: ${socket.id}`);

  socket.on('setUniqueId', async (uniqueId) => {
    try {
      logger.info(`Setting up connection for: ${uniqueId}`);
      
      // If there's an existing connection, disconnect it
      if (activeConnections.has(socket.id)) {
        const oldConnection = activeConnections.get(socket.id);
        await oldConnection.disconnect();
      }

      // Create new connection
      const tiktokConnection = new WebcastPushConnection(uniqueId);
      
      // Store the connection
      activeConnections.set(socket.id, tiktokConnection);

      // Set up event handlers
      tiktokConnection.on('chat', (data) => {
        socket.emit('chat', data);
      });

      tiktokConnection.on('member', (data) => {
        socket.emit('member', data);
      });

      tiktokConnection.on('roomUser', (data) => {
        socket.emit('roomUser', data);
      });

      tiktokConnection.on('connected', (data) => {
        socket.emit('tiktokConnected', {
          isConnected: true,
          upgradedToWebsocket: true,
          roomId: data.roomId,
          roomInfo: data.roomInfo
        });
      });

      // Connect to TikTok
      await tiktokConnection.connect();
      
    } catch (error) {
      logger.error(`Error setting up connection: ${error.message}`);
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', async () => {
    logger.info(`Client disconnected: ${socket.id}`);
    if (activeConnections.has(socket.id)) {
      const connection = activeConnections.get(socket.id);
      await connection.disconnect();
      activeConnections.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
