/**
 * SeleniumBase HTTP Driver
 *
 * Uses HTTP bridge for persistent connection across MCP restarts.
 * The Python bridge runs as a standalone HTTP server on port 47482.
 *
 * Features:
 * - Automatic driver reinitialization on session errors (US-012)
 * - Checkpoint-based operation resume after reinit
 * - Max 3 reinit attempts before giving up
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
const SELENIUMBASE_PROFILE_DIR = path.join(os.homedir(), '.hydraspecter', 'seleniumbase-profile');

/** Maximum driver reinit attempts per operation (US-003: max 2 reinitializations before abandon) */
const MAX_REINIT_ATTEMPTS = 2;

/**
 * Error patterns that indicate a session error requiring driver reinit.
 * These are common Selenium/WebDriver errors that mean the session is dead.
 */
const SESSION_ERROR_PATTERNS = [
  // Session/target closed errors
  /session.*(deleted|closed|expired|invalid|not found)/i,
  /target.*closed/i,
  /page.*closed/i,
  /browser.*closed/i,
  /no such (window|session|element)/i,
  /invalid session id/i,
  /session not created/i,

  // Stale element errors
  /stale element reference/i,
  /element.*stale/i,
  /element is not attached/i,

  // Connection errors to driver
  /connection refused/i,
  /unable to connect/i,
  /failed to connect/i,
  /econnrefused/i,
  /socket hang up/i,

  // Chrome/browser crashed
  /chrome not reachable/i,
  /browser.*crash/i,
  /renderer.*crash/i,
  /devtools.*disconnected/i,

  // Driver errors
  /webdriver.*exception/i,
  /driver.*error/i,
  /cannot find.*driver/i,
];

/**
 * Check if an error message indicates a session error that requires reinit
 */
export function isSessionError(errorMessage: string): boolean {
  return SESSION_ERROR_PATTERNS.some(pattern => pattern.test(errorMessage));
}

/**
 * Reinit state tracker - tracks reinit attempts per operation context
 */
interface ReinitState {
  attempts: number;
  lastReinitAt: Date | null;
  lastError: string | null;
}

// Global reinit state (reset on successful operation)
let globalReinitState: ReinitState = {
  attempts: 0,
  lastReinitAt: null,
  lastError: null,
};

/**
 * Reset reinit state after successful operation
 */
function resetReinitState(): void {
  globalReinitState = {
    attempts: 0,
    lastReinitAt: null,
    lastError: null,
  };
}

/**
 * Increment reinit attempts and check if max reached
 */
function incrementReinitAttempts(error: string): boolean {
  globalReinitState.attempts++;
  globalReinitState.lastReinitAt = new Date();
  globalReinitState.lastError = error;

  if (globalReinitState.attempts > MAX_REINIT_ATTEMPTS) {
    console.error(`[SeleniumBase HTTP] Max reinit attempts (${MAX_REINIT_ATTEMPTS}) reached. Giving up.`);
    return false;
  }

  console.error(`[SeleniumBase HTTP] Reinit attempt ${globalReinitState.attempts}/${MAX_REINIT_ATTEMPTS}`);
  return true;
}

/**
 * Operation checkpoint for resuming after reinit.
 * Stores the current URL and operation context so we can navigate back after reinit.
 */
export interface OperationCheckpoint {
  /** URL to navigate to after reinit */
  url: string;
  /** Operation name for logging */
  operation: string;
  /** Additional context data */
  context?: Record<string, any>;
  /** Timestamp when checkpoint was created */
  createdAt: Date;
}

/** Current operation checkpoint */
let currentCheckpoint: OperationCheckpoint | null = null;

/**
 * Set a checkpoint before a potentially failing operation.
 * If a session error occurs and reinit happens, the page will navigate to the checkpoint URL.
 */
export function setCheckpoint(checkpoint: OperationCheckpoint): void {
  currentCheckpoint = checkpoint;
  console.error(`[SeleniumBase HTTP] Checkpoint set: ${checkpoint.operation} @ ${checkpoint.url}`);
}

/**
 * Clear the current checkpoint (call after successful operation completion).
 */
export function clearCheckpoint(): void {
  if (currentCheckpoint) {
    console.error(`[SeleniumBase HTTP] Checkpoint cleared: ${currentCheckpoint.operation}`);
    currentCheckpoint = null;
  }
}

/**
 * Get the current checkpoint (for resuming after reinit).
 */
export function getCheckpoint(): OperationCheckpoint | null {
  return currentCheckpoint;
}

/**
 * Get the current reinit state (for diagnostics/debugging).
 */
export function getReinitState(): ReinitState {
  return { ...globalReinitState };
}

/**
 * Execute an operation with automatic checkpoint and retry on session error.
 * This is the recommended way to run operations that might fail due to session errors.
 *
 * @param operation - Name of the operation (for logging)
 * @param url - URL to navigate to after reinit (checkpoint)
 * @param fn - The async function to execute
 * @param context - Optional context data for the checkpoint
 */
export async function executeWithCheckpoint<T>(
  operation: string,
  url: string,
  fn: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  // Set checkpoint before operation
  setCheckpoint({ operation, url, context, createdAt: new Date() });

  try {
    const result = await fn();
    // Success - clear checkpoint
    clearCheckpoint();
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // If this was a session error and we have a checkpoint, we need to navigate back
    if (isSessionError(errorMessage) && currentCheckpoint) {
      console.error(`[SeleniumBase HTTP] Session error with checkpoint, will navigate to: ${currentCheckpoint.url}`);
      // The sendHttpCommand retry logic will handle reinit, then we navigate
      try {
        await sendHttpCommand('navigate', { url: currentCheckpoint.url });
        console.error(`[SeleniumBase HTTP] Navigated back to checkpoint URL: ${currentCheckpoint.url}`);
      } catch (navError) {
        console.error(`[SeleniumBase HTTP] Failed to navigate to checkpoint: ${navError}`);
      }
    }

    // Clear checkpoint on failure too (operation is complete, even if failed)
    clearCheckpoint();
    throw error;
  }
}

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

/** Current instance ID for reinit tracking */
let currentInstanceId: string | null = null;

/** Current headless setting for reinit */
let currentHeadlessSetting: boolean = false;

/** Store last known URL for each instance (for resuming after reinit) */
const lastKnownUrls: Map<string, string> = new Map();

/**
 * Update the last known URL for an instance (called after navigation)
 */
export function updateLastKnownUrl(instanceId: string, url: string): void {
  if (url && url !== 'about:blank') {
    lastKnownUrls.set(instanceId, url);
  }
}

/**
 * Get the last known URL for an instance
 */
export function getLastKnownUrl(instanceId: string): string | undefined {
  return lastKnownUrls.get(instanceId);
}

/**
 * Reinitialize the SeleniumBase driver after a session error.
 * Sends quit command to HTTP bridge, recreates the driver, and navigates to last known URL.
 * Preserves the same instanceId for the caller.
 *
 * @param instanceId - The instance ID to reinitialize (will be preserved)
 * @returns The same instanceId after successful reinitialization
 */
export async function reinitializeSeleniumDriver(instanceId: string): Promise<string> {
  console.error('[SeleniumBase] Reinitializing driver...');

  // Get last known URL before reinit
  const lastUrl = lastKnownUrls.get(instanceId);

  // Step 1: Quit the old driver
  try {
    await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'quit', params: {} }),
    });
    console.error('[SeleniumBase] Old driver quit successfully');
  } catch (e) {
    // Driver might already be dead, that's fine
    console.error('[SeleniumBase] Driver quit failed (expected if already dead)');
  }

  // Step 2: Wait for cleanup
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Step 3: Reinitialize with the same profile, preserving instanceId
  const initResponse = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'init',
      params: {
        headless: currentHeadlessSetting,
        instanceId, // Preserve the same instanceId for the caller
        profileDir: SELENIUMBASE_PROFILE_DIR,
      },
    }),
  });

  if (!initResponse.ok) {
    const text = await initResponse.text();
    throw new Error(`Failed to reinitialize driver: ${initResponse.status} ${text}`);
  }

  const result = await initResponse.json();
  if (result?.error) {
    throw new Error(`Failed to reinitialize driver: ${result.error}`);
  }

  // Update the current instance ID
  currentInstanceId = instanceId;

  // Step 4: Navigate to last known URL after reinit
  if (lastUrl) {
    console.error(`[SeleniumBase] Navigating to last known URL: ${lastUrl}`);
    try {
      await fetch(BRIDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'navigate', params: { url: lastUrl } }),
      });
    } catch (e) {
      console.error(`[SeleniumBase] Failed to navigate to last URL: ${e}`);
    }
  }

  console.error('[SeleniumBase] Driver reinitialized, resuming operation...');
  return instanceId;
}

/**
 * Internal reinitializeDriver for backward compatibility (used by sendHttpCommand retry logic)
 */
async function reinitializeDriver(): Promise<void> {
  const instanceId = currentInstanceId || `sb-${uuidv4().substring(0, 8)}`;
  await reinitializeSeleniumDriver(instanceId);
}

/**
 * Send a command to the HTTP bridge (internal, no retry)
 */
async function sendHttpCommandInternal(action: string, params: Record<string, any> = {}): Promise<any> {
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
  // Handle null results (e.g., from JavaScript returning null)
  if (result !== null && result !== undefined && result.error) {
    throw new Error(result.error);
  }
  return result;
}

/**
 * Send a command to the HTTP bridge with automatic retry on session errors.
 * If a session error is detected, reinitializes the driver and retries.
 */
async function sendHttpCommand(action: string, params: Record<string, any> = {}): Promise<any> {
  try {
    const result = await sendHttpCommandInternal(action, params);
    // Success - reset reinit state
    resetReinitState();
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if this is a session error that can be recovered
    if (isSessionError(errorMessage)) {
      console.error(`[SeleniumBase HTTP] Session error detected: ${errorMessage}`);

      // Check if we can attempt reinit
      if (!incrementReinitAttempts(errorMessage)) {
        // Max attempts reached, throw the original error
        throw new Error(`Session error after ${MAX_REINIT_ATTEMPTS} reinit attempts: ${errorMessage}`);
      }

      // Reinitialize the driver
      await reinitializeDriver();

      // Retry the command
      return await sendHttpCommand(action, params);
    }

    // Not a session error, throw as-is
    throw error;
  }
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
    // Track last known URL for reinit recovery
    if (currentInstanceId) {
      updateLastKnownUrl(currentInstanceId, url);
    }
  }

  async goBack(options?: NavigationOptions): Promise<void> {
    await sendHttpCommand('back', options);
    const info = await this.getInfo();
    this._url = info.url;
    // Track last known URL for reinit recovery
    if (currentInstanceId) {
      updateLastKnownUrl(currentInstanceId, this._url);
    }
  }

  async goForward(options?: NavigationOptions): Promise<void> {
    await sendHttpCommand('forward', options);
    const info = await this.getInfo();
    this._url = info.url;
    // Track last known URL for reinit recovery
    if (currentInstanceId) {
      updateLastKnownUrl(currentInstanceId, this._url);
    }
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

  /**
   * Minimize browser window (prevents focus stealing)
   */
  async minimize(): Promise<void> {
    await sendHttpCommand('minimize');
  }

  /**
   * Restore/maximize browser window
   */
  async restore(): Promise<void> {
    await sendHttpCommand('restore');
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

  // Store settings for potential reinit
  currentHeadlessSetting = options?.headless ?? false;

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
      profileDir: SELENIUMBASE_PROFILE_DIR,
    });
    createdAt = new Date();
    console.error(`[SeleniumBase HTTP] Created new driver: ${instanceId}`);
  }

  // Track current instance ID for reinit
  currentInstanceId = instanceId;

  // Reset reinit state for new instance
  resetReinitState();

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
