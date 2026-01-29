/**
 * HydraSpecter Inject - Content Script
 *
 * Injects CSS/JS based on matching rules from storage
 */

const STYLE_PREFIX = 'hydraspecter-style-';
const injectedStyles = new Set();

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
 * Inject CSS into page
 */
function injectCSS(rule) {
  const styleId = STYLE_PREFIX + rule.id;

  // Skip if already injected
  if (injectedStyles.has(styleId)) return;

  // Remove existing style with same ID
  const existing = document.getElementById(styleId);
  if (existing) existing.remove();

  // Create style element
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = rule.css;

  // Inject as early as possible
  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(style);
    injectedStyles.add(styleId);
    console.log(`[HydraSpecter] Injected CSS: ${rule.name}`);
  }
}

/**
 * Inject JS into page
 */
function injectJS(rule) {
  // Only inject JS at document_end or document_idle
  if (rule.runAt === 'document_start') return;

  try {
    // Create script element to run in page context
    const script = document.createElement('script');
    script.textContent = rule.js;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // Clean up after execution
    console.log(`[HydraSpecter] Injected JS: ${rule.name}`);
  } catch (error) {
    console.error(`[HydraSpecter] JS injection failed for ${rule.name}:`, error);
  }
}

/**
 * Apply all matching rules to current page
 */
async function applyRules(retryCount = 0) {
  const url = window.location.href;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 200; // ms

  console.log(`[HydraSpecter] Applying rules for: ${url} (attempt ${retryCount + 1})`);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getMatchingRules',
      url: url
    });

    console.log('[HydraSpecter] Got response:', response);

    const rules = response?.rules || [];
    let appliedCount = 0;

    console.log(`[HydraSpecter] Matching rules: ${rules.length}`);

    for (const rule of rules) {
      console.log(`[HydraSpecter] Processing rule: ${rule.name}, enabled=${rule.enabled}, hasCSS=${!!rule.css}`);

      if (!rule.enabled) continue;

      // Inject CSS
      if (rule.css) {
        injectCSS(rule);
        appliedCount++;
      }

      // Inject JS (only at document_end)
      if (rule.js && document.readyState !== 'loading') {
        injectJS(rule);
      }
    }

    // If no rules found and we haven't exhausted retries, try again
    // This handles the case where storage isn't loaded yet at document_start
    if (rules.length === 0 && retryCount < MAX_RETRIES) {
      console.log(`[HydraSpecter] No rules found, retrying in ${RETRY_DELAY}ms...`);
      setTimeout(() => applyRules(retryCount + 1), RETRY_DELAY);
      return 0;
    }

    // Update badge
    if (appliedCount > 0) {
      chrome.runtime.sendMessage({
        action: 'updateBadge',
        count: appliedCount
      }).catch(() => {});
      console.log(`[HydraSpecter] Applied ${appliedCount} rules`);
    }

    return appliedCount;
  } catch (error) {
    console.error('[HydraSpecter] Error applying rules:', error);

    // Retry on error (background might not be ready)
    if (retryCount < MAX_RETRIES) {
      console.log(`[HydraSpecter] Error, retrying in ${RETRY_DELAY}ms...`);
      setTimeout(() => applyRules(retryCount + 1), RETRY_DELAY);
    }
    return 0;
  }
}

/**
 * Re-apply JS rules that were waiting for document_end
 */
async function applyJSRules() {
  const url = window.location.href;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getMatchingRules',
      url: url
    });

    const rules = response?.rules || [];

    for (const rule of rules) {
      if (rule.enabled && rule.js) {
        injectJS(rule);
      }
    }
  } catch (error) {
    console.error('[HydraSpecter] Error applying JS rules:', error);
  }
}

// Listen for rule updates from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'rulesUpdated') {
    // Clear injected styles cache and re-apply
    injectedStyles.clear();
    applyRules();
    sendResponse({ success: true });
  }
  return true;
});

// Apply rules immediately (for CSS)
applyRules();

// Apply JS rules when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyJSRules);
} else {
  applyJSRules();
}

// Re-apply on navigation (for SPAs)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    injectedStyles.clear();
    applyRules();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});
