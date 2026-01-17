/**
 * Cloudflare Turnstile Handler
 *
 * Handles Cloudflare Turnstile CAPTCHA detection and interaction.
 * Turnstile uses cross-origin iframes that cannot be accessed directly,
 * so we use coordinate-based clicking with human-like behavior.
 */

import { Page } from 'playwright';
import { humanMove } from './ghost-cursor.js';
import { randomDelay } from './random.js';

export interface TurnstileResult {
  detected: boolean;
  clicked: boolean;
  solved: boolean;
  error?: string;
  position?: { x: number; y: number };
  attempt?: number;
}

/**
 * Detect if Cloudflare Turnstile is present on the page
 */
export async function detectTurnstile(page: Page): Promise<{
  detected: boolean;
  iframeSelector?: string;
  position?: { x: number; y: number };
}> {
  try {
    // Turnstile iframe selectors (in order of specificity)
    const turnstileSelectors = [
      'iframe[src*="challenges.cloudflare.com/turnstile"]',
      'iframe[src*="challenges.cloudflare.com"]',
      '.cf-turnstile iframe',
      '[data-turnstile-sitekey] iframe',
      'iframe[title*="Cloudflare"]',
      'iframe[title*="turnstile"]',
    ];

    for (const selector of turnstileSelectors) {
      const iframe = await page.$(selector);
      if (iframe) {
        const box = await iframe.boundingBox();
        if (box) {
          // Calculate center of iframe (where the checkbox is)
          // Turnstile checkbox is typically in the left portion of the widget
          const x = box.x + Math.min(box.width * 0.15, 30); // Left side, around 15% or 30px
          const y = box.y + box.height / 2; // Vertical center

          return {
            detected: true,
            iframeSelector: selector,
            position: { x: Math.round(x), y: Math.round(y) }
          };
        }
      }
    }

    // Also check for Turnstile widget container (sometimes iframe is dynamically loaded)
    const turnstileWidget = await page.$('.cf-turnstile, [data-turnstile-sitekey]');
    if (turnstileWidget) {
      const box = await turnstileWidget.boundingBox();
      if (box) {
        return {
          detected: true,
          position: { x: Math.round(box.x + 30), y: Math.round(box.y + box.height / 2) }
        };
      }
    }

    return { detected: false };
  } catch (error) {
    return { detected: false };
  }
}

/**
 * Attempt to click the Turnstile checkbox
 * Uses human-like mouse movement and clicking
 */
export async function clickTurnstile(
  page: Page,
  options: {
    humanize?: boolean;
    maxAttempts?: number;
    waitAfterClick?: number;
  } = {}
): Promise<TurnstileResult> {
  const {
    humanize = true,
    maxAttempts = 3,
    waitAfterClick = 3000
  } = options;

  // Detect Turnstile
  const detection = await detectTurnstile(page);
  if (!detection.detected || !detection.position) {
    return {
      detected: false,
      clicked: false,
      solved: false,
      error: 'Turnstile not detected on page'
    };
  }

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Add some randomness to the click position (±3px)
      const jitter = () => Math.floor(Math.random() * 7) - 3;
      const clickX = detection.position.x + jitter();
      const clickY = detection.position.y + jitter();

      // Random pre-click delay (100-500ms) to appear human
      await randomDelay(100, 500);

      // Use human-like mouse movement if enabled
      if (humanize) {
        await humanMove(page, { x: clickX, y: clickY });
        // Small delay before clicking
        await randomDelay(50, 150);
      }

      // Click the checkbox
      await page.mouse.click(clickX, clickY, {
        delay: Math.floor(Math.random() * 50) + 50 // 50-100ms click duration
      });

      // Wait to see if it solved
      await page.waitForTimeout(waitAfterClick);

      // Check if Turnstile is still visible (if gone, likely solved)
      const afterDetection = await detectTurnstile(page);
      if (!afterDetection.detected) {
        return {
          detected: true,
          clicked: true,
          solved: true,
          position: detection.position,
          attempt
        };
      }

      // Check for success indicators
      const solved = await page.evaluate(() => {
        // Check for common success patterns
        const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
        if (turnstileResponse && turnstileResponse.value) {
          return true;
        }

        // Check if the widget shows success state
        const successFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
        if (!successFrame) {
          // If iframe is gone, might be solved or failed
          return false;
        }

        return false;
      });

      if (solved) {
        return {
          detected: true,
          clicked: true,
          solved: true,
          position: detection.position,
          attempt
        };
      }

      // Didn't solve yet, wait before retry
      if (attempt < maxAttempts) {
        await randomDelay(1000, 2000);
      }

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    detected: true,
    clicked: true,
    solved: false,
    position: detection.position,
    attempt: maxAttempts,
    error: lastError || 'Failed to solve Turnstile after max attempts (may require human intervention)'
  };
}

/**
 * Wait for Turnstile to appear and attempt to solve it
 */
export async function waitAndSolveTurnstile(
  page: Page,
  options: {
    timeout?: number;
    humanize?: boolean;
    maxAttempts?: number;
  } = {}
): Promise<TurnstileResult> {
  const { timeout = 10000, humanize = true, maxAttempts = 3 } = options;

  // Wait for Turnstile to appear
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const detection = await detectTurnstile(page);
    if (detection.detected) {
      return await clickTurnstile(page, { humanize, maxAttempts });
    }
    await page.waitForTimeout(500);
  }

  return {
    detected: false,
    clicked: false,
    solved: false,
    error: `Turnstile not found within ${timeout}ms timeout`
  };
}
