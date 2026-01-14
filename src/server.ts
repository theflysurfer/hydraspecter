import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { BrowserManager } from './browser-manager.js';
import { BrowserTools } from './tools.js';
import { MetaTool } from './meta-tool.js';
import { ServerConfig } from './types.js';
import { syncAllProfilesFromChrome } from './global-profile.js';

export class ConcurrentBrowserServer {
  private server: Server;
  private browserManager: BrowserManager;
  private browserTools: BrowserTools;
  private metaTool: MetaTool;
  private enabledTools: string[] | undefined;
  private useMetaMode: boolean;

  constructor(config: ServerConfig) {
    this.server = new Server(
      {
        name: 'hydraspecter',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          completions: {},
        },
      }
    );

    this.browserManager = new BrowserManager(config);
    this.browserTools = new BrowserTools(
      this.browserManager,
      config.humanize,
      config.rateLimit,
      {
        poolSize: config.globalProfile?.poolSize,
        headless: config.globalProfile?.headless ?? false, // Default: visible for anti-detection
        channel: config.globalProfile?.channel,
      }
    );
    this.metaTool = new MetaTool(this.browserTools);
    this.enabledTools = config.enabledTools;
    this.useMetaMode = config.metaMode ?? false;

    this.setupHandlers();
  }

  private setupHandlers() {
    // Handle tool list requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Meta mode: expose single unified tool (~2k tokens)
      if (this.useMetaMode) {
        return { tools: this.metaTool.getTools() };
      }

      // Standard mode: expose all tools (~31k tokens)
      let tools = this.browserTools.getTools();

      // Filter tools based on enabled groups (--groups option)
      if (this.enabledTools && this.enabledTools.length > 0) {
        tools = tools.filter(tool => this.enabledTools!.includes(tool.name));
      }

      return {
        tools: tools,
      };
    });

    // Handle tool call requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Meta mode: route through meta-tool
        if (this.useMetaMode) {
          return await this.metaTool.executeTools(name, args || {});
        }

        // Standard mode: direct execution
        const result = await this.browserTools.executeTools(name, args || {});
        return result;
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : error}`
        );
      }
    });

    // Handle completion requests (required for reloaderoo hot-reload)
    this.server.setRequestHandler(CompleteRequestSchema, async () => {
      // Return empty completions - we don't provide autocomplete suggestions
      return {
        completion: {
          values: [],
          hasMore: false,
        },
      };
    });

    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down server...');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nShutting down server...');
      await this.shutdown();
      process.exit(0);
    });
  }

  async run() {
    // Sync Chrome sessions to all pools at startup
    await syncAllProfilesFromChrome();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('HydraSpecter MCP Server started');
  }

  async shutdown() {
    try {
      await this.browserManager.destroy();
          console.error('Server closed');
  } catch (error) {
    console.error('Error closing server:', error);
    }
  }
}

// Default configuration
export const defaultConfig: ServerConfig = {
  maxInstances: 20,
  defaultBrowserConfig: {
    browserType: 'chromium',
    headless: true,
    viewport: {
      width: 1280,
      height: 720,
    },
    contextOptions: {
      ignoreHTTPSErrors: true,
    },
  },
  instanceTimeout: 30 * 60 * 1000, // 30 minutes
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  proxy: {
    autoDetect: true, // Enable proxy auto-detection by default
  },
}; 