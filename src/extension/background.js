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

  // Continue with existing message handlers below...
});

// Set up periodic refresh
setInterval(refreshRules, REFRESH_INTERVAL);

// Initial refresh
log('info', 'Background script loaded');
refreshRules();
