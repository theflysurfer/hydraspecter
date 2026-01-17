import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { BrowserManager } from './dist/browser-manager.js';
import { BrowserTools } from './dist/tools.js';
import { MetaTool } from './dist/meta-tool.js';

class TestServer {
  constructor() {
    this.server = new Server(
      { name: 'hydraspecter', version: '2.0.0' },
      { capabilities: { tools: {}, completions: {} } }
    );
    
    const config = {
      maxInstances: 5,
      defaultBrowserConfig: { browserType: 'chromium', headless: true, viewport: { width: 1280, height: 720 } },
      instanceTimeout: 30 * 60 * 1000,
      cleanupInterval: 5 * 60 * 1000,
    };
    
    this.browserManager = new BrowserManager(config);
    this.browserTools = new BrowserTools(this.browserManager, {}, undefined, { poolSize: 5 });
    this.metaTool = new MetaTool(this.browserTools);
    
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.metaTool.getTools()
    }));
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Test server started');
  }
}

const server = new TestServer();
await server.run();
