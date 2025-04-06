const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Add reconnection tracking
const reconnectDelays = new Map(); // Track reconnection delays per username
const MAX_RETRY_DELAY = 3600; // Maximum delay of 1 hour
const BASE_RETRY_DELAY = 2; // Start with 2 second delay

// Store active connections and their retry counts
const connections = new Map();
const retryAttempts = new Map();

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Status endpoint
app.get('/', (req, res) => {
    res.json({ status: 'TikTok Live Backend Running' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Helper function to calculate exponential backoff
function calculateRetryDelay(username) {
    const attempts = retryAttempts.get(username) || 0;
    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, attempts), MAX_RETRY_DELAY);
    retryAttempts.set(username, attempts + 1);
    return delay;
}

// WebSocket connection handler
wss.on('connection', async (ws, req) => {
    console.log('New WebSocket connection received');
    
    // Parse URL parameters
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const username = urlParams.get('username');
    
    if (!username) {
        ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Username parameter is required' 
        }));
        ws.close();
        return;
    }

    // Clean username (remove @ if present)
    const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
    
    // Check if user is rate limited
    const currentTime = Date.now();
    const reconnectTime = reconnectDelays.get(cleanUsername);
    
    if (reconnectTime && currentTime < reconnectTime) {
        const retryAfter = Math.ceil((reconnectTime - currentTime) / 1000);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Rate limited. Please try again later.',
            retryAfter: retryAfter
        }));
        ws.close();
        return;
    }

    console.log(`Attempting to connect to @${cleanUsername}'s livestream...`);

    // Create TikTok connection with more robust options
    const tiktokLive = new WebcastPushConnection(cleanUsername, {
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
        }
    });

    try {
        await tiktokLive.connect();
        
        // Reset retry attempts on successful connection
        retryAttempts.delete(cleanUsername);
        reconnectDelays.delete(cleanUsername);
        
        console.log(`Connected to @${cleanUsername}'s livestream!`);
        ws.send(JSON.stringify({ 
            type: 'connected',
            message: `Connected to @${cleanUsername}'s livestream`
        }));

        // Store connection for cleanup
        connections.set(ws, tiktokLive);

        // Chat message handler
        tiktokLive.on('chat', data => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log(`${data.uniqueId}: ${data.comment}`);
                ws.send(JSON.stringify({
                    type: 'chat',
                    uniqueId: data.uniqueId,
                    comment: data.comment
                }));
            }
        });

        // Follow event handler
        tiktokLive.on('follow', data => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log(`New follower: ${data.uniqueId}`);
                ws.send(JSON.stringify({
                    type: 'follow',
                    uniqueId: data.uniqueId,
                    nickname: data.nickname || data.uniqueId
                }));
            }
        });

        // Gift handler
        tiktokLive.on('gift', data => {
            if (ws.readyState === WebSocket.OPEN && data.diamondCount > 0) {
                ws.send(JSON.stringify({
                    type: 'gift',
                    uniqueId: data.uniqueId,
                    giftName: data.giftName,
                    repeatCount: data.repeatCount,
                    diamondCount: data.diamondCount
                }));
            }
        });

        // Subscribe handler
        tiktokLive.on('subscribe', data => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log(`New subscriber: ${data.uniqueId}`);
                ws.send(JSON.stringify({
                    type: 'subscribe',
                    uniqueId: data.uniqueId,
                    nickname: data.nickname || data.uniqueId
                }));
            }
        });

        // Stream end handler
        tiktokLive.on('streamEnd', () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                    type: 'streamEnd',
                    message: 'Stream ended'
                }));
            }
            cleanup(ws);
        });

        // Enhanced error handling
        tiktokLive.on('error', err => {
            console.error('TikTok connection error:', err);
            
            let retryAfter = 0;
            if (err.message?.includes('InitialFetchError')) {
                retryAfter = calculateRetryDelay(cleanUsername);
                reconnectDelays.set(cleanUsername, Date.now() + (retryAfter * 1000));
            }
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                    type: 'error',
                    message: err.message || 'Connection error occurred',
                    retryAfter: retryAfter
                }));
            }
            
            if (retryAfter > 0) {
                cleanup(ws);
            }
        });

    } catch (err) {
        console.error(`Failed to connect to @${cleanUsername}'s livestream:`, err);
        
        let retryAfter = 0;
        if (err.message?.includes('InitialFetchError')) {
            retryAfter = calculateRetryDelay(cleanUsername);
            reconnectDelays.set(cleanUsername, Date.now() + (retryAfter * 1000));
        }
        
        ws.send(JSON.stringify({ 
            type: 'error',
            message: err.message || 'Failed to connect to livestream',
            retryAfter: retryAfter
        }));
        
        cleanup(ws);
    }

    // Enhanced cleanup on disconnect
    ws.on('close', () => {
        console.log(`Connection closed for @${cleanUsername}`);
        cleanup(ws);
    });

    // Handle client errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for @${cleanUsername}:`, error);
        cleanup(ws);
    });
});

// Enhanced cleanup function
function cleanup(ws) {
    const tiktokLive = connections.get(ws);
    if (tiktokLive) {
        try {
            tiktokLive.disconnect();
        } catch (error) {
            console.error('Error during disconnect:', error);
        }
        connections.delete(ws);
    }
    
    try {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    } catch (error) {
        console.error('Error closing WebSocket:', error);
    }
}

// Handle process termination
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Cleaning up...');
    wss.clients.forEach(ws => {
        cleanup(ws);
        ws.close();
    });
    server.close(() => {
        console.log('Server shut down complete');
        process.exit(0);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket URL: ws://localhost:${PORT}`);
});
