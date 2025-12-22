/**
 * Ghost Cursor - Human-like mouse movement for Playwright
 * Based on ghost-cursor algorithm with Bezier curves and Fitts' Law
 */

import { Page, Locator } from 'playwright';
import {
  Point,
  BezierConfig,
  generateBezierPath,
  calculateDuration,
  calculateTimestamps,
  distance
} from './bezier.js';
import { random, randomOffset, randomDelay } from './random.js';

export interface HumanMouseConfig extends BezierConfig {
  /** Delay between movement steps in ms */
  moveStepDelay?: number;
  /** Random delay added to each step */
  moveStepDelayVariation?: number;
  /** Click delay after movement */
  preClickDelay?: { min: number; max: number };
  /** Delay between mousedown and mouseup */
  clickDuration?: { min: number; max: number };
  /** Post-click delay */
  postClickDelay?: { min: number; max: number };
  /** Random offset from element center */
  targetOffset?: number;
  /** Whether to scroll element into view */
  scrollIntoView?: boolean;
  /** Whether to move to random position in element (not just center) */
  randomizeTarget?: boolean;
}

const DEFAULT_MOUSE_CONFIG: Required<HumanMouseConfig> = {
  minPoints: 50,
  maxPoints: 100,
  spread: 0.3,
  overshoot: true,
  overshootProbability: 0.1,
  overshootSpread: 0.15,
  moveStepDelay: 10,
  moveStepDelayVariation: 5,
  preClickDelay: { min: 50, max: 150 },
  clickDuration: { min: 50, max: 150 },
  postClickDelay: { min: 100, max: 300 },
  targetOffset: 0,
  scrollIntoView: true,
  randomizeTarget: true
};

// Track current mouse position
let currentPosition: Point = { x: 0, y: 0 };

/**
 * Get the current mouse position
 */
export function getCurrentPosition(): Point {
  return { ...currentPosition };
}

/**
 * Set the current mouse position (use when page loads or position is unknown)
 */
export function setCurrentPosition(pos: Point): void {
  currentPosition = { ...pos };
}

/**
 * Get element bounding box with viewport offset
 */
async function getElementBox(element: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} | null> {
  try {
    const box = await element.boundingBox();

    if (!box) return null;

    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2
    };
  } catch {
    return null;
  }
}

/**
 * Calculate target point within element (randomized within bounds)
 */
function getTargetPoint(
  box: { x: number; y: number; width: number; height: number; centerX: number; centerY: number },
  config: HumanMouseConfig
): Point {
  if (config.randomizeTarget) {
    // Random point within element (avoiding edges)
    const margin = 0.2; // 20% margin from edges
    const xRange = box.width * (1 - 2 * margin);
    const yRange = box.height * (1 - 2 * margin);

    return {
      x: box.x + box.width * margin + random(0, xRange),
      y: box.y + box.height * margin + random(0, yRange)
    };
  }

  // Center with optional offset
  const offset = config.targetOffset ? randomOffset(config.targetOffset) : { x: 0, y: 0 };
  return {
    x: box.centerX + offset.x,
    y: box.centerY + offset.y
  };
}

/**
 * Move mouse along a path of points with realistic timing
 */
async function moveAlongPath(
  page: Page,
  path: Point[],
  config: Required<HumanMouseConfig>
): Promise<void> {
  const totalDist = path.reduce((acc, point, i) => {
    if (i === 0) return 0;
    return acc + distance(path[i - 1]!, point);
  }, 0);

  const duration = calculateDuration(totalDist);
  const timestamps = calculateTimestamps(path, duration);

  let lastTime = 0;
  for (let i = 0; i < path.length; i++) {
    const point = path[i]!;
    const timestamp = timestamps[i]!;
    const waitTime = timestamp - lastTime;

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    await page.mouse.move(point.x, point.y);
    currentPosition = point;
    lastTime = timestamp;

    // Add micro-variation to timing
    if (config.moveStepDelayVariation > 0 && i % 3 === 0) {
      await new Promise(resolve =>
        setTimeout(resolve, random(0, config.moveStepDelayVariation))
      );
    }
  }
}

/**
 * Move mouse to a specific point with human-like trajectory
 */
export async function humanMove(
  page: Page,
  to: Point,
  config: Partial<HumanMouseConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_MOUSE_CONFIG, ...config } as Required<HumanMouseConfig>;

  const from = getCurrentPosition();
  const path = generateBezierPath(from, to, mergedConfig);

  await moveAlongPath(page, path, mergedConfig);
}

/**
 * Move mouse to an element with human-like trajectory
 */
export async function humanMoveToElement(
  page: Page,
  selector: string,
  config: Partial<HumanMouseConfig> = {}
): Promise<Point | null> {
  const mergedConfig = { ...DEFAULT_MOUSE_CONFIG, ...config } as Required<HumanMouseConfig>;

  // Find element
  const element = page.locator(selector);
  await element.waitFor({ state: 'visible', timeout: 30000 });

  // Scroll into view if needed
  if (mergedConfig.scrollIntoView) {
    await element.scrollIntoViewIfNeeded();
    await randomDelay(100, 300); // Wait after scroll
  }

  // Get element box
  const box = await getElementBox(element);
  if (!box) {
    throw new Error(`Could not get bounding box for element: ${selector}`);
  }

  // Calculate target point
  const target = getTargetPoint(box, mergedConfig);

  // Move to target
  await humanMove(page, target, mergedConfig);

  return target;
}

/**
 * Click on an element with human-like mouse movement
 */
export async function humanClick(
  page: Page,
  selector: string,
  config: Partial<HumanMouseConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_MOUSE_CONFIG, ...config } as Required<HumanMouseConfig>;

  // Move to element
  await humanMoveToElement(page, selector, mergedConfig);

  // Pre-click hesitation
  await randomDelay(
    mergedConfig.preClickDelay.min,
    mergedConfig.preClickDelay.max
  );

  // Perform click with realistic timing
  await page.mouse.down();
  await randomDelay(
    mergedConfig.clickDuration.min,
    mergedConfig.clickDuration.max
  );
  await page.mouse.up();

  // Post-click delay
  await randomDelay(
    mergedConfig.postClickDelay.min,
    mergedConfig.postClickDelay.max
  );
}

/**
 * Double click on an element with human-like behavior
 */
export async function humanDoubleClick(
  page: Page,
  selector: string,
  config: Partial<HumanMouseConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_MOUSE_CONFIG, ...config } as Required<HumanMouseConfig>;

  // Move to element
  await humanMoveToElement(page, selector, mergedConfig);

  // Pre-click hesitation
  await randomDelay(
    mergedConfig.preClickDelay.min,
    mergedConfig.preClickDelay.max
  );

  // First click
  await page.mouse.down();
  await randomDelay(30, 70);
  await page.mouse.up();

  // Inter-click delay (fast, typical double-click timing)
  await randomDelay(50, 150);

  // Second click
  await page.mouse.down();
  await randomDelay(30, 70);
  await page.mouse.up();

  // Post-click delay
  await randomDelay(
    mergedConfig.postClickDelay.min,
    mergedConfig.postClickDelay.max
  );
}

/**
 * Right click on an element with human-like behavior
 */
export async function humanRightClick(
  page: Page,
  selector: string,
  config: Partial<HumanMouseConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_MOUSE_CONFIG, ...config } as Required<HumanMouseConfig>;

  // Move to element
  await humanMoveToElement(page, selector, mergedConfig);

  // Pre-click hesitation
  await randomDelay(
    mergedConfig.preClickDelay.min,
    mergedConfig.preClickDelay.max
  );

  // Right click
  await page.mouse.down({ button: 'right' });
  await randomDelay(
    mergedConfig.clickDuration.min,
    mergedConfig.clickDuration.max
  );
  await page.mouse.up({ button: 'right' });

  // Post-click delay
  await randomDelay(
    mergedConfig.postClickDelay.min,
    mergedConfig.postClickDelay.max
  );
}

/**
 * Hover over an element with human-like movement
 */
export async function humanHover(
  page: Page,
  selector: string,
  duration: number = 500,
  config: Partial<HumanMouseConfig> = {}
): Promise<void> {
  await humanMoveToElement(page, selector, config);
  await randomDelay(duration * 0.8, duration * 1.2);
}

/**
 * Initialize mouse position (call when page loads or position is unknown)
 */
export async function initializeMousePosition(page: Page): Promise<void> {
  // Move to a random position in the viewport
  const viewport = page.viewportSize();
  if (viewport) {
    const startX = random(viewport.width * 0.3, viewport.width * 0.7);
    const startY = random(viewport.height * 0.3, viewport.height * 0.7);
    setCurrentPosition({ x: startX, y: startY });
    await page.mouse.move(startX, startY);
  }
}
