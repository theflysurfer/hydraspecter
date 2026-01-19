/**
 * HydraSpecter Backends Module
 *
 * Exports all browser backend implementations and types.
 *
 * NOTE: Individual backends (PlaywrightBackend, CamoufoxBackend, SeleniumBaseBackend)
 * are NOT exported here to enable lazy loading. Use BackendFactory.getAsync(type)
 * to get a backend instance. This avoids ESM compatibility issues with camoufox.
 */

// Types
export * from './types.js';

// Factory (use BackendFactory.getAsync() for lazy loading)
export { BackendFactory } from './backend-factory.js';

// Unified backend manager
export {
  UnifiedBackendManager,
  getUnifiedBackendManager,
  type UnifiedInstance,
  type FallbackConfig,
} from './unified-backend.js';
