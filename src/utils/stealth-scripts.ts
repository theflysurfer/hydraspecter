/**
 * Enhanced Anti-Detection Scripts
 *
 * Additional browser fingerprint evasions beyond puppeteer-extra-plugin-stealth.
 * These scripts run via addInitScript to patch browser APIs before page loads.
 *
 * Targets: Cloudflare Turnstile, DataDome, PerimeterX, Akamai
 */

/**
 * Get the comprehensive anti-detection script to inject via addInitScript.
 * This script patches multiple browser APIs to avoid bot detection.
 */
export function getStealthInitScript(): string {
  return `
    // === ANTI-DETECTION SCRIPT v2.0 ===
    // Patches browser APIs to avoid Cloudflare Turnstile and similar detection

    (function() {
      'use strict';

      // 1. Navigator.webdriver - primary bot signal
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
          configurable: true
        });
        // Also delete it from prototype
        delete Object.getPrototypeOf(navigator).webdriver;
      } catch (e) {}

      // 2. Navigator.plugins - empty = bot, should have common plugins
      try {
        const fakePlugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ];

        const pluginArray = {
          length: fakePlugins.length,
          item: (i) => fakePlugins[i] || null,
          namedItem: (name) => fakePlugins.find(p => p.name === name) || null,
          refresh: () => {},
          [Symbol.iterator]: function* () {
            for (const plugin of fakePlugins) yield plugin;
          }
        };

        // Add indexed access
        fakePlugins.forEach((plugin, i) => {
          pluginArray[i] = plugin;
          pluginArray[plugin.name] = plugin;
        });

        Object.defineProperty(navigator, 'plugins', {
          get: () => pluginArray,
          configurable: true
        });
      } catch (e) {}

      // 3. Navigator.languages - should match Accept-Language header
      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en', 'fr-FR', 'fr'],
          configurable: true
        });
      } catch (e) {}

      // 4. Navigator.platform - ensure consistency
      try {
        if (!navigator.platform || navigator.platform === '') {
          Object.defineProperty(navigator, 'platform', {
            get: () => 'Win32',
            configurable: true
          });
        }
      } catch (e) {}

      // 5. Navigator.hardwareConcurrency - realistic value
      try {
        if (navigator.hardwareConcurrency === 0 || navigator.hardwareConcurrency > 32) {
          Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => 8,
            configurable: true
          });
        }
      } catch (e) {}

      // 6. Navigator.deviceMemory - realistic value
      try {
        if (!navigator.deviceMemory || navigator.deviceMemory < 2) {
          Object.defineProperty(navigator, 'deviceMemory', {
            get: () => 8,
            configurable: true
          });
        }
      } catch (e) {}

      // 7. Permissions API - prevent detection via permission queries
      try {
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = function(parameters) {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: 'prompt', onchange: null });
          }
          return originalQuery.call(this, parameters);
        };
      } catch (e) {}

      // 8. Chrome runtime - must exist for Chrome detection
      try {
        if (!window.chrome) {
          window.chrome = {};
        }
        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            connect: () => {},
            sendMessage: () => {},
            id: undefined
          };
        }
      } catch (e) {}

      // 9. WebGL Renderer/Vendor - hide automation signals
      try {
        const getParameterProxy = new Proxy(WebGLRenderingContext.prototype.getParameter, {
          apply: function(target, thisArg, args) {
            const param = args[0];
            // UNMASKED_VENDOR_WEBGL
            if (param === 37445) {
              return 'Google Inc. (NVIDIA)';
            }
            // UNMASKED_RENDERER_WEBGL
            if (param === 37446) {
              return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            }
            return Reflect.apply(target, thisArg, args);
          }
        });
        WebGLRenderingContext.prototype.getParameter = getParameterProxy;

        // Also patch WebGL2
        if (typeof WebGL2RenderingContext !== 'undefined') {
          WebGL2RenderingContext.prototype.getParameter = getParameterProxy;
        }
      } catch (e) {}

      // 10. Iframe contentWindow access - prevent detection via iframe tricks
      try {
        const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
        if (originalContentWindow) {
          Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function() {
              const win = originalContentWindow.get.call(this);
              if (win) {
                try {
                  // Ensure webdriver is false in iframes too
                  Object.defineProperty(win.navigator, 'webdriver', {
                    get: () => false,
                    configurable: true
                  });
                } catch (e) {}
              }
              return win;
            }
          });
        }
      } catch (e) {}

      // 11. Canvas fingerprint noise (subtle randomization)
      try {
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
          // Add invisible noise to canvas
          if (this.width > 0 && this.height > 0) {
            const ctx = this.getContext('2d');
            if (ctx) {
              const imageData = ctx.getImageData(0, 0, 1, 1);
              // Tiny random modification (won't be visible)
              imageData.data[0] = imageData.data[0] ^ (Math.random() > 0.5 ? 1 : 0);
              ctx.putImageData(imageData, 0, 0);
            }
          }
          return originalToDataURL.apply(this, arguments);
        };
      } catch (e) {}

      // 12. Notification.permission - realistic default
      try {
        if (typeof Notification !== 'undefined') {
          Object.defineProperty(Notification, 'permission', {
            get: () => 'default',
            configurable: true
          });
        }
      } catch (e) {}

      // 13. Connection type - realistic network info
      try {
        if (navigator.connection) {
          Object.defineProperty(navigator.connection, 'effectiveType', {
            get: () => '4g',
            configurable: true
          });
        }
      } catch (e) {}

      // 14. Battery API - hide automation signals
      try {
        if (navigator.getBattery) {
          navigator.getBattery = () => Promise.resolve({
            charging: true,
            chargingTime: 0,
            dischargingTime: Infinity,
            level: 1,
            addEventListener: () => {},
            removeEventListener: () => {}
          });
        }
      } catch (e) {}

      // 15. Automation-specific properties cleanup
      try {
        // Remove Selenium markers
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        // Remove other automation markers
        delete window.__nightmare;
        delete window._phantom;
        delete window.callPhantom;
        delete window._selenium;
        delete window.__webdriver_evaluate;
        delete window.__selenium_evaluate;
        delete window.__webdriver_script_function;
        delete window.__webdriver_script_func;
        delete window.__webdriver_script_fn;
        delete window.__fxdriver_evaluate;
        delete window.__driver_unwrapped;
        delete window.__webdriver_unwrapped;
        delete window.__driver_evaluate;
        delete window.__selenium_unwrapped;
        delete window.__fxdriver_unwrapped;
        delete window.webdriver;
        delete window.domAutomation;
        delete window.domAutomationController;
      } catch (e) {}

      console.log('[HydraSpecter] Anti-detection patches applied');
    })();
  `;
}

/**
 * Minimal stealth script for faster execution (use when full stealth not needed)
 */
export function getMinimalStealthScript(): string {
  return `
    (function() {
      'use strict';
      // Essential patches only
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
        delete Object.getPrototypeOf(navigator).webdriver;
      } catch (e) {}

      try {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) window.chrome.runtime = { id: undefined };
      } catch (e) {}
    })();
  `;
}
