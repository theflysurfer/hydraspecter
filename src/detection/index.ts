/**
 * HydraSpecter Detection Module
 *
 * Exports all detection-related functionality.
 */

// Backend selection
export {
  BackendSelector,
  getBackendSelector,
  type DomainRule,
  type BackendRulesConfig,
} from './backend-selector.js';

// Cloudflare detection
export {
  detectFromContent,
  detectFromPage,
  isKnownCloudflareProtected,
  type CloudflareDetection,
} from './cloudflare-detector.js';

// Login detection
export {
  LoginDetector,
  waitForLogin,
  type LoginDetection,
  type SiteLoginConfig,
  type UrlPattern,
} from './login-detector.js';
