const TikTokConnection = require('./tiktokConnection');
const logger = require('./logger');

class ConnectionWrapper {
  constructor() {
    this.connections = new Map();
    this.maxConnections = 10; // Maximum number of concurrent connections
  }

  async addConnection(username) {
    if (this.connections.size >= this.maxConnections) {
      logger.warn(`Maximum number of connections (${this.maxConnections}) reached`);
      return false;
    }

    if (this.connections.has(username)) {
      logger.warn(`Connection for ${username} already exists`);
      return false;
    }

    const connection = new TikTokConnection(username);
    const success = await connection.connect();

    if (success) {
      this.connections.set(username, connection);
      logger.info(`Added new connection for ${username}`);
      return true;
    }

    return false;
  }

  removeConnection(username) {
    if (this.connections.has(username)) {
      const connection = this.connections.get(username);
      connection.disconnect();
      this.connections.delete(username);
      logger.info(`Removed connection for ${username}`);
      return true;
    }
    return false;
  }

  getConnection(username) {
    return this.connections.get(username);
  }

  getAllConnections() {
    return Array.from(this.connections.entries());
  }

  getConnectionCount() {
    return this.connections.size;
  }

  clearAllConnections() {
    this.connections.forEach(connection => connection.disconnect());
    this.connections.clear();
    logger.info('Cleared all connections');
  }
}

module.exports = ConnectionWrapper;
