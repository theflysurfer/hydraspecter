/**
 * CSS/JS Injector
 *
 * Functions to inject CSS and JavaScript into Playwright pages
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Page } from 'playwright';
import { InjectionRule, InjectionResult, ApplyRulesResult, RunAt } from './types.js';
import { InjectionRuleManager } from './rule-manager.js';

/**
 * Expand ~ to home directory in file paths
 */
function expandPath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Inject CSS into a page
 */
export async function injectCSS(page: Page, css: string): Promise<InjectionResult> {
  try {
    await page.addStyleTag({ content: css });
    return { success: true, source: 'inline', type: 'css' };
  } catch (error) {
    return {
      success: false,
      source: 'inline',
      type: 'css',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Inject CSS from a file into a page
 */
export async function injectCSSFile(page: Page, filePath: string): Promise<InjectionResult> {
  try {
    const expandedPath = expandPath(filePath);
    const css = fs.readFileSync(expandedPath, 'utf8');
    await page.addStyleTag({ content: css });
    return { success: true, source: 'file', type: 'css' };
  } catch (error) {
    return {
      success: false,
      source: 'file',
      type: 'css',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Inject JavaScript into a page
 *
 * @param page - Playwright page
 * @param js - JavaScript code to inject
 * @param runAt - When to run: 'document_start' uses addInitScript (runs before page load),
 *                others use evaluate (runs immediately)
 */
export async function injectJS(
  page: Page,
  js: string,
  runAt: RunAt = 'document_end'
): Promise<InjectionResult> {
  try {
    let result: unknown;

    if (runAt === 'document_start') {
      // addInitScript runs before any page scripts
      // Note: This only affects future navigations, not the current page
      await page.addInitScript(js);
      result = 'Script registered for future navigations';
    } else {
      // evaluate runs immediately in the current page context
      result = await page.evaluate(js);
    }

    return { success: true, source: 'inline', type: 'js', result };
  } catch (error) {
    return {
      success: false,
      source: 'inline',
      type: 'js',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Inject JavaScript from a file into a page
 */
export async function injectJSFile(
  page: Page,
  filePath: string,
  runAt: RunAt = 'document_end'
): Promise<InjectionResult> {
  try {
    const expandedPath = expandPath(filePath);
    const js = fs.readFileSync(expandedPath, 'utf8');
    return await injectJS(page, js, runAt);
  } catch (error) {
    return {
      success: false,
      source: 'file',
      type: 'js',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply a single injection rule to a page
 */
export async function applyRule(page: Page, rule: InjectionRule): Promise<InjectionResult[]> {
  const results: InjectionResult[] = [];

  // Inject CSS
  if (rule.css) {
    results.push(await injectCSS(page, rule.css));
  } else if (rule.cssFile) {
    results.push(await injectCSSFile(page, rule.cssFile));
  }

  // Inject JS
  if (rule.js) {
    results.push(await injectJS(page, rule.js, rule.runAt));
  } else if (rule.jsFile) {
    results.push(await injectJSFile(page, rule.jsFile, rule.runAt));
  }

  return results;
}

/**
 * Apply all matching rules to a page
 *
 * @param page - Playwright page
 * @param url - Current page URL (for matching)
 * @param manager - InjectionRuleManager instance
 * @param status - Optional status filter ('dev' or 'prod')
 */
export async function applyMatchingRules(
  page: Page,
  url: string,
  manager: InjectionRuleManager,
  status?: 'dev' | 'prod'
): Promise<ApplyRulesResult> {
  const result: ApplyRulesResult = {
    appliedRules: [],
    skippedRules: [],
    errors: [],
  };

  const matchingRules = manager.getMatchingRules(url, status);

  for (const rule of matchingRules) {
    try {
      const injectionResults = await applyRule(page, rule);
      const hasErrors = injectionResults.some((r) => !r.success);

      if (hasErrors) {
        const errorMessages = injectionResults
          .filter((r) => !r.success)
          .map((r) => r.error)
          .join('; ');
        result.errors.push({ ruleId: rule.id, error: errorMessages });
        result.skippedRules.push(rule.id);
      } else {
        result.appliedRules.push(rule.id);
        console.error(`[Injector] Applied rule: ${rule.id} (${rule.name}) to ${url}`);
      }
    } catch (error) {
      result.errors.push({
        ruleId: rule.id,
        error: error instanceof Error ? error.message : String(error),
      });
      result.skippedRules.push(rule.id);
    }
  }

  return result;
}

/**
 * Create a style tag with an ID for later removal
 */
export async function injectCSSWithId(page: Page, css: string, id: string): Promise<InjectionResult> {
  try {
    await page.evaluate(
      ({ css, id }) => {
        // Remove existing style tag with same ID
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        // Create new style tag
        const style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
      },
      { css, id }
    );
    return { success: true, source: 'inline', type: 'css' };
  } catch (error) {
    return {
      success: false,
      source: 'inline',
      type: 'css',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove a previously injected style tag by ID
 */
export async function removeCSSById(page: Page, id: string): Promise<boolean> {
  try {
    return await page.evaluate((id) => {
      const style = document.getElementById(id);
      if (style) {
        style.remove();
        return true;
      }
      return false;
    }, id);
  } catch {
    return false;
  }
}
