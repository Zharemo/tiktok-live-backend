const logger = require('./logger');

let ipRequestCounts = {};
let maxIpConnections = 10;
let maxIpRequestsPerMinute = 5;

// Reset request counts every minute
setInterval(() => {
  ipRequestCounts = {};
}, 60 * 1000);

function getSocketIp(socket) {
  if (['::1', '::ffff:127.0.0.1'].includes(socket.handshake.address)) {
    return socket.handshake.headers['x-forwarded-for'];
  } else {
    return socket.handshake.address;
  }
}

function getOverallIpConnectionCounts(io) {
  let ipCounts = {};
  io.of('/').sockets.forEach(socket => {
    let ip = getSocketIp(socket);
    if (!ipCounts[ip]) {
      ipCounts[ip] = 1;
    } else {
      ipCounts[ip] += 1;
    }
  });
  return ipCounts;
}

function clientBlocked(io, currentSocket) {
  let ipCounts = getOverallIpConnectionCounts(io);
  let currentIp = getSocketIp(currentSocket);

  if (typeof currentIp !== 'string') {
    logger.info('LIMITER: Failed to retrieve socket IP.');
    return false;
  }

  let currentIpConnections = ipCounts[currentIp] || 0;
  let currentIpRequests = ipRequestCounts[currentIp] || 0;
  ipRequestCounts[currentIp] = currentIpRequests + 1;

  if (currentIpConnections > maxIpConnections) {
    logger.info(`LIMITER: Max connection count of ${maxIpConnections} exceeded for client ${currentIp}`);
    return true;
  }

  if (currentIpRequests > maxIpRequestsPerMinute) {
    logger.info(`LIMITER: Max request count of ${maxIpRequestsPerMinute} exceeded for client ${currentIp}`);
    return true;
  }

  return false;
}

// Helper function to check if a specific IP is blocked
function isIpBlocked(io, ip) {
  let ipCounts = getOverallIpConnectionCounts(io);
  let currentIpConnections = ipCounts[ip] || 0;
  let currentIpRequests = ipRequestCounts[ip] || 0;

  return currentIpConnections > maxIpConnections || currentIpRequests > maxIpRequestsPerMinute;
}

// Helper function to get current limits
function getLimits() {
  return {
    maxIpConnections,
    maxIpRequestsPerMinute
  };
}

// Helper function to update limits
function updateLimits(newMaxConnections, newMaxRequests) {
  maxIpConnections = newMaxConnections;
  maxIpRequestsPerMinute = newMaxRequests;
  logger.info(`Rate limiter limits updated: ${maxIpConnections} connections, ${maxIpRequestsPerMinute} requests per minute`);
}

module.exports = {
  clientBlocked,
  getOverallIpConnectionCounts,
  getSocketIp,
  isIpBlocked,
  getLimits,
  updateLimits
};
