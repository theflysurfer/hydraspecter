/**
 * Minimal Window Manager for HydraSpecter
 *
 * Manages browser window positioning for stealth backends.
 * Creates a minimal 100x100 window at 0,0 that stays on top.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MinimalWindowOptions {
  /** Window width in pixels (default: 100) */
  width?: number;
  /** Window height in pixels (default: 100) */
  height?: number;
  /** X position (default: 0) */
  x?: number;
  /** Y position (default: 0) */
  y?: number;
  /** Set always-on-top (default: true) */
  alwaysOnTop?: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_MINIMAL: WindowBounds = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

const DEFAULT_RESTORED: WindowBounds = {
  x: 100,
  y: 100,
  width: 1280,
  height: 720,
};

/**
 * Minimal Window Manager
 *
 * Sets browser window to minimal size in corner with always-on-top.
 * Works with Playwright Page objects or any CDP-capable browser.
 */
export class MinimalWindowManager {
  private isMinimized = false;
  private savedBounds: WindowBounds | null = null;

  /**
   * Set window to minimal size (100x100) at position (0,0)
   * @param page Playwright Page or any object with CDP access
   * @param options Configuration options
   */
  async setMinimal(page: any, options: MinimalWindowOptions = {}): Promise<void> {
    const bounds: WindowBounds = {
      x: options.x ?? DEFAULT_MINIMAL.x,
      y: options.y ?? DEFAULT_MINIMAL.y,
      width: options.width ?? DEFAULT_MINIMAL.width,
      height: options.height ?? DEFAULT_MINIMAL.height,
    };

    const alwaysOnTop = options.alwaysOnTop ?? true;

    try {
      // Save current bounds for restore
      this.savedBounds = await this.getWindowBounds(page);
    } catch {
      // If we can't get bounds, use defaults for restore
      this.savedBounds = DEFAULT_RESTORED;
    }

    // Set viewport size
    await this.setViewportSize(page, bounds.width, bounds.height);

    // Set window position via CDP
    await this.setWindowBounds(page, bounds);

    // Set always-on-top if on Windows
    if (alwaysOnTop && process.platform === 'win32') {
      await this.setAlwaysOnTop(page, true);
    }

    this.isMinimized = true;
    console.error(`[MinimalWindow] Set to ${bounds.width}x${bounds.height} at (${bounds.x}, ${bounds.y})`);
  }

  /**
   * Restore window to normal size
   * @param page Playwright Page object
   */
  async restore(page: any): Promise<void> {
    const bounds = this.savedBounds ?? DEFAULT_RESTORED;

    await this.setViewportSize(page, bounds.width, bounds.height);
    await this.setWindowBounds(page, bounds);

    // Remove always-on-top
    if (process.platform === 'win32') {
      await this.setAlwaysOnTop(page, false);
    }

    this.isMinimized = false;
    console.error(`[MinimalWindow] Restored to ${bounds.width}x${bounds.height}`);
  }

  /**
   * Check if window is currently minimized
   */
  isMinimal(): boolean {
    return this.isMinimized;
  }

  /**
   * Set viewport size using Playwright API
   */
  private async setViewportSize(page: any, width: number, height: number): Promise<void> {
    try {
      if (typeof page.setViewportSize === 'function') {
        await page.setViewportSize({ width, height });
      }
    } catch (error) {
      console.error(`[MinimalWindow] Failed to set viewport: ${error}`);
    }
  }

  /**
   * Get window bounds via CDP
   */
  private async getWindowBounds(page: any): Promise<WindowBounds> {
    try {
      const cdpSession = await this.getCDPSession(page);
      if (!cdpSession) {
        return DEFAULT_RESTORED;
      }

      const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
      const { bounds } = await cdpSession.send('Browser.getWindowBounds', { windowId });

      return {
        x: bounds.left || 0,
        y: bounds.top || 0,
        width: bounds.width || DEFAULT_RESTORED.width,
        height: bounds.height || DEFAULT_RESTORED.height,
      };
    } catch {
      return DEFAULT_RESTORED;
    }
  }

  /**
   * Set window bounds via CDP
   */
  private async setWindowBounds(page: any, bounds: WindowBounds): Promise<void> {
    try {
      const cdpSession = await this.getCDPSession(page);
      if (!cdpSession) {
        return;
      }

      const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
      await cdpSession.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          windowState: 'normal',
        },
      });
    } catch (error) {
      console.error(`[MinimalWindow] Failed to set window bounds: ${error}`);
    }
  }

  /**
   * Get CDP session from page
   */
  private async getCDPSession(page: any): Promise<any> {
    try {
      // Playwright way
      if (typeof page.context === 'function') {
        const context = page.context();
        if (typeof context.newCDPSession === 'function') {
          return await context.newCDPSession(page);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Set always-on-top using Windows API via PowerShell
   * @param page Page object (used to find window by title)
   * @param enabled Enable or disable always-on-top
   */
  private async setAlwaysOnTop(_page: any, enabled: boolean): Promise<void> {
    if (process.platform !== 'win32') {
      return;
    }

    try {
      // PowerShell script to set HWND_TOPMOST or HWND_NOTOPMOST
      // Uses FindWindow to find browser windows and SetWindowPos
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$HWND_TOPMOST = [IntPtr]::new(-1)
$HWND_NOTOPMOST = [IntPtr]::new(-2)
$SWP_NOMOVE = 0x0002
$SWP_NOSIZE = 0x0001
$flags = $SWP_NOMOVE -bor $SWP_NOSIZE

$targetPos = if (${enabled}) { $HWND_TOPMOST } else { $HWND_NOTOPMOST }

# Find browser windows by process name (chrome, firefox, chromium)
$browserProcesses = Get-Process | Where-Object {
    $_.ProcessName -match 'chrome|chromium|firefox|msedge'
} | Select-Object -ExpandProperty Id

$found = $false
$callback = {
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }

    $processId = 0
    [Win32]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null

    if ($browserProcesses -contains $processId) {
        $len = [Win32]::GetWindowTextLength($hWnd)
        if ($len -gt 0) {
            $sb = New-Object System.Text.StringBuilder($len + 1)
            [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $windowTitle = $sb.ToString()

            # Set always-on-top for this window
            [Win32]::SetWindowPos($hWnd, $targetPos, 0, 0, 0, 0, $flags) | Out-Null
            $script:found = $true
        }
    }
    return $true
}

[Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
      `.trim();

      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
        windowsHide: true,
      });

      console.error(`[MinimalWindow] Set always-on-top: ${enabled}`);
    } catch (error) {
      console.error(`[MinimalWindow] Failed to set always-on-top: ${error}`);
    }
  }
}

// Singleton instance
let windowManager: MinimalWindowManager | null = null;

/**
 * Get the singleton MinimalWindowManager instance
 */
export function getMinimalWindowManager(): MinimalWindowManager {
  if (!windowManager) {
    windowManager = new MinimalWindowManager();
  }
  return windowManager;
}

/**
 * Quick helper to set minimal window
 */
export async function setMinimalWindow(page: any, options?: MinimalWindowOptions): Promise<void> {
  return getMinimalWindowManager().setMinimal(page, options);
}

/**
 * Quick helper to restore window
 */
export async function restoreWindow(page: any): Promise<void> {
  return getMinimalWindowManager().restore(page);
}
