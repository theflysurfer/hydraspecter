#!/usr/bin/env node

/**
 * Test Spotify anti-detection
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function testSpotify() {
  console.log('🎵 Testing Spotify...\n');

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
    console.log('📍 Step 1: Creating browser...');
    const result = await browserTools.executeTools('browser_create', {
      url: 'https://www.spotify.com'
    });

    if (result.isError) {
      console.error('❌ Failed:', result.content);
      process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    console.log('✅ Browser created');
    console.log('   - Mode:', data.mode);
    console.log('   - Protection level:', data.protectionLevel);
    console.log('   - Headless:', data.settings.headless);
    console.log('   - Humanize:', data.settings.humanize);

    const browserId = data.id;

    console.log('\n📍 Step 2: Waiting for page load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n📍 Step 3: Taking snapshot...');
    const snapshot = await browserTools.executeTools('browser_snapshot', {
      instanceId: browserId,
      maxElements: 50
    });

    if (!snapshot.isError) {
      const snapshotData = JSON.parse(snapshot.content[0].text);
      console.log('✅ Snapshot captured');
      console.log('\nPage title:', snapshotData.title);
      console.log('\nFirst 1000 chars of content:');
      console.log(snapshotData.snapshot.substring(0, 1000));

      // Check for bot detection
      const content = snapshotData.snapshot.toLowerCase();
      if (content.includes('robot') ||
          content.includes('automation') ||
          content.includes('unusual') ||
          content.includes('captcha') ||
          content.includes('verify') ||
          content.includes('vérif')) {
        console.log('\n❌ BOT DETECTED - Spotify is blocking us');
      } else if (content.includes('spotify') || content.includes('music') || content.includes('playlist')) {
        console.log('\n✅ SUCCESS - Spotify loaded normally!');
      } else {
        console.log('\n⚠️ UNCERTAIN - Check the browser window manually');
      }
    } else {
      console.log('❌ Snapshot failed:', snapshot.content);
    }

    console.log('\n📍 Step 4: Browser open for 15 seconds - check manually!');
    console.log('   👀 Look for bot detection or "unusual traffic" messages');
    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log('\n📍 Step 5: Closing...');
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

testSpotify();
