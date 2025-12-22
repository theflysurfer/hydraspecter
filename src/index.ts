#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ConcurrentBrowserServer, defaultConfig } from './server.js';
import { ServerConfig } from './types.js';

const program = new Command();

program
  .name('concurrent-browser-mcp')
  .description('A multi-concurrent browser MCP server')
  .version('1.0.0');

program
  .option('-m, --max-instances <number>', 'Maximum number of instances', (value) => parseInt(value), defaultConfig.maxInstances)
  .option('-t, --instance-timeout <number>', 'Instance timeout in minutes', (value) => parseInt(value) * 60 * 1000, defaultConfig.instanceTimeout)
  .option('-c, --cleanup-interval <number>', 'Cleanup interval in minutes', (value) => parseInt(value) * 60 * 1000, defaultConfig.cleanupInterval)
  .option('--browser <browser>', 'Default browser type', 'chromium')
  .option('--headless', 'Default headless mode', true)
  .option('--width <number>', 'Default viewport width (0 for natural)', (value) => parseInt(value), defaultConfig.defaultBrowserConfig.viewport?.width || 1280)
  .option('--height <number>', 'Default viewport height (0 for natural)', (value) => parseInt(value), defaultConfig.defaultBrowserConfig.viewport?.height || 720)
  .option('--natural-viewport', 'Use natural viewport size (recommended for anti-detection)', false)
  .option('--channel <channel>', 'Browser channel: chrome, msedge (recommended for anti-detection)')
  .option('--user-data-dir <path>', 'Persistent user data directory for profile reuse')
  .option('--user-agent <string>', 'Default user agent (not recommended - use browser default)')
  .option('--ignore-https-errors', 'Ignore HTTPS errors', false)
  .option('--bypass-csp', 'Bypass CSP', false)
  .option('--proxy <string>', 'Proxy server (e.g., http://127.0.0.1:7890)')
  .option('--no-proxy-auto-detect', 'Disable automatic proxy detection')
  .option('--humanize', 'Enable all human-like behaviors by default (mouse, typing, scroll)')
  .option('--humanize-mouse', 'Enable human-like mouse movement by default')
  .option('--humanize-typing', 'Enable human-like typing by default')
  .option('--humanize-scroll', 'Enable human-like scrolling by default')
  .option('--typo-rate <number>', 'Typo rate for human typing (0-1)', (value) => parseFloat(value), 0.02)
  .action(async (options) => {
    // Build configuration
    // Determine viewport: null for natural, or specified dimensions
    const viewport = options.naturalViewport ? null : {
      width: options.width,
      height: options.height,
    };

    const config: ServerConfig = {
      maxInstances: options.maxInstances,
      instanceTimeout: options.instanceTimeout,
      cleanupInterval: options.cleanupInterval,
      defaultBrowserConfig: {
        browserType: options.browser as 'chromium' | 'firefox' | 'webkit',
        headless: options.headless,
        viewport: viewport,
        userAgent: options.userAgent,
        channel: options.channel as 'chrome' | 'msedge' | 'chrome-beta' | 'msedge-beta' | undefined,
        userDataDir: options.userDataDir,
        contextOptions: {
          ignoreHTTPSErrors: options.ignoreHttpsErrors,
          bypassCSP: options.bypassCsp,
        },
      },
      proxy: {
        server: options.proxy,
        autoDetect: options.proxyAutoDetect !== false, // Enable by default unless explicitly disabled
      },
      humanize: {
        mouse: options.humanize || options.humanizeMouse || false,
        typing: options.humanize || options.humanizeTyping || false,
        scroll: options.humanize || options.humanizeScroll || false,
        typoRate: options.typoRate,
      },
    };

    // Start server
    try {
      console.error(chalk.blue('🚀 Starting Concurrent Browser MCP Server (Stealth Mode)'));
      console.error(chalk.gray(`Max instances: ${config.maxInstances}`));
      console.error(chalk.gray(`Default browser: ${config.defaultBrowserConfig.browserType}`));
      if (config.defaultBrowserConfig.channel) {
        console.error(chalk.green(`Browser channel: ${config.defaultBrowserConfig.channel} (anti-detection)`));
      }
      console.error(chalk.gray(`Headless mode: ${config.defaultBrowserConfig.headless ? 'yes' : 'no'}`));
      if (config.defaultBrowserConfig.viewport === null) {
        console.error(chalk.green('Viewport: natural (anti-detection)'));
      } else {
        console.error(chalk.gray(`Viewport size: ${config.defaultBrowserConfig.viewport?.width}x${config.defaultBrowserConfig.viewport?.height}`));
      }
      if (config.defaultBrowserConfig.userDataDir) {
        console.error(chalk.green(`User data dir: ${config.defaultBrowserConfig.userDataDir} (persistent profile)`));
      }
      console.error(chalk.gray(`Instance timeout: ${config.instanceTimeout / 60000} minutes`));
      console.error(chalk.gray(`Cleanup interval: ${config.cleanupInterval / 60000} minutes`));

      if (config.proxy?.server) {
        console.error(chalk.gray(`Proxy server: ${config.proxy.server}`));
      } else if (config.proxy?.autoDetect) {
        console.error(chalk.gray('Proxy: Auto-detection enabled'));
      } else {
        console.error(chalk.gray('Proxy: Disabled'));
      }

      // Display humanize configuration
      const humanizeEnabled = config.humanize?.mouse || config.humanize?.typing || config.humanize?.scroll;
      if (humanizeEnabled) {
        const enabledFeatures: string[] = [];
        if (config.humanize?.mouse) enabledFeatures.push('mouse');
        if (config.humanize?.typing) enabledFeatures.push('typing');
        if (config.humanize?.scroll) enabledFeatures.push('scroll');
        console.error(chalk.green(`Humanize: ${enabledFeatures.join(', ')} (anti-detection)`));
        if (config.humanize?.typoRate && config.humanize.typoRate !== 0.02) {
          console.error(chalk.gray(`  Typo rate: ${(config.humanize.typoRate * 100).toFixed(1)}%`));
        }
      }
      console.error('');

      const server = new ConcurrentBrowserServer(config);
      await server.run();
    } catch (error) {
      console.error(chalk.red('❌ Failed to start server:'), error);
      process.exit(1);
    }
  });

// Add example command
program
  .command('example')
  .description('Show usage examples')
  .action(() => {
    console.log(chalk.bold('\n📚 Usage Examples:\n'));
    
    console.log(chalk.yellow('1. Start server (default configuration):'));
    console.log(chalk.gray('  npx concurrent-browser-mcp\n'));
    
    console.log(chalk.yellow('2. Start server (custom configuration):'));
    console.log(chalk.gray('  npx concurrent-browser-mcp --max-instances 25 --browser firefox --headless false\n'));
    
    console.log(chalk.yellow('3. Start server with proxy:'));
    console.log(chalk.gray('  npx concurrent-browser-mcp --proxy http://127.0.0.1:7890\n'));
    
    console.log(chalk.yellow('4. Start server without proxy auto-detection:'));
    console.log(chalk.gray('  npx concurrent-browser-mcp --no-proxy-auto-detect\n'));

    console.log(chalk.yellow('5. Start server with human-like behaviors (anti-detection):'));
    console.log(chalk.gray('  npx concurrent-browser-mcp --humanize\n'));

    console.log(chalk.yellow('6. Start server with specific human behaviors:'));
    console.log(chalk.gray('  npx concurrent-browser-mcp --humanize-mouse --humanize-typing\n'));

    console.log(chalk.yellow('7. Use in MCP client:'));
    console.log(chalk.gray('  {'));
    console.log(chalk.gray('    "mcpServers": {'));
    console.log(chalk.gray('      "concurrent-browser": {'));
    console.log(chalk.gray('        "command": "npx",'));
    console.log(chalk.gray('        "args": ["concurrent-browser-mcp", "--max-instances", "20", "--proxy", "http://127.0.0.1:7890"]'));
    console.log(chalk.gray('      }'));
    console.log(chalk.gray('    }'));
    console.log(chalk.gray('  }\n'));
    
    console.log(chalk.yellow('8. Available tools include:'));
    console.log(chalk.gray('  - browser_create_instance: Create browser instance'));
    console.log(chalk.gray('  - browser_list_instances: List all instances'));
    console.log(chalk.gray('  - browser_navigate: Navigate to URL'));
    console.log(chalk.gray('  - browser_click: Click element (humanize option)'));
    console.log(chalk.gray('  - browser_type: Type text (humanize option)'));
    console.log(chalk.gray('  - browser_fill: Fill form field (humanize option)'));
    console.log(chalk.gray('  - browser_scroll: Scroll page (humanize option)'));
    console.log(chalk.gray('  - browser_screenshot: Take screenshot'));
    console.log(chalk.gray('  - browser_snapshot: Get ARIA tree (token-efficient)'));
    console.log(chalk.gray('  - browser_batch_execute: Execute multiple operations'));
    console.log(chalk.gray('  - and more...\n'));

    console.log(chalk.yellow('9. Test real functionality:'));
    console.log(chalk.gray('  - Simulation demo: node examples/demo.js'));
    console.log(chalk.gray('  - Real test: node test-real-screenshot.js (generates actual screenshot files)'));
    console.log(chalk.gray('  - View screenshots: open screenshot-*.png\n'));
  });

// Error handling
program.configureHelp({
  sortSubcommands: true,
  helpWidth: 80,
});

program.parse();

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
} 