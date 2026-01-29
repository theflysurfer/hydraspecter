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
