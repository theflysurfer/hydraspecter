/**
 * SeleniumBase Backend for HydraSpecter
 *
 * Chrome-based stealth browser using SeleniumBase UC (Undetected Chrome) mode.
 * Communicates via subprocess stdio for reliable, non-blocking operation.
 *
 * Key features:
 * - Chrome UC mode (patches chromedriver detection)
 * - uc_click() and uc_gui_click_captcha() for Turnstile bypass
 * - Native Chrome profile persistence
 * - No HTTP bridge (direct stdio communication)
 */

import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

import {
  IBrowserBackend,
  BackendType,
  BackendPage,
  BackendInstance,
  BackendCreateOptions,
  BackendNavigateOptions,
  BackendClickOptions,
  BackendTypeOptions,
  BackendScreenshotOptions,
  BackendSnapshotResult,
  BackendResult,
} from './types.js';

/** Message sent to Python subprocess */
interface PythonCommand {
  id: string;
  method: string;
  params: Record<string, any>;
}

/** Response from Python subprocess */
interface PythonResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * SeleniumBase Backend Implementation
 *
 * Uses a Python subprocess running SeleniumBase UC mode.
 * Communication is via JSON lines over stdio (no HTTP bridge).
 */
export class SeleniumBaseBackend implements IBrowserBackend {
  readonly backendType: BackendType = 'seleniumbase';
  readonly name = 'SeleniumBase UC Mode (Chrome Stealth)';

  private instances: Map<string, {
    process: ChildProcess;
    readline: readline.Interface;
    pending: Map<string, { resolve: (value: PythonResponse) => void; reject: (error: Error) => void }>;
    instance: BackendInstance;
  }> = new Map();

  private pythonScriptPath: string;

  constructor() {
    // Python script path (bundled with HydraSpecter)
    this.pythonScriptPath = path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
      '..',
      '..',
      'scripts',
      'seleniumbase_bridge.py'
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Python and SeleniumBase are available
      const result = await this.runPythonCheck();
      return result;
    } catch {
      return false;
    }
  }

  /**
   * Find Python executable path (cross-platform)
   * Tries multiple methods: env var, py.exe launcher, common paths
   */
  private async findPythonPath(): Promise<string> {
    // 1. Check PYTHON environment variable
    if (process.env['PYTHON']) {
      return process.env['PYTHON'];
    }

    // 2. On Windows, try py.exe launcher first (most reliable)
    if (process.platform === 'win32') {
      const pyPath = await this.tryCommand('py', ['-3', '--version']);
      if (pyPath) return 'py';

      // 3. Try where python to find in PATH
      const wherePython = await this.tryWhereCommand('python');
      if (wherePython) return wherePython;

      // 4. Check common Windows Python paths
      const commonPaths = [
        'C:\\Python313\\python.exe',
        'C:\\Python312\\python.exe',
        'C:\\Python311\\python.exe',
        'C:\\Python310\\python.exe',
        'C:\\Python39\\python.exe',
        `${process.env['LOCALAPPDATA']}\\Programs\\Python\\Python313\\python.exe`,
        `${process.env['LOCALAPPDATA']}\\Programs\\Python\\Python312\\python.exe`,
        `${process.env['LOCALAPPDATA']}\\Programs\\Python\\Python311\\python.exe`,
        `${process.env['LOCALAPPDATA']}\\Programs\\Python\\Python310\\python.exe`,
        `${process.env['USERPROFILE']}\\AppData\\Local\\Programs\\Python\\Python313\\python.exe`,
        `${process.env['USERPROFILE']}\\AppData\\Local\\Programs\\Python\\Python312\\python.exe`,
        `${process.env['USERPROFILE']}\\AppData\\Local\\Programs\\Python\\Python311\\python.exe`,
      ];

      for (const p of commonPaths) {
        if (p && fs.existsSync(p)) {
          return p;
        }
      }
    }

    // 5. Default fallback
    return process.platform === 'win32' ? 'py' : 'python3';
  }

  private async tryCommand(cmd: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, { stdio: 'ignore', timeout: 3000 });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  private async tryWhereCommand(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('where', [cmd], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
      let output = '';
      proc.stdout?.on('data', (data) => { output += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && output.trim()) {
          // Return first path found
          const firstPath = output.trim().split('\n')[0];
          resolve(firstPath ? firstPath.trim() : null);
        } else {
          resolve(null);
        }
      });
      proc.on('error', () => resolve(null));
    });
  }

  private async runPythonCheck(): Promise<boolean> {
    const pythonPath = await this.findPythonPath();
    const args = pythonPath === 'py' ? ['-3', '-c', 'import seleniumbase; print("ok")'] : ['-c', 'import seleniumbase; print("ok")'];

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      });

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        resolve(code === 0 && output.includes('ok'));
      });

      proc.on('error', () => {
        resolve(false);
      });

      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  }

  async create(options: BackendCreateOptions = {}): Promise<BackendResult<BackendInstance>> {
    try {
      const id = uuidv4();

      // Profile directory for persistence
      const profileDir = options.profileDir || path.join(
        os.homedir(),
        '.hydraspecter',
        'seleniumbase-profile'
      );

      // Ensure profile directory exists
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // Ensure Python bridge script exists
      if (!fs.existsSync(this.pythonScriptPath)) {
        await this.createPythonBridgeScript();
      }

      // Find Python executable and start subprocess
      const pythonPath = await this.findPythonPath();
      // If using py.exe launcher, add -3 flag for Python 3
      const pythonArgs = pythonPath === 'py'
        ? ['-3', this.pythonScriptPath]
        : [this.pythonScriptPath];

      const proc = spawn(pythonPath, pythonArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HYDRA_PROFILE_DIR: profileDir,
          HYDRA_HEADLESS: options.headless ? 'true' : 'false',
          HYDRA_PROXY: options.proxy || '',
          HYDRA_WINDOW_SIZE: options.windowSize
            ? `${options.windowSize.width},${options.windowSize.height}`
            : options.viewport
              ? `${options.viewport.width},${options.viewport.height}`
              : '1280,720',
          HYDRA_WINDOW_POSITION: options.windowPosition
            ? `${options.windowPosition.x},${options.windowPosition.y}`
            : '',
        },
      });

      // Set up readline for JSON line communication
      const rl = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      const pending = new Map<string, { resolve: (value: PythonResponse) => void; reject: (error: Error) => void }>();

      // Handle responses
      rl.on('line', (line) => {
        try {
          const response: PythonResponse = JSON.parse(line);
          const handler = pending.get(response.id);
          if (handler) {
            pending.delete(response.id);
            handler.resolve(response);
          }
        } catch (e) {
          console.error('[SeleniumBase] Invalid JSON response:', line);
        }
      });

      // Handle stderr for debugging
      proc.stderr?.on('data', (data) => {
        console.error('[SeleniumBase]', data.toString().trim());
      });

      // Handle process exit
      proc.on('close', (code) => {
        console.error(`[SeleniumBase] Process exited with code ${code}`);
        // Reject all pending requests
        for (const [reqId, handler] of pending) {
          handler.reject(new Error(`Process exited with code ${code}`));
          pending.delete(reqId);
        }
        this.instances.delete(id);
      });

      // Create the BackendPage wrapper
      const backendPage: BackendPage = {
        id: `sb-page-${id.slice(0, 8)}`,
        backend: 'seleniumbase',
        url: async () => {
          const result = await this.sendCommand(id, 'get_url', {});
          return result.data || 'about:blank';
        },
        title: async () => {
          const result = await this.sendCommand(id, 'get_title', {});
          return result.data || '';
        },
        native: { instanceId: id, type: 'seleniumbase' },
      };

      const instance: BackendInstance = {
        id,
        backend: 'seleniumbase',
        page: backendPage,
        pages: async () => [backendPage], // SeleniumBase UC mode is single-page
        createdAt: new Date(),
        lastUsed: new Date(),
        native: proc,
      };

      this.instances.set(id, { process: proc, readline: rl, pending, instance });

      // Initialize browser
      const initResult = await this.sendCommand(id, 'init', {
        profileDir,
        headless: options.headless ?? false,
        proxy: options.proxy,
        windowSize: options.windowSize || options.viewport || { width: 1280, height: 720 },
        windowPosition: options.windowPosition,
      });

      if (!initResult.success) {
        await this.close(instance);
        return {
          success: false,
          error: initResult.error || 'Failed to initialize SeleniumBase',
        };
      }

      // Navigate to initial URL if provided
      if (options.url) {
        const navResult = await this.sendCommand(id, 'navigate', { url: options.url });
        if (!navResult.success) {
          console.error('[SeleniumBase] Initial navigation failed:', navResult.error);
        }
      }

      return {
        success: true,
        data: instance,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create SeleniumBase instance: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  private async sendCommand(instanceId: string, method: string, params: Record<string, any>): Promise<PythonResponse> {
    const stored = this.instances.get(instanceId);
    if (!stored) {
      return { id: '', success: false, error: 'Instance not found' };
    }

    const cmdId = uuidv4();
    const command: PythonCommand = { id: cmdId, method, params };

    return new Promise((resolve, reject) => {
      stored.pending.set(cmdId, { resolve, reject });

      // Send command as JSON line
      stored.process.stdin?.write(JSON.stringify(command) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (stored.pending.has(cmdId)) {
          stored.pending.delete(cmdId);
          resolve({ id: cmdId, success: false, error: 'Command timed out' });
        }
      }, 30000);
    });
  }

  private async createPythonBridgeScript(): Promise<void> {
    const scriptDir = path.dirname(this.pythonScriptPath);
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }

    const script = `#!/usr/bin/env python3
"""
SeleniumBase Bridge for HydraSpecter
Communicates via JSON lines over stdio.
"""

import json
import sys
import os
import traceback

def main():
    # Environment config
    profile_dir = os.environ.get('HYDRA_PROFILE_DIR', '')
    headless = os.environ.get('HYDRA_HEADLESS', 'false').lower() == 'true'
    proxy = os.environ.get('HYDRA_PROXY', '')
    window_size = os.environ.get('HYDRA_WINDOW_SIZE', '1280,720')
    window_position = os.environ.get('HYDRA_WINDOW_POSITION', '')

    driver = None

    def send_response(cmd_id, success, data=None, error=None):
        response = {'id': cmd_id, 'success': success}
        if data is not None:
            response['data'] = data
        if error is not None:
            response['error'] = error
        print(json.dumps(response), flush=True)

    def init_driver(params):
        nonlocal driver
        from seleniumbase import Driver

        # Parse window size
        ws = params.get('windowSize', {})
        width = ws.get('width', 1280)
        height = ws.get('height', 720)

        # UC mode options
        driver = Driver(
            uc=True,  # Undetected Chrome mode
            headless=params.get('headless', False),
            user_data_dir=params.get('profileDir'),
            proxy=params.get('proxy') or None,
        )

        # Set window size
        driver.set_window_size(width, height)

        # Set window position if specified
        wp = params.get('windowPosition')
        if wp:
            driver.set_window_position(wp.get('x', 0), wp.get('y', 0))

        return True

    def navigate(params):
        url = params.get('url')
        if not url:
            raise ValueError('URL required')
        driver.uc_open_with_reconnect(url, reconnect_time=3)
        return True

    def click(params):
        selector = params.get('selector')
        uc_click = params.get('ucClick', True)
        if not selector:
            raise ValueError('Selector required')

        if uc_click:
            # UC click avoids detection
            driver.uc_click(selector)
        else:
            driver.click(selector)
        return True

    def type_text(params):
        selector = params.get('selector')
        text = params.get('text')
        if not selector or text is None:
            raise ValueError('Selector and text required')

        if params.get('clear', False):
            driver.clear(selector)

        driver.type(selector, text)
        return True

    def fill(params):
        selector = params.get('selector')
        value = params.get('value')
        if not selector or value is None:
            raise ValueError('Selector and value required')

        driver.clear(selector)
        driver.type(selector, value)
        return True

    def screenshot(params):
        import base64
        # Take screenshot and return as base64
        png_data = driver.get_screenshot_as_png()
        return base64.b64encode(png_data).decode('utf-8')

    def snapshot(params):
        format_type = params.get('format', 'html')
        if format_type == 'html':
            return {'content': driver.page_source, 'format': 'html'}
        else:
            return {'content': driver.get_page_source(), 'format': 'text'}

    def evaluate(params):
        script = params.get('script')
        if not script:
            raise ValueError('Script required')
        return driver.execute_script(script)

    def wait_element(params):
        selector = params.get('selector')
        timeout = params.get('timeout', 10)
        if not selector:
            raise ValueError('Selector required')
        driver.wait_for_element(selector, timeout=timeout)
        return True

    def scroll(params):
        if 'selector' in params:
            driver.scroll_to(params['selector'])
        else:
            direction = params.get('direction', 'down')
            amount = params.get('amount', 300)
            if direction == 'down':
                driver.execute_script(f'window.scrollBy(0, {amount})')
            else:
                driver.execute_script(f'window.scrollBy(0, -{amount})')
        return True

    def close(params):
        nonlocal driver
        if driver:
            driver.quit()
            driver = None
        return True

    def get_url(params):
        return driver.current_url if driver else 'about:blank'

    def get_title(params):
        return driver.title if driver else ''

    def solve_turnstile(params):
        # Special method for Cloudflare Turnstile
        driver.uc_gui_click_captcha()
        return True

    # Command handlers
    handlers = {
        'init': init_driver,
        'navigate': navigate,
        'click': click,
        'type': type_text,
        'fill': fill,
        'screenshot': screenshot,
        'snapshot': snapshot,
        'evaluate': evaluate,
        'wait_element': wait_element,
        'scroll': scroll,
        'close': close,
        'get_url': get_url,
        'get_title': get_title,
        'solve_turnstile': solve_turnstile,
    }

    # Main loop: read JSON commands from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
            cmd_id = cmd.get('id', '')
            method = cmd.get('method', '')
            params = cmd.get('params', {})

            if method not in handlers:
                send_response(cmd_id, False, error=f'Unknown method: {method}')
                continue

            try:
                result = handlers[method](params)
                send_response(cmd_id, True, data=result)
            except Exception as e:
                send_response(cmd_id, False, error=str(e))

        except json.JSONDecodeError as e:
            sys.stderr.write(f'Invalid JSON: {e}\\n')
            sys.stderr.flush()

if __name__ == '__main__':
    main()
`;

    fs.writeFileSync(this.pythonScriptPath, script, 'utf-8');
  }

  async navigate(backendPage: BackendPage, url: string, options: BackendNavigateOptions = {}): Promise<BackendResult<void>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'navigate', { url, ...options });
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  async click(backendPage: BackendPage, selector: string, options: BackendClickOptions = {}): Promise<BackendResult<void>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'click', {
      selector,
      ucClick: options.ucClick ?? true,
      ...options,
    });
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  async typeText(backendPage: BackendPage, selector: string, text: string, options: BackendTypeOptions = {}): Promise<BackendResult<void>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'type', { selector, text, ...options });
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  async fill(backendPage: BackendPage, selector: string, value: string, options: BackendTypeOptions = {}): Promise<BackendResult<void>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'fill', { selector, value, ...options });
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  async screenshot(backendPage: BackendPage, options: BackendScreenshotOptions = {}): Promise<BackendResult<string>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'screenshot', options);
    return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
  }

  async snapshot(backendPage: BackendPage, options: { format?: 'aria' | 'html' | 'text' } = {}): Promise<BackendResult<BackendSnapshotResult>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'snapshot', { format: options.format || 'html' });
    return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
  }

  async evaluate<T = any>(backendPage: BackendPage, script: string, ...args: any[]): Promise<BackendResult<T>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'evaluate', { script, args });
    return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
  }

  async waitForElement(backendPage: BackendPage, selector: string, options: { timeout?: number; state?: 'attached' | 'visible' } = {}): Promise<BackendResult<void>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'wait_element', { selector, ...options });
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  async waitForNavigation(_backendPage: BackendPage, _options: BackendNavigateOptions = {}): Promise<BackendResult<void>> {
    // SeleniumBase handles this internally during navigate
    return { success: true };
  }

  async scroll(backendPage: BackendPage, options: { direction: 'up' | 'down'; amount?: number } | { selector: string }): Promise<BackendResult<void>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'scroll', options);
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  async closePage(_backendPage: BackendPage): Promise<BackendResult<void>> {
    // SeleniumBase UC mode is single-page, closing page closes the browser
    return { success: true };
  }

  async close(instance: BackendInstance): Promise<BackendResult<void>> {
    try {
      const stored = this.instances.get(instance.id);
      if (stored) {
        await this.sendCommand(instance.id, 'close', {});
        stored.process.kill();
        stored.readline.close();
        this.instances.delete(instance.id);
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Close instance failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * Solve Cloudflare Turnstile challenge using UC GUI click
   */
  async solveTurnstile(backendPage: BackendPage): Promise<BackendResult<void>> {
    const instanceId = (backendPage.native as any).instanceId;
    const result = await this.sendCommand(instanceId, 'solve_turnstile', {});
    return result.success ? { success: true } : { success: false, error: result.error };
  }
}
