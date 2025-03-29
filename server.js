const WebSocket = require('ws');
const http = require('http');
const { WebcastPushConnection } = require('tiktok-live-connector');

// Create HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TikTok Live WebSocket Server Running');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Active connections
const activeConnections = new Map();

// Custom connection wrapper for improved error handling
class EnhancedTikTokConnection {
    constructor(options) {
        this.options = options;
        this.connection = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.eventHandlers = {};
    }
    
    async connect() {
        try {
            // Create a new connection
            this.connection = new WebcastPushConnection(this.options);
            
            // Connect and register any event handlers
            await this.connection.connect();
            
            // Re-register any event handlers
            Object.keys(this.eventHandlers).forEach(event => {
                this.eventHandlers[event].forEach(handler => {
                    this.connection.on(event, handler);
                });
            });
            
            return this.connection;
        } catch (error) {
            console.error(`Connection error (attempt ${this.retryCount + 1}/${this.maxRetries}):`, error.message);
            
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`Retrying connection in ${this.retryCount * 2} seconds...`);
                
                return new Promise((resolve, reject) => {
                    setTimeout(async () => {
                        try {
                            const result = await this.connect();
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        }
                    }, this.retryCount * 2000);
                });
            }
            
            throw error;
        }
    }
    
    on(event, callback) {
        // Store the handler for reconnection purposes
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(callback);
        
        // Register with the current connection if it exists
        if (this.connection) {
            this.connection.on(event, callback);
        }
    }
    
    disconnect() {
        if (this.connection) {
            try {
                this.connection.disconnect();
            } catch (error) {
                console.error('Error disconnecting:', error);
            }
            this.connection = null;
        }
    }
}

wss.on('connection', async (ws, req) => {
    console.log('New connection received');
    
    // Parse URL parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    let username = url.searchParams.get('username');
    
    if (!username) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Username parameter is required'
        }));
        ws.close();
        return;
    }
    
    username = username.replace('@', '');
    console.log(`Connecting to @${username}'s livestream...`);
    
    ws.send(JSON.stringify({
        type: 'status',
        message: `Connecting to @${username}'s livestream...`
    }));
    
    // Get authentication parameters from headers
    const authHeaders = {};
    Object.keys(req.headers).forEach(key => {
        if (key.toLowerCase().startsWith('x-tiktok-')) {
            const cookieName = key.toLowerCase().replace('x-tiktok-', '');
            authHeaders[cookieName] = req.headers[key];
        }
    });
    
    // Setup connection options
    const connectionOptions = {
        processInitialData: true,
        enableExtendedGiftInfo: true,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 2000,
        clientParams: {
            "app_language": "en-US",
            "device_platform": "web",
            "browser_name": "Mozilla",
            "browser_version": "5.0",
            "cookie_enabled": true,
            "screen_width": 1920,
            "screen_height": 1080
        }
    };
    
    // Add any authentication cookies if provided
    if (authHeaders.sessionid || authHeaders['sid_tt']) {
        console.log('Using authenticated connection with provided cookies');
        connectionOptions.sessionId = authHeaders.sessionid || authHeaders['sid_tt'];
        
        if (authHeaders['tt_csrf_token']) {
            connectionOptions.csrfToken = authHeaders['tt_csrf_token'];
        }
    }
    
    // Create TikTok connection
    const tiktokConnection = new EnhancedTikTokConnection({
        ...connectionOptions,
        uniqueId: username
    });
    
    try {
        await tiktokConnection.connect();
        console.log(`Connected to @${username}'s livestream!`);
        
        // Store the connection
        activeConnections.set(ws, tiktokConnection);
        
        // Send success message
        ws.send(JSON.stringify({
            type: 'connected',
            message: `Connected to @${username}'s livestream!`
        }));
        
        // Forward all TikTok events
        tiktokConnection.on('chat', data => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'chat',
                    uniqueId: data.uniqueId,
                    comment: data.comment,
                    userId: data.userId
                }));
            }
        });
        
        tiktokConnection.on('gift', data => {
            if (ws.readyState === WebSocket.OPEN && data.repeatCount > 0) {
                ws.send(JSON.stringify({
                    type: 'gift',
                    uniqueId: data.uniqueId,
                    giftName: data.giftName,
                    repeatCount: data.repeatCount,
                    diamondCount: data.diamondCount
                }));
            }
        });
        
        tiktokConnection.on('roomUser', data => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'viewerCount',
                    viewerCount: data.viewerCount
                }));
            }
        });
        
        tiktokConnection.on('streamEnd', () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'streamEnd',
                    message: 'Stream ended'
                }));
            }
            
            // Clean up
            tiktokConnection.disconnect();
            activeConnections.delete(ws);
            ws.close();
        });
        
        // Handle WebSocket close
        ws.on('close', () => {
            console.log(`Connection closed for ${username}`);
            
            // Clean up
            if (activeConnections.has(ws)) {
                const conn = activeConnections.get(ws);
                conn.disconnect();
                activeConnections.delete(ws);
            }
        });
        
        // Handle WebSocket errors
        ws.on('error', (error) => {
            console.error(`WebSocket error for ${username}:`, error);
            
            if (activeConnections.has(ws)) {
                const conn = activeConnections.get(ws);
                conn.disconnect();
                activeConnections.delete(ws);
            }
            
            ws.close();
        });
        
    } catch (error) {
        console.error(`Failed to connect to @${username}'s livestream:`, error.message);
        
        // Handle specific error scenarios
        let errorMessage = `Failed to connect: ${error.message}`;
        
        if (error.message.includes('LIVEMONITORING_SIGN_URL_FAIL_CAUSE_CLOSED_LIVE')) {
            errorMessage = 'This user is not currently live streaming';
        } else if (error.message.includes('rate limit')) {
            errorMessage = 'TikTok rate limit reached - try again later';
        } else if (error.message.includes('User not found')) {
            errorMessage = 'TikTok user not found';
        } else if (error.message.includes('Login required')) {
            errorMessage = 'TikTok login required to view this stream';
        }
        
        // Send error message
        ws.send(JSON.stringify({
            type: 'error',
            message: errorMessage
        }));
        
        // Close the connection
        ws.close();
    }
});

// Handle errors
wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log(`WebSocket URL: ws://localhost:${PORT}`);
});
