class RateLimiter {
    constructor(maxTokens = 10, tokenRefillRate = 1) {
        this.maxTokens = maxTokens;
        this.tokenRefillRate = tokenRefillRate; // tokens per second
        this.tokens = maxTokens;
        this.lastRefillTime = Date.now();
        this.waitingQueue = [];
    }

    async acquire() {
        this.refillTokens();

        if (this.tokens > 0) {
            this.tokens--;
            return true;
        }

        // Return promise that resolves when a token becomes available
        return new Promise((resolve) => {
            this.waitingQueue.push(resolve);
        });
    }

    release() {
        this.refillTokens();
        
        if (this.waitingQueue.length > 0 && this.tokens > 0) {
            const nextResolve = this.waitingQueue.shift();
            this.tokens--;
            nextResolve(true);
        }
    }

    refillTokens() {
        const now = Date.now();
        const timePassed = (now - this.lastRefillTime) / 1000; // convert to seconds
        const tokensToAdd = Math.floor(timePassed * this.tokenRefillRate);

        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
            this.lastRefillTime = now;
        }
    }
}

module.exports = RateLimiter;
