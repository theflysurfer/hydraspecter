/**
 * API Bookmarks - LLM Memory for Endpoints
 *
 * Allows the LLM to save discovered API endpoints during navigation
 * for later reuse in scraping tasks without re-discovering them.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Saved endpoint structure */
export interface SavedEndpoint {
  name: string;
  method: string;
  path: string;
  fullUrl?: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyTemplate?: string;
  tags: string[];
  notes?: string;
  createdAt: string;
  lastUsed?: string;
  usageCount: number;
}

/** Endpoint input for saving */
export interface EndpointInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyTemplate?: string;
}

/** Storage structure */
interface BookmarksStorage {
  version: number;
  endpoints: Record<string, Record<string, SavedEndpoint>>; // domain -> slug -> endpoint
  lastModified: string;
}

/** Headers that should never be saved (security) */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-api-key',
  'x-auth-token',
  'api-key',
  'bearer',
  'x-access-token',
  'x-session-id',
  'x-request-id',
]);

/** Default storage path */
const DEFAULT_BOOKMARKS_PATH = path.join(os.homedir(), '.hydraspecter', 'api-bookmarks.json');

/**
 * Manages API endpoint bookmarks with persistence
 */
export class ApiBookmarks {
  private endpoints: Map<string, Map<string, SavedEndpoint>> = new Map();
  private storagePath: string;
  private dirty: boolean = false;
  private saveTimer?: NodeJS.Timeout;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || DEFAULT_BOOKMARKS_PATH;
    this.load();
  }

  /**
   * Extract root domain from URL
   */
  getRootDomain(urlOrHostname: string): string {
    let hostname: string;

    try {
      const url = new URL(urlOrHostname.includes('://') ? urlOrHostname : `https://${urlOrHostname}`);
      hostname = url.hostname;
    } catch {
      hostname = urlOrHostname;
    }

    hostname = hostname.replace(/^www\./, '');

    const twoPartTlds = [
      'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
      'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tw',
      'org.uk', 'net.au', 'gov.uk', 'ac.uk',
    ];

    const parts = hostname.split('.');

    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2).join('.');
      if (twoPartTlds.includes(lastTwo)) {
        return parts.slice(-3).join('.');
      }
    }

    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }

    return hostname;
  }

  /**
   * Generate a URL-safe slug from endpoint name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }

  /**
   * Extract path from URL
   */
  private extractPath(url: string): string {
    try {
      const parsed = new URL(url.includes('://') ? url : `https://example.com${url}`);
      return parsed.pathname;
    } catch {
      return url.startsWith('/') ? url : `/${url}`;
    }
  }

  /**
   * Sanitize headers by removing sensitive ones
   */
  sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (!SENSITIVE_HEADERS.has(lowerKey)) {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Add or update an endpoint
   */
  addEndpoint(
    domain: string,
    name: string,
    endpoint: EndpointInput,
    options?: { tags?: string[]; notes?: string }
  ): { id: string; created: boolean } {
    const rootDomain = this.getRootDomain(domain);
    const slug = this.generateSlug(name);
    const id = `${rootDomain}/${slug}`;

    if (!this.endpoints.has(rootDomain)) {
      this.endpoints.set(rootDomain, new Map());
    }

    const domainEndpoints = this.endpoints.get(rootDomain)!;
    const existing = domainEndpoints.get(slug);

    const savedEndpoint: SavedEndpoint = {
      name,
      method: endpoint.method.toUpperCase(),
      path: this.extractPath(endpoint.url),
      fullUrl: endpoint.url.includes('://') ? endpoint.url : undefined,
      headers: endpoint.headers ? this.sanitizeHeaders(endpoint.headers) : undefined,
      queryParams: endpoint.queryParams,
      bodyTemplate: endpoint.bodyTemplate,
      tags: options?.tags || [],
      notes: options?.notes,
      createdAt: existing?.createdAt || new Date().toISOString(),
      lastUsed: existing?.lastUsed,
      usageCount: existing?.usageCount || 0,
    };

    domainEndpoints.set(slug, savedEndpoint);
    console.log(`[ApiBookmarks] ${existing ? 'Updated' : 'Added'} endpoint: ${id}`);
    this.scheduleSave();

    return { id, created: !existing };
  }

  /**
   * Get a specific endpoint by ID
   */
  getEndpoint(id: string): SavedEndpoint | null {
    const [domain, slug] = id.split('/');
    if (!domain || !slug) return null;

    const domainEndpoints = this.endpoints.get(domain);
    if (!domainEndpoints) return null;

    const endpoint = domainEndpoints.get(slug);
    if (!endpoint) return null;

    // Update usage stats
    endpoint.lastUsed = new Date().toISOString();
    endpoint.usageCount++;
    this.scheduleSave();

    return endpoint;
  }

  /**
   * List endpoints with optional filtering
   */
  listEndpoints(options?: {
    domain?: string;
    tags?: string[];
    search?: string;
  }): Array<{ id: string; domain: string; endpoint: SavedEndpoint }> {
    const results: Array<{ id: string; domain: string; endpoint: SavedEndpoint }> = [];

    for (const [domain, domainEndpoints] of this.endpoints) {
      // Filter by domain
      if (options?.domain && domain !== this.getRootDomain(options.domain)) {
        continue;
      }

      for (const [slug, endpoint] of domainEndpoints) {
        // Filter by tags
        if (options?.tags && options.tags.length > 0) {
          const hasTag = options.tags.some(tag => endpoint.tags.includes(tag));
          if (!hasTag) continue;
        }

        // Filter by search
        if (options?.search) {
          const searchLower = options.search.toLowerCase();
          const matches =
            endpoint.name.toLowerCase().includes(searchLower) ||
            endpoint.path.toLowerCase().includes(searchLower) ||
            endpoint.notes?.toLowerCase().includes(searchLower) ||
            endpoint.tags.some(t => t.toLowerCase().includes(searchLower));
          if (!matches) continue;
        }

        results.push({
          id: `${domain}/${slug}`,
          domain,
          endpoint,
        });
      }
    }

    // Sort by most recently used, then by usage count
    results.sort((a, b) => {
      const aTime = a.endpoint.lastUsed ? new Date(a.endpoint.lastUsed).getTime() : 0;
      const bTime = b.endpoint.lastUsed ? new Date(b.endpoint.lastUsed).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return b.endpoint.usageCount - a.endpoint.usageCount;
    });

    return results;
  }

  /**
   * Delete an endpoint
   */
  deleteEndpoint(id: string): boolean {
    const [domain, slug] = id.split('/');
    if (!domain || !slug) return false;

    const domainEndpoints = this.endpoints.get(domain);
    if (!domainEndpoints) return false;

    const deleted = domainEndpoints.delete(slug);

    if (deleted) {
      // Clean up empty domain maps
      if (domainEndpoints.size === 0) {
        this.endpoints.delete(domain);
      }
      console.log(`[ApiBookmarks] Deleted endpoint: ${id}`);
      this.scheduleSave();
    }

    return deleted;
  }

  /**
   * Get total count of endpoints
   */
  getTotalCount(): number {
    let count = 0;
    for (const domainEndpoints of this.endpoints.values()) {
      count += domainEndpoints.size;
    }
    return count;
  }

  /**
   * Get count per domain
   */
  getDomainCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [domain, domainEndpoints] of this.endpoints) {
      counts[domain] = domainEndpoints.size;
    }
    return counts;
  }

  /**
   * Load bookmarks from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const content = fs.readFileSync(this.storagePath, 'utf-8');
        const data = JSON.parse(content) as BookmarksStorage;

        this.endpoints.clear();

        if (data.endpoints) {
          for (const [domain, domainEndpoints] of Object.entries(data.endpoints)) {
            const endpointMap = new Map<string, SavedEndpoint>();
            for (const [slug, endpoint] of Object.entries(domainEndpoints)) {
              endpointMap.set(slug, endpoint);
            }
            this.endpoints.set(domain, endpointMap);
          }
        }

        console.log(`[ApiBookmarks] Loaded ${this.getTotalCount()} endpoints across ${this.endpoints.size} domains`);
      }
    } catch (error) {
      console.warn(`[ApiBookmarks] Failed to load: ${error}`);
    }
  }

  /**
   * Save bookmarks to disk
   */
  private save(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: BookmarksStorage = {
        version: 1,
        endpoints: {},
        lastModified: new Date().toISOString(),
      };

      for (const [domain, domainEndpoints] of this.endpoints) {
        data.endpoints[domain] = {};
        for (const [slug, endpoint] of domainEndpoints) {
          data.endpoints[domain][slug] = endpoint;
        }
      }

      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
      this.dirty = false;
      console.log(`[ApiBookmarks] Saved ${this.getTotalCount()} endpoints`);
    } catch (error) {
      console.error(`[ApiBookmarks] Failed to save: ${error}`);
    }
  }

  /**
   * Schedule a save (debounced)
   */
  private scheduleSave(): void {
    this.dirty = true;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      if (this.dirty) {
        this.save();
      }
    }, 1000);
  }

  /**
   * Force save now
   */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.dirty) {
      this.save();
    }
  }
}

/** Singleton instance */
let bookmarksInstance: ApiBookmarks | null = null;

/**
 * Get the API bookmarks singleton
 */
export function getApiBookmarks(storagePath?: string): ApiBookmarks {
  if (!bookmarksInstance) {
    bookmarksInstance = new ApiBookmarks(storagePath);
  }
  return bookmarksInstance;
}
