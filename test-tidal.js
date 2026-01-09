#!/usr/bin/env node

/**
 * Test script to verify Tidal anti-detection works
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function testTidal() {
  console.log('🧪 Testing Tidal anti-detection...\n');

  // Create browser manager
  const browserManager = new BrowserManager({
    maxInstances: 20,
    cleanupInterval: 300000,
  });

  // Create browser tools with chrome channel
  const browserTools = new BrowserTools(
    browserManager,
    {}, // humanize config
    undefined, // rate limit
    {
      poolSize: 5,
      headless: false,  // CRITICAL: visible browser
      channel: 'chrome' // CRITICAL: real Chrome
    }
  );

  try {
    console.log('📍 Step 1: Creating browser with persistent mode...');
    const result = await browserTools.executeTools('browser_create', {
      url: 'https://login.tidal.com'
    });

    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.isError) {
      console.error('❌ Failed to create browser:', result.content);
      process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    console.log('✅ Browser created:', data);
    const browserId = data.id;

    console.log('\n📍 Step 2: Checking protection level...');
    const protection = await browserTools.executeTools('browser_get_protection_level', {
      url: 'https://tidal.com'
    });

    console.log('✅ Protection level:', JSON.parse(protection.content[0].text));

    console.log('\n📍 Step 3: Waiting for page load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n📍 Step 4: Taking full snapshot...');
    const snapshot = await browserTools.executeTools('browser_snapshot', {
      instanceId: browserId
      // No expectation filter - get everything
    });

    if (!snapshot.isError) {
      const snapshotData = JSON.parse(snapshot.content[0].text);
      console.log('✅ Page snapshot captured');
      console.log('\nPage content preview:');
      console.log(snapshotData.snapshot.substring(0, 500) + '...');

      // Check if we got the bot detection message
      if (snapshotData.snapshot.toLowerCase().includes('robot') ||
          snapshotData.snapshot.toLowerCase().includes('vérification')) {
        console.log('\n❌ BOT DETECTED - Tidal is still detecting automation');
        console.log('   This means we need stronger anti-detection measures');
      } else {
        console.log('\n✅ NO BOT DETECTION - Page loaded successfully!');
      }
    }

    console.log('\n📍 Step 5: Keeping browser open for 15 seconds for manual inspection...');
    console.log('   👀 Check the browser window - do you see the bot detection?');
    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log('\n📍 Step 6: Closing browser...');
    await browserTools.executeTools('browser_close_instance', {
      instanceId: browserId
    });

    console.log('✅ Test complete!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

testTidal();
