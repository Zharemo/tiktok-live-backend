const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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

// Store active connections
const connections = new Map();

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
    console.log(`Attempting to connect to @${cleanUsername}'s livestream...`);

    // Create TikTok connection
    const tiktokLive = new WebcastPushConnection(cleanUsername, {
        processInitialData: true,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 2000,
        clientParams: {
            "app_language": "en-US",
            "device_platform": "web"
        }
    });

    try {
        await tiktokLive.connect();
        
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

        // Error handler
        tiktokLive.on('error', err => {
            console.error('TikTok connection error:', err);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                    type: 'error',
                    message: err.message || 'Connection error occurred'
                }));
            }
        });

    } catch (err) {
        console.error(`Failed to connect to @${cleanUsername}'s livestream:`, err);
        ws.send(JSON.stringify({ 
            type: 'error',
            message: err.message || 'Failed to connect to livestream'
        }));
        cleanup(ws);
    }

    // Handle client disconnect
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

// Cleanup function
function cleanup(ws) {
    const tiktokLive = connections.get(ws);
    if (tiktokLive) {
        tiktokLive.disconnect();
        connections.delete(ws);
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
