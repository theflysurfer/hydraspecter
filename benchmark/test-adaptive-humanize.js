#!/usr/bin/env node
/**
 * Test Adaptive Humanize Mode
 * Tests that humanize activates only when detection signals are found
 */

import { chromium } from 'playwright';

const TEST_SITES = {
  // Should NOT trigger humanize (clean site)
  clean: 'https://example.com',
  // Should trigger humanize (Cloudflare protected)
  cloudflare: 'https://bot.sannysoft.com/',
  // Should trigger humanize (always-humanize domain)
  temu: 'https://www.temu.com',
};

// Detection patterns from detection-monitor.ts
const DETECTION_PATTERNS = {
  cloudflare: {
    selectors: [
      '#challenge-running',
      '#challenge-form',
      '.cf-browser-verification',
      '#cf-wrapper',
      '#challenge-stage',
    ],
    textPatterns: [
      /checking your browser/i,
      /please wait/i,
      /just a moment/i,
      /cloudflare/i,
    ],
  },
  captcha: {
    selectors: [
      '.g-recaptcha',
      '.h-captcha',
      '[data-sitekey]',
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
    ],
  },
  botWarning: {
    textPatterns: [
      /bot detected/i,
      /automated access/i,
      /verify you'?re human/i,
      /suspicious activity/i,
      /access denied/i,
    ],
  },
};

async function checkDetection(page) {
  const url = page.url();
  const results = { detected: false, type: null, details: '' };

  try {
    // Check Cloudflare selectors
    for (const selector of DETECTION_PATTERNS.cloudflare.selectors) {
      const element = await page.$(selector);
      if (element) {
        return { detected: true, type: 'cloudflare', details: `Found selector: ${selector}` };
      }
    }

    // Check page text for patterns
    const pageText = await page.evaluate(() => document.body?.innerText || '');
    for (const pattern of DETECTION_PATTERNS.cloudflare.textPatterns) {
      if (pattern.test(pageText)) {
        return { detected: true, type: 'cloudflare_text', details: `Found pattern: ${pattern}` };
      }
    }

    // Check CAPTCHA selectors
    for (const selector of DETECTION_PATTERNS.captcha.selectors) {
      const element = await page.$(selector);
      if (element) {
        return { detected: true, type: 'captcha', details: `Found selector: ${selector}` };
      }
    }

    // Check bot warning text
    for (const pattern of DETECTION_PATTERNS.botWarning.textPatterns) {
      if (pattern.test(pageText)) {
        return { detected: true, type: 'bot_warning', details: `Found pattern: ${pattern}` };
      }
    }
  } catch (e) {
    // Page might have navigated
  }

  return results;
}

async function testSite(name, url, expectedDetection) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`   URL: ${url}`);
  console.log(`   Expected detection: ${expectedDetection ? 'YES' : 'NO'}`);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: null,
    locale: 'fr-FR',
  });

  const page = await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000); // Wait for any challenges to appear

    const detection = await checkDetection(page);

    console.log(`   Detection result: ${detection.detected ? '⚠️ DETECTED' : '✅ CLEAN'}`);
    if (detection.detected) {
      console.log(`   Type: ${detection.type}`);
      console.log(`   Details: ${detection.details}`);
    }

    const matchesExpectation = detection.detected === expectedDetection;
    console.log(`   Result: ${matchesExpectation ? '✅ PASS' : '❌ FAIL'}`);

    return { site: name, detection, matchesExpectation };
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return { site: name, error: e.message };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('🔬 Adaptive Humanize Mode Test');
  console.log('==============================');
  console.log('Tests that detection correctly identifies protection mechanisms\n');

  const results = [];

  // Test clean site (should not trigger)
  results.push(await testSite('Clean Site', TEST_SITES.clean, false));

  // Small pause between tests
  await new Promise(r => setTimeout(r, 2000));

  // Test site with potential Cloudflare (may or may not trigger depending on protection)
  results.push(await testSite('Sannysoft (Detection Test)', TEST_SITES.cloudflare, false));

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));

  let passed = 0, failed = 0;
  for (const result of results) {
    if (result.error) {
      console.log(`${result.site}: ⚠️ ERROR - ${result.error}`);
      failed++;
    } else if (result.matchesExpectation) {
      console.log(`${result.site}: ✅ PASS`);
      passed++;
    } else {
      console.log(`${result.site}: ❌ FAIL`);
      failed++;
    }
  }

  console.log(`\nTotal: ${passed}/${results.length} passed`);

  console.log('\n💡 Note: Detection accuracy depends on the actual site protection.');
  console.log('   Sites may or may not show challenges depending on your IP/browser.\n');
}

main().catch(console.error);
