/**
 * Physics-based scrolling simulation for human-like behavior
 * Based on Pydoll's scroll engine with momentum, friction, and natural variations
 */

import { Page } from 'playwright';
import { random, delay, randomBool } from './random.js';

export interface ScrollConfig {
  /** Base duration for scroll animation in ms */
  duration: number;
  /** Easing function type */
  easing: 'linear' | 'ease-out' | 'ease-in-out' | 'bezier';
  /** Probability of overshooting the target (0-1) */
  overshootChance: number;
  /** Probability of micro-pauses during scroll (0-1) */
  microPauseChance: number;
  /** Maximum jitter in pixels */
  jitterAmount: number;
  /** Number of scroll steps */
  steps: number;
  /** Minimum scroll amount per step */
  minStepSize: number;
  /** Whether to add random horizontal movement */
  addHorizontalJitter: boolean;
}

const DEFAULT_SCROLL_CONFIG: ScrollConfig = {
  duration: 800,
  easing: 'ease-out',
  overshootChance: 0.15,
  microPauseChance: 0.1,
  jitterAmount: 5,
  steps: 30,
  minStepSize: 10,
  addHorizontalJitter: true
};

/**
 * Easing functions for natural scroll animation
 */
const easingFunctions = {
  linear: (t: number) => t,
  'ease-out': (t: number) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t: number) => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2,
  bezier: (t: number) => {
    // Cubic bezier approximation for natural momentum
    const t2 = t * t;
    const t3 = t2 * t;
    return 3 * t2 - 2 * t3 + random(-0.02, 0.02);
  }
};

/**
 * Scroll by a specific amount with human-like physics
 */
export async function humanScroll(
  page: Page,
  deltaY: number,
  config: Partial<ScrollConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_SCROLL_CONFIG, ...config };
  const easing = easingFunctions[mergedConfig.easing];

  // Calculate scroll parameters
  const shouldOvershoot = randomBool(mergedConfig.overshootChance) && Math.abs(deltaY) > 200;
  const overshootAmount = shouldOvershoot ? deltaY * random(0.1, 0.2) : 0;
  const totalScroll = deltaY + overshootAmount;

  // Calculate step timing
  const stepDuration = mergedConfig.duration / mergedConfig.steps;
  let accumulatedScroll = 0;

  for (let i = 0; i < mergedConfig.steps; i++) {
    const progress = (i + 1) / mergedConfig.steps;
    const easedProgress = easing(progress);

    // Calculate this step's scroll amount
    const targetScroll = totalScroll * easedProgress;
    let stepScroll = targetScroll - accumulatedScroll;

    // Add jitter for realism
    if (mergedConfig.jitterAmount > 0) {
      stepScroll += random(-mergedConfig.jitterAmount, mergedConfig.jitterAmount);
    }

    // Ensure minimum step size for visible movement
    if (Math.abs(stepScroll) < mergedConfig.minStepSize && i < mergedConfig.steps - 1) {
      continue;
    }

    // Calculate horizontal jitter
    const deltaX = mergedConfig.addHorizontalJitter
      ? random(-2, 2)
      : 0;

    // Perform the scroll
    await page.mouse.wheel(deltaX, stepScroll);
    accumulatedScroll += stepScroll;

    // Wait for next step
    await delay(stepDuration * random(0.8, 1.2));

    // Random micro-pause (simulates reading)
    if (randomBool(mergedConfig.microPauseChance)) {
      await delay(random(100, 300));
    }
  }

  // Correction scroll if we overshot
  if (shouldOvershoot) {
    await delay(random(100, 200));

    // Scroll back to correct position
    const correctionSteps = Math.ceil(mergedConfig.steps * 0.3);
    const correctionPerStep = -overshootAmount / correctionSteps;

    for (let i = 0; i < correctionSteps; i++) {
      await page.mouse.wheel(0, correctionPerStep);
      await delay(stepDuration * 0.5);
    }
  }
}

/**
 * Scroll down with human-like behavior
 */
export async function humanScrollDown(
  page: Page,
  amount: number = 300,
  config: Partial<ScrollConfig> = {}
): Promise<void> {
  await humanScroll(page, amount, config);
}

/**
 * Scroll up with human-like behavior
 */
export async function humanScrollUp(
  page: Page,
  amount: number = 300,
  config: Partial<ScrollConfig> = {}
): Promise<void> {
  await humanScroll(page, -amount, config);
}

/**
 * Scroll to the top of the page with human-like behavior
 */
export async function humanScrollToTop(
  page: Page,
  config: Partial<ScrollConfig> = {}
): Promise<void> {
  // Get current scroll position
  const scrollY = await page.evaluate(() => window.scrollY);

  if (scrollY > 0) {
    await humanScroll(page, -scrollY, {
      ...config,
      duration: Math.min(1500, config.duration || DEFAULT_SCROLL_CONFIG.duration),
      overshootChance: 0.05 // Less overshoot when scrolling to top
    });
  }
}

/**
 * Scroll to the bottom of the page with human-like behavior
 */
export async function humanScrollToBottom(
  page: Page,
  config: Partial<ScrollConfig> = {}
): Promise<void> {
  // Get remaining scroll distance
  const { scrollY, scrollHeight, innerHeight } = await page.evaluate(() => ({
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight
  }));

  const remainingScroll = scrollHeight - innerHeight - scrollY;

  if (remainingScroll > 0) {
    await humanScroll(page, remainingScroll, {
      ...config,
      duration: Math.min(2000, config.duration || DEFAULT_SCROLL_CONFIG.duration)
    });
  }
}

/**
 * Scroll to an element with human-like behavior
 */
export async function humanScrollToElement(
  page: Page,
  selector: string,
  config: Partial<ScrollConfig> = {}
): Promise<void> {
  const element = page.locator(selector);
  await element.waitFor({ state: 'attached', timeout: 10000 });

  // Get element position relative to viewport
  const elementBox = await element.boundingBox();
  if (!elementBox) {
    throw new Error(`Could not get bounding box for element: ${selector}`);
  }

  // Get viewport height
  const viewportHeight = page.viewportSize()?.height || 720;

  // Calculate scroll needed to center element in viewport
  const elementCenter = elementBox.y + elementBox.height / 2;
  const viewportCenter = viewportHeight / 2;
  const scrollNeeded = elementCenter - viewportCenter;

  if (Math.abs(scrollNeeded) > 50) {
    await humanScroll(page, scrollNeeded, config);
  }

  // Small delay to let the page settle
  await delay(random(100, 200));
}

/**
 * Scroll through a page in chunks (simulating reading)
 */
export async function humanScrollRead(
  page: Page,
  options: {
    chunkSize?: number;
    readPauseMin?: number;
    readPauseMax?: number;
    maxChunks?: number;
  } = {}
): Promise<void> {
  const {
    chunkSize = 400,
    readPauseMin = 1000,
    readPauseMax = 3000,
    maxChunks = 20
  } = options;

  for (let i = 0; i < maxChunks; i++) {
    // Check if we're at the bottom
    const { scrollY, scrollHeight, innerHeight } = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight
    }));

    if (scrollY + innerHeight >= scrollHeight - 50) {
      break; // Reached bottom
    }

    // Scroll a chunk
    await humanScrollDown(page, random(chunkSize * 0.8, chunkSize * 1.2));

    // Pause to "read"
    await delay(random(readPauseMin, readPauseMax));
  }
}

/**
 * Get default scroll configuration
 */
export function getDefaultScrollConfig(): ScrollConfig {
  return { ...DEFAULT_SCROLL_CONFIG };
}

/**
 * Create a fast scroll config (less natural, more efficient)
 */
export function getFastScrollConfig(): ScrollConfig {
  return {
    ...DEFAULT_SCROLL_CONFIG,
    duration: 400,
    steps: 15,
    microPauseChance: 0,
    overshootChance: 0
  };
}

/**
 * Create a slow/natural scroll config (very human-like)
 */
export function getNaturalScrollConfig(): ScrollConfig {
  return {
    ...DEFAULT_SCROLL_CONFIG,
    duration: 1200,
    steps: 50,
    microPauseChance: 0.2,
    overshootChance: 0.2,
    jitterAmount: 8
  };
}
