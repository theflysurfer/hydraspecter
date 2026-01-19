/**
 * Login Detector for HydraSpecter
 *
 * Automatically detects when a user has successfully logged in
 * by monitoring URL changes, cookies, and DOM elements.
 */

import { BackendPage } from '../backends/types.js';

/** Login detection result */
export interface LoginDetection {
  /** Whether login was detected */
  detected: boolean;
  /** Detection method */
  method?: 'url' | 'cookie' | 'element' | 'redirect';
  /** Confidence level (0-1) */
  confidence: number;
  /** Details about the detection */
  details?: string;
}

/** URL pattern - can be string or RegExp */
export type UrlPattern = string | RegExp;

/** Site-specific login configuration */
export interface SiteLoginConfig {
  /** Domain pattern */
  domain: string;
  /** URL patterns that indicate logged-in state */
  loggedInUrls?: UrlPattern[];
  /** URL patterns that indicate logged-out state */
  loggedOutUrls?: UrlPattern[];
  /** Cookie names that indicate logged-in state */
  loginCookies?: string[];
  /** CSS selectors that appear when logged in */
  loggedInElements?: string[];
  /** CSS selectors that appear when logged out */
  loggedOutElements?: string[];
}

/** Known site configurations */
const SITE_CONFIGS: SiteLoginConfig[] = [
  // ChatGPT
  {
    domain: 'chatgpt.com',
    loggedInUrls: ['/c/', '/g/', '/?model='],
    loggedOutUrls: ['/auth/login'],
    loginCookies: ['__Secure-next-auth.session-token'],
    loggedInElements: ['[data-testid="profile-button"]', '.user-avatar'],
    loggedOutElements: ['[data-testid="login-button"]'],
  },
  {
    domain: 'chat.openai.com',
    loggedInUrls: ['/c/', '/g/'],
    loggedOutUrls: ['/auth/login'],
    loginCookies: ['__Secure-next-auth.session-token'],
    loggedInElements: ['[data-testid="profile-button"]'],
  },
  // Claude
  {
    domain: 'claude.ai',
    loggedInUrls: ['/chat/', '/new', '/project'],
    loggedOutUrls: ['/login', '/signup'],
    loginCookies: ['sessionKey'],
    loggedInElements: ['.user-menu', '[data-testid="user-menu"]'],
    loggedOutElements: ['[data-testid="login-button"]', '.login-form'],
  },
  // Perplexity
  {
    domain: 'perplexity.ai',
    loggedInUrls: ['/library', '/collections', '/settings'],
    loggedOutUrls: ['/signin'],
    loggedInElements: ['.user-avatar', '[data-testid="user-menu"]'],
    loggedOutElements: ['[data-testid="sign-in-button"]'],
  },
  // Google
  {
    domain: 'google.com',
    loginCookies: ['SID', 'HSID', 'SSID'],
    loggedInElements: ['[data-ogsr-up]', '#gb_70'],
    loggedOutElements: ['[data-sigil="login"]', '#gb_23'],
  },
  // Gmail
  {
    domain: 'mail.google.com',
    loggedInUrls: ['/mail/u/'],
    loggedOutUrls: ['/signin', '/ServiceLogin'],
    loginCookies: ['GMAIL_AT'],
    loggedInElements: ['.gb_Pc', '#\\:2'],
  },
  // Notion
  {
    domain: 'notion.so',
    loggedInUrls: [/^\/[a-f0-9-]{32}/, /^\/[a-zA-Z]+-[a-f0-9-]{32}/],
    loggedOutUrls: ['/login', '/signup'],
    loggedInElements: ['.notion-sidebar', '[data-block-id]'],
    loggedOutElements: ['.login-form', '[data-testid="login-input"]'],
  },
  // Discord
  {
    domain: 'discord.com',
    loggedInUrls: ['/channels/', '/app'],
    loggedOutUrls: ['/login', '/register'],
    loginCookies: ['token'],
    loggedInElements: ['[class*="privateChannels"]', '[class*="guilds"]'],
    loggedOutElements: ['[class*="authBox"]'],
  },
];

/**
 * Login Detector Class
 *
 * Monitors a page for login state changes.
 */
export class LoginDetector {
  private initialUrl: string = '';
  private initialCookies: Set<string> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;
  private onLoginCallbacks: Array<(detection: LoginDetection) => void> = [];
  private onTimeoutCallbacks: Array<() => void> = [];
  private config: SiteLoginConfig | undefined;

  /**
   * Start monitoring a page for login
   * @param page Backend page to monitor
   * @param timeout Maximum wait time in ms (default: 5 minutes)
   */
  async startMonitoring(page: BackendPage, timeout: number = 5 * 60 * 1000): Promise<void> {
    // Get initial state
    this.initialUrl = await page.url();
    this.config = this.findConfig(this.initialUrl);

    // Get initial cookies if possible
    try {
      const native = page.native;
      if (native && native.context && typeof native.context().cookies === 'function') {
        const cookies = await native.context().cookies();
        this.initialCookies = new Set(cookies.map((c: any) => c.name));
      }
    } catch {
      // Cookies not available
    }

    // Start polling
    this.pollInterval = setInterval(async () => {
      const detection = await this.checkLoginState(page);
      if (detection.detected) {
        this.stopMonitoring();
        this.onLoginCallbacks.forEach(cb => cb(detection));
      }
    }, 1000);

    // Set timeout
    setTimeout(() => {
      if (this.pollInterval) {
        this.stopMonitoring();
        this.onTimeoutCallbacks.forEach(cb => cb());
      }
    }, timeout);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Register callback for login detection
   */
  onLogin(callback: (detection: LoginDetection) => void): void {
    this.onLoginCallbacks.push(callback);
  }

  /**
   * Register callback for timeout
   */
  onTimeout(callback: () => void): void {
    this.onTimeoutCallbacks.push(callback);
  }

  /**
   * Find site config for URL
   */
  private findConfig(url: string): SiteLoginConfig | undefined {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();

      return SITE_CONFIGS.find(config => {
        return domain === config.domain || domain.endsWith('.' + config.domain);
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Check current login state
   */
  async checkLoginState(page: BackendPage): Promise<LoginDetection> {
    const currentUrl = await page.url();

    // Check URL change
    const urlDetection = this.checkUrlChange(currentUrl);
    if (urlDetection.detected) {
      return urlDetection;
    }

    // Check cookies
    const cookieDetection = await this.checkCookies(page);
    if (cookieDetection.detected) {
      return cookieDetection;
    }

    // Check DOM elements
    const elementDetection = await this.checkElements(page);
    if (elementDetection.detected) {
      return elementDetection;
    }

    return {
      detected: false,
      confidence: 0,
    };
  }

  /**
   * Check for login via URL change
   */
  private checkUrlChange(currentUrl: string): LoginDetection {
    // Check if we moved away from login page
    if (this.config?.loggedOutUrls) {
      const wasOnLogin = this.config.loggedOutUrls.some(pattern => {
        if (typeof pattern === 'string') {
          return this.initialUrl.includes(pattern);
        }
        return pattern.test(this.initialUrl);
      });

      const isNowOffLogin = !this.config.loggedOutUrls.some(pattern => {
        if (typeof pattern === 'string') {
          return currentUrl.includes(pattern);
        }
        return pattern.test(currentUrl);
      });

      if (wasOnLogin && isNowOffLogin) {
        return {
          detected: true,
          method: 'url',
          confidence: 0.9,
          details: `Redirected from login page: ${this.initialUrl} → ${currentUrl}`,
        };
      }
    }

    // Check if we're now on a logged-in URL
    if (this.config?.loggedInUrls) {
      const isOnLoggedInUrl = this.config.loggedInUrls.some(pattern => {
        if (typeof pattern === 'string') {
          return currentUrl.includes(pattern);
        }
        return pattern.test(currentUrl);
      });

      if (isOnLoggedInUrl && currentUrl !== this.initialUrl) {
        return {
          detected: true,
          method: 'redirect',
          confidence: 0.85,
          details: `Navigated to logged-in URL: ${currentUrl}`,
        };
      }
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Check for login via cookies
   */
  private async checkCookies(page: BackendPage): Promise<LoginDetection> {
    if (!this.config?.loginCookies) {
      return { detected: false, confidence: 0 };
    }

    try {
      const native = page.native;
      if (native && native.context && typeof native.context().cookies === 'function') {
        const cookies = await native.context().cookies();
        const currentCookies = new Set(cookies.map((c: any) => c.name));

        // Check for new login cookies
        for (const loginCookie of this.config.loginCookies) {
          if (currentCookies.has(loginCookie) && !this.initialCookies.has(loginCookie)) {
            return {
              detected: true,
              method: 'cookie',
              confidence: 0.95,
              details: `Login cookie appeared: ${loginCookie}`,
            };
          }
        }
      }
    } catch {
      // Cookies not available
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Check for login via DOM elements
   */
  private async checkElements(page: BackendPage): Promise<LoginDetection> {
    try {
      const native = page.native;
      if (!native || typeof native.$ !== 'function') {
        return { detected: false, confidence: 0 };
      }

      // Check for logged-in elements
      if (this.config?.loggedInElements) {
        for (const selector of this.config.loggedInElements) {
          try {
            const element = await native.$(selector);
            if (element) {
              return {
                detected: true,
                method: 'element',
                confidence: 0.85,
                details: `Logged-in element found: ${selector}`,
              };
            }
          } catch {
            // Selector not found
          }
        }
      }

      // Check for absence of logged-out elements
      if (this.config?.loggedOutElements) {
        let hadLogoutElement = false;
        let hasLogoutElement = false;

        for (const selector of this.config.loggedOutElements) {
          try {
            const element = await native.$(selector);
            if (element) {
              hasLogoutElement = true;
            }
          } catch {
            // Selector not found
          }
        }

        // If we initially had logout elements but now don't
        if (hadLogoutElement && !hasLogoutElement) {
          return {
            detected: true,
            method: 'element',
            confidence: 0.8,
            details: 'Logout elements disappeared',
          };
        }
      }
    } catch {
      // Element check failed
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * One-shot login detection check
   */
  static async detect(page: BackendPage): Promise<LoginDetection> {
    const detector = new LoginDetector();
    detector.initialUrl = await page.url();
    detector.config = detector.findConfig(detector.initialUrl);
    return detector.checkLoginState(page);
  }
}

/**
 * Wait for login with promise
 * @param page Page to monitor
 * @param timeout Timeout in ms
 * @returns Promise that resolves with detection or rejects on timeout
 */
export function waitForLogin(page: BackendPage, timeout: number = 5 * 60 * 1000): Promise<LoginDetection> {
  return new Promise((resolve, reject) => {
    const detector = new LoginDetector();

    detector.onLogin((detection) => {
      resolve(detection);
    });

    detector.onTimeout(() => {
      reject(new Error('Login detection timed out'));
    });

    detector.startMonitoring(page, timeout);
  });
}
