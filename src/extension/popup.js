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

function matchUrl(url, pattern) {
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
    <div class="rule">
      <div class="rule-icon"></div>
      <div class="rule-info">
        <div class="rule-name">${escapeHtml(rule.name)}</div>
        <div class="rule-pattern">${escapeHtml(rule.urlPattern)}</div>
      </div>
      <div class="rule-badge">${rule.css ? 'CSS' : ''}${rule.css && rule.js ? '+' : ''}${rule.js ? 'JS' : ''}</div>
    </div>
  `).join('');
}

async function updateUI() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url || '';
  currentUrlEl.textContent = currentUrl || '-';
  currentUrlEl.title = currentUrl;

  const { rules = [], lastSync } = await chrome.storage.local.get(['rules', 'lastSync']);
  totalRulesEl.textContent = rules.length;
  const matchingRules = rules.filter(r => matchUrl(currentUrl, r.urlPattern));
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

// Event listeners
refreshBtn.addEventListener('click', refreshRules);
testNativeBtn.addEventListener('click', testNativeConnection);
loadLogBtn.addEventListener('click', loadDebugLog);
clearLogBtn.addEventListener('click', clearDebugLog);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updateUI();
});

// Initial
updateUI();
