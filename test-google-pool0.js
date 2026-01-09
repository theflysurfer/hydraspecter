#!/usr/bin/env node

/**
 * Test Google with pool-0 (real Chrome profile)
 */

import { chromium as chromiumExtra } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import os from 'os';

// Add stealth plugin
chromiumExtra.use(stealth());

async function testGooglePool0() {
  console.log('🔐 Testing Google with pool-0 (real Chrome profile)...\n');

  const pool0Path = path.join(os.homedir(), '.hydraspecter', 'profiles', 'pool-0');

  console.log(`📍 Using profile: ${pool0Path}`);
  console.log('📍 Launching browser...');

  const context = await chromiumExtra.launchPersistentContext(pool0Path, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('📍 Navigating to Google...');
  await page.goto('https://accounts.google.com');

  console.log('\n✅ Browser open!');
  console.log('🔍 Check if you are already logged in to Google');
  console.log('   or if you can login without "unsafe browser" error\n');

  console.log('⏳ Browser will stay open for 2 minutes...');
  console.log('   Press Ctrl+C to close\n');

  await new Promise(resolve => setTimeout(resolve, 120000));

  console.log('🧹 Closing...');
  await context.close();
  console.log('✅ Done!');
  process.exit(0);
}

testGooglePool0();
