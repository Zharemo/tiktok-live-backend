const { WebcastPushConnection } = require('tiktok-live-connector');
const EventEmitter = require('events');

class ConnectionWrapper extends EventEmitter {
    constructor(username, options = {}) {
        super();
        this.username = username;
        this.options = {
            processInitialData: true,
            enableExtendedGiftInfo: false,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2000,
            requestHeaders: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            },
            clientParams: {
                "app_language": "en-US",
                "device_platform": "web",
                "browser_language": "en",
                "browser_platform": "web",
                "browser_name": "Mozilla",
                "browser_version": "5.0"
            },
            ...options
        };
        
        this.tiktokConnection = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    async connect() {
        try {
            this.tiktokConnection = new WebcastPushConnection(this.username, this.options);
            
            // Setup event handlers
            this.setupEventHandlers();
            
            // Connect to TikTok
            await this.tiktokConnection.connect();
            
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.emit('connected');
            
        } catch (error) {
            this.handleError(error);
        }
    }

    setupEventHandlers() {
        // Forward all TikTok events
        this.tiktokConnection.on('chat', (data) => this.emit('chat', data));
        this.tiktokConnection.on('gift', (data) => this.emit('gift', data));
        this.tiktokConnection.on('follow', (data) => this.emit('follow', data));
        this.tiktokConnection.on('subscribe', (data) => this.emit('subscribe', data));
        this.tiktokConnection.on('streamEnd', () => {
            this.isConnected = false;
            this.emit('streamEnd');
        });
        
        this.tiktokConnection.on('error', (error) => this.handleError(error));
    }

    handleError(error) {
        this.isConnected = false;
        
        if (error.message?.includes('InitialFetchError')) {
            this.emit('error', {
                message: error.message,
                retryAfter: error.retryAfter || 60,
                type: 'InitialFetchError'
            });
        } else {
            this.emit('error', {
                message: error.message,
                type: 'ConnectionError'
            });
        }

        // Attempt reconnection if appropriate
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), this.calculateReconnectDelay());
        }
    }

    calculateReconnectDelay() {
        return Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    }

    disconnect() {
        if (this.tiktokConnection) {
            this.tiktokConnection.disconnect();
            this.isConnected = false;
            this.emit('disconnected');
        }
    }
}

module.exports = ConnectionWrapper;
