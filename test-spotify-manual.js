#!/usr/bin/env node

/**
 * Open Spotify for manual DRM testing
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function testSpotify() {
  console.log('🎵 Opening Spotify for manual testing...\n');

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
    console.log('📍 Creating browser...');
    const result = await browserTools.executeTools('browser_create', {
      url: 'https://www.spotify.com'
    });

    if (result.isError) {
      console.error('❌ Failed:', result.content);
      process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    console.log(`✅ Spotify opened`);
    console.log(`   Browser ID: ${data.id}`);
    console.log(`   Mode: ${data.mode}`);
    console.log(`   Protection level: ${data.protectionLevel}`);

    console.log('\n🔍 TESTING INSTRUCTIONS:');
    console.log('   1. Click "Se connecter" (Login) if you have an account');
    console.log('   2. Or browse to any song');
    console.log('   3. Try to play music');
    console.log('   4. Check if you see "La lecture de contenus protégés est désactivée"\n');

    console.log('⏳ Browser will stay open for 90 seconds...');
    console.log('   Press Ctrl+C to close earlier\n');

    await new Promise(resolve => setTimeout(resolve, 90000));

    console.log('🧹 Closing browser...');
    await browserTools.executeTools('browser_close_instance', {
      instanceId: data.id
    });

    console.log('✅ Test complete!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

testSpotify();
