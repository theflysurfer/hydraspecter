import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackendRules, getDefaultRules } from '../../src/backend-rules.js';
import * as path from 'path';
import * as os from 'os';

// Suppress console.error during tests
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('BackendRules', () => {
  let rules: BackendRules;

  beforeEach(() => {
    // Use a non-existent config path to test with default rules only
    const nonExistentPath = path.join(os.tmpdir(), 'hydraspecter-test', 'nonexistent-config.json');
    rules = new BackendRules(nonExistentPath);
  });

  describe('getBackendForUrl()', () => {
    describe('SeleniumBase domains', () => {
      it('should return "seleniumbase" for chatgpt.com', () => {
        expect(rules.getBackendForUrl('https://chatgpt.com')).toBe('seleniumbase');
      });

      it('should return "seleniumbase" for claude.ai', () => {
        expect(rules.getBackendForUrl('https://claude.ai')).toBe('seleniumbase');
      });

      it('should return "seleniumbase" for perplexity.ai', () => {
        expect(rules.getBackendForUrl('https://perplexity.ai')).toBe('seleniumbase');
      });

      it('should return "seleniumbase" for openai.com', () => {
        expect(rules.getBackendForUrl('https://openai.com')).toBe('seleniumbase');
      });

      it('should return "seleniumbase" for subdomain of chatgpt.com', () => {
        expect(rules.getBackendForUrl('https://api.chatgpt.com')).toBe('seleniumbase');
      });

      it('should return "seleniumbase" for www.claude.ai', () => {
        expect(rules.getBackendForUrl('https://www.claude.ai')).toBe('seleniumbase');
      });
    });

    describe('Playwright domains (wildcard)', () => {
      it('should return "playwright" for google.com', () => {
        expect(rules.getBackendForUrl('https://google.com')).toBe('playwright');
      });

      it('should return "playwright" for example.com (wildcard match)', () => {
        expect(rules.getBackendForUrl('https://example.com')).toBe('playwright');
      });

      it('should return "playwright" for github.com', () => {
        expect(rules.getBackendForUrl('https://github.com')).toBe('playwright');
      });

      it('should return "playwright" for amazon.com', () => {
        expect(rules.getBackendForUrl('https://amazon.com')).toBe('playwright');
      });

      it('should return "playwright" for subdomain of google.com', () => {
        expect(rules.getBackendForUrl('https://accounts.google.com')).toBe('playwright');
      });
    });

    describe('URL parsing edge cases', () => {
      it('should handle URLs with paths', () => {
        expect(rules.getBackendForUrl('https://chatgpt.com/chat/abc123')).toBe('seleniumbase');
      });

      it('should handle URLs with query strings', () => {
        expect(rules.getBackendForUrl('https://google.com/search?q=test')).toBe('playwright');
      });

      it('should handle URLs with ports', () => {
        expect(rules.getBackendForUrl('https://chatgpt.com:443')).toBe('seleniumbase');
      });

      it('should handle bare domain without protocol', () => {
        expect(rules.getBackendForUrl('chatgpt.com')).toBe('seleniumbase');
      });

      it('should be case-insensitive', () => {
        expect(rules.getBackendForUrl('https://CHATGPT.COM')).toBe('seleniumbase');
        expect(rules.getBackendForUrl('https://ChatGPT.com')).toBe('seleniumbase');
      });
    });
  });

  describe('shouldUseSeleniumBase()', () => {
    it('should return true for chatgpt.com', () => {
      expect(rules.shouldUseSeleniumBase('https://chatgpt.com')).toBe(true);
    });

    it('should return false for google.com', () => {
      expect(rules.shouldUseSeleniumBase('https://google.com')).toBe(false);
    });
  });

  describe('getDefaultRules()', () => {
    it('should return default SeleniumBase domains', () => {
      const defaults = getDefaultRules();
      expect(defaults.seleniumbase).toContain('chatgpt.com');
      expect(defaults.seleniumbase).toContain('claude.ai');
      expect(defaults.seleniumbase).toContain('perplexity.ai');
      expect(defaults.seleniumbase).toContain('openai.com');
    });

    it('should return wildcard for Playwright', () => {
      const defaults = getDefaultRules();
      expect(defaults.playwright).toContain('*');
    });
  });

  describe('getConfig()', () => {
    it('should return a copy of the config', () => {
      const config1 = rules.getConfig();
      const config2 = rules.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different object references
    });
  });

  describe('hasCustomConfig()', () => {
    it('should return false when using non-existent config path', () => {
      expect(rules.hasCustomConfig()).toBe(false);
    });
  });
});
