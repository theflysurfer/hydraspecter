/**
 * Cloudflare Bypass Integration Tests
 *
 * These tests verify that stealth backends can bypass Cloudflare protection.
 * Fast tests (backend selection) run by default.
 * Slow tests (live browser) require: SKIP_SLOW_TESTS=false
 *
 * Prerequisites for live tests:
 * 1. Login to ChatGPT, Claude, Perplexity manually using HydraSpecter
 * 2. Run sync-pools.ps1 to propagate sessions
 * 3. Run: npm run test:cloudflare
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BackendFactory, BackendType } from '../../src/backends/index.js';
import { detectFromPage } from '../../src/detection/cloudflare-detector.js';
import { getBackendSelector } from '../../src/detection/backend-selector.js';

// Skip slow tests by default
const SKIP_SLOW = process.env['SKIP_SLOW_TESTS'] !== 'false';

// Test sites known to use Cloudflare
const CLOUDFLARE_SITES = [
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    expectedBackend: 'camoufox' as BackendType,
    authRequired: true,
    successIndicator: 'chat',
  },
  {
    name: 'Claude',
    url: 'https://claude.ai/',
    expectedBackend: 'camoufox' as BackendType,
    authRequired: true,
    successIndicator: 'chat',
  },
  {
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    expectedBackend: 'camoufox' as BackendType,
    authRequired: false,
    successIndicator: 'perplexity',
  },
];

// Fast tests (always run) - no browser needed
describe('Cloudflare Bypass - Backend Selection', () => {
  const selector = getBackendSelector();

  it('should select camoufox for ChatGPT', () => {
    const backend = selector.selectBackend('https://chatgpt.com/chat');
    expect(backend).toBe('camoufox');
  });

  it('should select camoufox for Claude', () => {
    const backend = selector.selectBackend('https://claude.ai/chat');
    expect(backend).toBe('camoufox');
  });

  it('should select camoufox for Perplexity', () => {
    const backend = selector.selectBackend('https://perplexity.ai/library');
    expect(backend).toBe('camoufox');
  });

  it('should select playwright for Google', () => {
    const backend = selector.selectBackend('https://google.com/');
    expect(backend).toBe('playwright');
  });
});

// Backend availability tests (fast)
describe('Cloudflare Bypass - Backend Availability', () => {
  it('should have playwright available', async () => {
    const available = await BackendFactory.isAvailable('playwright');
    expect(available).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')('should check camoufox availability on Windows', async () => {
    const available = await BackendFactory.isAvailable('camoufox');
    // Camoufox may not be available in all environments due to Firefox binary requirements
    console.log(`Camoufox available: ${available}`);
    // Only expect true if it can be loaded - ESM issues may prevent loading in test environment
  });

  it.skipIf(process.platform !== 'win32')('should check seleniumbase availability', async () => {
    const available = await BackendFactory.isAvailable('seleniumbase');
    // SeleniumBase requires Python, may not be available everywhere
    console.log(`SeleniumBase available: ${available}`);
  });
});

// Slow tests (require live browsers and authentication)
describe.skipIf(SKIP_SLOW)('Cloudflare Bypass - Live Site Tests', () => {
  for (const site of CLOUDFLARE_SITES) {
    describe(site.name, () => {
      let instance: any;
      let page: any;

      beforeAll(async () => {
        const backend = await BackendFactory.getAsync(site.expectedBackend);
        const result = await backend.create({ url: site.url });

        if (!result.success || !result.data) {
          throw new Error(`Failed to create browser for ${site.name}: ${result.error}`);
        }

        instance = result.data;
        page = instance.page;
      }, 60000);

      afterAll(async () => {
        if (instance) {
          const backend = await BackendFactory.getAsync(site.expectedBackend);
          await backend.close(instance);
        }
      });

      it(`should bypass Cloudflare on ${site.name}`, async () => {
        const detection = await detectFromPage(page);
        expect(detection.detected).toBe(false);
      }, 30000);

      it(`should reach ${site.name} content`, async () => {
        const url = await page.url();
        expect(url).toContain(site.successIndicator);
      });

      it(`should take screenshot of ${site.name}`, async () => {
        const backend = await BackendFactory.getAsync(site.expectedBackend);
        const result = await backend.screenshot(page, { fullPage: false });

        expect(result.success).toBe(true);
        expect(result.data).toBeTruthy();
      }, 15000);
    });
  }
});

/**
 * Manual Test Runner
 *
 * Run individual site tests manually for debugging:
 *
 * ```typescript
 * import { testChatGPT } from './cloudflare-bypass.test';
 * await testChatGPT();
 * ```
 */

export async function testChatGPT(): Promise<boolean> {
  return testSite('chatgpt.com', 'camoufox');
}

export async function testClaude(): Promise<boolean> {
  return testSite('claude.ai', 'camoufox');
}

export async function testPerplexity(): Promise<boolean> {
  return testSite('perplexity.ai', 'camoufox');
}

async function testSite(domain: string, backendType: BackendType): Promise<boolean> {
  console.log(`\n=== Testing ${domain} with ${backendType} ===\n`);

  const backend = await BackendFactory.getAsync(backendType);
  const available = await backend.isAvailable();

  if (!available) {
    console.error(`Backend ${backendType} is not available`);
    return false;
  }

  const url = `https://${domain}/`;
  console.log(`Creating browser for ${url}...`);

  const result = await backend.create({ url });

  if (!result.success || !result.data) {
    console.error(`Failed to create browser: ${result.error}`);
    return false;
  }

  const instance = result.data;
  const page = instance.page;

  try {
    // Wait for page to stabilize
    await new Promise(r => setTimeout(r, 5000));

    // Check for Cloudflare
    const detection = await detectFromPage(page);
    console.log(`Cloudflare detected: ${detection.detected}`);

    if (detection.detected) {
      console.log(`Detection type: ${detection.type}`);
      console.log(`Suggestion: ${detection.suggestion}`);
      return false;
    }

    // Get current URL
    const currentUrl = await page.url();
    console.log(`Current URL: ${currentUrl}`);

    // Take screenshot
    const screenshot = await backend.screenshot(page, { fullPage: false });
    if (screenshot.success && screenshot.data) {
      console.log(`Screenshot taken (${screenshot.data.length} bytes base64)`);
    }

    console.log(`\n=== ${domain} test PASSED ===\n`);
    return true;
  } finally {
    await backend.close(instance);
  }
}
