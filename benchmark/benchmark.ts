/**
 * Benchmark Script for Anti-Detection Features
 * Compares main (baseline) vs enligne (humanize) branches
 *
 * Metrics:
 * - Anti-detection scores (CreepJS, Sannysoft, etc.)
 * - Execution time per action
 * - Total scenario time
 * - Token efficiency (actions per second)
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Test sites
const TEST_SITES = {
  sannysoft: 'https://bot.sannysoft.com/',
  creepjs: 'https://abrahamjuliot.github.io/creepjs/',
  pixelscan: 'https://pixelscan.net/',
  browserleaks: 'https://browserleaks.com/javascript',
  intoli: 'https://intoli.com/blog/not-possible-to-block-chrome-headless/chrome-headless-test.html',
};

interface ActionMetrics {
  action: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
}

interface SiteResult {
  site: string;
  url: string;
  loadTime: number;
  webdriverFlag: boolean | null;
  detectionScore?: string;
  details: Record<string, any>;
  screenshot?: string;
}

interface BenchmarkResult {
  branch: string;
  timestamp: string;
  config: {
    headless: boolean;
    humanize: boolean;
    channel?: string;
  };
  siteResults: SiteResult[];
  actionMetrics: ActionMetrics[];
  summary: {
    totalTime: number;
    avgActionTime: number;
    actionsPerSecond: number;
    successRate: number;
    detectionRate: number;
  };
}

class Benchmark {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private actionMetrics: ActionMetrics[] = [];
  private outputDir: string;

  constructor(private branch: string, private humanize: boolean = false) {
    this.outputDir = path.join(__dirname, 'results', `${branch}_${Date.now()}`);
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async setup(headless: boolean = false): Promise<void> {
    console.log(`\n🚀 Setting up browser (branch: ${this.branch}, humanize: ${this.humanize}, headless: ${headless})`);

    this.browser = await chromium.launch({
      headless,
      channel: 'chrome', // Use real Chrome
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: null, // Natural viewport
      userAgent: undefined, // Use default
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
    });

    this.page = await this.context.newPage();

    // Remove webdriver flag
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private async measureAction<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startTime = performance.now();
    let success = true;
    let error: string | undefined;

    try {
      const result = await fn();
      return result;
    } catch (e) {
      success = false;
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      const endTime = performance.now();
      this.actionMetrics.push({
        action: name,
        startTime,
        endTime,
        duration: endTime - startTime,
        success,
        error,
      });
    }
  }

  async testSannysoft(): Promise<SiteResult> {
    console.log('📊 Testing bot.sannysoft.com...');

    const startTime = performance.now();
    await this.measureAction('navigate_sannysoft', async () => {
      await this.page!.goto(TEST_SITES.sannysoft, { waitUntil: 'networkidle' });
    });
    const loadTime = performance.now() - startTime;

    // Wait for tests to complete
    await this.page!.waitForTimeout(3000);

    // Extract results
    const results = await this.page!.evaluate(() => {
      const rows = document.querySelectorAll('table tr');
      const data: Record<string, string> = {};
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const key = cells[0]?.textContent?.trim() || '';
          const value = cells[1]?.textContent?.trim() || '';
          if (key) data[key] = value;
        }
      });
      return data;
    });

    // Check webdriver flag
    const webdriverFlag = await this.page!.evaluate(() => {
      return (navigator as any).webdriver;
    });

    // Take screenshot
    const screenshotPath = path.join(this.outputDir, 'sannysoft.png');
    await this.page!.screenshot({ path: screenshotPath, fullPage: true });

    return {
      site: 'sannysoft',
      url: TEST_SITES.sannysoft,
      loadTime,
      webdriverFlag,
      details: results,
      screenshot: screenshotPath,
    };
  }

  async testCreepJS(): Promise<SiteResult> {
    console.log('📊 Testing CreepJS...');

    const startTime = performance.now();
    await this.measureAction('navigate_creepjs', async () => {
      await this.page!.goto(TEST_SITES.creepjs, { waitUntil: 'networkidle' });
    });
    const loadTime = performance.now() - startTime;

    // Wait for fingerprint analysis
    await this.page!.waitForTimeout(8000);

    // Scroll to see more results
    if (this.humanize) {
      // Human-like scroll would be here if we had the utils imported
      await this.page!.mouse.wheel(0, 500);
      await this.page!.waitForTimeout(500);
    } else {
      await this.page!.evaluate(() => window.scrollBy(0, 500));
    }

    // Extract trust score
    const score = await this.page!.evaluate(() => {
      const scoreEl = document.querySelector('.visitor-info .grade');
      return scoreEl?.textContent?.trim() || 'N/A';
    });

    const webdriverFlag = await this.page!.evaluate(() => (navigator as any).webdriver);

    const screenshotPath = path.join(this.outputDir, 'creepjs.png');
    await this.page!.screenshot({ path: screenshotPath, fullPage: true });

    return {
      site: 'creepjs',
      url: TEST_SITES.creepjs,
      loadTime,
      webdriverFlag,
      detectionScore: score,
      details: { trustScore: score },
      screenshot: screenshotPath,
    };
  }

  async testInteractions(): Promise<void> {
    console.log('🖱️ Testing interactions...');

    // Navigate to a form page
    await this.measureAction('navigate_form', async () => {
      await this.page!.goto('https://www.google.com/', { waitUntil: 'load' });
    });

    // Test typing
    await this.measureAction('type_search', async () => {
      const searchBox = this.page!.locator('textarea[name="q"], input[name="q"]');
      await searchBox.waitFor({ state: 'visible', timeout: 5000 });

      if (this.humanize) {
        // Simulate human typing with delays
        const text = 'playwright automation test';
        for (const char of text) {
          await searchBox.type(char, { delay: 50 + Math.random() * 100 });
        }
      } else {
        await searchBox.fill('playwright automation test');
      }
    });

    // Test scroll
    await this.measureAction('scroll_page', async () => {
      if (this.humanize) {
        // Simulate human scroll
        for (let i = 0; i < 5; i++) {
          await this.page!.mouse.wheel(0, 100 + Math.random() * 50);
          await this.page!.waitForTimeout(100 + Math.random() * 200);
        }
      } else {
        await this.page!.evaluate(() => window.scrollBy(0, 500));
      }
    });

    // Test click (on a safe element)
    await this.measureAction('click_element', async () => {
      const logo = this.page!.locator('img[alt="Google"]');
      if (await logo.isVisible()) {
        if (this.humanize) {
          // Move mouse naturally then click
          const box = await logo.boundingBox();
          if (box) {
            await this.page!.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
            await this.page!.waitForTimeout(50 + Math.random() * 100);
          }
        }
        await logo.click({ force: true }).catch(() => {}); // Ignore click errors
      }
    });
  }

  async runFullBenchmark(headless: boolean = false): Promise<BenchmarkResult> {
    const startTime = performance.now();
    this.actionMetrics = [];

    await this.setup(headless);

    const siteResults: SiteResult[] = [];

    try {
      // Test anti-detection sites
      siteResults.push(await this.testSannysoft());
      siteResults.push(await this.testCreepJS());

      // Test interactions
      await this.testInteractions();

    } catch (error) {
      console.error('Benchmark error:', error);
    }

    await this.cleanup();

    const totalTime = performance.now() - startTime;
    const successfulActions = this.actionMetrics.filter(a => a.success);
    const avgActionTime = this.actionMetrics.length > 0
      ? this.actionMetrics.reduce((sum, a) => sum + a.duration, 0) / this.actionMetrics.length
      : 0;

    // Calculate detection rate (how many sites flagged as bot)
    const detectedCount = siteResults.filter(r => r.webdriverFlag === true).length;
    const detectionRate = siteResults.length > 0 ? detectedCount / siteResults.length : 0;

    const result: BenchmarkResult = {
      branch: this.branch,
      timestamp: new Date().toISOString(),
      config: {
        headless,
        humanize: this.humanize,
        channel: 'chrome',
      },
      siteResults,
      actionMetrics: this.actionMetrics,
      summary: {
        totalTime,
        avgActionTime,
        actionsPerSecond: this.actionMetrics.length / (totalTime / 1000),
        successRate: this.actionMetrics.length > 0
          ? successfulActions.length / this.actionMetrics.length
          : 0,
        detectionRate,
      },
    };

    // Save results
    const resultPath = path.join(this.outputDir, 'results.json');
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`\n📁 Results saved to: ${resultPath}`);

    return result;
  }
}

function printComparison(main: BenchmarkResult, enligne: BenchmarkResult): void {
  console.log('\n' + '='.repeat(70));
  console.log('📊 BENCHMARK COMPARISON: main vs enligne');
  console.log('='.repeat(70));

  console.log('\n⏱️  PERFORMANCE METRICS');
  console.log('-'.repeat(50));
  console.log(`Total Time:`);
  console.log(`  main:    ${(main.summary.totalTime / 1000).toFixed(2)}s`);
  console.log(`  enligne: ${(enligne.summary.totalTime / 1000).toFixed(2)}s`);
  console.log(`  Δ: ${((enligne.summary.totalTime - main.summary.totalTime) / 1000).toFixed(2)}s (${((enligne.summary.totalTime / main.summary.totalTime - 1) * 100).toFixed(1)}%)`);

  console.log(`\nAvg Action Time:`);
  console.log(`  main:    ${main.summary.avgActionTime.toFixed(2)}ms`);
  console.log(`  enligne: ${enligne.summary.avgActionTime.toFixed(2)}ms`);
  console.log(`  Δ: ${(enligne.summary.avgActionTime - main.summary.avgActionTime).toFixed(2)}ms`);

  console.log(`\nActions/Second (Token Efficiency):`);
  console.log(`  main:    ${main.summary.actionsPerSecond.toFixed(2)} actions/s`);
  console.log(`  enligne: ${enligne.summary.actionsPerSecond.toFixed(2)} actions/s`);

  console.log('\n🛡️  ANTI-DETECTION METRICS');
  console.log('-'.repeat(50));
  console.log(`Detection Rate (lower is better):`);
  console.log(`  main:    ${(main.summary.detectionRate * 100).toFixed(1)}%`);
  console.log(`  enligne: ${(enligne.summary.detectionRate * 100).toFixed(1)}%`);

  console.log('\n📋 SITE-BY-SITE RESULTS');
  console.log('-'.repeat(50));

  for (const mainSite of main.siteResults) {
    const enligneSite = enligne.siteResults.find(s => s.site === mainSite.site);
    if (enligneSite) {
      console.log(`\n${mainSite.site}:`);
      console.log(`  webdriver flag - main: ${mainSite.webdriverFlag}, enligne: ${enligneSite.webdriverFlag}`);
      console.log(`  load time - main: ${mainSite.loadTime.toFixed(0)}ms, enligne: ${enligneSite.loadTime.toFixed(0)}ms`);
      if (mainSite.detectionScore) {
        console.log(`  score - main: ${mainSite.detectionScore}, enligne: ${enligneSite.detectionScore}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));

  const timeOverhead = ((enligne.summary.totalTime / main.summary.totalTime - 1) * 100);
  const detectionImprovement = (main.summary.detectionRate - enligne.summary.detectionRate) * 100;

  console.log(`\n✅ Time Overhead: +${timeOverhead.toFixed(1)}% (humanize adds ${((enligne.summary.totalTime - main.summary.totalTime) / 1000).toFixed(1)}s)`);
  console.log(`✅ Detection Improvement: ${detectionImprovement >= 0 ? '+' : ''}${detectionImprovement.toFixed(1)} percentage points`);
  console.log(`✅ Token Efficiency Ratio: ${(main.summary.actionsPerSecond / enligne.summary.actionsPerSecond).toFixed(2)}x slower with humanize`);
}

async function main(): Promise<void> {
  console.log('🔬 Starting Anti-Detection Benchmark');
  console.log('===================================\n');

  const headless = process.argv.includes('--headless');
  const mode = process.argv.includes('--headful') ? false : headless;

  console.log(`Mode: ${mode ? 'headless' : 'headful'}`);

  // Run benchmark for "main" (no humanize)
  console.log('\n📍 Running benchmark: main (baseline, no humanize)');
  const mainBenchmark = new Benchmark('main', false);
  const mainResult = await mainBenchmark.runFullBenchmark(mode);

  // Run benchmark for "enligne" (with humanize)
  console.log('\n📍 Running benchmark: enligne (with humanize)');
  const enligneBenchmark = new Benchmark('enligne', true);
  const enligneResult = await enligneBenchmark.runFullBenchmark(mode);

  // Print comparison
  printComparison(mainResult, enligneResult);

  // Save combined results
  const combinedPath = path.join(__dirname, 'results', `comparison_${Date.now()}.json`);
  fs.writeFileSync(combinedPath, JSON.stringify({
    main: mainResult,
    enligne: enligneResult,
    comparison: {
      timeOverhead: (enligneResult.summary.totalTime / mainResult.summary.totalTime - 1) * 100,
      detectionImprovement: (mainResult.summary.detectionRate - enligneResult.summary.detectionRate) * 100,
      tokenEfficiencyRatio: mainResult.summary.actionsPerSecond / enligneResult.summary.actionsPerSecond,
    },
  }, null, 2));

  console.log(`\n📁 Combined results saved to: ${combinedPath}`);
}

main().catch(console.error);
