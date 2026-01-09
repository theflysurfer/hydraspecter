#!/usr/bin/env node

/**
 * Open browser with pool-0 (real Chrome profile)
 * Stays open until Ctrl+C
 */

import { chromium as chromiumExtra } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import os from 'os';

// Add stealth plugin
chromiumExtra.use(stealth());

async function openBrowser() {
  console.log('🚀 Opening browser with pool-0 (real Chrome profile)...\n');

  const pool0Path = path.join(os.homedir(), '.hydraspecter', 'profiles', 'pool-0');

  console.log(`📍 Profile: ${pool0Path}`);
  console.log('📍 Launching...\n');

  const context = await chromiumExtra.launchPersistentContext(pool0Path, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=IsOledReady,ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,AcceptCHFrame,OptimizationHints',
      '--enable-features=NetworkService,NetworkServiceInProcess',
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('✅ Browser open!');
  console.log('\n🔍 Navigate to https://accounts.google.com to test');
  console.log('⏳ Browser will stay open - Press Ctrl+C to close\n');

  // Keep alive
  await new Promise(() => {});
}

openBrowser().catch(console.error);
