import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Lock file content */
export interface ProfileLock {
  pid: number;
  startedAt: string;
  mcpId: string;
}

/** Profile status for listing */
export interface ProfileStatus {
  id: string;
  path: string;
  available: boolean;
  lock?: ProfileLock;
  isStale?: boolean;
}

/** Default pool configuration */
const DEFAULT_BASE_DIR = path.join(os.homedir(), '.hydraspecter');
const DEFAULT_POOL_SIZE = 10;

/**
 * Manages a pool of browser profiles for multi-process support.
 * Each process acquires a profile from the pool, preventing Chrome's profile lock conflicts.
 */
export class ProfilePool {
  private baseDir: string;
  private profilesDir: string;
  private locksDir: string;
  private poolSize: number;
  private acquiredProfile: string | null = null;
  private mcpId: string;

  constructor(options?: {
    baseDir?: string;
    poolSize?: number;
  }) {
    this.baseDir = options?.baseDir || DEFAULT_BASE_DIR;
    this.profilesDir = path.join(this.baseDir, 'profiles');
    this.locksDir = path.join(this.baseDir, 'locks');
    this.poolSize = options?.poolSize || DEFAULT_POOL_SIZE;
    this.mcpId = `hydra-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    this.ensureDirectories();
    this.setupCleanupHandlers();
  }

  /**
   * Ensure all required directories exist
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
    }
    if (!fs.existsSync(this.locksDir)) {
      fs.mkdirSync(this.locksDir, { recursive: true });
    }

    // Create pool directories
    for (let i = 0; i < this.poolSize; i++) {
      const profilePath = path.join(this.profilesDir, `pool-${i}`);
      if (!fs.existsSync(profilePath)) {
        fs.mkdirSync(profilePath, { recursive: true });
      }
    }
  }

  /**
   * Setup cleanup handlers for process exit
   */
  private setupCleanupHandlers(): void {
    const cleanup = () => {
      if (this.acquiredProfile) {
        this.releaseProfile(this.acquiredProfile);
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      cleanup();
      process.exit(1);
    });
  }

  /**
   * Get lock file path for a profile
   */
  private getLockPath(profileId: string): string {
    return path.join(this.locksDir, `${profileId}.lock`);
  }

  /**
   * Check if a process is still running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Chrome's native lockfile is active (another Chrome has the profile open)
   */
  private isChromeLockActive(profilePath: string): boolean {
    const chromeLockFile = path.join(profilePath, 'lockfile');
    if (!fs.existsSync(chromeLockFile)) return false;

    try {
      // Try to open for writing - if Chrome has it locked, this fails on Windows
      const fd = fs.openSync(chromeLockFile, 'r+');
      fs.closeSync(fd);
      return false; // We could open it, so it's not locked by Chrome
    } catch {
      return true; // Locked by another Chrome process
    }
  }

  /**
   * Check if a lock is stale (process no longer running)
   */
  private isLockStale(lockPath: string): boolean {
    try {
      const lockContent = fs.readFileSync(lockPath, 'utf-8');
      const lock: ProfileLock = JSON.parse(lockContent);
      return !this.isProcessRunning(lock.pid);
    } catch {
      // If we can't read the lock, consider it stale
      return true;
    }
  }

  /**
   * Clean up stale locks
   */
  private cleanStaleLocks(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const profileId = `pool-${i}`;
      const lockPath = this.getLockPath(profileId);

      if (fs.existsSync(lockPath) && this.isLockStale(lockPath)) {
        console.log(`[ProfilePool] Cleaning stale lock for ${profileId}`);
        fs.unlinkSync(lockPath);
      }
    }
  }

  /**
   * Acquire an available profile from the pool
   * @param preferredId - Optional profile ID to try first (e.g., "pool-0" for auth)
   * @returns Profile path if available, null if all profiles are in use
   */
  async acquireProfile(preferredId?: string): Promise<{ profileId: string; profilePath: string } | null> {
    // Clean stale locks first
    this.cleanStaleLocks();

    // Build order of profiles to try (preferred first if specified)
    const profileOrder: number[] = [];
    if (preferredId) {
      const match = preferredId.match(/pool-(\d+)/);
      if (match && match[1]) {
        const preferredIndex = parseInt(match[1], 10);
        if (preferredIndex >= 0 && preferredIndex < this.poolSize) {
          profileOrder.push(preferredIndex);
        }
      }
    }
    // Add remaining profiles in order
    for (let i = 0; i < this.poolSize; i++) {
      if (!profileOrder.includes(i)) {
        profileOrder.push(i);
      }
    }

    for (const i of profileOrder) {
      const profileId = `pool-${i}`;
      const lockPath = this.getLockPath(profileId);
      const profilePath = path.join(this.profilesDir, profileId);

      // Check Chrome's native lock first (another Chrome may have the profile open)
      if (this.isChromeLockActive(profilePath)) {
        console.log(`[ProfilePool] Profile ${profileId} locked by Chrome, trying next`);
        continue;
      }

      // Check if our lock exists
      if (!fs.existsSync(lockPath)) {
        // Create lock
        const lock: ProfileLock = {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          mcpId: this.mcpId
        };

        try {
          // Use exclusive flag to prevent race conditions
          fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), { flag: 'wx' });
          this.acquiredProfile = profileId;
          console.log(`[ProfilePool] Acquired profile: ${profileId}`);
          return { profileId, profilePath };
        } catch (err: any) {
          // Another process grabbed it first, try next
          if (err.code !== 'EEXIST') {
            throw err;
          }
        }
      }
    }

    return null; // All profiles in use
  }

  /**
   * Release a profile back to the pool
   */
  releaseProfile(profileId: string): void {
    const lockPath = this.getLockPath(profileId);

    if (fs.existsSync(lockPath)) {
      try {
        const lockContent = fs.readFileSync(lockPath, 'utf-8');
        const lock: ProfileLock = JSON.parse(lockContent);

        // Only release if we own this lock
        if (lock.mcpId === this.mcpId) {
          fs.unlinkSync(lockPath);
          console.log(`[ProfilePool] Released profile: ${profileId}`);

          if (this.acquiredProfile === profileId) {
            this.acquiredProfile = null;
          }
        }
      } catch (err) {
        console.error(`[ProfilePool] Error releasing profile ${profileId}:`, err);
      }
    }
  }

  /**
   * Force release a profile (for manual cleanup)
   */
  forceReleaseProfile(profileId: string): boolean {
    const lockPath = this.getLockPath(profileId);

    if (fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
        console.log(`[ProfilePool] Force released profile: ${profileId}`);
        return true;
      } catch (err) {
        console.error(`[ProfilePool] Error force releasing profile ${profileId}:`, err);
        return false;
      }
    }
    return false; // No lock to release
  }

  /**
   * List all profiles and their status
   */
  listProfiles(): ProfileStatus[] {
    const profiles: ProfileStatus[] = [];

    for (let i = 0; i < this.poolSize; i++) {
      const profileId = `pool-${i}`;
      const lockPath = this.getLockPath(profileId);
      const profilePath = path.join(this.profilesDir, profileId);

      const status: ProfileStatus = {
        id: profileId,
        path: profilePath,
        available: true
      };

      if (fs.existsSync(lockPath)) {
        try {
          const lockContent = fs.readFileSync(lockPath, 'utf-8');
          const lock: ProfileLock = JSON.parse(lockContent);
          status.available = false;
          status.lock = lock;
          status.isStale = !this.isProcessRunning(lock.pid);
        } catch {
          // Corrupted lock, mark as stale
          status.available = false;
          status.isStale = true;
        }
      }

      profiles.push(status);
    }

    return profiles;
  }

  /**
   * Get the currently acquired profile for this process
   */
  getAcquiredProfile(): string | null {
    return this.acquiredProfile;
  }

  /**
   * Get the MCP instance ID
   */
  getMcpId(): string {
    return this.mcpId;
  }

  /**
   * Get pool size
   */
  getPoolSize(): number {
    return this.poolSize;
  }

  /**
   * Get base directory
   */
  getBaseDir(): string {
    return this.baseDir;
  }
}

/** Singleton instance */
let profilePoolInstance: ProfilePool | null = null;

/**
 * Get the profile pool singleton
 */
export function getProfilePool(options?: {
  baseDir?: string;
  poolSize?: number;
}): ProfilePool {
  if (!profilePoolInstance) {
    profilePoolInstance = new ProfilePool(options);
  }
  return profilePoolInstance;
}

/**
 * Reset the profile pool (for testing)
 */
export function resetProfilePool(): void {
  if (profilePoolInstance) {
    const acquired = profilePoolInstance.getAcquiredProfile();
    if (acquired) {
      profilePoolInstance.releaseProfile(acquired);
    }
    profilePoolInstance = null;
  }
}
