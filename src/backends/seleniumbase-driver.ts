/**
 * SeleniumBase UC Driver Wrapper
 *
 * Provides a Playwright-like interface to SeleniumBase UC mode via Python bridge.
 * SeleniumBase UC (Undetected Chromedriver) bypasses Cloudflare and other anti-bot systems.
 *
 * Architecture:
 * - Node.js spawns a Python process running SeleniumBase
 * - Communication via stdin/stdout JSON messages
 * - Persistent profile at ~/.hydraspecter/seleniumbase-profile
 *
 * Limitations vs Playwright:
 * - No network interception
 * - No ARIA tree snapshots (uses DOM parsing instead)
 * - Single profile (no multi-pool)
 * - Basic humanization (no ghost-cursor)
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { killOrphanDrivers, cleanupBeforeStart } from '../utils/process-cleanup.js';
import {
  IBrowserPage,
  IBrowserInstance,
  BackendType,
  BrowserFeature,
  ScreenshotOptions,
  ClickOptions,
  TypeOptions,
  NavigationOptions,
  ScrollOptions,
  AdapterPageInfo,
  BACKEND_FEATURES,
} from '../browser-adapter.js';

/** Default profile directory for SeleniumBase UC (legacy mode) */
const DEFAULT_PROFILE_DIR = path.join(os.homedir(), '.hydraspecter', 'seleniumbase-profile');

/** Session state file directory (for State Injection pattern) */
const SESSION_STATE_DIR = path.join(os.homedir(), '.hydraspecter', 'sessions');

/** Python bridge script path */
const PYTHON_BRIDGE_PATH = path.join(os.homedir(), '.hydraspecter', 'seleniumbase-bridge.py');

/** Session state data structure */
export interface SessionState {
  cookies: any[];
  localStorage: Record<string, string>;
  url?: string;
  savedAt?: string;
}

/** Message types for Python bridge communication */
interface BridgeMessage {
  id: string;
  type: 'request' | 'response' | 'error' | 'event';
  action?: string;
  params?: Record<string, any>;
  result?: any;
  error?: string;
}

/**
 * SeleniumBase Page Adapter
 *
 * Implements IBrowserPage interface using SeleniumBase UC via Python bridge.
 */
export class SeleniumBasePage implements IBrowserPage {
  readonly backend: BackendType = 'seleniumbase';
  private driver: SeleniumBaseDriver;
  private _url: string = 'about:blank';
  private _closed: boolean = false;

  constructor(driver: SeleniumBaseDriver) {
    this.driver = driver;
  }

  async goto(url: string, options?: NavigationOptions): Promise<void> {
    await this.driver.sendCommand('navigate', { url, ...options });
    this._url = url;
  }

  async goBack(options?: NavigationOptions): Promise<void> {
    await this.driver.sendCommand('back', options);
    const info = await this.getInfo();
    this._url = info.url;
  }

  async goForward(options?: NavigationOptions): Promise<void> {
    await this.driver.sendCommand('forward', options);
    const info = await this.getInfo();
    this._url = info.url;
  }

  async reload(options?: NavigationOptions): Promise<void> {
    await this.driver.sendCommand('reload', options);
  }

  async click(selector: string, options?: ClickOptions): Promise<void> {
    // SeleniumBase UC has its own anti-detection click (uc_click)
    await this.driver.sendCommand('click', { selector, ...options });
  }

  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    await this.driver.sendCommand('type', { selector, text, ...options });
  }

  async fill(selector: string, text: string, options?: TypeOptions): Promise<void> {
    // SeleniumBase fill: clear then type
    await this.driver.sendCommand('fill', { selector, text, ...options });
  }

  async scroll(options?: ScrollOptions): Promise<void> {
    await this.driver.sendCommand('scroll', options);
  }

  async waitForSelector(selector: string, options?: { timeout?: number; state?: string }): Promise<void> {
    await this.driver.sendCommand('wait_for_element', { selector, ...options });
  }

  async evaluate<R>(script: string | Function, ...args: any[]): Promise<R> {
    const scriptStr = typeof script === 'function' ? `(${script.toString()})(...${JSON.stringify(args)})` : script;
    const result = await this.driver.sendCommand('evaluate', { script: scriptStr });
    return result as R;
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const result = await this.driver.sendCommand('screenshot', options);
    // Result is base64 encoded
    return Buffer.from(result.data, 'base64');
  }

  async title(): Promise<string> {
    const result = await this.driver.sendCommand('get_title');
    return result.title;
  }

  url(): string {
    return this._url;
  }

  async content(): Promise<string> {
    const result = await this.driver.sendCommand('get_content');
    return result.html;
  }

  async getInfo(): Promise<AdapterPageInfo> {
    const result = await this.driver.sendCommand('get_info');
    this._url = result.url;
    return {
      url: result.url,
      title: result.title
    };
  }

  async close(): Promise<void> {
    if (!this._closed) {
      await this.driver.sendCommand('close_page');
      this._closed = true;
    }
  }

  isClosed(): boolean {
    return this._closed;
  }

  supportsFeature(feature: BrowserFeature): boolean {
    return BACKEND_FEATURES.seleniumbase.includes(feature);
  }

  /**
   * Update internal URL cache (called by driver on navigation events)
   */
  updateUrl(url: string): void {
    this._url = url;
  }
}

/**
 * SeleniumBase Browser Instance
 *
 * Wraps a SeleniumBase UC driver instance.
 */
export class SeleniumBaseInstance implements IBrowserInstance {
  readonly id: string;
  readonly backend: BackendType = 'seleniumbase';
  readonly page: SeleniumBasePage;
  readonly createdAt: Date;
  lastUsed: Date;
  isActive: boolean = true;
  metadata?: { name?: string; tags?: string[]; description?: string };

  private driver: SeleniumBaseDriver;

  constructor(driver: SeleniumBaseDriver, id?: string, metadata?: IBrowserInstance['metadata']) {
    this.id = id || uuidv4();
    this.driver = driver;
    this.page = new SeleniumBasePage(driver);
    this.createdAt = new Date();
    this.lastUsed = new Date();
    this.metadata = metadata;
  }

  async close(): Promise<void> {
    await this.driver.close();
    this.isActive = false;
  }

  /**
   * Get the underlying driver (for advanced operations)
   */
  getDriver(): SeleniumBaseDriver {
    return this.driver;
  }

  /**
   * Save session state (cookies + localStorage) to a file.
   * Uses State Injection pattern - saves to ~/.hydraspecter/sessions/{domain}.json
   */
  async saveSession(domain?: string): Promise<string> {
    // Get current URL to extract domain if not provided
    const info = await this.page.getInfo();
    const url = new URL(info.url);
    const targetDomain = domain || url.hostname.replace(/^www\./, '');

    // Ensure sessions directory exists
    if (!fs.existsSync(SESSION_STATE_DIR)) {
      fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });
    }

    // Get session state from browser
    const state = await this.driver.sendCommand('save_session') as SessionState;

    // Save to file
    const filePath = path.join(SESSION_STATE_DIR, `${targetDomain}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));

    console.error(`[SeleniumBase] Session saved: ${filePath} (${state.cookies.length} cookies)`);
    return filePath;
  }

  /**
   * Load session state from a file.
   * Must navigate to domain first, then call this to inject cookies.
   */
  async loadSession(domain: string): Promise<boolean> {
    const filePath = path.join(SESSION_STATE_DIR, `${domain}.json`);

    if (!fs.existsSync(filePath)) {
      console.error(`[SeleniumBase] No session found for ${domain}`);
      return false;
    }

    try {
      const state = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionState;

      // Inject cookies and localStorage
      const result = await this.driver.sendCommand('load_session', { data: state });

      console.error(`[SeleniumBase] Session loaded: ${result.cookies} cookies, ${result.localStorage} localStorage items`);
      return true;
    } catch (error) {
      console.error(`[SeleniumBase] Failed to load session: ${error}`);
      return false;
    }
  }

  /**
   * Check if a session exists for a domain.
   */
  static hasSession(domain: string): boolean {
    const filePath = path.join(SESSION_STATE_DIR, `${domain}.json`);
    return fs.existsSync(filePath);
  }

  /**
   * List all saved sessions.
   */
  static listSessions(): string[] {
    if (!fs.existsSync(SESSION_STATE_DIR)) {
      return [];
    }
    return fs.readdirSync(SESSION_STATE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Minimize browser window (prevents focus stealing)
   */
  async minimize(): Promise<void> {
    await this.driver.sendCommand('minimize');
  }

  /**
   * Restore/maximize browser window
   */
  async restore(): Promise<void> {
    await this.driver.sendCommand('restore');
  }
}

/**
 * SeleniumBase Driver
 *
 * Manages the Python bridge process and command communication.
 */
export class SeleniumBaseDriver extends EventEmitter {
  private process: ChildProcess | null = null;
  private pendingCommands: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
  private profileDir: string | null;
  private headless: boolean;
  private isReady: boolean = false;
  private buffer: string = '';
  private useStateInjection: boolean;

  constructor(options?: {
    profileDir?: string | null;  // null = use temp profile (State Injection mode)
    headless?: boolean;
    useStateInjection?: boolean;  // Default: true (recommended)
  }) {
    super();
    // State Injection mode: use temp profiles, no user_data_dir
    // Legacy mode: use profileDir for persistence (prone to zombie issues)
    this.useStateInjection = options?.useStateInjection ?? true;

    if (this.useStateInjection) {
      // Don't use a profile dir - let SeleniumBase create temp profiles
      this.profileDir = null;
    } else {
      this.profileDir = options?.profileDir || DEFAULT_PROFILE_DIR;
      // Ensure profile directory exists (legacy mode only)
      if (this.profileDir && !fs.existsSync(this.profileDir)) {
        fs.mkdirSync(this.profileDir, { recursive: true });
      }
    }

    this.headless = options?.headless ?? false; // Default: visible for anti-detection
  }

  /**
   * Start the SeleniumBase UC driver via Python bridge.
   */
  async start(): Promise<void> {
    // Ensure Python bridge script exists
    await this.ensurePythonBridge();

    // Kill orphan chromedriver processes BEFORE starting (prevents lock issues)
    console.error('[SeleniumBase] Cleaning up orphan drivers before start...');
    killOrphanDrivers();

    // If using legacy profile mode, also clean up lock files
    if (this.profileDir) {
      cleanupBeforeStart(this.profileDir);
    }

    return new Promise((resolve, reject) => {
      const env = { ...process.env };

      this.process = spawn('python', [PYTHON_BRIDGE_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: os.homedir()
      });

      if (!this.process.stdout || !this.process.stdin) {
        reject(new Error('Failed to create Python bridge process'));
        return;
      }

      // Handle stdout (JSON responses)
      this.process.stdout.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      // Handle stderr (debug output)
      this.process.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          console.error(`[SeleniumBase] ${msg}`);
        }
      });

      // Store PID for cleanup
      const processPid = this.process.pid;

      // Handle process exit
      this.process.on('exit', async (code) => {
        console.error(`[SeleniumBase] Process exited with code ${code}`);
        this.isReady = false;
        this.process = null;

        // Kill orphan Chrome processes on Windows
        if (processPid && process.platform === 'win32') {
          try {
            const { execSync } = await import('child_process');
            execSync(`taskkill /F /T /PID ${processPid}`, { stdio: 'ignore' });
          } catch {
            // Process tree already gone
          }
        }

        // Reject all pending commands
        for (const [, { reject }] of this.pendingCommands) {
          reject(new Error(`Process exited with code ${code}`));
        }
        this.pendingCommands.clear();
      });

      // Handle process error
      this.process.on('error', async (error) => {
        console.error(`[SeleniumBase] Process error: ${error.message}`);
        // Cleanup on error
        if (processPid && process.platform === 'win32') {
          try {
            const { execSync } = await import('child_process');
            execSync(`taskkill /F /T /PID ${processPid}`, { stdio: 'ignore' });
          } catch {
            // Process tree already gone
          }
        }
        reject(error);
      });

      // Initialize the driver
      // State Injection mode: don't pass profileDir (use temp profile)
      // Legacy mode: pass profileDir for persistence
      const initParams: Record<string, any> = { headless: this.headless };
      if (this.profileDir) {
        initParams['profileDir'] = this.profileDir;
      }

      this.sendCommand('init', initParams)
        .then(() => {
          this.isReady = true;
          const mode = this.useStateInjection ? 'State Injection (temp profile)' : `Legacy (${this.profileDir})`;
          console.error(`[SeleniumBase] Driver ready - Mode: ${mode}`);
          resolve();
        })
        .catch(async (error) => {
          // Cleanup on init failure
          console.error(`[SeleniumBase] Init failed: ${error.message}, cleaning up`);
          if (processPid && process.platform === 'win32') {
            try {
              const { execSync } = await import('child_process');
              execSync(`taskkill /F /T /PID ${processPid}`, { stdio: 'ignore' });
            } catch {
              // Process tree already gone
            }
          }
          if (this.process) {
            this.process.kill();
            this.process = null;
          }
          reject(error);
        });
    });
  }

  /**
   * Process buffered data from stdout.
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');

    // Process complete lines
    for (let i = 0; i < lines.length - 1; i++) {
      const rawLine = lines[i];
      if (rawLine === undefined) continue;
      const line = rawLine.trim();
      if (line) {
        try {
          const message: BridgeMessage = JSON.parse(line);
          this.handleMessage(message);
        } catch {
          // Not JSON, might be debug output
          if (!line.startsWith('[DEBUG]')) {
            console.error(`[SeleniumBase] Unparsed: ${line}`);
          }
        }
      }
    }

    // Keep the last incomplete line in buffer
    this.buffer = lines[lines.length - 1] ?? '';
  }

  /**
   * Handle a message from the Python bridge.
   */
  private handleMessage(message: BridgeMessage): void {
    if (message.type === 'response' || message.type === 'error') {
      const pending = this.pendingCommands.get(message.id);
      if (pending) {
        this.pendingCommands.delete(message.id);
        if (message.type === 'error') {
          pending.reject(new Error(message.error || 'Unknown error'));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.type === 'event') {
      this.emit(message.action || 'event', message.params);
    }
  }

  /**
   * Send a command to the Python bridge.
   */
  async sendCommand(action: string, params?: Record<string, any>): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error('SeleniumBase driver not started');
    }

    const id = uuidv4();
    const message: BridgeMessage = {
      id,
      type: 'request',
      action,
      params
    };

    return new Promise((resolve, reject) => {
      // Set timeout for command (120s for init/navigate, 30s for others)
      const timeoutMs = (action === 'init' || action === 'navigate') ? 120000 : 30000;
      let timeoutId: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        this.pendingCommands.delete(id);
      };

      // Set up timeout
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Command '${action}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      // Store command handlers
      this.pendingCommands.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        }
      });

      // Write command to stdin
      const jsonMessage = JSON.stringify(message) + '\n';
      console.error(`[SeleniumBase] Sending: ${action} (id: ${id.substring(0, 8)})`);

      this.process!.stdin!.write(jsonMessage, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Close the driver and Python process.
   * Also kills any orphan Chrome processes spawned by this driver.
   */
  async close(): Promise<void> {
    if (this.process) {
      const pid = this.process.pid;
      console.error(`[SeleniumBase] Closing driver (PID: ${pid})`);

      try {
        // Try graceful quit first
        await Promise.race([
          this.sendCommand('quit'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('quit timeout')), 5000))
        ]);
      } catch {
        // Ignore errors when quitting
        console.error('[SeleniumBase] Graceful quit failed, forcing cleanup');
      }

      // Kill the Python process
      try {
        this.process.kill('SIGKILL');
      } catch {
        // Process might already be dead
      }

      // Force kill any child Chrome processes on Windows
      if (pid && process.platform === 'win32') {
        try {
          const { execSync } = await import('child_process');
          // Kill process tree (all child processes)
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } catch {
          // Process tree might already be gone
        }
      }

      this.process = null;
    }
    this.isReady = false;
  }

  /**
   * Force cleanup - kills all Chrome processes using our profile directory.
   * Use this as a last resort when normal close fails.
   */
  async forceCleanup(): Promise<void> {
    console.error('[SeleniumBase] Force cleanup initiated');

    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        // Kill all chromedriver processes
        execSync('taskkill /F /IM chromedriver.exe', { stdio: 'ignore' });
      } catch {
        // No chromedriver processes
      }
    }

    await this.close();
  }

  /**
   * Check if driver is ready.
   */
  isDriverReady(): boolean {
    return this.isReady && this.process !== null;
  }

  /**
   * Ensure the Python bridge script exists.
   */
  private async ensurePythonBridge(): Promise<void> {
    const bridgeDir = path.dirname(PYTHON_BRIDGE_PATH);
    if (!fs.existsSync(bridgeDir)) {
      fs.mkdirSync(bridgeDir, { recursive: true });
    }

    // Write the Python bridge script
    const bridgeScript = this.getPythonBridgeScript();
    fs.writeFileSync(PYTHON_BRIDGE_PATH, bridgeScript, 'utf-8');
    console.error(`[SeleniumBase] Python bridge written to: ${PYTHON_BRIDGE_PATH}`);
  }

  /**
   * Get the Python bridge script content.
   */
  private getPythonBridgeScript(): string {
    return `#!/usr/bin/env python3
"""
SeleniumBase UC Bridge for HydraSpecter
Receives JSON commands via stdin, sends responses via stdout.
"""

import sys
import json
import time
import base64
import signal
import atexit
import traceback
from seleniumbase import Driver

# Global driver instance
driver = None

def cleanup():
    """Cleanup driver on exit"""
    global driver
    if driver:
        try:
            sys.stderr.write("[DEBUG] Cleanup: quitting driver\\n")
            sys.stderr.flush()
            driver.quit()
        except Exception:
            pass
        driver = None

# Register cleanup handlers
atexit.register(cleanup)
signal.signal(signal.SIGTERM, lambda s, f: (cleanup(), sys.exit(0)))
signal.signal(signal.SIGINT, lambda s, f: (cleanup(), sys.exit(0)))

def send_response(msg_id, result=None, error=None):
    """Send a response back to Node.js"""
    response = {
        "id": msg_id,
        "type": "error" if error else "response",
    }
    if error:
        response["error"] = str(error)
    else:
        response["result"] = result
    print(json.dumps(response), flush=True)

def send_event(action, params=None):
    """Send an event to Node.js"""
    event = {
        "id": "",
        "type": "event",
        "action": action,
        "params": params or {}
    }
    print(json.dumps(event), flush=True)

def handle_command(msg):
    """Handle a command from Node.js"""
    global driver

    msg_id = msg.get("id", "")
    action = msg.get("action", "")
    params = msg.get("params", {})

    try:
        if action == "init":
            # Initialize the driver
            headless = params.get("headless", False)
            profile_dir = params.get("profileDir")

            sys.stderr.write(f"[DEBUG] Initializing UC driver (headless: {headless}, profile: {profile_dir})\\n")
            sys.stderr.flush()

            # Use profile directory if provided (for session persistence)
            # Otherwise let SeleniumBase manage temp profile
            driver_args = {
                "uc": True,  # Undetected Chromedriver mode
                "headless": headless,
            }
            if profile_dir:
                driver_args["user_data_dir"] = profile_dir

            driver = Driver(**driver_args)

            sys.stderr.write(f"[DEBUG] Driver ready, title: {driver.title}\\n")
            sys.stderr.flush()

            send_response(msg_id, {"status": "ready", "profile": profile_dir or "temp"})

        elif action == "navigate":
            url = params.get("url")
            timeout = params.get("timeout", 30)
            driver.set_page_load_timeout(timeout)

            # Use UC reconnect method for Cloudflare bypass (if available)
            try:
                driver.uc_open_with_reconnect(url, 4)  # 4 reconnect attempts
            except AttributeError:
                # Fallback to regular navigation
                driver.get(url)

            # Small delay to let Cloudflare challenge complete
            time.sleep(2)
            send_response(msg_id, {"url": driver.current_url, "title": driver.title})

        elif action == "back":
            driver.back()
            send_response(msg_id, {"url": driver.current_url})

        elif action == "forward":
            driver.forward()
            send_response(msg_id, {"url": driver.current_url})

        elif action == "reload":
            driver.refresh()
            send_response(msg_id, {"url": driver.current_url})

        elif action == "click":
            selector = params.get("selector")
            locator_type = params.get("locatorType", "css")  # css, xpath, or link_text

            # Find element based on locator type
            if locator_type == "xpath":
                element = driver.find_element("xpath", selector)
            elif locator_type == "link_text":
                # Try link_text first, then partial_link_text
                try:
                    element = driver.find_element("link text", selector)
                except Exception:
                    element = driver.find_element("partial link text", selector)
            else:
                # CSS selector (default)
                element = driver.find_element("css selector", selector)

            # Use UC click for anti-detection
            try:
                driver.uc_click(element)
            except Exception:
                # Fallback to regular click
                element.click()
            send_response(msg_id, {"clicked": True, "locatorType": locator_type})

        elif action == "type":
            selector = params.get("selector")
            text = params.get("text", "")
            delay = params.get("delay", 0.05)
            # Type with delay for human-like behavior
            element = driver.find_element("css selector", selector)
            for char in text:
                element.send_keys(char)
                time.sleep(delay)
            send_response(msg_id, {"typed": True})

        elif action == "fill":
            selector = params.get("selector")
            text = params.get("text", "")
            element = driver.find_element("css selector", selector)
            element.clear()
            element.send_keys(text)
            send_response(msg_id, {"filled": True})

        elif action == "scroll":
            direction = params.get("direction", "down")
            amount = params.get("amount", 300)
            if direction == "down":
                driver.execute_script(f"window.scrollBy(0, {amount})")
            elif direction == "up":
                driver.execute_script(f"window.scrollBy(0, -{amount})")
            send_response(msg_id, {"scrolled": True})

        elif action == "wait_for_element":
            selector = params.get("selector")
            timeout = params.get("timeout", 10)
            driver.wait_for_element(selector, timeout=timeout)
            send_response(msg_id, {"found": True})

        elif action == "evaluate":
            script = params.get("script")
            result = driver.execute_script(f"return {script}")
            send_response(msg_id, result)

        elif action == "screenshot":
            # Take screenshot and return as base64
            png_data = driver.get_screenshot_as_png()
            b64_data = base64.b64encode(png_data).decode("utf-8")
            send_response(msg_id, {"data": b64_data, "type": "png"})

        elif action == "get_title":
            send_response(msg_id, {"title": driver.title})

        elif action == "get_content":
            send_response(msg_id, {"html": driver.page_source})

        elif action == "get_info":
            send_response(msg_id, {
                "url": driver.current_url,
                "title": driver.title
            })

        elif action == "close_page":
            # Just clear the current page, don't quit driver
            driver.execute_script("window.location = 'about:blank'")
            send_response(msg_id, {"closed": True})

        elif action == "save_session":
            # Export cookies and localStorage for State Injection pattern
            cookies = driver.get_cookies()

            # Get localStorage via JavaScript
            local_storage = driver.execute_script("""
                const items = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    items[key] = localStorage.getItem(key);
                }
                return items;
            """) or {}

            session_data = {
                "cookies": cookies,
                "localStorage": local_storage,
                "url": driver.current_url,
                "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            send_response(msg_id, session_data)

        elif action == "load_session":
            # Import cookies and localStorage for State Injection pattern
            data = params.get("data", {})
            cookies = data.get("cookies", [])
            local_storage = data.get("localStorage", {})

            # Add cookies
            for cookie in cookies:
                try:
                    # Remove problematic fields that Selenium doesn't accept
                    cookie_clean = {k: v for k, v in cookie.items()
                                  if k not in ['sameSite', 'storeId', 'hostOnly', 'session']}
                    driver.add_cookie(cookie_clean)
                except Exception as e:
                    sys.stderr.write(f"[WARN] Cookie inject failed: {e}\\n")

            # Set localStorage
            if local_storage:
                for key, value in local_storage.items():
                    try:
                        escaped_value = json.dumps(value)
                        driver.execute_script(f"localStorage.setItem({json.dumps(key)}, {escaped_value})")
                    except Exception as e:
                        sys.stderr.write(f"[WARN] localStorage inject failed: {e}\\n")

            send_response(msg_id, {"injected": True, "cookies": len(cookies), "localStorage": len(local_storage)})

        elif action == "quit":
            if driver:
                driver.quit()
                driver = None
            send_response(msg_id, {"quit": True})

        else:
            send_response(msg_id, error=f"Unknown action: {action}")

    except Exception as e:
        sys.stderr.write(f"[ERROR] {action}: {traceback.format_exc()}\\n")
        sys.stderr.flush()
        send_response(msg_id, error=str(e))

def main():
    """Main loop - read commands from stdin"""
    sys.stderr.write("[DEBUG] SeleniumBase bridge started\\n")
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
            handle_command(msg)
        except json.JSONDecodeError as e:
            sys.stderr.write(f"[ERROR] Invalid JSON: {e}\\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[ERROR] Unhandled: {traceback.format_exc()}\\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
`;
  }
}

/**
 * Create a new SeleniumBase browser instance.
 *
 * @param options Configuration options
 * @returns A browser instance using SeleniumBase UC backend
 */
export async function createSeleniumBaseInstance(options?: {
  profileDir?: string | null;
  headless?: boolean;
  url?: string;
  metadata?: IBrowserInstance['metadata'];
  useStateInjection?: boolean;  // Default: true (recommended)
  autoLoadSession?: boolean;    // Auto-load session if exists for target domain
}): Promise<SeleniumBaseInstance> {
  const useStateInjection = options?.useStateInjection ?? true;

  const driver = new SeleniumBaseDriver({
    profileDir: useStateInjection ? null : options?.profileDir,
    headless: options?.headless,
    useStateInjection,
  });

  await driver.start();

  const instance = new SeleniumBaseInstance(driver, undefined, options?.metadata);

  // Navigate to initial URL if provided
  if (options?.url) {
    await instance.page.goto(options.url);

    // Auto-load session if State Injection mode and session exists
    if (useStateInjection && options?.autoLoadSession !== false) {
      try {
        const url = new URL(options.url);
        const domain = url.hostname.replace(/^www\./, '');

        if (SeleniumBaseInstance.hasSession(domain)) {
          console.error(`[SeleniumBase] Auto-loading session for ${domain}...`);
          const loaded = await instance.loadSession(domain);
          if (loaded) {
            // Reload page to apply session
            await instance.page.reload();
          }
        }
      } catch (error) {
        console.error(`[SeleniumBase] Auto-load session failed: ${error}`);
      }
    }
  }

  console.error(`[SeleniumBase] Instance created: ${instance.id} (State Injection: ${useStateInjection})`);
  return instance;
}

/**
 * Check if SeleniumBase is available (Python + SeleniumBase installed).
 */
export async function isSeleniumBaseAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('python', ['-c', 'import seleniumbase; print("ok")'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });

    proc.on('close', (code) => {
      resolve(code === 0 && output.includes('ok'));
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}
