#!/usr/bin/env node
/**
 * Export Chrome sessions for all configured sites to HydraSpecter profiles.
 *
 * IMPORTANT: Chrome must be CLOSED for this to work (otherwise cookies are locked).
 *
 * Usage:
 *   node scripts/export-chrome-sessions.cjs
 *   node scripts/export-chrome-sessions.cjs --site google
 *   node scripts/export-chrome-sessions.cjs --list
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Try to load better-sqlite3
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('Error: better-sqlite3 not found. Run from hydraspecter directory:');
  console.error('  cd hydraspecter && node scripts/export-chrome-sessions.cjs');
  process.exit(1);
}

// Paths
const CHROME_PROFILE = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Google', 'Chrome', 'User Data', 'Default'
);
const CHROME_COOKIES = path.join(CHROME_PROFILE, 'Network', 'Cookies');
const PROFILES_DIR = path.join(os.homedir(), '.hydraspecter', 'profiles');
const SITE_SESSIONS_DIR = path.join(os.homedir(), '.hydraspecter', 'site-sessions');

// Sites configuration - what each site needs
const SITES_CONFIG = {
  google: {
    name: "Google (Gmail, YouTube, Drive)",
    domains: [".google.com", ".youtube.com", ".googleapis.com", "google.com", "youtube.com"],
    testUrl: "https://mail.google.com"
  },
  homeexchange: {
    name: "HomeExchange",
    domains: [".homeexchange.com", "homeexchange.com"],
    testUrl: "https://www.homeexchange.com/my/searches"
  },
  notion: {
    name: "Notion",
    domains: [".notion.so", "notion.so"],
    testUrl: "https://www.notion.so"
  },
  amazon: {
    name: "Amazon",
    domains: [".amazon.fr", ".amazon.com", ".amazon.de", "amazon.fr", "amazon.com"],
    testUrl: "https://www.amazon.fr/gp/css/order-history"
  },
  github: {
    name: "GitHub",
    domains: [".github.com", "github.com"],
    testUrl: "https://github.com/settings/profile"
  },
  kiabi: {
    name: "Kiabi",
    domains: [".kiabi.com", "kiabi.com"],
    testUrl: "https://www.kiabi.com/mon-compte"
  },
  temu: {
    name: "Temu",
    domains: [".temu.com", "temu.com"],
    testUrl: "https://www.temu.com/account"
  },
  aliexpress: {
    name: "AliExpress",
    domains: [".aliexpress.com", "aliexpress.com"],
    testUrl: "https://www.aliexpress.com/p/order/index.html"
  },
  discord: {
    name: "Discord",
    domains: [".discord.com", "discord.com"],
    testUrl: "https://discord.com/channels/@me"
  },
  spotify: {
    name: "Spotify",
    domains: [".spotify.com", "spotify.com"],
    testUrl: "https://open.spotify.com"
  }
};

// Colors for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(color, symbol, message) {
  console.log(`${colors[color]}${symbol}${colors.reset} ${message}`);
}

/**
 * Check if Chrome is running
 */
function isChromeRunning() {
  try {
    const { execSync } = require('child_process');
    const result = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf-8' });
    return result.toLowerCase().includes('chrome.exe');
  } catch {
    return false;
  }
}

/**
 * Read all cookies from Chrome's SQLite database
 */
function readChromeCookies() {
  if (!fs.existsSync(CHROME_COOKIES)) {
    throw new Error(`Chrome cookies not found at: ${CHROME_COOKIES}`);
  }

  const db = new Database(CHROME_COOKIES, { readonly: true, fileMustExist: true });

  // Get all cookies
  const cookies = db.prepare(`
    SELECT
      host_key as domain,
      name,
      value,
      path,
      expires_utc,
      is_secure,
      is_httponly,
      samesite,
      encrypted_value
    FROM cookies
  `).all();

  db.close();

  return cookies;
}

/**
 * Convert Chrome cookie to Playwright format
 */
function convertCookie(chromeCookie) {
  // Chrome stores expiry as Windows FILETIME (microseconds since 1601)
  // Convert to Unix timestamp
  let expires = -1;
  if (chromeCookie.expires_utc && chromeCookie.expires_utc > 0) {
    // Chrome epoch: Jan 1, 1601. Unix epoch: Jan 1, 1970. Difference: 11644473600 seconds
    expires = Math.floor((chromeCookie.expires_utc / 1000000) - 11644473600);
  }

  // Note: encrypted_value cannot be decrypted without DPAPI (Windows only, requires same user)
  // Chrome v127+ uses App-Bound encryption which we can't decrypt
  // So we only get the 'value' field which may be empty for encrypted cookies

  return {
    name: chromeCookie.name,
    value: chromeCookie.value || '', // May be empty if encrypted
    domain: chromeCookie.domain,
    path: chromeCookie.path || '/',
    expires: expires,
    httpOnly: !!chromeCookie.is_httponly,
    secure: !!chromeCookie.is_secure,
    sameSite: chromeCookie.samesite === 0 ? 'None' :
              chromeCookie.samesite === 1 ? 'Lax' :
              chromeCookie.samesite === 2 ? 'Strict' : 'Lax'
  };
}

/**
 * Filter cookies for a specific site
 */
function getCookiesForSite(allCookies, siteKey) {
  const site = SITES_CONFIG[siteKey];
  if (!site) return [];

  return allCookies.filter(cookie => {
    const domain = cookie.domain.toLowerCase();
    return site.domains.some(d => {
      const siteDomain = d.toLowerCase();
      return domain === siteDomain ||
             domain.endsWith(siteDomain) ||
             siteDomain.endsWith(domain);
    });
  });
}

/**
 * Save cookies to HydraSpecter profiles
 */
function saveCookiesToProfiles(cookies, siteKey) {
  // Ensure directories exist
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  fs.mkdirSync(SITE_SESSIONS_DIR, { recursive: true });

  // Save site-specific session
  const siteSession = {
    site: siteKey,
    siteName: SITES_CONFIG[siteKey]?.name || siteKey,
    cookies: cookies,
    localStorage: [],
    indexedDB: [],
    exportedAt: new Date().toISOString(),
    note: 'Exported from Chrome cookies database. localStorage/IndexedDB require Chrome extension.'
  };

  const siteSessionPath = path.join(SITE_SESSIONS_DIR, `${siteKey}.json`);
  fs.writeFileSync(siteSessionPath, JSON.stringify(siteSession, null, 2));

  // Get or create pools
  let pools = [];
  if (fs.existsSync(PROFILES_DIR)) {
    pools = fs.readdirSync(PROFILES_DIR).filter(d => d.startsWith('pool-'));
  }
  if (pools.length === 0) {
    pools = ['pool-0'];
  }

  // Merge into each pool
  for (const pool of pools) {
    const poolDir = path.join(PROFILES_DIR, pool);
    fs.mkdirSync(poolDir, { recursive: true });

    const storageStatePath = path.join(poolDir, 'storage-state.json');

    // Load existing or create new
    let existingState = { cookies: [], origins: [] };
    if (fs.existsSync(storageStatePath)) {
      try {
        existingState = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
      } catch (e) {
        // Corrupted, start fresh
      }
    }

    // Merge cookies (replace by domain+name+path)
    const cookieKey = (c) => `${c.domain}|${c.name}|${c.path}`;
    const cookieMap = new Map();

    for (const cookie of existingState.cookies || []) {
      cookieMap.set(cookieKey(cookie), cookie);
    }
    for (const cookie of cookies) {
      cookieMap.set(cookieKey(cookie), cookie);
    }

    existingState.cookies = Array.from(cookieMap.values());

    // Save
    fs.writeFileSync(storageStatePath, JSON.stringify(existingState, null, 2));
    fs.writeFileSync(path.join(poolDir, 'imported-cookies.json'), JSON.stringify(existingState, null, 2));
  }

  return pools.length;
}

/**
 * Export sessions for all sites
 */
async function exportAllSites(siteFilter = null) {
  console.log('\n' + '='.repeat(60));
  console.log(colors.cyan + '  HydraSpecter - Chrome Session Exporter' + colors.reset);
  console.log('='.repeat(60) + '\n');

  // Check if Chrome is running
  if (isChromeRunning()) {
    log('yellow', '⚠', 'Chrome is running. Some cookies may be locked.');
    log('dim', ' ', 'For best results, close Chrome completely.\n');
  }

  // Read all cookies
  log('cyan', '→', 'Reading Chrome cookies database...');
  let allCookies;
  try {
    const rawCookies = readChromeCookies();
    allCookies = rawCookies.map(convertCookie);
    log('green', '✓', `Found ${allCookies.length} total cookies`);
  } catch (error) {
    log('red', '✗', `Failed to read cookies: ${error.message}`);
    if (error.message.includes('SQLITE_BUSY')) {
      log('yellow', ' ', 'Chrome has the database locked. Please close Chrome and try again.');
    }
    return;
  }

  console.log('\n' + '-'.repeat(60) + '\n');

  // Process each site
  const sites = siteFilter ? [siteFilter] : Object.keys(SITES_CONFIG);
  const results = {};

  for (const siteKey of sites) {
    const site = SITES_CONFIG[siteKey];
    if (!site) {
      log('red', '✗', `Unknown site: ${siteKey}`);
      continue;
    }

    process.stdout.write(`${colors.cyan}→${colors.reset} ${site.name.padEnd(35)}`);

    const siteCookies = getCookiesForSite(allCookies, siteKey);
    const nonEmptyCookies = siteCookies.filter(c => c.value && c.value.length > 0);

    if (siteCookies.length === 0) {
      console.log(`${colors.yellow}⊘ No cookies found${colors.reset}`);
      results[siteKey] = { success: false, reason: 'no_cookies' };
      continue;
    }

    if (nonEmptyCookies.length === 0) {
      console.log(`${colors.yellow}⚠ ${siteCookies.length} cookies (all encrypted)${colors.reset}`);
      results[siteKey] = { success: false, reason: 'encrypted', count: siteCookies.length };
      continue;
    }

    // Save to profiles
    const poolsUpdated = saveCookiesToProfiles(nonEmptyCookies, siteKey);
    console.log(`${colors.green}✓ ${nonEmptyCookies.length} cookies → ${poolsUpdated} pools${colors.reset}`);
    results[siteKey] = { success: true, cookies: nonEmptyCookies.length, pools: poolsUpdated };
  }

  // Summary
  console.log('\n' + '-'.repeat(60));
  console.log('\n' + colors.cyan + 'Summary:' + colors.reset);

  const successful = Object.entries(results).filter(([, r]) => r.success);
  const encrypted = Object.entries(results).filter(([, r]) => r.reason === 'encrypted');
  const noCookies = Object.entries(results).filter(([, r]) => r.reason === 'no_cookies');

  if (successful.length > 0) {
    log('green', '✓', `${successful.length} sites exported successfully`);
  }
  if (encrypted.length > 0) {
    log('yellow', '⚠', `${encrypted.length} sites have encrypted cookies (use Chrome extension)`);
    console.log(colors.dim + '    Sites: ' + encrypted.map(([k]) => k).join(', ') + colors.reset);
  }
  if (noCookies.length > 0) {
    log('yellow', '⊘', `${noCookies.length} sites have no cookies (not logged in Chrome)`);
    console.log(colors.dim + '    Sites: ' + noCookies.map(([k]) => k).join(', ') + colors.reset);
  }

  console.log('\n' + colors.dim + 'Note: For encrypted cookies (Chrome v127+), use the Chrome extension' + colors.reset);
  console.log(colors.dim + '      while Chrome is open to export them.' + colors.reset);
  console.log();
}

/**
 * List all configured sites
 */
function listSites() {
  console.log('\n' + colors.cyan + 'Configured sites:' + colors.reset + '\n');

  for (const [key, site] of Object.entries(SITES_CONFIG)) {
    console.log(`  ${colors.green}${key.padEnd(15)}${colors.reset} ${site.name}`);
    console.log(`  ${colors.dim}${''.padEnd(15)} Domains: ${site.domains.join(', ')}${colors.reset}`);
    console.log();
  }
}

// Main
const args = process.argv.slice(2);

if (args.includes('--list') || args.includes('-l')) {
  listSites();
} else if (args.includes('--site') || args.includes('-s')) {
  const siteIndex = args.indexOf('--site') !== -1 ? args.indexOf('--site') : args.indexOf('-s');
  const siteKey = args[siteIndex + 1];
  if (!siteKey) {
    console.error('Error: --site requires a site key');
    listSites();
    process.exit(1);
  }
  exportAllSites(siteKey);
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/export-chrome-sessions.cjs [options]

Options:
  --list, -l        List all configured sites
  --site, -s KEY    Export only a specific site
  --help, -h        Show this help

Examples:
  node scripts/export-chrome-sessions.cjs                 # Export all sites
  node scripts/export-chrome-sessions.cjs --site google   # Export only Google
  node scripts/export-chrome-sessions.cjs --list          # List sites
`);
} else {
  exportAllSites();
}
