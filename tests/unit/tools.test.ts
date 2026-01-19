import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserTools } from '../../src/tools.js';
import { BrowserManager } from '../../src/browser-manager.js';

// Mock BrowserManager
vi.mock('../../src/browser-manager.js', () => ({
  BrowserManager: vi.fn().mockImplementation(() => ({
    getInstance: vi.fn(),
    createInstance: vi.fn(),
    listInstances: vi.fn(),
    closeInstance: vi.fn(),
    closeAllInstances: vi.fn(),
    saveSessionState: vi.fn(),
  })),
}));

describe('BrowserTools', () => {
  let browserTools: BrowserTools;
  let mockBrowserManager: any;

  beforeEach(() => {
    mockBrowserManager = new BrowserManager({} as any);
    browserTools = new BrowserTools(mockBrowserManager);
  });

  describe('getTools()', () => {
    it('should return an array of tools', () => {
      const tools = browserTools.getTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should include browser_create tool', () => {
      const tools = browserTools.getTools();
      const createTool = tools.find(t => t.name === 'browser_create');
      expect(createTool).toBeDefined();
      expect(createTool?.inputSchema).toBeDefined();
      expect(createTool?.outputSchema).toBeDefined();
    });

    it('should include browser_navigate tool with outputSchema', () => {
      const tools = browserTools.getTools();
      const navigateTool = tools.find(t => t.name === 'browser_navigate');
      expect(navigateTool).toBeDefined();
      expect(navigateTool?.outputSchema).toHaveProperty('properties');
    });

    it('should include browser_snapshot tool', () => {
      const tools = browserTools.getTools();
      const snapshotTool = tools.find(t => t.name === 'browser_snapshot');
      expect(snapshotTool).toBeDefined();
      expect(snapshotTool?.description).toContain('token-efficient');
    });

    it('should include browser_batch_execute tool', () => {
      const tools = browserTools.getTools();
      const batchTool = tools.find(t => t.name === 'browser_batch_execute');
      expect(batchTool).toBeDefined();
      expect(batchTool?.inputSchema.properties).toHaveProperty('steps');
    });

    it('all tools should have name and description', () => {
      const tools = browserTools.getTools();
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.name.startsWith('browser_')).toBe(true);
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });

    it('all tools should have inputSchema', () => {
      const tools = browserTools.getTools();
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('executeTools() - rate limiting', () => {
    it('should allow requests when rate limiting disabled', async () => {
      mockBrowserManager.listInstances.mockReturnValue({
        success: true,
        data: { instances: [], count: 0 },
      });

      const result = await browserTools.executeTools('browser_list_instances', {});
      expect(result.isError).toBeFalsy();
    });

    it('should block requests when rate limit exceeded', async () => {
      // Create tools with rate limiting enabled
      const rateLimitedTools = new BrowserTools(
        mockBrowserManager,
        {},
        { enabled: true, maxRequests: 2, windowMs: 60000 }
      );

      mockBrowserManager.listInstances.mockReturnValue({
        success: true,
        data: { instances: [], count: 0 },
      });

      // First two requests should succeed
      await rateLimitedTools.executeTools('browser_list_instances', {});
      await rateLimitedTools.executeTools('browser_list_instances', {});

      // Third request should be rate limited
      const result = await rateLimitedTools.executeTools('browser_list_instances', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Rate limit exceeded');
    });
  });

  describe('executeTools() - MCP format', () => {
    it('should return MCP-compliant format on success', async () => {
      mockBrowserManager.listInstances.mockReturnValue({
        success: true,
        data: { instances: [], count: 0 },
      });

      const result = await browserTools.executeTools('browser_list_instances', {});

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeFalsy();
    });

    it('should return isError: true on failure', async () => {
      mockBrowserManager.closeInstance.mockReturnValue({
        success: false,
        error: 'Instance not found',
      });

      const result = await browserTools.executeTools('browser_close_instance', {
        instanceId: 'nonexistent',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Instance not found');
    });

    it('should return error for unknown tool', async () => {
      const result = await browserTools.executeTools('unknown_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });
  });

  describe('getRateLimitStatus()', () => {
    it('should return rate limit status', () => {
      const status = browserTools.getRateLimitStatus();
      expect(status).toHaveProperty('allowed');
      expect(status).toHaveProperty('remaining');
      expect(status).toHaveProperty('resetMs');
      expect(status).toHaveProperty('total');
    });
  });
});
