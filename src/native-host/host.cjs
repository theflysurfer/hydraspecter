#!/usr/bin/env node
/**
 * HydraSpecter Inject - Native Messaging Host
 *
 * Reads injection rules from ~/.hydraspecter/injection-rules.json
 * and sends them to the Chrome extension
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RULES_PATH = path.join(os.homedir(), '.hydraspecter', 'injection-rules.json');
const PROFILES_DIR = path.join(os.homedir(), '.hydraspecter', 'profiles');
const EXPORTED_COOKIES_PATH = path.join(os.homedir(), '.hydraspecter', 'exported-cookies.json');
const EXPORTED_SESSION_PATH = path.join(os.homedir(), '.hydraspecter', 'exported-full-session.json');
const SITE_SESSIONS_DIR = path.join(os.homedir(), '.hydraspecter', 'site-sessions');

/**
 * Read a message from stdin (Chrome native messaging protocol)
 */
function readMessage() {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let lengthBuffer = null;
    let messageLength = null;

    process.stdin.on('readable', () => {
      let chunk;

      // First, read the 4-byte length prefix
      if (lengthBuffer === null) {
        lengthBuffer = process.stdin.read(4);
        if (lengthBuffer === null) return;
        messageLength = lengthBuffer.readUInt32LE(0);
      }

      // Then read the message
      if (messageLength !== null) {
        chunk = process.stdin.read(messageLength);
        if (chunk !== null) {
          try {
            const message = JSON.parse(chunk.toString('utf8'));
            resolve(message);
          } catch (e) {
            reject(new Error('Invalid JSON message'));
          }
        }
      }
    });

    process.stdin.on('end', () => {
      if (messageLength === null) {
        reject(new Error('No message received'));
      }
    });

    process.stdin.on('error', reject);
  });
}

/**
 * Write a message to stdout (Chrome native messaging protocol)
 */
function writeMessage(message) {
  const json = JSON.stringify(message);
  const buffer = Buffer.from(json, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(buffer.length, 0);

  process.stdout.write(length);
  process.stdout.write(buffer);
}

/**
 * Import cookies from Chrome extension into HydraSpecter profiles
 * Saves as Playwright-compatible storage state format
 */
function importCookies(cookies, domains) {
  try {
    // Create storage state object
    const storageState = {
      cookies: cookies,
      origins: [] // We don't have localStorage from extension, but cookies are the important part
    };

    // Save to exported-cookies.json (single file for debugging)
    fs.mkdirSync(path.dirname(EXPORTED_COOKIES_PATH), { recursive: true });
    fs.writeFileSync(EXPORTED_COOKIES_PATH, JSON.stringify(storageState, null, 2));

    // Also save directly to each pool's cookies
    let poolsUpdated = 0;
    if (fs.existsSync(PROFILES_DIR)) {
      const pools = fs.readdirSync(PROFILES_DIR).filter(d => d.startsWith('pool-'));

      for (const pool of pools) {
        const poolDir = path.join(PROFILES_DIR, pool, 'Default', 'Network');
        const cookiesPath = path.join(poolDir, 'Cookies');

        // Check if the pool has a Cookies database
        if (fs.existsSync(cookiesPath)) {
          // We can't easily write to SQLite from here without better-sqlite3
          // Instead, we'll save a JSON file that HydraSpecter can read on startup
          const jsonPath = path.join(PROFILES_DIR, pool, 'imported-cookies.json');
          fs.writeFileSync(jsonPath, JSON.stringify(storageState, null, 2));
          poolsUpdated++;
        } else {
          // Pool might not have cookies yet, create the directory structure
          fs.mkdirSync(poolDir, { recursive: true });
          const jsonPath = path.join(PROFILES_DIR, pool, 'imported-cookies.json');
          fs.writeFileSync(jsonPath, JSON.stringify(storageState, null, 2));
          poolsUpdated++;
        }
      }
    }

    return {
      success: true,
      message: `Exported ${cookies.length} cookies to ${poolsUpdated} pools`,
      exportedPath: EXPORTED_COOKIES_PATH,
      poolsUpdated
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Import FULL session from Chrome extension into HydraSpecter profiles
 * Includes cookies, localStorage, and IndexedDB
 * Saves as Playwright-compatible storage state format (with extras)
 */
function importFullSession(session) {
  try {
    // Convert localStorage array to Playwright origins format
    const origins = [];
    for (const lsData of session.localStorage || []) {
      if (lsData.origin && lsData.data) {
        origins.push({
          origin: lsData.origin,
          localStorage: Object.entries(lsData.data).map(([name, value]) => ({
            name,
            value
          }))
        });
      }
    }

    // Create Playwright-compatible storage state
    const storageState = {
      cookies: session.cookies || [],
      origins: origins
    };

    // Save full session (including IndexedDB which Playwright doesn't support natively)
    const fullSession = {
      ...session,
      storageState: storageState,
      importedAt: new Date().toISOString()
    };

    // Save to exported-full-session.json for debugging
    fs.mkdirSync(path.dirname(EXPORTED_SESSION_PATH), { recursive: true });
    fs.writeFileSync(EXPORTED_SESSION_PATH, JSON.stringify(fullSession, null, 2));

    // Save Playwright storage state to each pool
    let poolsUpdated = 0;
    if (fs.existsSync(PROFILES_DIR)) {
      const pools = fs.readdirSync(PROFILES_DIR).filter(d => d.startsWith('pool-'));

      for (const pool of pools) {
        const poolDir = path.join(PROFILES_DIR, pool);
        fs.mkdirSync(poolDir, { recursive: true });

        // Save Playwright-compatible storage state
        const storageStatePath = path.join(poolDir, 'storage-state.json');
        fs.writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));

        // Also save imported-cookies.json for backward compatibility
        const jsonPath = path.join(poolDir, 'imported-cookies.json');
        fs.writeFileSync(jsonPath, JSON.stringify(storageState, null, 2));

        // Save full session data (including IndexedDB) for manual restoration
        const fullSessionPath = path.join(poolDir, 'full-session.json');
        fs.writeFileSync(fullSessionPath, JSON.stringify(fullSession, null, 2));

        poolsUpdated++;
      }
    }

    // If no pools exist yet, create pool-0
    if (poolsUpdated === 0) {
      const pool0Dir = path.join(PROFILES_DIR, 'pool-0');
      fs.mkdirSync(pool0Dir, { recursive: true });

      const storageStatePath = path.join(pool0Dir, 'storage-state.json');
      fs.writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));

      const jsonPath = path.join(pool0Dir, 'imported-cookies.json');
      fs.writeFileSync(jsonPath, JSON.stringify(storageState, null, 2));

      const fullSessionPath = path.join(pool0Dir, 'full-session.json');
      fs.writeFileSync(fullSessionPath, JSON.stringify(fullSession, null, 2));

      poolsUpdated = 1;
    }

    return {
      success: true,
      message: `Exported full session to ${poolsUpdated} pools: ${session.cookies?.length || 0} cookies, ${session.localStorage?.length || 0} localStorage origins, ${session.indexedDB?.length || 0} IndexedDB databases`,
      exportedPath: EXPORTED_SESSION_PATH,
      poolsUpdated,
      stats: {
        cookies: session.cookies?.length || 0,
        localStorageOrigins: session.localStorage?.length || 0,
        indexedDBDatabases: session.indexedDB?.length || 0
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Import session for a specific site
 * Saves to site-sessions/{site}.json and merges into pool storage states
 */
function importSiteSession(siteKey, session) {
  try {
    // Ensure site-sessions directory exists
    fs.mkdirSync(SITE_SESSIONS_DIR, { recursive: true });

    // Save site-specific session
    const siteSessionPath = path.join(SITE_SESSIONS_DIR, `${siteKey}.json`);
    fs.writeFileSync(siteSessionPath, JSON.stringify(session, null, 2));

    // Convert to Playwright storage state format
    const origins = [];
    for (const lsData of session.localStorage || []) {
      if (lsData.origin && lsData.data) {
        origins.push({
          origin: lsData.origin,
          localStorage: Object.entries(lsData.data).map(([name, value]) => ({
            name,
            value
          }))
        });
      }
    }

    // Now merge into each pool's storage-state.json
    let poolsUpdated = 0;

    // Get existing pools or create pool-0
    let pools = [];
    if (fs.existsSync(PROFILES_DIR)) {
      pools = fs.readdirSync(PROFILES_DIR).filter(d => d.startsWith('pool-'));
    }
    if (pools.length === 0) {
      pools = ['pool-0'];
    }

    for (const pool of pools) {
      const poolDir = path.join(PROFILES_DIR, pool);
      fs.mkdirSync(poolDir, { recursive: true });

      const storageStatePath = path.join(poolDir, 'storage-state.json');

      // Load existing storage state or create new
      let existingState = { cookies: [], origins: [] };
      if (fs.existsSync(storageStatePath)) {
        try {
          existingState = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
        } catch (e) {
          // Corrupted file, start fresh
        }
      }

      // Merge cookies (replace by domain+name+path)
      const cookieKey = (c) => `${c.domain}|${c.name}|${c.path}`;
      const cookieMap = new Map();

      // Add existing cookies
      for (const cookie of existingState.cookies || []) {
        cookieMap.set(cookieKey(cookie), cookie);
      }
      // Override with new cookies
      for (const cookie of session.cookies || []) {
        cookieMap.set(cookieKey(cookie), cookie);
      }

      existingState.cookies = Array.from(cookieMap.values());

      // Merge origins (replace by origin)
      const originMap = new Map();
      for (const origin of existingState.origins || []) {
        originMap.set(origin.origin, origin);
      }
      for (const origin of origins) {
        originMap.set(origin.origin, origin);
      }
      existingState.origins = Array.from(originMap.values());

      // Save merged state
      fs.writeFileSync(storageStatePath, JSON.stringify(existingState, null, 2));

      // Also save as imported-cookies.json for backward compatibility
      fs.writeFileSync(path.join(poolDir, 'imported-cookies.json'), JSON.stringify(existingState, null, 2));

      poolsUpdated++;
    }

    return {
      success: true,
      message: `Saved ${session.cookies?.length || 0} cookies, ${session.localStorage?.length || 0} localStorage to ${poolsUpdated} pools`,
      siteSessionPath,
      poolsUpdated
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Load rules from JSON file
 */
function loadRules() {
  try {
    if (!fs.existsSync(RULES_PATH)) {
      return { rules: [], error: null };
    }

    const content = fs.readFileSync(RULES_PATH, 'utf8');
    const data = JSON.parse(content);

    // Filter to only prod and enabled rules
    const prodRules = (data.rules || []).filter(
      rule => rule.status === 'prod' && rule.enabled !== false
    );

    return { rules: prodRules, error: null };
  } catch (error) {
    return { rules: [], error: error.message };
  }
}

/**
 * Main handler
 */
async function main() {
  try {
    const message = await readMessage();

    if (message.action === 'getRules') {
      const result = loadRules();
      writeMessage({
        rules: result.rules,
        count: result.rules.length,
        error: result.error,
        timestamp: Date.now()
      });
    } else if (message.action === 'ping') {
      writeMessage({ pong: true, timestamp: Date.now() });
    } else if (message.action === 'importCookies') {
      const result = importCookies(message.cookies || [], message.domains || []);
      writeMessage({
        ...result,
        timestamp: Date.now()
      });
    } else if (message.action === 'importFullSession') {
      const result = importFullSession(message.session || {});
      writeMessage({
        ...result,
        timestamp: Date.now()
      });
    } else if (message.action === 'importSiteSession') {
      const result = importSiteSession(message.site, message.session || {});
      writeMessage({
        ...result,
        timestamp: Date.now()
      });
    } else {
      writeMessage({ error: `Unknown action: ${message.action}` });
    }
  } catch (error) {
    writeMessage({ error: error.message });
  }

  // Exit after processing one message (Chrome spawns new process for each)
  process.exit(0);
}

main();
