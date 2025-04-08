const { WebcastPushConnection } = require('tiktok-live-connector');
const logger = require('./logger');

class TikTokConnection {
  constructor(username) {
    this.username = username;
    this.connection = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.connection = new WebcastPushConnection(this.username);
      
      this.connection.on('connected', () => {
        this.isConnected = true;
        logger.info(`Connected to TikTok Live: ${this.username}`);
      });

      this.connection.on('disconnected', () => {
        this.isConnected = false;
        logger.info(`Disconnected from TikTok Live: ${this.username}`);
      });

      this.connection.on('error', (err) => {
        logger.error(`TikTok connection error for ${this.username}:`, err);
      });

      await this.connection.connect();
      return true;
    } catch (err) {
      logger.error(`Failed to connect to TikTok Live ${this.username}:`, err);
      return false;
    }
  }

  disconnect() {
    if (this.connection && this.isConnected) {
      this.connection.disconnect();
      this.isConnected = false;
    }
  }

  on(event, callback) {
    if (this.connection) {
      this.connection.on(event, callback);
    }
  }
}

module.exports = TikTokConnection;
