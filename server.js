const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const ConnectionWrapper = require('./connectionWrapper');
const RateLimiter = require('./limiter');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Initialize rate limiter (10 connections per minute per username)
const rateLimiter = new RateLimiter(10, 1/60);

// Store active connections
const connections = new Map();
const connectionAttempts = new Map();

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Health check endpoints
app.get('/', (req, res) => {
    res.json({ status: 'TikTok Live Backend Running' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// WebSocket connection handler
wss.on('connection', async (ws, req) => {
    console.log('New WebSocket connection received');
    let tiktokConnection;
    
    // Parse URL parameters
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const username = urlParams.get('username');
    
    if (!username) {
        sendError(ws, 'Username parameter is required');
        return;
    }

    // Clean username
    const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
    
    // Check rate limiting
    try {
        await rateLimiter.acquire();
    } catch (error) {
        sendError(ws, 'Too many connection attempts. Please try again later.', 429);
        return;
    }

    // Create connection wrapper
    tiktokConnection = new ConnectionWrapper(cleanUsername, {
        enableExtendedGiftInfo: true,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 2000
    });

    // Store connection
    connections.set(ws, tiktokConnection);

    // Set up event handlers
    tiktokConnection.on('connected', () => {
        console.log(`Connected to @${cleanUsername}'s livestream!`);
        sendMessage(ws, 'connected', `Connected to @${cleanUsername}'s livestream`);
    });

    tiktokConnection.on('chat', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            sendMessage(ws, 'chat', null, {
                uniqueId: data.uniqueId,
                nickname: data.nickname,
                comment: data.comment
            });
        }
    });

    tiktokConnection.on('gift', (data) => {
        if (ws.readyState === WebSocket.OPEN && data.diamondCount > 0) {
            sendMessage(ws, 'gift', null, {
                uniqueId: data.uniqueId,
                nickname: data.nickname,
                giftId: data.giftId,
                giftName: data.giftName,
                repeatCount: data.repeatCount,
                diamondCount: data.diamondCount
            });
        }
    });

    tiktokConnection.on('follow', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            sendMessage(ws, 'follow', null, {
                uniqueId: data.uniqueId,
                nickname: data.nickname || data.uniqueId
            });
        }
    });

    tiktokConnection.on('subscribe', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            sendMessage(ws, 'subscribe', null, {
                uniqueId: data.uniqueId,
                nickname: data.nickname || data.uniqueId
            });
        }
    });

    tiktokConnection.on('streamEnd', () => {
        sendMessage(ws, 'streamEnd', 'Stream ended');
        cleanup(ws);
    });

    tiktokConnection.on('error', (error) => {
        console.error('TikTok connection error:', error);
        sendError(ws, error.message, error.type === 'InitialFetchError' ? 429 : 500, error.retryAfter);
        
        if (error.type === 'InitialFetchError') {
            cleanup(ws);
        }
    });

    // Handle WebSocket events
    ws.on('close', () => {
        console.log(`Connection closed for @${cleanUsername}`);
        cleanup(ws);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for @${cleanUsername}:`, error);
        cleanup(ws);
    });

    // Start connection
    try {
        await tiktokConnection.connect();
    } catch (error) {
        console.error(`Failed to connect to @${cleanUsername}'s livestream:`, error);
        sendError(ws, error.message);
        cleanup(ws);
    }
});

// Helper function to send formatted messages
function sendMessage(ws, type, message = null, data = null) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type,
            message,
            data,
            timestamp: Date.now()
        }));
    }
}

// Helper function to send error messages
function sendError(ws, message, code = 500, retryAfter = null) {
    const errorPayload = {
        type: 'error',
        message: message,
        code: code,
        timestamp: Date.now()
    };

    if (retryAfter) {
        errorPayload.retryAfter = retryAfter;
    }

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(errorPayload));
        ws.close();
    }
}

// Cleanup function
function cleanup(ws) {
    const connection = connections.get(ws);
    if (connection) {
        connection.disconnect();
        connections.delete(ws);
    }
    rateLimiter.release();
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

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Implement your error reporting here
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Implement your error reporting here
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket URL: ws://localhost:${PORT}`);
});
