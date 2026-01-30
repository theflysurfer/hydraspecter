/**
 * HydraSpecter Inject - Popup Script with Debug
 */

// Elements - Main
const currentUrlEl = document.getElementById('currentUrl');
const totalRulesEl = document.getElementById('totalRules');
const activeRulesEl = document.getElementById('activeRules');
const rulesListEl = document.getElementById('rulesList');
const refreshBtn = document.getElementById('refreshBtn');
const lastSyncEl = document.getElementById('lastSync');

// Elements - Debug
const extIdEl = document.getElementById('extId');
const extVersionEl = document.getElementById('extVersion');
const nativeStatusEl = document.getElementById('nativeStatus');
const nativeDetailsEl = document.getElementById('nativeDetails');
const storageRulesEl = document.getElementById('storageRules');
const storageSourceEl = document.getElementById('storageSource');
const storageErrorEl = document.getElementById('storageError');
const debugLogEl = document.getElementById('debugLog');
const testNativeBtn = document.getElementById('testNativeBtn');
const loadLogBtn = document.getElementById('loadLogBtn');
const clearLogBtn = document.getElementById('clearLogBtn');

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

    if (tab.dataset.tab === 'debug') {
      updateDebugUI();
    }
  });
});

function matchUrlPattern(url, pattern) {
  if (!url || !pattern) return false;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${escaped}$`, 'i').test(url);
  } catch {
    return false;
  }
}

function matchUrl(url, pattern, excludePatterns = []) {
  if (!matchUrlPattern(url, pattern)) return false;
  if (excludePatterns && excludePatterns.length > 0) {
    for (const excludePattern of excludePatterns) {
      if (matchUrlPattern(url, excludePattern)) return false;
    }
  }
  return true;
}

function formatTime(timestamp) {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderRules(rules, currentUrl) {
  if (!rules || rules.length === 0) {
    rulesListEl.innerHTML = '<div class="empty">No rules loaded</div>';
    return;
  }
  const matchingRules = rules.filter(r => matchUrl(currentUrl, r.urlPattern));
  if (matchingRules.length === 0) {
    rulesListEl.innerHTML = '<div class="empty">No rules for this page</div>';
    return;
  }
  rulesListEl.innerHTML = matchingRules.map(rule => `
    <div class="rule ${rule.enabled ? '' : 'disabled'}" data-rule-id="${escapeHtml(rule.id)}">
      <div class="rule-icon"></div>
      <div class="rule-info">
        <div class="rule-name">${escapeHtml(rule.name)}</div>
        <div class="rule-pattern">${escapeHtml(rule.urlPattern)}</div>
      </div>
      <div class="rule-badge">${rule.css ? 'CSS' : ''}${rule.css && rule.js ? '+' : ''}${rule.js ? 'JS' : ''}</div>
      <label class="rule-toggle">
        <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-rule-id="${escapeHtml(rule.id)}">
        <span class="slider"></span>
      </label>
    </div>
  `).join('');

  // Add toggle event listeners
  rulesListEl.querySelectorAll('.rule-toggle input').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const ruleId = e.target.dataset.ruleId;
      const enabled = e.target.checked;
      await toggleRule(ruleId, enabled);
    });
  });
}

async function toggleRule(ruleId, enabled) {
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'toggleRule',
      ruleId,
      enabled
    });
    if (result.success) {
      await updateUI();
    }
  } catch (error) {
    console.error('Failed to toggle rule:', error);
  }
}

async function updateUI() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url || '';
  currentUrlEl.textContent = currentUrl || '-';
  currentUrlEl.title = currentUrl;

  const { rules = [], lastSync } = await chrome.storage.local.get(['rules', 'lastSync']);
  totalRulesEl.textContent = rules.length;
  const matchingRules = rules.filter(r => matchUrl(currentUrl, r.urlPattern, r.excludePatterns));
  activeRulesEl.textContent = matchingRules.filter(r => r.enabled).length;
  renderRules(rules, currentUrl);
  lastSyncEl.textContent = `Sync: ${formatTime(lastSync)}`;
}

async function updateDebugUI() {
  // Extension info
  const manifest = chrome.runtime.getManifest();
  extIdEl.textContent = chrome.runtime.id;
  extVersionEl.textContent = manifest.version;

  // Storage info
  const storage = await chrome.storage.local.get(null);
  storageRulesEl.textContent = storage.rules?.length || 0;
  storageSourceEl.textContent = storage.source || 'unknown';
  storageErrorEl.textContent = storage.lastError || 'None';
  storageErrorEl.className = `debug-value ${storage.lastError ? 'error' : ''}`;
}

async function testNativeConnection() {
  testNativeBtn.disabled = true;
  testNativeBtn.textContent = 'Testing...';
  nativeStatusEl.innerHTML = '<span class="status-dot pending"></span>Testing...';
  nativeDetailsEl.innerHTML = '';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'debug:test' });

    if (result.success) {
      nativeStatusEl.innerHTML = `<span class="status-dot success"></span>${result.message}`;
    } else {
      nativeStatusEl.innerHTML = `<span class="status-dot error"></span>Failed`;

      let details = '';
      if (result.error) {
        details += `<div class="debug-item"><div class="debug-label">Error</div><div class="debug-value error">${escapeHtml(result.message)}</div></div>`;
      }
      if (result.hints) {
        details += `<div class="debug-item"><div class="debug-label">Hints</div>`;
        result.hints.forEach(hint => {
          details += `<div class="hint">${escapeHtml(hint)}</div>`;
        });
        details += `</div>`;
      }
      nativeDetailsEl.innerHTML = details;
    }
  } catch (error) {
    nativeStatusEl.innerHTML = `<span class="status-dot error"></span>Error`;
    nativeDetailsEl.innerHTML = `<div class="debug-item"><div class="debug-value error">${escapeHtml(error.message)}</div></div>`;
  } finally {
    testNativeBtn.disabled = false;
    testNativeBtn.textContent = 'Test Connection';
  }
}

async function loadDebugLog() {
  try {
    const result = await chrome.runtime.sendMessage({ action: 'debug:log' });
    if (result.log && result.log.length > 0) {
      debugLogEl.innerHTML = result.log.map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        return `<div class="log-entry ${entry.level}">[${time}] ${entry.message}</div>`;
      }).join('');
      debugLogEl.scrollTop = debugLogEl.scrollHeight;
    } else {
      debugLogEl.innerHTML = '<div class="log-entry">No log entries</div>';
    }
  } catch (error) {
    debugLogEl.innerHTML = `<div class="log-entry error">Error: ${error.message}</div>`;
  }
}

async function clearDebugLog() {
  await chrome.runtime.sendMessage({ action: 'debug:clearLog' });
  debugLogEl.innerHTML = '<div class="log-entry">Log cleared</div>';
}

async function refreshRules() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';
  try {
    const result = await chrome.runtime.sendMessage({ action: 'refreshRules' });
    await updateUI();
    if (!result.success) {
      lastSyncEl.textContent = `Error: ${result.message || 'Unknown'}`;
    }
  } catch (error) {
    lastSyncEl.textContent = `Error: ${error.message}`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh Rules';
  }
}

// Elements - Cookies
const exportAllSitesBtn = document.getElementById('exportAllSitesBtn');
const exportProgressEl = document.getElementById('exportProgress');
const sitesListEl = document.getElementById('sitesList');
const lastExportEl = document.getElementById('lastExport');
const exportResultEl = document.getElementById('exportResult');

/**
 * Load and display sites configuration
 */
async function loadSitesConfig() {
  try {
    const result = await chrome.runtime.sendMessage({ action: 'getSitesConfig' });
    const sites = result.sites || [];

    if (sites.length === 0) {
      sitesListEl.innerHTML = '<div class="empty">No sites configured</div>';
      return;
    }

    sitesListEl.innerHTML = sites.map(site => `
      <div class="rule" data-site-key="${escapeHtml(site.key)}">
        <div class="rule-icon" style="background: #667eea;"></div>
        <div class="rule-info">
          <div class="rule-name">${escapeHtml(site.name)}</div>
          <div class="rule-pattern">${escapeHtml(site.domains.slice(0, 2).join(', '))}</div>
        </div>
        <button class="debug-btn export-site-btn" data-site-key="${escapeHtml(site.key)}" style="margin: 0; padding: 3px 8px;">
          Export
        </button>
      </div>
    `).join('');

    // Add click handlers
    sitesListEl.querySelectorAll('.export-site-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const siteKey = e.target.dataset.siteKey;
        await exportSiteSession(siteKey, e.target);
      });
    });
  } catch (error) {
    sitesListEl.innerHTML = `<div class="empty error">Error: ${error.message}</div>`;
  }
}

/**
 * Export session for a specific site
 */
async function exportSiteSession(siteKey, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '...';

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'exportSiteSession',
      siteKey: siteKey
    });

    if (result.success) {
      button.textContent = '✓';
      button.style.background = '#3fb950';
      lastExportEl.textContent = new Date().toLocaleTimeString();
      exportResultEl.textContent = `${result.siteName}: ${result.cookies} cookies`;
      exportResultEl.className = 'debug-value success';
    } else {
      button.textContent = '✗';
      button.style.background = '#f85149';
      exportResultEl.textContent = result.message || 'Failed';
      exportResultEl.className = 'debug-value error';
    }

    // Reset button after 2 seconds
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = '';
      button.disabled = false;
    }, 2000);
  } catch (error) {
    button.textContent = '✗';
    button.style.background = '#f85149';
    exportResultEl.textContent = error.message;
    exportResultEl.className = 'debug-value error';

    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = '';
      button.disabled = false;
    }, 2000);
  }
}

/**
 * Export ALL sites at once
 */
async function exportAllSites() {
  exportAllSitesBtn.disabled = true;
  exportAllSitesBtn.textContent = 'Exporting...';
  exportProgressEl.style.display = 'block';
  exportProgressEl.textContent = 'Starting export...';
  exportResultEl.textContent = '';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'exportAllSiteSessions' });

    if (result.success) {
      lastExportEl.textContent = new Date().toLocaleTimeString();
      exportProgressEl.style.display = 'none';
      exportResultEl.textContent = result.message;
      exportResultEl.className = 'debug-value success';
    } else {
      exportProgressEl.style.display = 'none';
      exportResultEl.textContent = `Partial: ${result.message}`;
      exportResultEl.className = 'debug-value';
      if (result.failed && result.failed.length > 0) {
        exportResultEl.textContent += ` (Failed: ${result.failed.join(', ')})`;
      }
    }
  } catch (error) {
    exportProgressEl.style.display = 'none';
    exportResultEl.textContent = error.message;
    exportResultEl.className = 'debug-value error';
  } finally {
    exportAllSitesBtn.disabled = false;
    exportAllSitesBtn.textContent = '🚀 Export ALL Sites';
  }
}

// Event listeners
refreshBtn.addEventListener('click', refreshRules);
testNativeBtn.addEventListener('click', testNativeConnection);
loadLogBtn.addEventListener('click', loadDebugLog);
clearLogBtn.addEventListener('click', clearDebugLog);
exportAllSitesBtn?.addEventListener('click', exportAllSites);

// Tab change handler - load sites when cookies tab is shown
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'cookies') {
      loadSitesConfig();
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updateUI();
});

// Initial
updateUI();
// Load sites config if cookies tab is active
if (document.querySelector('.tab[data-tab="cookies"]')?.classList.contains('active')) {
  loadSitesConfig();
}
