/**
 * Detection Monitor - Adaptive Anti-Detection System
 *
 * Monitors for critical situations that indicate bot detection:
 * - Cloudflare challenges
 * - CAPTCHAs (reCAPTCHA, hCaptcha)
 * - Rate limiting (403, 429)
 * - Bot warning messages
 * - DataDome/PerimeterX scripts
 *
 * When detected, signals to switch to humanize mode
 */

import { Page, Response } from 'playwright';

export interface DetectionResult {
  detected: boolean;
  type: DetectionType | null;
  confidence: number; // 0-1
  details: string;
  shouldHumanize: boolean;
  shouldRetry: boolean;
  waitTime?: number; // ms to wait before retry
}

export type DetectionType =
  | 'cloudflare_challenge'
  | 'cloudflare_turnstile'
  | 'recaptcha'
  | 'hcaptcha'
  | 'rate_limit'
  | 'bot_warning'
  | 'datadome'
  | 'perimeterx'
  | 'akamai'
  | 'blocked'
  | 'fingerprint_check';

export interface DetectionConfig {
  /** Enable response code monitoring */
  monitorResponses: boolean;
  /** Enable DOM monitoring for challenge elements */
  monitorDOM: boolean;
  /** Enable script detection (DataDome, etc.) */
  monitorScripts: boolean;
  /** Custom patterns to detect */
  customPatterns?: RegExp[];
  /** Sites to always use humanize */
  alwaysHumanizeDomains?: string[];
}

const DEFAULT_CONFIG: DetectionConfig = {
  monitorResponses: true,
  monitorDOM: true,
  monitorScripts: true,
  alwaysHumanizeDomains: [
    'temu.com',
    'amazon.com',
    'amazon.fr',
    'cloudflare.com',
  ],
};

// Detection patterns
const DETECTION_PATTERNS = {
  // Cloudflare
  cloudflare: {
    selectors: [
      '#challenge-running',
      '#challenge-form',
      '.cf-browser-verification',
      '#cf-wrapper',
      '[data-ray]',
      '#challenge-stage',
    ],
    textPatterns: [
      /checking your browser/i,
      /please wait/i,
      /just a moment/i,
      /enable javascript and cookies/i,
      /attention required/i,
      /cloudflare/i,
    ],
    scripts: [
      /challenges\.cloudflare\.com/i,
      /cdn-cgi\/challenge-platform/i,
    ],
  },

  // Turnstile (Cloudflare CAPTCHA)
  turnstile: {
    selectors: [
      '[data-turnstile-sitekey]',
      '.cf-turnstile',
      'iframe[src*="challenges.cloudflare.com"]',
    ],
  },

  // reCAPTCHA
  recaptcha: {
    selectors: [
      '.g-recaptcha',
      '[data-sitekey]',
      '#recaptcha',
      'iframe[src*="recaptcha"]',
      'iframe[src*="google.com/recaptcha"]',
    ],
    scripts: [
      /google\.com\/recaptcha/i,
      /gstatic\.com\/recaptcha/i,
    ],
  },

  // hCaptcha
  hcaptcha: {
    selectors: [
      '.h-captcha',
      '[data-hcaptcha-sitekey]',
      'iframe[src*="hcaptcha"]',
    ],
    scripts: [
      /hcaptcha\.com/i,
    ],
  },

  // DataDome
  datadome: {
    selectors: [
      '#datadome-captcha',
      '[data-datadome]',
    ],
    scripts: [
      /datadome\.co/i,
      /dd\.js/i,
    ],
    cookies: ['datadome'],
  },

  // PerimeterX
  perimeterx: {
    selectors: [
      '#px-captcha',
      '[data-px-captcha]',
    ],
    scripts: [
      /px\.perimeterx/i,
      /captcha\.px-cdn/i,
    ],
    cookies: ['_px', '_pxhd'],
  },

  // Akamai Bot Manager
  akamai: {
    scripts: [
      /akam\/\d+/i,
      /akamaihd\.net/i,
    ],
    cookies: ['ak_bmsc', 'bm_sv'],
  },

  // Generic bot warnings
  botWarning: {
    textPatterns: [
      /bot detected/i,
      /automated access/i,
      /verify you'?re human/i,
      /are you a robot/i,
      /suspicious activity/i,
      /unusual traffic/i,
      /access denied/i,
      /blocked/i,
      /rate limit/i,
      /too many requests/i,
    ],
  },
};

/**
 * Detection Monitor class
 * Monitors a page for bot detection signals
 */
export class DetectionMonitor {
  private config: DetectionConfig;
  private responseHistory: { status: number; url: string; timestamp: number }[] = [];
  private detectionHistory: DetectionResult[] = [];

  constructor(config: Partial<DetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if the current page shows signs of bot detection
   */
  async checkPage(page: Page): Promise<DetectionResult> {
    const results: DetectionResult[] = [];

    // Check if domain should always use humanize
    const url = page.url();
    if (this.shouldAlwaysHumanize(url)) {
      return {
        detected: true,
        type: null,
        confidence: 1,
        details: 'Domain in always-humanize list',
        shouldHumanize: true,
        shouldRetry: false,
      };
    }

    // Check for Cloudflare challenge
    if (this.config.monitorDOM) {
      const cfResult = await this.checkCloudflare(page);
      if (cfResult.detected) results.push(cfResult);

      const captchaResult = await this.checkCaptchas(page);
      if (captchaResult.detected) results.push(captchaResult);

      const warningResult = await this.checkBotWarnings(page);
      if (warningResult.detected) results.push(warningResult);
    }

    // Check for detection scripts
    if (this.config.monitorScripts) {
      const scriptResult = await this.checkDetectionScripts(page);
      if (scriptResult.detected) results.push(scriptResult);
    }

    // Return the most critical detection
    if (results.length > 0) {
      // Sort by confidence and return highest
      results.sort((a, b) => b.confidence - a.confidence);
      const result = results[0]!;
      this.detectionHistory.push(result);
      return result;
    }

    return {
      detected: false,
      type: null,
      confidence: 0,
      details: 'No detection signals found',
      shouldHumanize: false,
      shouldRetry: false,
    };
  }

  /**
   * Check response for rate limiting or blocking
   */
  checkResponse(response: Response): DetectionResult {
    const status = response.status();
    const url = response.url();

    this.responseHistory.push({ status, url, timestamp: Date.now() });

    // Keep only last 100 responses
    if (this.responseHistory.length > 100) {
      this.responseHistory.shift();
    }

    // Check for blocking status codes
    if (status === 403) {
      return {
        detected: true,
        type: 'blocked',
        confidence: 0.9,
        details: `403 Forbidden: ${url}`,
        shouldHumanize: true,
        shouldRetry: true,
        waitTime: 5000,
      };
    }

    if (status === 429) {
      return {
        detected: true,
        type: 'rate_limit',
        confidence: 1,
        details: `429 Too Many Requests: ${url}`,
        shouldHumanize: true,
        shouldRetry: true,
        waitTime: 30000, // Wait 30s before retry
      };
    }

    if (status === 503) {
      // Check rate of 503s
      const recent503s = this.responseHistory.filter(
        r => r.status === 503 && Date.now() - r.timestamp < 60000
      ).length;

      if (recent503s > 3) {
        return {
          detected: true,
          type: 'rate_limit',
          confidence: 0.8,
          details: `Multiple 503 errors detected (${recent503s} in last minute)`,
          shouldHumanize: true,
          shouldRetry: true,
          waitTime: 10000,
        };
      }
    }

    return {
      detected: false,
      type: null,
      confidence: 0,
      details: 'Response OK',
      shouldHumanize: false,
      shouldRetry: false,
    };
  }

  /**
   * Check for Cloudflare challenge
   */
  private async checkCloudflare(page: Page): Promise<DetectionResult> {
    try {
      // Check for challenge selectors
      for (const selector of DETECTION_PATTERNS.cloudflare.selectors) {
        const element = await page.$(selector);
        if (element) {
          return {
            detected: true,
            type: 'cloudflare_challenge',
            confidence: 0.95,
            details: `Cloudflare challenge detected: ${selector}`,
            shouldHumanize: true,
            shouldRetry: true,
            waitTime: 5000,
          };
        }
      }

      // Check page text for challenge patterns
      const pageText = await page.evaluate(() => document.body?.innerText || '');
      for (const pattern of DETECTION_PATTERNS.cloudflare.textPatterns) {
        if (pattern.test(pageText)) {
          return {
            detected: true,
            type: 'cloudflare_challenge',
            confidence: 0.8,
            details: `Cloudflare text pattern detected: ${pattern}`,
            shouldHumanize: true,
            shouldRetry: true,
            waitTime: 5000,
          };
        }
      }

      // Check for Turnstile
      for (const selector of DETECTION_PATTERNS.turnstile.selectors) {
        const element = await page.$(selector);
        if (element) {
          return {
            detected: true,
            type: 'cloudflare_turnstile',
            confidence: 0.95,
            details: `Cloudflare Turnstile detected: ${selector}`,
            shouldHumanize: true,
            shouldRetry: false, // Can't bypass Turnstile automatically
          };
        }
      }
    } catch {
      // Page might have navigated
    }

    return { detected: false, type: null, confidence: 0, details: '', shouldHumanize: false, shouldRetry: false };
  }

  /**
   * Check for CAPTCHAs
   */
  private async checkCaptchas(page: Page): Promise<DetectionResult> {
    try {
      // reCAPTCHA
      for (const selector of DETECTION_PATTERNS.recaptcha.selectors) {
        const element = await page.$(selector);
        if (element) {
          return {
            detected: true,
            type: 'recaptcha',
            confidence: 0.95,
            details: `reCAPTCHA detected: ${selector}`,
            shouldHumanize: true,
            shouldRetry: false, // Can't bypass CAPTCHA
          };
        }
      }

      // hCaptcha
      for (const selector of DETECTION_PATTERNS.hcaptcha.selectors) {
        const element = await page.$(selector);
        if (element) {
          return {
            detected: true,
            type: 'hcaptcha',
            confidence: 0.95,
            details: `hCaptcha detected: ${selector}`,
            shouldHumanize: true,
            shouldRetry: false,
          };
        }
      }

      // DataDome
      for (const selector of DETECTION_PATTERNS.datadome.selectors) {
        const element = await page.$(selector);
        if (element) {
          return {
            detected: true,
            type: 'datadome',
            confidence: 0.95,
            details: `DataDome CAPTCHA detected: ${selector}`,
            shouldHumanize: true,
            shouldRetry: false,
          };
        }
      }
    } catch {
      // Page might have navigated
    }

    return { detected: false, type: null, confidence: 0, details: '', shouldHumanize: false, shouldRetry: false };
  }

  /**
   * Check for bot warning messages
   */
  private async checkBotWarnings(page: Page): Promise<DetectionResult> {
    try {
      const pageText = await page.evaluate(() => document.body?.innerText || '');

      for (const pattern of DETECTION_PATTERNS.botWarning.textPatterns) {
        if (pattern.test(pageText)) {
          return {
            detected: true,
            type: 'bot_warning',
            confidence: 0.7,
            details: `Bot warning text detected: ${pattern}`,
            shouldHumanize: true,
            shouldRetry: true,
            waitTime: 10000,
          };
        }
      }
    } catch {
      // Page might have navigated
    }

    return { detected: false, type: null, confidence: 0, details: '', shouldHumanize: false, shouldRetry: false };
  }

  /**
   * Check for detection scripts (DataDome, PerimeterX, etc.)
   */
  private async checkDetectionScripts(page: Page): Promise<DetectionResult> {
    try {
      const scripts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('script[src]'))
          .map(s => s.getAttribute('src') || '');
      });

      // Check DataDome
      for (const pattern of DETECTION_PATTERNS.datadome.scripts) {
        if (scripts.some(src => pattern.test(src))) {
          return {
            detected: true,
            type: 'datadome',
            confidence: 0.6,
            details: 'DataDome script detected',
            shouldHumanize: true,
            shouldRetry: false,
          };
        }
      }

      // Check PerimeterX
      for (const pattern of DETECTION_PATTERNS.perimeterx.scripts) {
        if (scripts.some(src => pattern.test(src))) {
          return {
            detected: true,
            type: 'perimeterx',
            confidence: 0.6,
            details: 'PerimeterX script detected',
            shouldHumanize: true,
            shouldRetry: false,
          };
        }
      }

      // Check Akamai
      for (const pattern of DETECTION_PATTERNS.akamai.scripts) {
        if (scripts.some(src => pattern.test(src))) {
          return {
            detected: true,
            type: 'akamai',
            confidence: 0.6,
            details: 'Akamai Bot Manager script detected',
            shouldHumanize: true,
            shouldRetry: false,
          };
        }
      }
    } catch {
      // Page might have navigated
    }

    return { detected: false, type: null, confidence: 0, details: '', shouldHumanize: false, shouldRetry: false };
  }

  /**
   * Check if domain should always use humanize
   */
  private shouldAlwaysHumanize(url: string): boolean {
    if (!this.config.alwaysHumanizeDomains) return false;

    try {
      const hostname = new URL(url).hostname;
      return this.config.alwaysHumanizeDomains.some(domain =>
        hostname.includes(domain)
      );
    } catch {
      return false;
    }
  }

  /**
   * Get detection history
   */
  getHistory(): DetectionResult[] {
    return [...this.detectionHistory];
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.detectionHistory = [];
    this.responseHistory = [];
  }

  /**
   * Add domain to always-humanize list
   */
  addAlwaysHumanizeDomain(domain: string): void {
    if (!this.config.alwaysHumanizeDomains) {
      this.config.alwaysHumanizeDomains = [];
    }
    if (!this.config.alwaysHumanizeDomains.includes(domain)) {
      this.config.alwaysHumanizeDomains.push(domain);
    }
  }
}

/**
 * Create a response listener for a page
 */
export function createResponseMonitor(page: Page, monitor: DetectionMonitor): void {
  page.on('response', (response) => {
    const result = monitor.checkResponse(response);
    if (result.detected) {
      console.warn(`[DetectionMonitor] ${result.type}: ${result.details}`);
    }
  });
}

/**
 * Quick check function for one-off detection
 */
export async function quickDetectionCheck(page: Page): Promise<DetectionResult> {
  const monitor = new DetectionMonitor();
  return await monitor.checkPage(page);
}
