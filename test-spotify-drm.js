#!/usr/bin/env node

/**
 * Test if Spotify DRM (WideVine) is working
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function testSpotifyDRM() {
  console.log('🎵 Testing Spotify DRM (WideVine)...\n');

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
      url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp' // Random popular song
    });

    if (result.isError) {
      console.error('❌ Failed:', result.content);
      process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    console.log('✅ Browser created');
    const browserId = data.id;

    console.log('\n📍 Step 2: Waiting for page load...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log('\n📍 Step 3: Getting page snapshot...');
    const snapshot = await browserTools.executeTools('browser_snapshot', {
      instanceId: browserId,
      maxElements: 100
    });

    if (!snapshot.isError) {
      const snapData = JSON.parse(snapshot.content[0].text);
      const content = snapData.snapshot.toLowerCase();

      console.log('\n📄 Snapshot preview:');
      console.log(snapData.snapshot.substring(0, 1000));
      console.log('...\n');

      // Check for DRM error
      if (content.includes('protégés est désactivée') ||
          content.includes('protected content') ||
          content.includes('lecture de contenus protégés')) {
        console.log('❌ DRM ERROR DETECTED');
        console.log('   Message: "La lecture de contenus protégés est désactivée"');
        console.log('   This means WideVine/DRM is NOT working');
      } else if (content.includes('play') || content.includes('pause') || content.includes('écouter')) {
        console.log('✅ PLAYER DETECTED - DRM might be working!');
        console.log('   The Spotify player UI is present');
      } else {
        console.log('⚠️ UNCERTAIN - Manual inspection needed');
      }
    } else {
      console.log('❌ Snapshot failed:', snapshot.content);
    }

    console.log('\n📍 Step 4: Browser open for 20 seconds - check manually!');
    console.log('   👀 Try to play the song - does it work or show a DRM error?');
    await new Promise(resolve => setTimeout(resolve, 20000));

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

testSpotifyDRM();
