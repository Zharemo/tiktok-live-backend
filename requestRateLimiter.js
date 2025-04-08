class RequestRateLimiter {
  constructor() {
    this.lastTimestamps = new Map();
    this.cooldownMs = 300; // adjust as needed
  }

  shouldProcess(eventData) {
    const key = eventData.userId || eventData.uniqueId || JSON.stringify(eventData);
    const now = Date.now();

    if (this.lastTimestamps.has(key)) {
      const last = this.lastTimestamps.get(key);
      if ((now - last) < this.cooldownMs) {
        return false;
      }
    }

    this.lastTimestamps.set(key, now);
    return true;
  }
}

module.exports = RequestRateLimiter;
