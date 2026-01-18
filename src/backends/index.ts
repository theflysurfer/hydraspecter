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

export {
  SeleniumBaseHttpPage,
  SeleniumBaseHttpInstance,
  createSeleniumBaseHttpInstance,
  isSeleniumBaseHttpAvailable,
  shutdownHttpBridge,
  getBridgeState,
  // Session error handling (US-012)
  isSessionError,
  executeWithCheckpoint,
  setCheckpoint,
  clearCheckpoint,
  getCheckpoint,
  getReinitState,
} from './seleniumbase-http-driver.js';

export type {
  SessionState,
  OperationCheckpoint,
} from './seleniumbase-http-driver.js';
