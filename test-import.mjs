import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Import BrowserManager to test if it breaks things
import { BrowserManager } from './dist/browser-manager.js';

class TestServer {
  constructor() {
    this.server = new Server(
      { name: 'hydraspecter', version: '2.0.0' },
      { capabilities: { tools: {}, completions: {} } }
    );
    
    // Create BrowserManager like HydraSpecter does
    this.browserManager = new BrowserManager({
      maxInstances: 5,
      defaultBrowserConfig: { browserType: 'chromium', headless: true, viewport: { width: 1280, height: 720 } },
      instanceTimeout: 30 * 60 * 1000,
      cleanupInterval: 5 * 60 * 1000,
    });
    
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'browser', description: 'Test', inputSchema: { type: 'object', properties: {} } }]
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
