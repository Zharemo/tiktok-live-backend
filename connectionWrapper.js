const { WebcastPushConnection } = require('tiktok-live-connector');
const EventEmitter = require('events');

class ConnectionWrapper extends EventEmitter {
  constructor(username, options = {}) {
    super();
    this.connection = new WebcastPushConnection(username, options);
    this.username = username;
    this.eventNamesToListen = ['chat', 'gift', 'follow', 'like', 'share', 'subscribe', 'member', 'roomUser', 'tiktokConnected'];

    this.eventNamesToListen.forEach(event => {
      this.connection.on(event, (data) => {
        this.emit('event', event, data);
      });
    });

    this.connection.on('disconnected', () => {
      console.warn('Disconnected from TikTok live');
    });
  }

  async connect(username) {
    try {
      if (this.connection.isConnected()) {
        await this.connection.disconnect();
      }
      this.connection.username = username;
      await this.connection.connect();
      console.log(`Connected to ${username}`);
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  }
}

module.exports = ConnectionWrapper;
