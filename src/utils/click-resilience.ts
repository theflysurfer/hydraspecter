/**
 * Click resilience system - auto-recovery for common click failures
 *
 * Handles:
 * - Element not visible (auto-scroll)
 * - Overlay intercepts (force click or dismiss)
 * - Timeout (position fallback)
 * - Rate limiting (exponential backoff)
 */

import { Page, Locator } from 'playwright';
import { delay } from './random.js';

// Error categories
export type ClickErrorCategory =
  | 'visibility'    // Element exists but not visible
  | 'overlay'       // Another element intercepts pointer events
  | 'timeout'       // Selector not found in time
  | 'detached'      // Element removed from DOM
  | 'rate_limit'    // Server-side rate limiting
  | 'not_found'     // Selector matches nothing (no retry)
  | 'fatal';        // Unrecoverable error

export interface ClassifiedError {
  category: ClickErrorCategory;
  message: string;
  shouldRetry: boolean;
  waitTime: number;  // ms before retry
}

export interface ClickAttempt {
  attempt: number;
  strategy: ClickErrorCategory | 'standard';
  error?: string;
  duration: number;
}

export interface ResilientClickResult {
  success: boolean;
  attempts: ClickAttempt[];
  finalStrategy: ClickErrorCategory | 'standard';
  recoveryApplied: string[];
  data?: any;
  error?: string;
  suggestion?: string;
}

export interface ResilienceOptions {
  autoScroll: boolean;
  autoForce: boolean;
  positionFallback: boolean;
  maxRetries: number;
  retryDelay: number;
  dismissOverlays: boolean;
  timeout: number;
}

// Default resilience options
export const DEFAULT_RESILIENCE: ResilienceOptions = {
  autoScroll: true,
  autoForce: true,
  positionFallback: true,
  maxRetries: 3,
  retryDelay: 500,
  dismissOverlays: true,
  timeout: 30000
};

// Known dismissible overlays
const DISMISSIBLE_OVERLAYS = [
  // Cookie consent (common patterns)
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
  'button:has-text("Accepter")',
  'button:has-text("Tout accepter")',
  '[data-testid="cookie-accept"]',
  '.cookie-consent button.accept',
  '#onetrust-accept-btn-handler',

  // Modal close buttons
  'button[aria-label="Close"]',
  'button[aria-label="Fermer"]',
  'button[aria-label="Dismiss"]',
  '.modal-close',
  '[data-dismiss="modal"]',
  '.close-button',

  // Popup/dialog dismissers
  '.popup-close',
  '.overlay-dismiss',
  '[role="dialog"] button[aria-label="Close"]',

  // Google Cloud specific (Gemini panel)
  '#ocb-root-page button[aria-label="Close"]',
  'button[aria-label="Close Gemini"]',
  'button[aria-label="close Gemini"]',
  '#ocb-root-page .close-button',

  // Google general
  'button[aria-label="Close search"]',

  // Chat widgets
  '.intercom-close-button',
  '.drift-widget-close',
  '.crisp-close',
];

/**
 * Classify a click error to determine recovery strategy
 */
export function classifyClickError(error: Error | string): ClassifiedError {
  const msg = (error instanceof Error ? error.message : error).toLowerCase();

  // Element not visible - needs scroll
  if (msg.includes('not visible') || msg.includes('element is not visible')) {
    return {
      category: 'visibility',
      message: 'Element exists but is not visible',
      shouldRetry: true,
      waitTime: 200
    };
  }

  // Overlay intercepts pointer events
  if (msg.includes('intercepts pointer') || msg.includes('obscured') || msg.includes('pointer events')) {
    return {
      category: 'overlay',
      message: 'Another element intercepts pointer events',
      shouldRetry: true,
      waitTime: 300
    };
  }

  // Element detached from DOM
  if (msg.includes('detached') || msg.includes('not attached')) {
    return {
      category: 'detached',
      message: 'Element was detached from DOM',
      shouldRetry: true,
      waitTime: 500
    };
  }

  // Timeout - selector not found
  if (msg.includes('timeout') && !msg.includes('navigation')) {
    return {
      category: 'timeout',
      message: 'Timeout waiting for element',
      shouldRetry: true,
      waitTime: 100
    };
  }

  // Rate limiting
  if (msg.includes('403') || msg.includes('forbidden')) {
    return {
      category: 'rate_limit',
      message: 'Rate limited (403)',
      shouldRetry: true,
      waitTime: 5000
    };
  }

  if (msg.includes('429') || msg.includes('too many')) {
    return {
      category: 'rate_limit',
      message: 'Rate limited (429)',
      shouldRetry: true,
      waitTime: 30000
    };
  }

  // No elements found - don't retry
  if (msg.includes('no elements found') || msg.includes('0 elements')) {
    return {
      category: 'not_found',
      message: 'No elements match selector',
      shouldRetry: false,
      waitTime: 0
    };
  }

  // Unknown error - don't retry
  return {
    category: 'fatal',
    message: msg,
    shouldRetry: false,
    waitTime: 0
  };
}

/**
 * Try to dismiss known overlays (cookie consent, modals, chat widgets)
 */
export async function dismissKnownOverlays(page: Page): Promise<boolean> {
  for (const selector of DISMISSIBLE_OVERLAYS) {
    try {
      const el = page.locator(selector).first();
      const isVisible = await el.isVisible({ timeout: 500 }).catch(() => false);

      if (isVisible) {
        await el.click({ force: true, timeout: 1000 });
        await delay(200);
        return true;
      }
    } catch {
      // Continue to next overlay pattern
    }
  }
  return false;
}

/**
 * Get element coordinates via JavaScript evaluation (fallback for selector issues)
 */
export async function getPositionFallback(
  page: Page,
  selector: string
): Promise<{ x: number; y: number } | null> {
  try {
    const coords = await page.evaluate((sel: string) => {
      // Try querySelector first
      let el: Element | null = document.querySelector(sel);

      // If not found, try text-based search for common patterns
      if (!el && sel.includes(':has-text(')) {
        const textMatch = sel.match(/:has-text\(["'](.+?)["']\)/);
        if (textMatch && textMatch[1]) {
          const searchText = textMatch[1];
          const tagMatch = sel.match(/^(\w+)/);
          const tag = tagMatch && tagMatch[1] ? tagMatch[1] : '*';

          // Find element containing text
          const elements = Array.from(document.querySelectorAll(tag));
          for (const element of elements) {
            if (element.textContent?.includes(searchText)) {
              el = element;
              break;
            }
          }
        }
      }

      if (!el) return null;

      // Scroll into view first
      el.scrollIntoView({ block: 'center', behavior: 'instant' });

      const rect = el.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      };
    }, selector);

    return coords;
  } catch {
    return null;
  }
}

/**
 * Calculate exponential backoff with jitter
 */
export function calculateBackoff(attempt: number, baseDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30s
}

/**
 * Execute a single click attempt with error handling
 */
async function executeClick(
  locator: Locator,
  options: {
    force?: boolean;
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    delay?: number;
    timeout?: number;
  }
): Promise<void> {
  await locator.click({
    force: options.force || false,
    button: options.button || 'left',
    clickCount: options.clickCount || 1,
    delay: options.delay || 0,
    timeout: options.timeout || 30000
  });
}

/**
 * Main resilient click function - orchestrates retry logic and recovery strategies
 */
export async function resilientClick(
  page: Page,
  locator: Locator,
  selector: string,
  clickOptions: {
    force?: boolean;
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    delay?: number;
    timeout?: number;
  },
  resilienceOptions: ResilienceOptions
): Promise<ResilientClickResult> {
  const attempts: ClickAttempt[] = [];
  const recoveryApplied: string[] = [];
  let currentForce = clickOptions.force || false;

  for (let i = 0; i < resilienceOptions.maxRetries; i++) {
    const attemptStart = Date.now();
    const attemptNum = i + 1;

    try {
      // Execute click attempt
      await executeClick(locator, {
        ...clickOptions,
        force: currentForce,
        timeout: i === 0 ? resilienceOptions.timeout : Math.min(resilienceOptions.timeout / 2, 15000)
      });

      // Success!
      attempts.push({
        attempt: attemptNum,
        strategy: i === 0 ? 'standard' : attempts[attempts.length - 1]?.strategy || 'standard',
        duration: Date.now() - attemptStart
      });

      return {
        success: true,
        attempts,
        finalStrategy: attempts[attempts.length - 1]?.strategy || 'standard',
        recoveryApplied,
        data: {
          selector,
          clicked: true,
          totalAttempts: attemptNum
        }
      };

    } catch (error) {
      const classified = classifyClickError(error instanceof Error ? error : String(error));

      attempts.push({
        attempt: attemptNum,
        strategy: classified.category,
        error: classified.message,
        duration: Date.now() - attemptStart
      });

      // Don't retry if error is not recoverable
      if (!classified.shouldRetry) {
        break;
      }

      // Last attempt - don't apply recovery, just fail
      if (i === resilienceOptions.maxRetries - 1) {
        break;
      }

      // Apply recovery strategy based on error category
      switch (classified.category) {
        case 'visibility':
          if (resilienceOptions.autoScroll) {
            try {
              await locator.scrollIntoViewIfNeeded();
              recoveryApplied.push('scroll');
              await delay(classified.waitTime);
            } catch {
              // Element might not be there, continue anyway
            }
          }
          break;

        case 'overlay':
          if (resilienceOptions.autoForce && !currentForce) {
            // First: try force click
            currentForce = true;
            recoveryApplied.push('force');
          } else if (resilienceOptions.dismissOverlays) {
            // Second: try dismissing overlays
            const dismissed = await dismissKnownOverlays(page);
            if (dismissed) {
              recoveryApplied.push('dismiss_overlay');
              currentForce = false; // Reset force after dismissing
            }
          }
          await delay(classified.waitTime);
          break;

        case 'timeout':
          if (resilienceOptions.positionFallback) {
            // Try to get position and click by coordinates
            const pos = await getPositionFallback(page, selector);
            if (pos) {
              try {
                await page.mouse.click(pos.x, pos.y, {
                  button: clickOptions.button || 'left',
                  clickCount: clickOptions.clickCount || 1,
                  delay: clickOptions.delay || 0
                });

                recoveryApplied.push('position_fallback');
                attempts.push({
                  attempt: attemptNum + 1,
                  strategy: 'timeout',
                  duration: Date.now() - attemptStart
                });

                return {
                  success: true,
                  attempts,
                  finalStrategy: 'timeout',
                  recoveryApplied,
                  data: {
                    selector,
                    clicked: true,
                    position: pos,
                    fallbackUsed: true,
                    totalAttempts: attemptNum + 1
                  }
                };
              } catch (posError) {
                // Position click also failed
                recoveryApplied.push('position_fallback_failed');
              }
            }
          }
          break;

        case 'detached':
          // Wait for element to potentially reappear
          await delay(classified.waitTime);
          break;

        case 'rate_limit':
          // Exponential backoff
          const backoffTime = calculateBackoff(attemptNum, resilienceOptions.retryDelay);
          recoveryApplied.push(`backoff_${Math.round(backoffTime)}ms`);
          await delay(backoffTime);
          break;
      }
    }
  }

  // All attempts failed
  const lastAttempt = attempts[attempts.length - 1];
  return {
    success: false,
    attempts,
    finalStrategy: lastAttempt?.strategy || 'fatal',
    recoveryApplied,
    error: `Click failed after ${attempts.length} attempt(s): ${lastAttempt?.error || 'unknown error'}`,
    suggestion: getSuggestion(lastAttempt?.strategy)
  };
}

/**
 * Get a helpful suggestion based on the final error category
 */
function getSuggestion(category?: ClickErrorCategory | 'standard'): string {
  switch (category) {
    case 'visibility':
      return 'Element may be hidden by CSS or requires user action to show';
    case 'overlay':
      return 'Try using browser_evaluate to find and dismiss the blocking element, or use position-based clicking';
    case 'timeout':
      return 'Use browser_snapshot to verify the element exists, or use browser_evaluate to find element coordinates';
    case 'detached':
      return 'The page may be updating dynamically. Try waiting for navigation or network idle';
    case 'rate_limit':
      return 'Wait before retrying, or reduce request frequency';
    case 'not_found':
      return 'Verify the selector with browser_snapshot or use a more specific selector';
    default:
      return 'Use browser_evaluate to debug element state or browser_screenshot to see current page';
  }
}
