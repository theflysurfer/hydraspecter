#!/usr/bin/env node
/**
 * Quick Anti-Detection Benchmark
 * Tests both baseline and humanize modes, measures:
 * - Detection scores
 * - Execution time
 * - Token efficiency (actions/second)
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_SITES = {
  sannysoft: 'https://bot.sannysoft.com/',
  intoli: 'https://intoli.com/blog/not-possible-to-block-chrome-headless/chrome-headless-test.html',
};

class QuickBenchmark {
  constructor(name, humanize = false) {
    this.name = name;
    this.humanize = humanize;
    this.metrics = [];
    this.startTime = 0;
  }

  async measureAction(name, fn) {
    const start = performance.now();
    try {
      await fn();
      const duration = performance.now() - start;
      this.metrics.push({ name, duration, success: true });
      return duration;
    } catch (e) {
      const duration = performance.now() - start;
      this.metrics.push({ name, duration, success: false, error: e.message });
      throw e;
    }
  }

  async run() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🧪 Running: ${this.name} (humanize: ${this.humanize})`);
    console.log('='.repeat(50));

    this.startTime = performance.now();
    const results = { sites: {}, webdriver: {} };

    const browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      viewport: null,
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
    });

    const page = await context.newPage();

    // Remove webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    try {
      // Test 1: Sannysoft
      console.log('\n📊 Test 1: bot.sannysoft.com');
      await this.measureAction('navigate_sannysoft', () =>
        page.goto(TEST_SITES.sannysoft, { waitUntil: 'networkidle', timeout: 30000 })
      );
      await page.waitForTimeout(2000);

      results.webdriver.sannysoft = await page.evaluate(() => navigator.webdriver);
      results.sites.sannysoft = await page.evaluate(() => {
        const cells = document.querySelectorAll('td.result');
        let passed = 0, failed = 0;
        cells.forEach(c => {
          if (c.classList.contains('passed')) passed++;
          else if (c.classList.contains('failed')) failed++;
        });
        return { passed, failed, total: passed + failed };
      });

      console.log(`   webdriver: ${results.webdriver.sannysoft}`);
      console.log(`   tests: ${results.sites.sannysoft.passed}/${results.sites.sannysoft.total} passed`);

      // Test 2: Intoli headless detection
      console.log('\n📊 Test 2: Intoli headless detection');
      await this.measureAction('navigate_intoli', () =>
        page.goto(TEST_SITES.intoli, { waitUntil: 'load', timeout: 30000 })
      );
      await page.waitForTimeout(2000);

      results.webdriver.intoli = await page.evaluate(() => navigator.webdriver);
      results.sites.intoli = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tr');
        let passed = 0, failed = 0;
        rows.forEach(r => {
          const result = r.querySelector('td:last-child');
          if (result) {
            if (result.style.backgroundColor === 'rgb(144, 238, 144)' ||
                result.textContent?.includes('✓')) passed++;
            else if (result.style.backgroundColor === 'rgb(255, 182, 193)' ||
                     result.textContent?.includes('✗')) failed++;
          }
        });
        return { passed, failed };
      });

      console.log(`   webdriver: ${results.webdriver.intoli}`);

      // Test 3: Interaction benchmark
      console.log('\n🖱️  Test 3: Interaction performance');
      await this.measureAction('navigate_google', () =>
        page.goto('https://www.google.com', { waitUntil: 'load', timeout: 30000 })
      );

      // Typing test
      const searchBox = page.locator('textarea[name="q"], input[name="q"]');
      await searchBox.waitFor({ state: 'visible', timeout: 5000 });

      if (this.humanize) {
        // Human-like typing with variable delays
        await this.measureAction('type_humanized', async () => {
          const text = 'playwright test benchmark';
          for (const char of text) {
            await searchBox.type(char, { delay: 30 + Math.random() * 120 });
            // Occasional pause
            if (Math.random() < 0.1) {
              await page.waitForTimeout(100 + Math.random() * 200);
            }
          }
        });

        // Human-like scroll
        await this.measureAction('scroll_humanized', async () => {
          for (let i = 0; i < 5; i++) {
            const delta = 80 + Math.random() * 120;
            await page.mouse.wheel(Math.random() * 4 - 2, delta);
            await page.waitForTimeout(50 + Math.random() * 150);
          }
        });
      } else {
        // Fast typing
        await this.measureAction('type_instant', async () => {
          await searchBox.fill('playwright test benchmark');
        });

        // Instant scroll
        await this.measureAction('scroll_instant', async () => {
          await page.evaluate(() => window.scrollBy(0, 500));
        });
      }

    } catch (e) {
      console.error('Error:', e.message);
    }

    await browser.close();

    const totalTime = performance.now() - this.startTime;
    const successfulActions = this.metrics.filter(m => m.success);
    const avgDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0) / this.metrics.length;

    return {
      name: this.name,
      humanize: this.humanize,
      results,
      metrics: this.metrics,
      summary: {
        totalTime,
        actionCount: this.metrics.length,
        avgActionTime: avgDuration,
        actionsPerSecond: this.metrics.length / (totalTime / 1000),
        successRate: successfulActions.length / this.metrics.length,
        webdriverDetected: Object.values(results.webdriver).some(v => v === true),
      },
    };
  }
}

function printResults(baseline, humanized) {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 BENCHMARK RESULTS');
  console.log('═'.repeat(60));

  console.log('\n⏱️  TIMING');
  console.log('─'.repeat(40));
  console.log(`Total Time:`);
  console.log(`  Baseline:  ${(baseline.summary.totalTime / 1000).toFixed(2)}s`);
  console.log(`  Humanized: ${(humanized.summary.totalTime / 1000).toFixed(2)}s`);
  const timeOverhead = ((humanized.summary.totalTime / baseline.summary.totalTime - 1) * 100);
  console.log(`  Overhead:  +${timeOverhead.toFixed(1)}%`);

  console.log(`\nAvg Action Time:`);
  console.log(`  Baseline:  ${baseline.summary.avgActionTime.toFixed(0)}ms`);
  console.log(`  Humanized: ${humanized.summary.avgActionTime.toFixed(0)}ms`);

  console.log('\n🎯 TOKEN EFFICIENCY');
  console.log('─'.repeat(40));
  console.log(`Actions/Second:`);
  console.log(`  Baseline:  ${baseline.summary.actionsPerSecond.toFixed(2)}`);
  console.log(`  Humanized: ${humanized.summary.actionsPerSecond.toFixed(2)}`);
  const efficiencyRatio = baseline.summary.actionsPerSecond / humanized.summary.actionsPerSecond;
  console.log(`  Ratio:     ${efficiencyRatio.toFixed(2)}x slower with humanize`);

  console.log('\n🛡️  ANTI-DETECTION');
  console.log('─'.repeat(40));
  console.log(`Webdriver Detected:`);
  console.log(`  Baseline:  ${baseline.summary.webdriverDetected ? '❌ YES' : '✅ NO'}`);
  console.log(`  Humanized: ${humanized.summary.webdriverDetected ? '❌ YES' : '✅ NO'}`);

  console.log('\n📋 DETAILED METRICS');
  console.log('─'.repeat(40));

  console.log('\nBaseline actions:');
  baseline.metrics.forEach(m => {
    console.log(`  ${m.success ? '✓' : '✗'} ${m.name}: ${m.duration.toFixed(0)}ms`);
  });

  console.log('\nHumanized actions:');
  humanized.metrics.forEach(m => {
    console.log(`  ${m.success ? '✓' : '✗'} ${m.name}: ${m.duration.toFixed(0)}ms`);
  });

  console.log('\n' + '═'.repeat(60));
  console.log('📈 SUMMARY');
  console.log('═'.repeat(60));
  console.log(`\n✅ Time overhead: +${timeOverhead.toFixed(1)}% for human-like behavior`);
  console.log(`✅ Token efficiency: ${efficiencyRatio.toFixed(2)}x slower (expected for realism)`);
  console.log(`✅ Detection: Both ${baseline.summary.webdriverDetected === humanized.summary.webdriverDetected ? 'same' : 'different'} result`);
  console.log(`\n💡 Trade-off: ${timeOverhead.toFixed(0)}% slower for more human-like behavior`);
}

async function main() {
  console.log('🔬 Anti-Detection Benchmark');
  console.log('===========================');
  console.log('Testing baseline vs humanized interactions\n');

  // Run baseline (no humanize)
  const baselineBench = new QuickBenchmark('baseline', false);
  const baselineResult = await baselineBench.run();

  // Small pause between tests
  await new Promise(r => setTimeout(r, 2000));

  // Run humanized
  const humanizedBench = new QuickBenchmark('humanized', true);
  const humanizedResult = await humanizedBench.run();

  // Print comparison
  printResults(baselineResult, humanizedResult);

  // Save results
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const outputPath = path.join(resultsDir, `benchmark_${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    baseline: baselineResult,
    humanized: humanizedResult,
    comparison: {
      timeOverheadPercent: ((humanizedResult.summary.totalTime / baselineResult.summary.totalTime - 1) * 100),
      tokenEfficiencyRatio: baselineResult.summary.actionsPerSecond / humanizedResult.summary.actionsPerSecond,
    },
  }, null, 2));

  console.log(`\n📁 Results saved: ${outputPath}`);
}

main().catch(console.error);
