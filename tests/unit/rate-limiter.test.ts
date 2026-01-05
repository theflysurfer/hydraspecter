import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from '../../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
  });

  describe('when disabled (default)', () => {
    it('should always allow requests', () => {
      for (let i = 0; i < 200; i++) {
        expect(rateLimiter.isAllowed()).toBe(true);
      }
    });

    it('should report infinite remaining', () => {
      const status = rateLimiter.getStatus();
      expect(status.allowed).toBe(true);
      expect(status.remaining).toBe(Infinity);
    });

    it('should report not enabled', () => {
      expect(rateLimiter.isEnabled()).toBe(false);
    });
  });

  describe('when enabled', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        enabled: true,
        maxRequests: 5,
        windowMs: 1000, // 1 second
      });
    });

    it('should allow requests up to limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(rateLimiter.isAllowed()).toBe(true);
      }
    });

    it('should block requests beyond limit', () => {
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed();
      }
      // Next request should be blocked
      expect(rateLimiter.isAllowed()).toBe(false);
    });

    it('should report correct remaining count', () => {
      expect(rateLimiter.getStatus().remaining).toBe(5);
      rateLimiter.isAllowed();
      expect(rateLimiter.getStatus().remaining).toBe(4);
      rateLimiter.isAllowed();
      expect(rateLimiter.getStatus().remaining).toBe(3);
    });

    it('should reset after window expires', async () => {
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed();
      }
      expect(rateLimiter.isAllowed()).toBe(false);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should allow again
      expect(rateLimiter.isAllowed()).toBe(true);
    });

    it('should report enabled', () => {
      expect(rateLimiter.isEnabled()).toBe(true);
    });
  });

  describe('reset()', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        enabled: true,
        maxRequests: 3,
        windowMs: 60000,
      });
    });

    it('should clear all tracked requests', () => {
      // Use up the limit
      for (let i = 0; i < 3; i++) {
        rateLimiter.isAllowed();
      }
      expect(rateLimiter.getStatus().remaining).toBe(0);

      // Reset
      rateLimiter.reset();

      // Should have full quota again
      expect(rateLimiter.getStatus().remaining).toBe(3);
    });
  });

  describe('updateConfig()', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        enabled: false,
        maxRequests: 10,
        windowMs: 60000,
      });
    });

    it('should update enabled state', () => {
      expect(rateLimiter.isEnabled()).toBe(false);
      rateLimiter.updateConfig({ enabled: true });
      expect(rateLimiter.isEnabled()).toBe(true);
    });

    it('should update maxRequests', () => {
      rateLimiter.updateConfig({ enabled: true, maxRequests: 5 });
      expect(rateLimiter.getStatus().total).toBe(5);
    });
  });

  describe('getStatus()', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        enabled: true,
        maxRequests: 10,
        windowMs: 5000,
      });
    });

    it('should return correct status object', () => {
      const status = rateLimiter.getStatus();
      expect(status).toHaveProperty('allowed');
      expect(status).toHaveProperty('remaining');
      expect(status).toHaveProperty('resetMs');
      expect(status).toHaveProperty('total');
    });

    it('should report resetMs for when quota will refresh', () => {
      rateLimiter.isAllowed(); // Make one request
      const status = rateLimiter.getStatus();
      expect(status.resetMs).toBeGreaterThan(0);
      expect(status.resetMs).toBeLessThanOrEqual(5000);
    });
  });
});
