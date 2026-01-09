#!/usr/bin/env node

/**
 * Interactive Google login test - browser stays open for manual login
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function testGoogleInteractive() {
  console.log('🔐 Interactive Google login test...\n');

  const browserManager = new BrowserManager({
    maxInstances: 20,
    cleanupInterval: 300000,
  });

  const browserTools = new BrowserTools(
    browserManager,
    {},
    undefined,
    {
      poolSize: 5,
      headless: false,
      channel: 'chrome'
    }
  );

  try {
    console.log('📍 Opening Google login page...');
    const result = await browserTools.executeTools('browser_create', {
      url: 'https://accounts.google.com/signin'
    });

    if (result.isError) {
      console.error('❌ Failed:', result.content);
      process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    const browserId = data.id;
    console.log(`✅ Browser opened (${browserId})`);
    console.log(`   Protection level: ${data.protectionLevel}`);

    console.log('\n🔍 INSTRUCTIONS:');
    console.log('   1. The browser window should be open now');
    console.log('   2. Try to login manually with your Google account');
    console.log('   3. Check if you get:');
    console.log('      - "Impossible de vous connecter" (BLOCKED)');
    console.log('      - "Vérification nécessaire" (2FA/verification)');
    console.log('      - Successful login');
    console.log('   4. Take note of what happens\n');

    console.log('⏳ Browser will stay open for 2 minutes...');
    console.log('   Press Ctrl+C to close earlier\n');

    // Wait 2 minutes for manual inspection
    await new Promise(resolve => setTimeout(resolve, 120000));

    console.log('🧹 Closing browser...');
    await browserTools.executeTools('browser_close_instance', {
      instanceId: browserId
    });

    console.log('✅ Test complete!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

testGoogleInteractive();
