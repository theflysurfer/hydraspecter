import { describe, it, expect } from 'vitest';
import { formatAsToon, smartFormat, calculateTokenSavings } from '../../src/utils/toon-formatter.js';

describe('TOON Formatter', () => {
  describe('formatAsToon', () => {
    it('should format tabular array as CSV-like', () => {
      const data = [
        { url: 'https://api.com', method: 'GET', status: 200 },
        { url: 'https://api.com/data', method: 'POST', status: 201 }
      ];

      const result = formatAsToon(data);

      expect(result).toContain('url, method, status');
      expect(result).toContain('https://api.com, GET, 200');
      expect(result).toContain('https://api.com/data, POST, 201');
    });

    it('should format nested object with tabular array', () => {
      const data = {
        logs: [
          { type: 'error', text: 'Error 1' },
          { type: 'warn', text: 'Warning 1' }
        ],
        count: 2
      };

      const result = formatAsToon(data);

      expect(result).toContain('logs:');
      expect(result).toContain('type, text');
      expect(result).toContain('count: 2');
    });

    it('should handle empty arrays', () => {
      const result = formatAsToon([]);
      // Empty array at root level returns empty string (minimal output)
      expect(result).toBe('');
    });

    it('should handle simple values', () => {
      expect(formatAsToon('hello')).toBe('hello');
      expect(formatAsToon(42)).toBe('42');
      expect(formatAsToon(true)).toBe('true');
    });
  });

  describe('smartFormat', () => {
    it('should use JSON for small data', () => {
      const data = { foo: 'bar' };
      const result = smartFormat(data);

      expect(result.format).toBe('json');
      expect(result.tokenStats).toBeUndefined();
    });

    it('should auto-apply TOON for large tabular data', () => {
      // Create a large tabular array
      const logs = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        url: `https://example.com/api/${i}`,
        method: 'GET',
        status: 200,
        duration: Math.random() * 1000
      }));

      const result = smartFormat({ logs, count: logs.length });

      expect(result.format).toBe('toon');
      expect(result.tokenStats).toBeDefined();
      expect(result.tokenStats!.savings).toMatch(/\d+%/);
    });

    it('should not use TOON for non-tabular data', () => {
      const data = {
        nested: {
          deeply: {
            value: 'foo'
          }
        },
        array: [1, 2, 3, 4, 5]
      };

      const result = smartFormat(data);
      expect(result.format).toBe('json');
    });
  });

  describe('calculateTokenSavings', () => {
    it('should calculate savings for tabular data', () => {
      const data = [
        { a: 1, b: 2, c: 3 },
        { a: 4, b: 5, c: 6 },
        { a: 7, b: 8, c: 9 }
      ];

      const result = calculateTokenSavings(data);

      expect(result.json).toBeGreaterThan(0);
      expect(result.toon).toBeGreaterThan(0);
      expect(result.savings).toMatch(/-?\d+%/);
    });
  });
});
