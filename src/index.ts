#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ConcurrentBrowserServer, defaultConfig } from './server.js';
import { ServerConfig } from './types.js';
import { parseGroupsArg, ALL_GROUPS } from './tool-groups.js';

const program = new Command();

program
  .name('hydraspecter')
  .description('Multi-headed browser automation MCP - stealth, concurrent, unstoppable')
  .version('2.0.0');

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
  .option('--humanize-auto', 'Enable adaptive humanize: activates only when detection signals are found (Cloudflare, CAPTCHAs, rate limits)')
  .option('--humanize-mouse', 'Enable human-like mouse movement by default')
  .option('--humanize-typing', 'Enable human-like typing by default')
  .option('--humanize-scroll', 'Enable human-like scrolling by default')
  .option('--always-humanize-domains <domains>', 'Comma-separated list of domains to always humanize (e.g., temu.com,amazon.com)')
  .option('--typo-rate <number>', 'Typo rate for human typing (0-1)', (value) => parseFloat(value), 0.02)
  .option('--rate-limit <number>', 'Enable rate limiting with max requests per window', (value) => parseInt(value))
  .option('--rate-limit-window <number>', 'Rate limit window in seconds (default: 60)', (value) => parseInt(value) * 1000, 60000)
  .option('--pool-size <number>', 'Number of profiles in pool for multi-process (default: 5)', (value) => parseInt(value), 5)
  .option('--global-headless', 'Run global profile browser in headless mode (default: false for anti-detection)', false)
  .option('--global-channel <channel>', 'Browser channel for global profile: chrome, msedge')
  .option('--groups <groups>', `Tool groups to enable (comma-separated). Available: ${ALL_GROUPS.join(', ')}, all. Default: all`, 'all')
  .option('--meta', 'Enable meta-tool mode: single unified "browser" tool (~2k tokens vs ~31k). Zero-config recommended.', false)
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
        // Priority: --humanize-auto > --humanize > --humanize-<type>
        mouse: options.humanizeAuto ? 'auto' : (options.humanize || options.humanizeMouse || false),
        typing: options.humanizeAuto ? 'auto' : (options.humanize || options.humanizeTyping || false),
        scroll: options.humanizeAuto ? 'auto' : (options.humanize || options.humanizeScroll || false),
        typoRate: options.typoRate,
        alwaysHumanizeDomains: options.alwaysHumanizeDomains
          ? options.alwaysHumanizeDomains.split(',').map((d: string) => d.trim())
          : undefined,
      },
      rateLimit: options.rateLimit ? {
        enabled: true,
        maxRequests: options.rateLimit,
        windowMs: options.rateLimitWindow,
      } : undefined,
      globalProfile: {
        poolSize: options.poolSize,
        headless: options.globalHeadless || false, // Default: visible for anti-detection
        channel: options.globalChannel as 'chrome' | 'msedge' | undefined,
      },
      enabledTools: parseGroupsArg(['--groups=' + options.groups]),
      metaMode: options.meta,
    };

    // Start server
    try {
      console.error(chalk.blue('🚀 Starting HydraSpecter MCP Server'));
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
        const isAutoMode = config.humanize?.mouse === 'auto';
        const enabledFeatures: string[] = [];
        if (config.humanize?.mouse) enabledFeatures.push('mouse');
        if (config.humanize?.typing) enabledFeatures.push('typing');
        if (config.humanize?.scroll) enabledFeatures.push('scroll');

        if (isAutoMode) {
          console.error(chalk.cyan(`Humanize: AUTO mode - ${enabledFeatures.join(', ')} (activates on detection)`));
          console.error(chalk.gray('  Detects: Cloudflare, CAPTCHAs, DataDome, PerimeterX, rate limits'));
        } else {
          console.error(chalk.green(`Humanize: ${enabledFeatures.join(', ')} (anti-detection)`));
        }

        if (config.humanize?.typoRate && config.humanize.typoRate !== 0.02) {
          console.error(chalk.gray(`  Typo rate: ${(config.humanize.typoRate * 100).toFixed(1)}%`));
        }
        if (config.humanize?.alwaysHumanizeDomains?.length) {
          console.error(chalk.gray(`  Always humanize: ${config.humanize.alwaysHumanizeDomains.join(', ')}`));
        }
      }

      // Display rate limit configuration
      if (config.rateLimit?.enabled) {
        console.error(chalk.yellow(`Rate limit: ${config.rateLimit.maxRequests} requests per ${config.rateLimit.windowMs / 1000}s`));
      }

      // Display global profile configuration
      console.error(chalk.magenta('Profile Pool (multi-process sessions):'));
      console.error(chalk.gray(`  Pool size: ${config.globalProfile?.poolSize || 5} profiles`));
      console.error(chalk.gray(`  Headless: ${config.globalProfile?.headless ? 'yes' : 'no (anti-detection)'}`));
      if (config.globalProfile?.channel) {
        console.error(chalk.green(`  Browser: ${config.globalProfile.channel}`));
      }
      console.error(chalk.gray('  Domain intelligence: auto-learning protection levels'));

      // Display tool groups or meta mode
      if (config.metaMode) {
        console.error(chalk.green('Meta-tool mode: ENABLED (~2k tokens vs ~31k)'));
        console.error(chalk.gray('  Single "browser" tool with action routing'));
      } else {
        const toolCount = config.enabledTools?.length || 0;
        if (options.groups === 'all') {
          console.error(chalk.gray(`Tool groups: all (${toolCount} tools)`));
        } else {
          console.error(chalk.cyan(`Tool groups: ${options.groups} (${toolCount} tools)`));
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
    console.error(chalk.bold('\n📚 Usage Examples:\n'));
    
    console.error(chalk.yellow('1. Start server (default configuration):'));
    console.error(chalk.gray('  npx hydraspecter\n'));

    console.error(chalk.yellow('2. Start server (custom configuration):'));
    console.error(chalk.gray('  npx hydraspecter --max-instances 25 --browser firefox --headless false\n'));

    console.error(chalk.yellow('3. Start server with proxy:'));
    console.error(chalk.gray('  npx hydraspecter --proxy http://127.0.0.1:7890\n'));

    console.error(chalk.yellow('4. Start server without proxy auto-detection:'));
    console.error(chalk.gray('  npx hydraspecter --no-proxy-auto-detect\n'));

    console.error(chalk.yellow('5. Start server with human-like behaviors (anti-detection):'));
    console.error(chalk.gray('  npx hydraspecter --humanize\n'));

    console.error(chalk.yellow('6. Start server with ADAPTIVE humanize (recommended):'));
    console.error(chalk.gray('  npx hydraspecter --humanize-auto'));
    console.error(chalk.gray('  # Only activates humanize when Cloudflare, CAPTCHAs, or rate limits detected\n'));

    console.error(chalk.yellow('7. Start server with specific human behaviors:'));
    console.error(chalk.gray('  npx hydraspecter --humanize-mouse --humanize-typing\n'));

    console.error(chalk.yellow('8. Use in MCP client:'));
    console.error(chalk.gray('  {'));
    console.error(chalk.gray('    "mcpServers": {'));
    console.error(chalk.gray('      "hydraspecter": {'));
    console.error(chalk.gray('        "command": "npx",'));
    console.error(chalk.gray('        "args": ["hydraspecter", "--max-instances", "20", "--proxy", "http://127.0.0.1:7890"]'));
    console.error(chalk.gray('      }'));
    console.error(chalk.gray('    }'));
    console.error(chalk.gray('  }\n'));
    
    console.error(chalk.yellow('9. Browser creation (unified tool):'));
    console.error(chalk.gray('  - browser_create: Create browser (modes: persistent/incognito/isolated)'));
    console.error(chalk.gray('  - browser_get_protection_level: Check domain protection level'));
    console.error(chalk.gray('  - browser_reset_protection: Reset domain protection to level 0\n'));

    console.error(chalk.yellow('10. Standard tools:'));
    console.error(chalk.gray('  - browser_list_instances: List all instances'));
    console.error(chalk.gray('  - browser_navigate: Navigate to URL (with detection feedback)'));
    console.error(chalk.gray('  - browser_click: Click element (humanize: true/false/auto)'));
    console.error(chalk.gray('  - browser_type: Type text (humanize: true/false/auto)'));
    console.error(chalk.gray('  - browser_fill: Fill form field (humanize: true/false/auto)'));
    console.error(chalk.gray('  - browser_scroll: Scroll page (humanize: true/false/auto)'));
    console.error(chalk.gray('  - browser_screenshot: Take screenshot'));
    console.error(chalk.gray('  - browser_snapshot: Get ARIA tree (token-efficient)'));
    console.error(chalk.gray('  - browser_batch_execute: Execute multiple operations'));
    console.error(chalk.gray('  - and more...\n'));

    console.error(chalk.yellow('11. Test real functionality:'));
    console.error(chalk.gray('  - Simulation demo: node examples/demo.js'));
    console.error(chalk.gray('  - Real test: node test-real-screenshot.js (generates actual screenshot files)'));
    console.error(chalk.gray('  - View screenshots: open screenshot-*.png\n'));
  });

// Error handling
program.configureHelp({
  sortSubcommands: true,
  helpWidth: 80,
});

program.parse(); 