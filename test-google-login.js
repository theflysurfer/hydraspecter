#!/usr/bin/env node

/**
 * Test Google login to check if anti-detection is sufficient
 */

import { BrowserTools } from './dist/tools.js';
import { BrowserManager } from './dist/browser-manager.js';

async function testGoogleLogin() {
  console.log('🔐 Testing Google login...\n');

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

  const email = 'julien.fernandez.work@gmail.com';
  const password = 'Go51440705!?';

  try {
    console.log('📍 Step 1: Opening Google login page...');
    const result = await browserTools.executeTools('browser_create', {
      url: 'https://accounts.google.com/signin'
    });

    if (result.isError) {
      console.error('❌ Failed to create browser:', result.content);
      process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    const browserId = data.id;
    console.log('✅ Browser opened');

    console.log('\n📍 Step 2: Waiting for page load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n📍 Step 3: Looking for email field...');
    const snapshot1 = await browserTools.executeTools('browser_snapshot', {
      instanceId: browserId,
      expectation: 'login form'
    });

    if (!snapshot1.isError) {
      const snap1Data = JSON.parse(snapshot1.content[0].text);
      console.log('Page snapshot:');
      console.log(snap1Data.snapshot.substring(0, 800));

      // Check for bot detection
      if (snap1Data.snapshot.toLowerCase().includes('impossible de vous connecter') ||
          snap1Data.snapshot.toLowerCase().includes('unsafe browser') ||
          snap1Data.snapshot.toLowerCase().includes('unsafe')) {
        console.log('\n❌ BLOCKED - Google detected unsafe browser');
        console.log('   The fix with removed flags did NOT solve Google detection');
        console.log('   You still need to copy your real Chrome profile (see GOOGLE-LOGIN-FIX.md)');
      }
    }

    console.log('\n📍 Step 4: Trying to fill email...');

    // Try to find and fill email field
    try {
      await browserTools.executeTools('browser_fill', {
        instanceId: browserId,
        selector: 'input[type="email"]',
        value: email
      });
      console.log('✅ Email filled');

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Click next button
      await browserTools.executeTools('browser_click', {
        instanceId: browserId,
        selector: 'button:has-text("Suivant")',
        humanize: true
      });
      console.log('✅ Clicked "Suivant"');

      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if we got to password field
      const snapshot2 = await browserTools.executeTools('browser_snapshot', {
        instanceId: browserId,
        expectation: 'password'
      });

      if (!snapshot2.isError) {
        const snap2Data = JSON.parse(snapshot2.content[0].text);
        if (snap2Data.snapshot.toLowerCase().includes('password') ||
            snap2Data.snapshot.toLowerCase().includes('mot de passe')) {
          console.log('✅ Got to password field!');

          // Fill password
          await browserTools.executeTools('browser_fill', {
            instanceId: browserId,
            selector: 'input[type="password"]',
            value: password
          });
          console.log('✅ Password filled');

          await new Promise(resolve => setTimeout(resolve, 1000));

          // Click next
          await browserTools.executeTools('browser_click', {
            instanceId: browserId,
            selector: 'button:has-text("Suivant")',
            humanize: true
          });
          console.log('✅ Clicked "Suivant" for password');

          await new Promise(resolve => setTimeout(resolve, 5000));

          // Check if logged in
          const snapshot3 = await browserTools.executeTools('browser_snapshot', {
            instanceId: browserId,
            maxElements: 50
          });

          if (!snapshot3.isError) {
            const snap3Data = JSON.parse(snapshot3.content[0].text);
            console.log('\n📄 Final page state:');
            console.log(snap3Data.snapshot.substring(0, 1000));

            if (snap3Data.snapshot.toLowerCase().includes('compte google') ||
                snap3Data.snapshot.toLowerCase().includes('my account')) {
              console.log('\n✅ LOGIN SUCCESS! Google accepted the browser!');
            } else if (snap3Data.snapshot.toLowerCase().includes('vérif') ||
                       snap3Data.snapshot.toLowerCase().includes('verify')) {
              console.log('\n⚠️ 2FA required - but login was NOT blocked!');
            } else {
              console.log('\n⚠️ Uncertain - check browser manually');
            }
          }
        } else if (snap2Data.snapshot.toLowerCase().includes('impossible') ||
                   snap2Data.snapshot.toLowerCase().includes('unsafe')) {
          console.log('\n❌ BLOCKED at password step');
        }
      }

    } catch (error) {
      console.log('❌ Fill/click error:', error.message);
    }

    console.log('\n📍 Step 5: Browser staying open for 30 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log('\n🧹 Closing browser...');
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

testGoogleLogin();
