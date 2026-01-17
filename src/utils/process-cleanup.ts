/**
 * Process cleanup utilities for Windows
 * Handles chromedriver zombie processes without killing user's Chrome
 */

import { execSync } from 'child_process';

/**
 * Force kill a process and its children on Windows
 */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } catch {
      // Process already gone or access denied
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already gone
    }
  }
}

/**
 * Kill all orphan Chromedriver instances
 * This leaves user's main Chrome browser alone
 * Call this BEFORE starting a new SeleniumBase session
 */
export function killOrphanDrivers(): void {
  if (process.platform === 'win32') {
    try {
      // Only kill chromedrivers, not chrome.exe (user's browser)
      execSync('taskkill /F /IM chromedriver.exe', { stdio: 'ignore' });
    } catch {
      // No chromedrivers running, that's fine
    }
  }
}

/**
 * Kill Chrome instances that match our automation profile path
 * More surgical than killing all chrome.exe
 */
export function killHydraSpecterChrome(): void {
  if (process.platform === 'win32') {
    try {
      // Get all chrome processes with their command lines
      const result = execSync(
        'wmic process where "name=\'chrome.exe\'" get processid,commandline /format:csv',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      );

      const lines = result.split('\n').filter(line => line.includes('.hydraspecter'));
      for (const line of lines) {
        const match = line.match(/,(\d+)$/);
        if (match && match[1]) {
          const pid = parseInt(match[1], 10);
          killProcessTree(pid);
        }
      }
    } catch {
      // WMIC might not be available or no matching processes
    }
  }
}

/**
 * Remove lock files from a profile directory
 */
export function removeLockFiles(profileDir: string): void {
  const fs = require('fs');
  const path = require('path');

  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];

  for (const lockFile of lockFiles) {
    const lockPath = path.join(profileDir, lockFile);
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Ignore - might be locked
    }
  }
}

/**
 * Full cleanup before starting a new session
 */
export function cleanupBeforeStart(profileDir?: string): void {
  killOrphanDrivers();

  if (profileDir) {
    removeLockFiles(profileDir);
  }

  // Small delay to ensure processes are fully terminated
  // This is synchronous but necessary for stability
  const start = Date.now();
  while (Date.now() - start < 500) {
    // Busy wait 500ms
  }
}
