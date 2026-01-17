/**
 * Browser Backends Index
 *
 * Exports all available browser backends:
 * - Playwright (default): Full features
 * - SeleniumBase UC: Cloudflare bypass
 */

export {
  SeleniumBaseDriver,
  SeleniumBasePage,
  SeleniumBaseInstance,
  createSeleniumBaseInstance,
  isSeleniumBaseAvailable,
} from './seleniumbase-driver.js';
