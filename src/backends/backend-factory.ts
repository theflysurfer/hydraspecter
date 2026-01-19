/**
 * Backend Factory for HydraSpecter
 *
 * Creates and manages browser backend instances based on type.
 * Supports auto-selection based on domain rules.
 *
 * Uses lazy loading to avoid loading backends until needed,
 * which prevents ESM compatibility issues with camoufox.
 */

import { IBrowserBackend, BackendType } from './types.js';

/** Registered backend implementations (lazy-loaded) */
const backends: Map<BackendType, IBrowserBackend> = new Map();

/** Default backend type */
let defaultBackend: BackendType = 'playwright';

/**
 * Lazy-load a backend by type
 * This avoids loading all backends at startup (which can cause ESM issues)
 */
async function loadBackend(type: BackendType): Promise<IBrowserBackend> {
  // Check if already loaded
  const existing = backends.get(type);
  if (existing) return existing;

  let backend: IBrowserBackend;

  switch (type) {
    case 'playwright': {
      const { PlaywrightBackend } = await import('./playwright-backend.js');
      backend = new PlaywrightBackend();
      break;
    }
    case 'camoufox': {
      const { CamoufoxBackend } = await import('./camoufox-backend.js');
      backend = new CamoufoxBackend();
      break;
    }
    case 'seleniumbase': {
      const { SeleniumBaseBackend } = await import('./seleniumbase-backend.js');
      backend = new SeleniumBaseBackend();
      break;
    }
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }

  backends.set(type, backend);
  return backend;
}

/**
 * Synchronously get a backend if already loaded
 */
function getLoadedBackend(type: BackendType): IBrowserBackend | undefined {
  return backends.get(type);
}

/**
 * Backend Factory
 *
 * Central factory for creating and accessing browser backends.
 * Uses lazy loading to avoid ESM compatibility issues.
 */
export class BackendFactory {
  /**
   * Get a backend by type (async, lazy-loads if needed)
   * @param type Backend type (playwright, camoufox, seleniumbase)
   * @returns Backend instance
   */
  static async getAsync(type: BackendType): Promise<IBrowserBackend> {
    return loadBackend(type);
  }

  /**
   * Get a backend by type (sync, throws if not already loaded)
   * For backwards compatibility - prefers getAsync() for new code
   * @param type Backend type
   * @returns Backend instance
   */
  static get(type: BackendType): IBrowserBackend {
    const backend = getLoadedBackend(type);
    if (!backend) {
      // Try to load playwright synchronously as it's always available
      if (type === 'playwright') {
        // This is a workaround - ideally use getAsync
        throw new Error(`Backend ${type} not yet loaded. Use BackendFactory.getAsync() for lazy loading.`);
      }
      throw new Error(`Backend ${type} not loaded. Call getAsync() first or use a loaded backend.`);
    }
    return backend;
  }

  /**
   * Create a backend instance (alias for getAsync() for clearer API)
   * @param type Backend type
   * @returns Backend instance
   */
  static async create(type: BackendType): Promise<IBrowserBackend> {
    return BackendFactory.getAsync(type);
  }

  /**
   * List available backend types
   * @returns Array of backend type strings
   */
  static listTypes(): BackendType[] {
    return ['playwright', 'camoufox', 'seleniumbase'];
  }

  /**
   * Check if a backend type is available
   * @param type Backend type to check
   * @returns True if available
   */
  static async isAvailable(type: BackendType): Promise<boolean> {
    try {
      const backend = await BackendFactory.getAsync(type);
      return await backend.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Get the default backend type
   * @returns Current default backend type
   */
  static getDefault(): BackendType {
    return defaultBackend;
  }

  /**
   * Set the default backend type
   * @param type New default backend type
   */
  static setDefault(type: BackendType): void {
    if (!['playwright', 'camoufox', 'seleniumbase'].includes(type)) {
      throw new Error(`Unknown backend type: ${type}`);
    }
    defaultBackend = type;
  }

  /**
   * Get backend info for all available backends
   * @returns Array of backend info objects
   */
  static async getInfo(): Promise<Array<{ type: BackendType; name: string; available: boolean }>> {
    const types: BackendType[] = ['playwright', 'camoufox', 'seleniumbase'];
    const info: Array<{ type: BackendType; name: string; available: boolean }> = [];

    for (const type of types) {
      try {
        const backend = await loadBackend(type);
        const available = await backend.isAvailable();
        info.push({
          type,
          name: backend.name,
          available,
        });
      } catch (error) {
        // Backend failed to load
        info.push({
          type,
          name: `${type} (failed to load)`,
          available: false,
        });
      }
    }

    return info;
  }
}

// Note: Individual backends are not re-exported from here to enable lazy loading
// Use BackendFactory.getAsync(type) to get a backend instance
