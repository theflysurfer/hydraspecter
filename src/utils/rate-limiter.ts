import { RateLimitConfig } from '../types.js';

/**
 * Sliding window rate limiter
 * Tracks requests within a time window and rejects when limit is exceeded
 */
export class RateLimiter {
  private requests: number[] = [];
  private config: RateLimitConfig;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      maxRequests: config?.maxRequests ?? 100,
      windowMs: config?.windowMs ?? 60000, // 1 minute default
    };
  }

  /**
   * Check if a request is allowed
   * @returns true if allowed, false if rate limited
   */
  isAllowed(): boolean {
    if (!this.config.enabled) {
      return true;
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Remove expired requests
    this.requests = this.requests.filter(timestamp => timestamp > windowStart);

    // Check if under limit
    if (this.requests.length < this.config.maxRequests) {
      this.requests.push(now);
      return true;
    }

    return false;
  }

  /**
   * Get current rate limit status
   */
  getStatus(): {
    allowed: boolean;
    remaining: number;
    resetMs: number;
    total: number;
  } {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: Infinity,
        resetMs: 0,
        total: this.config.maxRequests,
      };
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Clean expired
    this.requests = this.requests.filter(timestamp => timestamp > windowStart);

    const remaining = Math.max(0, this.config.maxRequests - this.requests.length);
    const oldestRequest = this.requests[0];
    const resetMs = oldestRequest
      ? Math.max(0, oldestRequest + this.config.windowMs - now)
      : 0;

    return {
      allowed: remaining > 0,
      remaining,
      resetMs,
      total: this.config.maxRequests,
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requests = [];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimitConfig>): void {
    if (config.enabled !== undefined) this.config.enabled = config.enabled;
    if (config.maxRequests !== undefined) this.config.maxRequests = config.maxRequests;
    if (config.windowMs !== undefined) this.config.windowMs = config.windowMs;
  }

  /**
   * Check if rate limiting is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
