/**
 * Page Adapter for Backend Compatibility
 *
 * Wraps BackendInstance/BackendPage to be compatible with the legacy
 * BrowserInstance interface used by tools.ts.
 *
 * This allows seamless integration of stealth backends (Camoufox, SeleniumBase)
 * without modifying the existing tools implementation.
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserInstance } from '../types.js';
import type {
  BackendInstance,
  BackendPage,
  BackendType,
  IBrowserBackend,
} from './types.js';

/**
 * Extended BrowserInstance that tracks the backend used
 */
export interface AdaptedBrowserInstance extends BrowserInstance {
  /** Backend type used for this instance */
  backendType: BackendType;
  /** Reference to the backend implementation */
  backend: IBrowserBackend;
  /** Original backend instance (for backend-specific operations) */
  backendInstance: BackendInstance;
}

/**
 * Create a Playwright Page-like proxy from a BackendPage
 *
 * For Playwright and Camoufox backends, the native page IS Playwright-compatible.
 * For SeleniumBase, we create a thin proxy that maps common methods.
 */
export function adaptBackendPage(backendPage: BackendPage): Page {
  const native = backendPage.native;

  // For Playwright/Camoufox, native is already a Playwright Page
  if (backendPage.backend === 'playwright' || backendPage.backend === 'camoufox') {
    return native as Page;
  }

  // For SeleniumBase, create a proxy that maps Page methods to WebDriver
  // This is a minimal adapter - not all methods are supported
  return createSeleniumBasePageProxy(backendPage);
}

/**
 * Create a minimal Page proxy for SeleniumBase WebDriver
 * Only supports methods used by tools.ts
 */
function createSeleniumBasePageProxy(backendPage: BackendPage): Page {
  const driver = backendPage.native;

  const proxy = {
    // URL and title
    url: () => driver.current_url || driver.getCurrentUrl?.() || '',
    title: () => driver.title || driver.getTitle?.() || '',

    // Navigation
    goto: async (url: string, _options?: any) => {
      driver.get?.(url) || driver.open?.(url);
      return null;
    },
    goBack: async () => driver.back?.(),
    goForward: async () => driver.forward?.(),
    reload: async () => driver.refresh?.(),

    // Element interaction
    click: async (selector: string, _options?: any) => {
      const element = driver.find_element?.('css selector', selector) ||
        driver.findElement?.({ css: selector });
      if (element) {
        element.click?.();
      }
    },

    fill: async (selector: string, value: string) => {
      const element = driver.find_element?.('css selector', selector) ||
        driver.findElement?.({ css: selector });
      if (element) {
        element.clear?.();
        element.send_keys?.(value) || element.sendKeys?.(value);
      }
    },

    type: async (selector: string, text: string, options?: any) => {
      const element = driver.find_element?.('css selector', selector) ||
        driver.findElement?.({ css: selector });
      if (element) {
        for (const char of text) {
          element.send_keys?.(char) || element.sendKeys?.(char);
          if (options?.delay) {
            await new Promise(r => setTimeout(r, options.delay));
          }
        }
      }
    },

    // Content
    content: async () => driver.page_source || driver.getPageSource?.() || '',
    innerHTML: async (selector: string) => {
      const element = driver.find_element?.('css selector', selector);
      return element?.get_attribute?.('innerHTML') || '';
    },

    // Evaluation
    evaluate: async (fn: any, ...args: any[]) => {
      if (typeof fn === 'string') {
        return driver.execute_script?.(fn, ...args) ||
          driver.executeScript?.(fn, ...args);
      }
      // For function evaluation, convert to string
      const script = `return (${fn.toString()})(...arguments)`;
      return driver.execute_script?.(script, ...args) ||
        driver.executeScript?.(script, ...args);
    },

    // Waiting
    waitForSelector: async (selector: string, options?: any) => {
      // Basic polling wait
      const timeout = options?.timeout || 30000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const el = driver.find_element?.('css selector', selector);
          if (el) return el;
        } catch { /* continue */ }
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error(`Timeout waiting for selector: ${selector}`);
    },

    waitForLoadState: async (_state?: string) => {
      // SeleniumBase handles this internally
      return;
    },

    // Screenshot
    screenshot: async (options?: any) => {
      const base64 = driver.get_screenshot_as_base64?.() ||
        driver.getScreenshotAsBase64?.();
      if (options?.path) {
        const fs = await import('fs');
        fs.writeFileSync(options.path, Buffer.from(base64, 'base64'));
      }
      return Buffer.from(base64, 'base64');
    },

    // Context
    context: () => ({
      browser: () => ({
        close: async () => driver.quit?.(),
      }),
      newCDPSession: async () => null,
      storageState: async () => ({}),
    }),

    // Frames
    frames: () => [],
    mainFrame: () => proxy,
    frameLocator: () => proxy,

    // Locator (minimal support)
    locator: (selector: string) => ({
      click: async (options?: any) => proxy.click(selector, options),
      fill: async (value: string) => proxy.fill(selector, value),
      type: async (text: string, options?: any) => proxy.type(selector, text, options),
      textContent: async () => {
        const el = driver.find_element?.('css selector', selector);
        return el?.text || el?.getText?.() || '';
      },
      getAttribute: async (name: string) => {
        const el = driver.find_element?.('css selector', selector);
        return el?.get_attribute?.(name) || el?.getAttribute?.(name) || null;
      },
      isVisible: async () => {
        try {
          const el = driver.find_element?.('css selector', selector);
          return el?.is_displayed?.() || el?.isDisplayed?.() || false;
        } catch { return false; }
      },
      count: async () => {
        const els = driver.find_elements?.('css selector', selector) || [];
        return els.length;
      },
    }),

    // Keyboard
    keyboard: {
      press: async (key: string) => {
        // Map common keys
        const keyMap: Record<string, string> = {
          'Enter': '\ue007',
          'Tab': '\ue004',
          'Escape': '\ue00c',
        };
        const activeElement = driver.switch_to?.active_element;
        if (activeElement) {
          activeElement.send_keys?.(keyMap[key] || key);
        }
      },
    },

    // Mouse (limited support)
    mouse: {
      click: async (x: number, y: number) => {
        const actions = driver.action_chains?.() || driver.actions?.();
        if (actions) {
          actions.move_by_offset?.(x, y)?.click?.()?.perform?.();
        }
      },
    },

    // Close
    close: async () => {
      driver.close?.();
    },

    // Misc
    isClosed: () => false,
    setViewportSize: async () => { },
    bringToFront: async () => { },
    addInitScript: async () => { },
    setDefaultTimeout: () => { },
    setDefaultNavigationTimeout: () => { },

    // For compatibility
    on: () => { },
    off: () => { },
    once: () => { },
    removeListener: () => { },
  };

  return proxy as unknown as Page;
}

/**
 * Adapt a BackendInstance to the legacy BrowserInstance format
 */
export function adaptBackendInstance(
  backendInstance: BackendInstance,
  backend: IBrowserBackend
): AdaptedBrowserInstance {
  const page = adaptBackendPage(backendInstance.page);

  // For Playwright/Camoufox, we can get the real browser/context
  // For SeleniumBase, we create minimal wrappers
  let browser: Browser;
  let context: BrowserContext;

  if (backendInstance.backend === 'playwright' || backendInstance.backend === 'camoufox') {
    // Native objects are Playwright-compatible
    const nativePage = backendInstance.page.native;
    context = nativePage.context();
    browser = context.browser() as Browser;
  } else {
    // Create minimal wrappers for SeleniumBase
    const driver = backendInstance.native;
    context = {
      browser: () => browser,
      pages: () => [page],
      newPage: async () => page,
      close: async () => driver.quit?.(),
      storageState: async () => ({}),
      addCookies: async () => { },
      cookies: async () => [],
      clearCookies: async () => { },
      setDefaultTimeout: () => { },
      setDefaultNavigationTimeout: () => { },
    } as unknown as BrowserContext;

    browser = {
      close: async () => driver.quit?.(),
      contexts: () => [context],
      newContext: async () => context,
      newPage: async () => page,
      isConnected: () => true,
    } as unknown as Browser;
  }

  return {
    id: backendInstance.id,
    browser,
    context,
    page,
    createdAt: backendInstance.createdAt,
    lastUsed: backendInstance.lastUsed,
    isActive: true,
    backendType: backendInstance.backend,
    backend,
    backendInstance,
  };
}

/**
 * Check if an instance is an adapted backend instance
 */
export function isAdaptedInstance(instance: BrowserInstance): instance is AdaptedBrowserInstance {
  return 'backendType' in instance && 'backend' in instance;
}

/**
 * Get the backend for an instance (for backend-specific operations)
 */
export function getInstanceBackend(instance: BrowserInstance): IBrowserBackend | null {
  if (isAdaptedInstance(instance)) {
    return instance.backend;
  }
  return null;
}
