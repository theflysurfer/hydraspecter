import { ConcurrentBrowserServer, defaultConfig } from './dist/server.js';

const config = {
  ...defaultConfig,
  maxInstances: 5,
  metaMode: true,
  globalProfile: { poolSize: 5, headless: false }
};

const server = new ConcurrentBrowserServer(config);
await server.run();
