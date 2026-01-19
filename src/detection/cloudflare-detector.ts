/**
 * Cloudflare Challenge Detector for HydraSpecter
 *
 * Detects Cloudflare challenges (Turnstile, JS challenge, captcha)
 * from page content and responses.
 */

import { BackendPage } from '../backends/types.js';

/** Cloudflare detection result */
export interface CloudflareDetection {
  /** Whether Cloudflare protection was detected */
  detected: boolean;
  /** Type of protection detected */
  type?: 'turnstile' | 'js_challenge' | 'captcha' | 'access_denied' | 'rate_limit';
  /** Confidence level (0-1) */
  confidence: number;
  /** Details about the detection */
  details?: string;
  /** Suggestions for handling */
  suggestion?: string;
}

/** Cloudflare detection patterns */
const CLOUDFLARE_PATTERNS = {
  // Turnstile challenge
  turnstile: {
    selectors: [
      'iframe[src*="challenges.cloudflare.com"]',
      '[data-cf-turnstile]',
      '#cf-turnstile-container',
      '.cf-turnstile',
    ],
    pageContent: [
      'challenges.cloudflare.com/turnstile',
      'cf-turnstile',
      'Cloudflare Turnstile',
    ],
  },

  // JavaScript challenge
  jsChallenge: {
    selectors: [
      '#cf-spinner',
      '#challenge-form',
      '#challenge-running',
      '#cf-challenge-running',
    ],
    pageContent: [
      'Just a moment',
      'Checking your browser',
      'Please wait while we verify',
      'Enable JavaScript and cookies',
      'DDoS protection by Cloudflare',
    ],
    titles: [
      'Just a moment...',
      'Please Wait... | Cloudflare',
      'Attention Required! | Cloudflare',
    ],
  },

  // Captcha challenge
  captcha: {
    selectors: [
      '#cf-hcaptcha-container',
      '[data-hcaptcha-widget-id]',
      '.h-captcha',
      '#recaptcha',
    ],
    pageContent: [
      'hcaptcha.com',
      'recaptcha',
      'Please complete the security check',
    ],
  },

  // Access denied
  accessDenied: {
    selectors: [
      '#cf-error-details',
      '.cf-error-code',
    ],
    pageContent: [
      'Access denied',
      'Error 1020',
      'Error 1015',
      'Error 1010',
      'Ray ID',
      'You do not have access',
      'The owner of this website has banned',
    ],
  },

  // Rate limiting
  rateLimit: {
    selectors: [
      '.cf-error-overview',
    ],
    pageContent: [
      'Error 1015',
      'You are being rate limited',
      'Rate limit exceeded',
    ],
  },
};

/**
 * Detect Cloudflare protection from page content
 * @param html Page HTML content
 * @param title Page title
 * @returns Detection result
 */
export function detectFromContent(html: string, title?: string): CloudflareDetection {
  const htmlLower = html.toLowerCase();
  const titleLower = (title || '').toLowerCase();

  // Check for Turnstile
  for (const pattern of CLOUDFLARE_PATTERNS.turnstile.pageContent) {
    if (htmlLower.includes(pattern.toLowerCase())) {
      return {
        detected: true,
        type: 'turnstile',
        confidence: 0.95,
        details: `Turnstile detected: "${pattern}"`,
        suggestion: 'Use SeleniumBase with uc_gui_click_captcha() or Camoufox',
      };
    }
  }

  // Check for JS Challenge
  for (const pattern of CLOUDFLARE_PATTERNS.jsChallenge.pageContent) {
    if (htmlLower.includes(pattern.toLowerCase())) {
      return {
        detected: true,
        type: 'js_challenge',
        confidence: 0.9,
        details: `JS challenge detected: "${pattern}"`,
        suggestion: 'Use Camoufox or wait for challenge to complete',
      };
    }
  }

  for (const titlePattern of CLOUDFLARE_PATTERNS.jsChallenge.titles) {
    if (titleLower.includes(titlePattern.toLowerCase())) {
      return {
        detected: true,
        type: 'js_challenge',
        confidence: 0.95,
        details: `JS challenge title detected: "${titlePattern}"`,
        suggestion: 'Use Camoufox or SeleniumBase',
      };
    }
  }

  // Check for Captcha
  for (const pattern of CLOUDFLARE_PATTERNS.captcha.pageContent) {
    if (htmlLower.includes(pattern.toLowerCase())) {
      return {
        detected: true,
        type: 'captcha',
        confidence: 0.85,
        details: `Captcha detected: "${pattern}"`,
        suggestion: 'Use SeleniumBase with uc_gui_click_captcha()',
      };
    }
  }

  // Check for Access Denied
  for (const pattern of CLOUDFLARE_PATTERNS.accessDenied.pageContent) {
    if (htmlLower.includes(pattern.toLowerCase())) {
      return {
        detected: true,
        type: 'access_denied',
        confidence: 0.9,
        details: `Access denied: "${pattern}"`,
        suggestion: 'Try different backend or wait before retrying',
      };
    }
  }

  // Check for Rate Limit
  for (const pattern of CLOUDFLARE_PATTERNS.rateLimit.pageContent) {
    if (htmlLower.includes(pattern.toLowerCase())) {
      return {
        detected: true,
        type: 'rate_limit',
        confidence: 0.95,
        details: `Rate limit: "${pattern}"`,
        suggestion: 'Wait before retrying, use different IP',
      };
    }
  }

  // No Cloudflare detected
  return {
    detected: false,
    confidence: 0,
  };
}

/**
 * Detect Cloudflare protection from a BackendPage
 * @param page Backend page to check
 * @returns Detection result
 */
export async function detectFromPage(page: BackendPage): Promise<CloudflareDetection> {
  try {
    const native = page.native;

    // Check if it's a Playwright page
    if (native && typeof native.content === 'function') {
      const html = await native.content();
      const title = await native.title();

      // First check content
      const contentResult = detectFromContent(html, title);
      if (contentResult.detected) {
        return contentResult;
      }

      // Then check for elements using selectors
      for (const selector of CLOUDFLARE_PATTERNS.turnstile.selectors) {
        try {
          const element = await native.$(selector);
          if (element) {
            return {
              detected: true,
              type: 'turnstile',
              confidence: 0.99,
              details: `Turnstile element found: ${selector}`,
              suggestion: 'Use SeleniumBase with uc_gui_click_captcha()',
            };
          }
        } catch {
          // Selector not found, continue
        }
      }

      for (const selector of CLOUDFLARE_PATTERNS.jsChallenge.selectors) {
        try {
          const element = await native.$(selector);
          if (element) {
            return {
              detected: true,
              type: 'js_challenge',
              confidence: 0.95,
              details: `JS challenge element found: ${selector}`,
              suggestion: 'Use Camoufox or wait for challenge',
            };
          }
        } catch {
          // Selector not found, continue
        }
      }
    }

    return {
      detected: false,
      confidence: 0,
    };
  } catch (error) {
    console.error('[CloudflareDetector] Error checking page:', error);
    return {
      detected: false,
      confidence: 0,
      details: `Error checking: ${error instanceof Error ? error.message : error}`,
    };
  }
}

/**
 * Check if a URL is known to use Cloudflare protection
 * @param url URL to check
 * @returns Whether URL is likely Cloudflare-protected
 */
export function isKnownCloudflareProtected(url: string): boolean {
  const knownDomains = [
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'perplexity.ai',
    'discord.com',
    'kick.com',
    'cloudflare.com',
    'indeed.com',
    'linkedin.com',
    'twitch.tv',
    'crunchyroll.com',
  ];

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();

    return knownDomains.some(known =>
      domain === known || domain.endsWith('.' + known)
    );
  } catch {
    return false;
  }
}
