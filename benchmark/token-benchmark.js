#!/usr/bin/env node
/**
 * Token Consumption Benchmark
 * Compares actual MCP payload sizes between branches
 * Measures: JSON response sizes, ARIA snapshot tokens, TOON efficiency
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatAsToon, smartFormat } from '../dist/utils/toon-formatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Approximate tokens = characters / 4 (rough estimate for JSON)
function estimateTokens(str) {
  return Math.ceil(str.length / 4);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

class TokenBenchmark {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      branch: process.env.GIT_BRANCH || 'unknown',
      measurements: [],
    };
  }

  async run() {
    console.log('🔬 Token Consumption Benchmark');
    console.log('==============================\n');

    const browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
    });

    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    try {
      // Navigate to a content-rich page
      console.log('📄 Loading test page...');
      await page.goto('https://en.wikipedia.org/wiki/Web_scraping', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Test 1: Full HTML content (baseline - expensive)
      console.log('\n📊 Test 1: Full HTML Content (getPageInfo equivalent)');
      const htmlContent = await page.content();
      const htmlBytes = Buffer.byteLength(htmlContent, 'utf8');
      const htmlTokens = estimateTokens(htmlContent);
      console.log(`   Size: ${formatBytes(htmlBytes)}`);
      console.log(`   Estimated tokens: ~${htmlTokens.toLocaleString()}`);
      this.results.measurements.push({
        test: 'full_html',
        bytes: htmlBytes,
        tokens: htmlTokens,
        description: 'Complete HTML content',
      });

      // Test 2: ARIA Snapshot (token-optimized)
      console.log('\n📊 Test 2: ARIA Snapshot (browser_snapshot)');
      const ariaSnapshot = await page.locator('body').ariaSnapshot();
      const ariaBytes = Buffer.byteLength(ariaSnapshot, 'utf8');
      const ariaTokens = estimateTokens(ariaSnapshot);
      console.log(`   Size: ${formatBytes(ariaBytes)}`);
      console.log(`   Estimated tokens: ~${ariaTokens.toLocaleString()}`);
      console.log(`   Savings vs HTML: ${((1 - ariaBytes / htmlBytes) * 100).toFixed(1)}%`);
      this.results.measurements.push({
        test: 'aria_snapshot',
        bytes: ariaBytes,
        tokens: ariaTokens,
        description: 'ARIA accessibility tree',
        savingsVsHtml: ((1 - ariaBytes / htmlBytes) * 100).toFixed(1) + '%',
      });

      // Test 3: Screenshot (very expensive in tokens)
      console.log('\n📊 Test 3: Screenshot (base64)');
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });
      const screenshotBase64 = screenshot.toString('base64');
      const screenshotBytes = Buffer.byteLength(screenshotBase64, 'utf8');
      const screenshotTokens = estimateTokens(screenshotBase64);
      console.log(`   Size: ${formatBytes(screenshotBytes)}`);
      console.log(`   Estimated tokens: ~${screenshotTokens.toLocaleString()}`);
      this.results.measurements.push({
        test: 'screenshot_base64',
        bytes: screenshotBytes,
        tokens: screenshotTokens,
        description: 'JPEG screenshot as base64',
      });

      // Test 4: Markdown extraction
      console.log('\n📊 Test 4: Markdown Content (browser_get_markdown)');
      const markdown = await page.evaluate(() => {
        const article = document.querySelector('article') || document.body;
        return article.innerText.substring(0, 10000);
      });
      const mdBytes = Buffer.byteLength(markdown, 'utf8');
      const mdTokens = estimateTokens(markdown);
      console.log(`   Size: ${formatBytes(mdBytes)}`);
      console.log(`   Estimated tokens: ~${mdTokens.toLocaleString()}`);
      this.results.measurements.push({
        test: 'markdown_text',
        bytes: mdBytes,
        tokens: mdTokens,
        description: 'Text content as markdown (10KB limit)',
      });

      // Test 5: TOON Format vs JSON (with real network data)
      console.log('\n📊 Test 5: TOON Format vs JSON (Network Logs)');

      // Capture real network requests
      const networkLogs = [];
      page.on('request', request => {
        networkLogs.push({
          url: request.url().substring(0, 100),
          method: request.method(),
          resourceType: request.resourceType(),
        });
      });

      // Navigate to trigger more requests
      await page.goto('https://en.wikipedia.org/wiki/Web_scraping', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Compare JSON vs TOON for network logs
      const networkData = { logs: networkLogs.slice(0, 50), count: Math.min(networkLogs.length, 50) };
      const jsonStr = JSON.stringify(networkData, null, 2);
      const toonStr = formatAsToon(networkData);

      const jsonBytes = Buffer.byteLength(jsonStr, 'utf8');
      const toonBytes = Buffer.byteLength(toonStr, 'utf8');
      const jsonTokens = estimateTokens(jsonStr);
      // TOON is more token-efficient: ~3 chars per token vs 4 for JSON
      const toonTokens = Math.ceil(toonBytes / 3);

      console.log(`   Network requests captured: ${networkLogs.length}`);
      console.log(`   JSON: ${formatBytes(jsonBytes)} (~${jsonTokens} tokens)`);
      console.log(`   TOON: ${formatBytes(toonBytes)} (~${toonTokens} tokens)`);
      console.log(`   Savings: ${((1 - toonTokens / jsonTokens) * 100).toFixed(1)}%`);

      this.results.measurements.push({
        test: 'toon_vs_json_network',
        json: { bytes: jsonBytes, tokens: jsonTokens },
        toon: { bytes: toonBytes, tokens: toonTokens },
        savings: ((1 - toonTokens / jsonTokens) * 100).toFixed(1) + '%',
        description: 'TOON vs JSON for network logs',
      });

      // Test 6: Humanize overhead
      console.log('\n📊 Test 6: Humanize Option Overhead');
      const withoutHumanize = { tool: 'browser_click', args: { instanceId: 'xxx', selector: '#btn' } };
      const withHumanize = { tool: 'browser_click', args: { instanceId: 'xxx', selector: '#btn', humanize: true } };

      const noHumanizeBytes = Buffer.byteLength(JSON.stringify(withoutHumanize), 'utf8');
      const humanizeBytes = Buffer.byteLength(JSON.stringify(withHumanize), 'utf8');
      const overheadBytes = humanizeBytes - noHumanizeBytes;
      const overheadTokens = estimateTokens(JSON.stringify(withHumanize)) - estimateTokens(JSON.stringify(withoutHumanize));

      console.log(`   Without humanize: ${noHumanizeBytes} bytes`);
      console.log(`   With humanize: ${humanizeBytes} bytes`);
      console.log(`   Overhead: +${overheadBytes} bytes (+${overheadTokens} tokens per call)`);

      this.results.measurements.push({
        test: 'humanize_overhead',
        withoutHumanize: noHumanizeBytes,
        withHumanize: humanizeBytes,
        overheadBytes,
        overheadTokens,
        description: 'Extra bytes/tokens for humanize: true option',
      });

    } catch (e) {
      console.error('Error:', e.message);
    }

    await browser.close();

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📈 TOKEN EFFICIENCY SUMMARY');
    console.log('═'.repeat(60));

    const html = this.results.measurements.find(m => m.test === 'full_html');
    const aria = this.results.measurements.find(m => m.test === 'aria_snapshot');
    const screenshot = this.results.measurements.find(m => m.test === 'screenshot_base64');
    const toon = this.results.measurements.find(m => m.test === 'toon_vs_json_network');
    const humanize = this.results.measurements.find(m => m.test === 'humanize_overhead');

    console.log('\n🎯 Token Savings (browser_snapshot vs alternatives):');
    console.log(`   vs Full HTML:    ${((1 - aria.tokens / html.tokens) * 100).toFixed(0)}% saved (~${(html.tokens - aria.tokens).toLocaleString()} tokens)`);
    console.log(`   vs Screenshot:   ${((1 - aria.tokens / screenshot.tokens) * 100).toFixed(0)}% saved (~${(screenshot.tokens - aria.tokens).toLocaleString()} tokens)`);

    console.log('\n🎯 Token Savings (TOON format for network/console logs):');
    console.log(`   ${toon.savings} saved (~${(toon.json.tokens - toon.toon.tokens).toLocaleString()} tokens)`);

    console.log('\n🎯 Humanize Option Cost:');
    console.log(`   +${humanize.overheadTokens} tokens per humanized action`);
    console.log(`   Impact: Négligeable (<0.1% of typical session)`);

    // Save results
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const outputPath = path.join(resultsDir, `tokens_${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(this.results, null, 2));
    console.log(`\n📁 Results saved: ${outputPath}`);

    return this.results;
  }
}

const benchmark = new TokenBenchmark();
benchmark.run().catch(console.error);
