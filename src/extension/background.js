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
        const matches = matchUrl(message.url, rule.urlPattern);
        log('debug', `  Rule "${rule.name}" pattern="${rule.urlPattern}" matches=${matches}`);
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
function matchUrl(url, pattern) {
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

// Set up periodic refresh
setInterval(refreshRules, REFRESH_INTERVAL);

// Initial refresh
log('info', 'Background script loaded');
refreshRules();
