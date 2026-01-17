import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Simulate HydraSpecter structure
class TestServer {
  constructor() {
    this.server = new Server(
      { name: 'hydraspecter', version: '2.0.0' },
      { capabilities: { tools: {}, completions: {} } }
    );
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
