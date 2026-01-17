/**
 * SeleniumBase HTTP Driver
 *
 * Uses HTTP bridge for persistent connection across MCP restarts.
 * The Python bridge runs as a standalone HTTP server on port 47482.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import {
  IBrowserPage,
  IBrowserInstance,
  BackendType,
  BrowserFeature,
  BACKEND_FEATURES,
  ScreenshotOptions,
  ClickOptions,
  TypeOptions,
  NavigationOptions,
  ScrollOptions,
  AdapterPageInfo,
} from '../browser-adapter.js';

/** Bridge configuration */
const BRIDGE_PORT = 47482;
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
const STATE_FILE = path.join(os.homedir(), '.hydraspecter', 'bridge-state.json');
const HTTP_BRIDGE_SCRIPT = path.join(os.homedir(), '.hydraspecter', 'seleniumbase-http-bridge.py');
const SESSION_STATE_DIR = path.join(os.homedir(), '.hydraspecter', 'sessions');

/** Session state data structure */
export interface SessionState {
  cookies: any[];
  localStorage: Record<string, string>;
  url?: string;
  savedAt?: string;
}

/** Bridge state from disk */
interface BridgeState {
  port: number;
  pid: number;
  instanceId: string;
  createdAt: string;
  url: string | null;
}

/**
 * Send a command to the HTTP bridge
 */
async function sendHttpCommand(action: string, params: Record<string, any> = {}): Promise<any> {
  const response = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bridge error: ${response.status} ${text}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error);
  }
  return result;
}

/**
 * Check if the bridge is running
 */
async function isBridgeRunning(): Promise<boolean> {
  try {
    const response = await fetch(BRIDGE_URL, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start the HTTP bridge as a detached process
 */
async function startBridge(): Promise<void> {
  if (await isBridgeRunning()) {
    console.error('[SeleniumBase HTTP] Bridge already running');
    return;
  }

  console.error('[SeleniumBase HTTP] Starting bridge...');

  // Start the bridge as a detached process
  const child = spawn('python', [HTTP_BRIDGE_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    cwd: os.homedir(),
  });

  child.unref();

  // Wait for bridge to be ready (max 30 seconds)
  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    if (await isBridgeRunning()) {
      console.error('[SeleniumBase HTTP] Bridge started successfully');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error('Bridge failed to start within 30 seconds');
}

/**
 * Get the current bridge state (exported for reconnection)
 */
export function getBridgeState(): BridgeState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * SeleniumBase HTTP Page Adapter
 */
export class SeleniumBaseHttpPage implements IBrowserPage {
  readonly backend: BackendType = 'seleniumbase';
  private _url: string = 'about:blank';
  private _closed: boolean = false;

  supportsFeature(feature: BrowserFeature): boolean {
    return BACKEND_FEATURES.seleniumbase.includes(feature);
  }

  async goto(url: string, options?: NavigationOptions): Promise<void> {
    await sendHttpCommand('navigate', { url, ...options });
    this._url = url;
  }

  async goBack(options?: NavigationOptions): Promise<void> {
    await sendHttpCommand('back', options);
    const info = await this.getInfo();
    this._url = info.url;
  }

  async goForward(options?: NavigationOptions): Promise<void> {
    await sendHttpCommand('forward', options);
    const info = await this.getInfo();
    this._url = info.url;
  }

  async reload(options?: NavigationOptions): Promise<void> {
    await sendHttpCommand('reload', options);
  }

  async click(selector: string, options?: ClickOptions): Promise<void> {
    await sendHttpCommand('click', { selector, ...options });
  }

  async fill(selector: string, value: string, options?: { timeout?: number }): Promise<void> {
    await sendHttpCommand('fill', { selector, text: value, ...options });
  }

  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    await sendHttpCommand('type', { selector, text, ...options });
  }

  async scroll(options?: ScrollOptions): Promise<void> {
    await sendHttpCommand('scroll', options);
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    await sendHttpCommand('wait_for_element', { selector, ...options });
  }

  async evaluate<R>(script: string | Function, ..._args: any[]): Promise<R> {
    // Note: args are not passed to the bridge - SeleniumBase evaluate doesn't support args
    const scriptStr = typeof script === 'function' ? `(${script.toString()})()` : script;
    return await sendHttpCommand('evaluate', { script: scriptStr });
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const result = await sendHttpCommand('screenshot', options);
    return Buffer.from(result.data, 'base64');
  }

  async title(): Promise<string> {
    const result = await sendHttpCommand('get_title');
    return result.title;
  }

  url(): string {
    return this._url;
  }

  async content(): Promise<string> {
    const result = await sendHttpCommand('get_content');
    return result.html;
  }

  async close(): Promise<void> {
    await sendHttpCommand('close_page');
    this._closed = true;
  }

  isClosed(): boolean {
    return this._closed;
  }

  async getInfo(): Promise<AdapterPageInfo> {
    const result = await sendHttpCommand('get_info');
    this._url = result.url;
    return result;
  }
}

/**
 * SeleniumBase HTTP Instance
 */
export class SeleniumBaseHttpInstance implements IBrowserInstance {
  readonly id: string;
  readonly backend: BackendType = 'seleniumbase';
  readonly page: SeleniumBaseHttpPage;
  readonly createdAt: Date;
  lastUsed: Date;
  isActive: boolean = true;
  metadata?: IBrowserInstance['metadata'];

  constructor(id: string, createdAt: Date) {
    this.id = id;
    this.createdAt = createdAt;
    this.lastUsed = createdAt;
    this.page = new SeleniumBaseHttpPage();
  }

  /**
   * Save the current session state to a file
   */
  async saveSession(domain?: string): Promise<string> {
    const info = await this.page.getInfo();
    const url = new URL(info.url);
    const targetDomain = domain || url.hostname.replace(/^www\./, '');

    if (!fs.existsSync(SESSION_STATE_DIR)) {
      fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });
    }

    const state = await sendHttpCommand('save_session') as SessionState;
    const filePath = path.join(SESSION_STATE_DIR, `${targetDomain}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));

    console.error(`[SeleniumBase HTTP] Session saved: ${filePath} (${state.cookies.length} cookies)`);
    return filePath;
  }

  /**
   * Load a session from file
   */
  async loadSession(domain: string): Promise<boolean> {
    const filePath = path.join(SESSION_STATE_DIR, `${domain}.json`);

    if (!fs.existsSync(filePath)) {
      console.error(`[SeleniumBase HTTP] No session found for ${domain}`);
      return false;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data: SessionState = JSON.parse(content);

    await sendHttpCommand('load_session', { data });
    console.error(`[SeleniumBase HTTP] Session loaded for ${domain}`);
    return true;
  }

  /**
   * Check if a session exists for a domain
   */
  static hasSession(domain: string): boolean {
    const filePath = path.join(SESSION_STATE_DIR, `${domain}.json`);
    return fs.existsSync(filePath);
  }

  /**
   * List all saved sessions
   */
  static listSessions(): string[] {
    if (!fs.existsSync(SESSION_STATE_DIR)) {
      return [];
    }
    return fs.readdirSync(SESSION_STATE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  async close(): Promise<void> {
    // Just close the page, don't quit the driver
    await this.page.close();
  }
}

/**
 * Create a new SeleniumBase HTTP instance
 */
export async function createSeleniumBaseHttpInstance(options?: {
  url?: string;
  headless?: boolean;
}): Promise<SeleniumBaseHttpInstance> {
  // Ensure bridge is running
  await startBridge();

  // Check if there's an existing driver
  const pingResult = await sendHttpCommand('ping');

  let instanceId: string;
  let createdAt: Date;

  if (pingResult.hasDriver && pingResult.instanceId) {
    // Reuse existing driver
    instanceId = pingResult.instanceId;
    createdAt = new Date(); // Use current time since we're reconnecting
    console.error(`[SeleniumBase HTTP] Reconnected to existing driver: ${instanceId}`);
  } else {
    // Initialize new driver
    instanceId = `sb-${uuidv4().substring(0, 8)}`;
    await sendHttpCommand('init', {
      headless: options?.headless ?? false,
      instanceId,
    });
    createdAt = new Date();
    console.error(`[SeleniumBase HTTP] Created new driver: ${instanceId}`);
  }

  const instance = new SeleniumBaseHttpInstance(instanceId, createdAt);

  // Navigate to URL if provided
  if (options?.url) {
    await instance.page.goto(options.url);

    // Auto-load session if exists
    const url = new URL(options.url);
    const domain = url.hostname.replace(/^www\./, '');

    if (SeleniumBaseHttpInstance.hasSession(domain)) {
      console.error(`[SeleniumBase HTTP] Auto-loading session for ${domain}...`);
      const loaded = await instance.loadSession(domain);
      if (loaded) {
        await instance.page.reload();
      }
    }
  }

  return instance;
}

/**
 * Check if SeleniumBase HTTP mode is available
 */
export async function isSeleniumBaseHttpAvailable(): Promise<boolean> {
  // Check if Python is available
  try {
    const { execSync } = await import('child_process');
    execSync('python --version', { stdio: 'ignore' });
    return fs.existsSync(HTTP_BRIDGE_SCRIPT);
  } catch {
    return false;
  }
}

/**
 * Shutdown the HTTP bridge (for cleanup)
 */
export async function shutdownHttpBridge(): Promise<void> {
  try {
    await sendHttpCommand('quit');
  } catch {
    // Bridge might already be down
  }
}
