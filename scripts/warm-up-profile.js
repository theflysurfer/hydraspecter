#!/usr/bin/env node

/**
 * Warm up browser profile by visiting common sites
 * This creates browsing history to make the profile appear legitimate to Google
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function warmUpProfile() {
  console.log('🔥 Warming up browser profile...\n');
  console.log('This will visit several popular sites to create browsing history');
  console.log('Making the profile appear more legitimate to Google\n');

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

  const sitesToVisit = [
    'https://www.bbc.com/news',
    'https://www.wikipedia.org',
    'https://www.youtube.com',
    'https://www.reddit.com',
    'https://www.stackoverflow.com'
  ];

  try {
    console.log('📍 Creating browser...');
    const result = await browserTools.executeTools('browser_create', {
      url: sitesToVisit[0]
    });

    if (result.isError) {
      console.error('❌ Failed:', result.content);
      process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    const browserId = data.id;
    console.log(`✅ Browser created using profile: ${data.profileId || 'unknown'}\n`);

    // Visit each site
    for (let i = 0; i < sitesToVisit.length; i++) {
      const site = sitesToVisit[i];
      console.log(`📍 [${i+1}/${sitesToVisit.length}] Visiting ${site}...`);

      await browserTools.executeTools('browser_navigate', {
        instanceId: browserId,
        url: site
      });

      // Wait a bit to simulate real browsing
      await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
      console.log(`   ✅ Done`);
    }

    // Perform a Google search
    console.log('\n📍 Performing Google search...');
    await browserTools.executeTools('browser_navigate', {
      instanceId: browserId,
      url: 'https://www.google.com/search?q=weather+forecast'
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('   ✅ Search done');

    console.log('\n✅ Profile warm-up complete!');
    console.log('   The profile now has:');
    console.log('   - Browsing history');
    console.log('   - Cookies from popular sites');
    console.log('   - Google search history\n');

    console.log('📍 Keeping browser open for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log('🧹 Closing browser...');
    await browserTools.executeTools('browser_close_instance', {
      instanceId: browserId
    });

    console.log('\n🎉 Done! The profile is now warmed up.');
    console.log('   Try Google login again - it should work better now!');

  } catch (error) {
    console.error('❌ Warm-up failed:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

warmUpProfile();
