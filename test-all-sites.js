#!/usr/bin/env node

/**
 * Open Spotify, Tidal, and YouTube for manual testing
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function testAllSites() {
  console.log('🧪 Opening Spotify, Tidal, and YouTube...\n');

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

  const browsers = [];

  try {
    // Open Spotify
    console.log('🎵 Opening Spotify...');
    const spotify = await browserTools.executeTools('browser_create', {
      url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp'
    });
    if (!spotify.isError) {
      const spotifyData = JSON.parse(spotify.content[0].text);
      browsers.push({ name: 'Spotify', id: spotifyData.id });
      console.log(`   ✅ Spotify opened (${spotifyData.id})`);
    } else {
      console.log('   ❌ Spotify failed:', spotify.content);
    }

    // Open Tidal
    console.log('🌊 Opening Tidal...');
    const tidal = await browserTools.executeTools('browser_create', {
      url: 'https://listen.tidal.com'
    });
    if (!tidal.isError) {
      const tidalData = JSON.parse(tidal.content[0].text);
      browsers.push({ name: 'Tidal', id: tidalData.id });
      console.log(`   ✅ Tidal opened (${tidalData.id})`);
    } else {
      console.log('   ❌ Tidal failed:', tidal.content);
    }

    // Open YouTube
    console.log('🎥 Opening YouTube...');
    const youtube = await browserTools.executeTools('browser_create', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    if (!youtube.isError) {
      const youtubeData = JSON.parse(youtube.content[0].text);
      browsers.push({ name: 'YouTube', id: youtubeData.id });
      console.log(`   ✅ YouTube opened (${youtubeData.id})`);
    } else {
      console.log('   ❌ YouTube failed:', youtube.content);
    }

    console.log('\n📋 Summary:');
    console.log(`   Opened ${browsers.length}/3 browsers\n`);

    console.log('🔍 TESTING INSTRUCTIONS:');
    console.log('   Spotify: Try to play the song - does it work?');
    console.log('   Tidal: Check if you see bot detection or can browse');
    console.log('   YouTube: Try to play the video - does it work?\n');

    console.log('⏳ Browsers will stay open for 60 seconds...');
    console.log('   Press Ctrl+C to close them earlier\n');

    await new Promise(resolve => setTimeout(resolve, 60000));

    console.log('🧹 Closing all browsers...');
    for (const browser of browsers) {
      await browserTools.executeTools('browser_close_instance', {
        instanceId: browser.id
      });
      console.log(`   ✅ Closed ${browser.name}`);
    }

    console.log('\n✅ Test complete!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);

    // Try to close any open browsers
    for (const browser of browsers) {
      try {
        await browserTools.executeTools('browser_close_instance', {
          instanceId: browser.id
        });
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    process.exit(1);
  }

  process.exit(0);
}

testAllSites();
