/**
 * HydraSpecter Inject - Background Service Worker
 *
 * Handles:
 * - Communication with native messaging host
 * - Rule storage in chrome.storage.local
 * - Badge updates for active rules
 * - DEBUG: Diagnostics and troubleshooting
 */

const NATIVE_HOST_NAME = 'com.hydraspecter.inject';
const REFRESH_INTERVAL = 30000; // 30 seconds

// Sites configuration - what each site needs
const SITES_CONFIG = {
  google: {
    name: "Google (Gmail, YouTube, Drive)",
    domains: [".google.com", ".youtube.com", ".googleapis.com"],
    tabPatterns: ["*://*.google.com/*", "*://mail.google.com/*", "*://accounts.google.com/*", "*://*.youtube.com/*"],
    needs: { cookies: true, localStorage: true, indexedDB: true }
  },
  homeexchange: {
    name: "HomeExchange",
    domains: [".homeexchange.com", ".homeexchange.fr", "homeexchange.com", "homeexchange.fr"],
    tabPatterns: ["*://*.homeexchange.com/*", "*://*.homeexchange.fr/*"],
    needs: { cookies: true, localStorage: true, indexedDB: false }
  },
  notion: {
    name: "Notion",
    domains: [".notion.so"],
    tabPatterns: ["*://*.notion.so/*"],
    needs: { cookies: true, localStorage: true, indexedDB: true }
  },
  amazon: {
    name: "Amazon",
    domains: [".amazon.fr", ".amazon.com", ".amazon.de"],
    tabPatterns: ["*://*.amazon.fr/*", "*://*.amazon.com/*", "*://*.amazon.de/*"],
    needs: { cookies: true, localStorage: true, indexedDB: false }
  },
  github: {
    name: "GitHub",
    domains: [".github.com"],
    tabPatterns: ["*://*.github.com/*"],
    needs: { cookies: true, localStorage: true, indexedDB: false }
  },
  kiabi: {
    name: "Kiabi",
    domains: [".kiabi.com"],
    tabPatterns: ["*://*.kiabi.com/*"],
    needs: { cookies: true, localStorage: false, indexedDB: false }
  },
  temu: {
    name: "Temu",
    domains: [".temu.com"],
    tabPatterns: ["*://*.temu.com/*"],
    needs: { cookies: true, localStorage: true, indexedDB: false }
  },
  aliexpress: {
    name: "AliExpress",
    domains: [".aliexpress.com"],
    tabPatterns: ["*://*.aliexpress.com/*"],
    needs: { cookies: true, localStorage: true, indexedDB: false }
  },
  discord: {
    name: "Discord",
    domains: [".discord.com"],
    tabPatterns: ["*://*.discord.com/*"],
    needs: { cookies: true, localStorage: true, indexedDB: true }
  }
};

// Debug state
let debugLog = [];
const MAX_DEBUG_LOG = 100;

function log(level, message, data = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data
  };
  debugLog.push(entry);
  if (debugLog.length > MAX_DEBUG_LOG) debugLog.shift();

  const prefix = `[HydraSpecter:${level}]`;
  if (level === 'error') {
    console.error(prefix, message, data || '');
  } else {
    console.log(prefix, message, data || '');
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  log('info', 'Extension installed');
  refreshRules();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  log('info', 'Extension started');
  refreshRules();
});

/**
 * Test native host connection
 */
async function testNativeHost() {
  log('debug', 'Testing native host connection...');

  try {
    const startTime = Date.now();
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'ping'
    });
    const duration = Date.now() - startTime;

    if (response && response.pong) {
      log('info', `Native host OK (${duration}ms)`, response);
      return {
        success: true,
        message: `Connected in ${duration}ms`,
        response
      };
    } else {
      log('error', 'Native host returned unexpected response', response);
      return {
        success: false,
        message: 'Unexpected response',
        response
      };
    }
  } catch (error) {
    log('error', 'Native host connection failed', error.message);
    return {
      success: false,
      message: error.message,
      error: error.toString(),
      hints: [
        'Run install.ps1 from project directory',
        'Check registry: HKCU\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\com.hydraspecter.inject',
        'Verify manifest.json path points to host.bat',
        'Restart Chrome after installation'
      ]
    };
  }
}

/**
 * Refresh rules from native host
 */
async function refreshRules() {
  log('debug', 'Refreshing rules...');

  try {
    const startTime = Date.now();
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'getRules'
    });
    const duration = Date.now() - startTime;

    if (response && response.rules) {
      await chrome.storage.local.set({
        rules: response.rules,
        lastSync: Date.now(),
        lastError: null,
        source: 'native'
      });
      log('info', `Loaded ${response.rules.length} rules in ${duration}ms`);

      // Notify all tabs to re-apply rules
      const tabs = await chrome.tabs.query({});
      let notified = 0;
      for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
          try {
            await chrome.tabs.sendMessage(tab.id, { action: 'rulesUpdated' });
            notified++;
          } catch {
            // Tab doesn't have content script
          }
        }
      }
      log('debug', `Notified ${notified} tabs`);

      return { success: true, count: response.rules.length };
    } else if (response && response.error) {
      throw new Error(response.error);
    } else {
      throw new Error('Invalid response from native host');
    }
  } catch (error) {
    log('error', 'Native messaging error', error.message);
    await chrome.storage.local.set({
      lastError: error.message,
      lastErrorTime: Date.now()
    });

    // Try fallback
    return await loadFallbackRules();
  }
}

/**
 * Fallback: Load rules directly from file (for debugging)
 */
async function loadFallbackRules() {
  log('debug', 'Trying fallback methods...');

  // Method 1: Local dev server
  try {
    const response = await fetch('http://localhost:3847/injection-rules.json');
    if (response.ok) {
      const data = await response.json();
      const prodRules = data.rules.filter(r => r.status === 'prod' && r.enabled);
      await chrome.storage.local.set({
        rules: prodRules,
        lastSync: Date.now(),
        source: 'fallback-server'
      });
      log('info', `Fallback: Loaded ${prodRules.length} rules from dev server`);
      return { success: true, count: prodRules.length, source: 'fallback-server' };
    }
  } catch {
    log('debug', 'Fallback server not available');
  }

  return { success: false, message: 'All methods failed' };
}

/**
 * Get full diagnostic info
 */
async function getDiagnostics() {
  const storage = await chrome.storage.local.get(null);
  const manifest = chrome.runtime.getManifest();

  // Test native host
  const nativeTest = await testNativeHost();

  return {
    extension: {
      id: chrome.runtime.id,
      version: manifest.version,
      name: manifest.name
    },
    nativeHost: {
      name: NATIVE_HOST_NAME,
      test: nativeTest
    },
    storage: {
      rulesCount: storage.rules?.length || 0,
      lastSync: storage.lastSync ? new Date(storage.lastSync).toISOString() : 'Never',
      lastError: storage.lastError || null,
      source: storage.source || 'unknown'
    },
    debugLog: debugLog.slice(-20) // Last 20 entries
  };
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Standard actions
  if (message.action === 'getRules') {
    chrome.storage.local.get(['rules'], (result) => {
      sendResponse({ rules: result.rules || [] });
    });
    return true;
  }

  if (message.action === 'getMatchingRules') {
    chrome.storage.local.get(['rules'], (result) => {
      const rules = result.rules || [];
      log('debug', `getMatchingRules: ${rules.length} total rules, URL: ${message.url}`);

      const matching = rules.filter(rule => {
        const matches = matchUrl(message.url, rule.urlPattern, rule.excludePatterns);
        log('debug', `  Rule "${rule.name}" pattern="${rule.urlPattern}" excludes=${rule.excludePatterns?.length || 0} matches=${matches}`);
        return matches;
      });

      log('debug', `getMatchingRules: ${matching.length} matching rules`);
      sendResponse({ rules: matching });
    });
    return true;
  }

  if (message.action === 'refreshRules') {
    refreshRules().then(sendResponse);
    return true;
  }

  if (message.action === 'updateBadge') {
    updateBadge(sender.tab?.id, message.count);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'toggleRule') {
    toggleRuleEnabled(message.ruleId, message.enabled).then(sendResponse);
    return true;
  }

  // DEBUG actions
  if (message.action === 'debug:test') {
    testNativeHost().then(sendResponse);
    return true;
  }

  if (message.action === 'debug:diagnostics') {
    getDiagnostics().then(sendResponse);
    return true;
  }

  if (message.action === 'debug:log') {
    sendResponse({ log: debugLog });
    return true;
  }

  if (message.action === 'debug:clearLog') {
    debugLog = [];
    sendResponse({ success: true });
    return true;
  }
});

/**
 * Toggle rule enabled state in local storage
 * Note: This only affects local state, not the source file
 */
async function toggleRuleEnabled(ruleId, enabled) {
  log('debug', `Toggling rule ${ruleId} to ${enabled}`);

  try {
    const { rules = [] } = await chrome.storage.local.get(['rules']);
    const ruleIndex = rules.findIndex(r => r.id === ruleId);

    if (ruleIndex === -1) {
      return { success: false, message: 'Rule not found' };
    }

    rules[ruleIndex].enabled = enabled;
    await chrome.storage.local.set({ rules });

    // Notify all tabs to re-apply rules
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'rulesUpdated' });
        } catch {
          // Tab doesn't have content script
        }
      }
    }

    log('info', `Rule ${ruleId} ${enabled ? 'enabled' : 'disabled'}`);
    return { success: true };
  } catch (error) {
    log('error', 'Failed to toggle rule', error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Update badge with count of active rules
 */
function updateBadge(tabId, count) {
  if (!tabId) return;

  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

/**
 * Match URL against glob pattern
 */
function matchUrlPattern(url, pattern) {
  if (!url || !pattern) return false;

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  try {
    const regex = new RegExp(`^${escaped}$`, 'i');
    return regex.test(url);
  } catch {
    return false;
  }
}

/**
 * Match URL against rule (with exclusion support)
 */
function matchUrl(url, pattern, excludePatterns = []) {
  // First check if URL matches the include pattern
  if (!matchUrlPattern(url, pattern)) return false;

  // Then check if URL matches any exclude pattern
  if (excludePatterns && excludePatterns.length > 0) {
    for (const excludePattern of excludePatterns) {
      if (matchUrlPattern(url, excludePattern)) {
        return false; // URL is excluded
      }
    }
  }

  return true;
}

/**
 * Export cookies for specified domains to HydraSpecter profiles
 * @param {string[]} domains - Domains to export (e.g., ['.google.com', '.notion.so'])
 */
async function exportCookies(domains = []) {
  log('info', `Exporting cookies for domains: ${domains.join(', ') || 'ALL'}`);

  try {
    let allCookies = [];

    if (domains.length === 0) {
      // Export ALL cookies (be careful - this is a lot)
      allCookies = await chrome.cookies.getAll({});
    } else {
      // Export cookies for specific domains
      for (const domain of domains) {
        const cookies = await chrome.cookies.getAll({ domain });
        allCookies = allCookies.concat(cookies);
      }
    }

    log('info', `Found ${allCookies.length} cookies to export`);

    // Convert to Playwright format
    const playwrightCookies = allCookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate || -1,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite === 'no_restriction' ? 'None' :
                cookie.sameSite === 'lax' ? 'Lax' :
                cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
    }));

    // Send to native host for import into HydraSpecter profiles
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'importCookies',
      cookies: playwrightCookies,
      domains: domains
    });

    if (response && response.success) {
      log('info', `Cookies exported successfully: ${response.message}`);
      return {
        success: true,
        count: playwrightCookies.length,
        message: response.message
      };
    } else {
      throw new Error(response?.error || 'Unknown error from native host');
    }
  } catch (error) {
    log('error', 'Cookie export failed', error.message);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Export Google cookies specifically (most common use case)
 */
async function exportGoogleCookies() {
  return exportCookies(['.google.com', '.youtube.com', '.googleapis.com']);
}

/**
 * Export FULL session state (cookies + localStorage + IndexedDB)
 * This is needed for Google auth which uses all three
 */
async function exportFullSession(domains = ['.google.com', '.youtube.com']) {
  log('info', `Exporting full session for: ${domains.join(', ')}`);

  const result = {
    cookies: [],
    localStorage: [],
    indexedDB: [],
    exportedAt: new Date().toISOString()
  };

  try {
    // 1. Export cookies (same as before)
    for (const domain of domains) {
      const cookies = await chrome.cookies.getAll({ domain });
      result.cookies = result.cookies.concat(cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expirationDate || -1,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === 'no_restriction' ? 'None' :
                  cookie.sameSite === 'lax' ? 'Lax' :
                  cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
      })));
    }
    log('info', `Exported ${result.cookies.length} cookies`);

    // 2. Export localStorage and IndexedDB from Google tabs
    const tabs = await chrome.tabs.query({ url: ['*://*.google.com/*', '*://mail.google.com/*', '*://accounts.google.com/*'] });

    for (const tab of tabs) {
      if (!tab.id) continue;

      try {
        // Export localStorage
        const lsResponse = await chrome.tabs.sendMessage(tab.id, { action: 'exportLocalStorage' });
        if (lsResponse && lsResponse.data) {
          result.localStorage.push(lsResponse);
          log('info', `Exported localStorage from ${lsResponse.origin}: ${Object.keys(lsResponse.data).length} keys`);
        }

        // Export IndexedDB
        const idbResponse = await chrome.tabs.sendMessage(tab.id, { action: 'exportIndexedDB' });
        if (idbResponse && idbResponse.databases) {
          result.indexedDB.push(idbResponse);
          log('info', `Exported IndexedDB from ${idbResponse.origin}: ${idbResponse.databases.length} databases`);
        }
      } catch (e) {
        log('debug', `Could not export from tab ${tab.url}: ${e.message}`);
      }
    }

    // 3. Send to native host
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'importFullSession',
      session: result
    });

    if (response && response.success) {
      log('info', `Full session exported: ${response.message}`);
      return {
        success: true,
        cookies: result.cookies.length,
        localStorage: result.localStorage.length,
        indexedDB: result.indexedDB.length,
        message: response.message
      };
    } else {
      throw new Error(response?.error || 'Unknown error from native host');
    }
  } catch (error) {
    log('error', 'Full session export failed', error.message);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Export session for a specific site from SITES_CONFIG
 * @param {string} siteKey - Key from SITES_CONFIG (e.g., 'google', 'homeexchange')
 */
async function exportSiteSession(siteKey) {
  const site = SITES_CONFIG[siteKey];
  if (!site) {
    return { success: false, message: `Unknown site: ${siteKey}` };
  }

  log('info', `Exporting session for ${site.name}...`);

  const result = {
    site: siteKey,
    siteName: site.name,
    cookies: [],
    localStorage: [],
    indexedDB: [],
    exportedAt: new Date().toISOString()
  };

  try {
    // 1. Export cookies for all domains
    if (site.needs.cookies) {
      for (const domain of site.domains) {
        const cookies = await chrome.cookies.getAll({ domain });
        result.cookies = result.cookies.concat(cookies.map(cookie => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expirationDate || -1,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite === 'no_restriction' ? 'None' :
                    cookie.sameSite === 'lax' ? 'Lax' :
                    cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
        })));
      }
      log('info', `  Cookies: ${result.cookies.length}`);
    }

    // 2. Export localStorage and IndexedDB from matching tabs
    if (site.needs.localStorage || site.needs.indexedDB) {
      const tabs = await chrome.tabs.query({ url: site.tabPatterns });
      log('info', `  Found ${tabs.length} matching tabs`);

      for (const tab of tabs) {
        if (!tab.id) continue;

        try {
          if (site.needs.localStorage) {
            const lsResponse = await chrome.tabs.sendMessage(tab.id, { action: 'exportLocalStorage' });
            if (lsResponse && lsResponse.data) {
              result.localStorage.push(lsResponse);
              log('info', `  localStorage from ${lsResponse.origin}: ${Object.keys(lsResponse.data).length} keys`);
            }
          }

          if (site.needs.indexedDB) {
            const idbResponse = await chrome.tabs.sendMessage(tab.id, { action: 'exportIndexedDB' });
            if (idbResponse && idbResponse.databases) {
              result.indexedDB.push(idbResponse);
              log('info', `  IndexedDB from ${idbResponse.origin}: ${idbResponse.databases.length} databases`);
            }
          }
        } catch (e) {
          log('debug', `  Could not export from tab ${tab.url}: ${e.message}`);
        }
      }
    }

    // 3. Send to native host
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'importSiteSession',
      site: siteKey,
      session: result
    });

    if (response && response.success) {
      log('info', `Session exported for ${site.name}: ${response.message}`);
      return {
        success: true,
        site: siteKey,
        siteName: site.name,
        cookies: result.cookies.length,
        localStorage: result.localStorage.length,
        indexedDB: result.indexedDB.length,
        message: response.message
      };
    } else {
      throw new Error(response?.error || 'Unknown error from native host');
    }
  } catch (error) {
    log('error', `Session export failed for ${site.name}`, error.message);
    return {
      success: false,
      site: siteKey,
      siteName: site.name,
      message: error.message
    };
  }
}

/**
 * Export sessions for ALL configured sites
 */
async function exportAllSiteSessions() {
  log('info', 'Exporting ALL site sessions...');

  const results = {
    success: true,
    sites: {},
    totalCookies: 0,
    totalLocalStorage: 0,
    totalIndexedDB: 0,
    failed: []
  };

  for (const siteKey of Object.keys(SITES_CONFIG)) {
    const result = await exportSiteSession(siteKey);
    results.sites[siteKey] = result;

    if (result.success) {
      results.totalCookies += result.cookies || 0;
      results.totalLocalStorage += result.localStorage || 0;
      results.totalIndexedDB += result.indexedDB || 0;
    } else {
      results.failed.push(siteKey);
    }
  }

  results.success = results.failed.length === 0;
  results.message = `Exported ${Object.keys(SITES_CONFIG).length - results.failed.length}/${Object.keys(SITES_CONFIG).length} sites (${results.totalCookies} cookies, ${results.totalLocalStorage} localStorage, ${results.totalIndexedDB} IndexedDB)`;

  log('info', results.message);
  return results;
}

/**
 * Get list of configured sites
 */
function getSitesConfig() {
  return Object.entries(SITES_CONFIG).map(([key, config]) => ({
    key,
    name: config.name,
    domains: config.domains,
    needs: config.needs
  }));
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Cookie export actions
  if (message.action === 'exportCookies') {
    exportCookies(message.domains || []).then(sendResponse);
    return true;
  }

  if (message.action === 'exportGoogleCookies') {
    exportGoogleCookies().then(sendResponse);
    return true;
  }

  if (message.action === 'exportFullSession') {
    exportFullSession(message.domains || ['.google.com', '.youtube.com']).then(sendResponse);
    return true;
  }

  // New site-based export actions
  if (message.action === 'getSitesConfig') {
    sendResponse({ sites: getSitesConfig() });
    return true;
  }

  if (message.action === 'exportSiteSession') {
    exportSiteSession(message.siteKey).then(sendResponse);
    return true;
  }

  if (message.action === 'exportAllSiteSessions') {
    exportAllSiteSessions().then(sendResponse);
    return true;
  }

  // Continue with existing message handlers below...
});

// Set up periodic refresh
setInterval(refreshRules, REFRESH_INTERVAL);

// Initial refresh
log('info', 'Background script loaded');
refreshRules();
