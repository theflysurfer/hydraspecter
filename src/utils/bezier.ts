/**
 * Bezier curve implementation for smooth mouse movement paths
 * Based on ghost-cursor algorithm with Fitts' Law integration
 */

import { random, clamp } from './random.js';

export interface Point {
  x: number;
  y: number;
}

export interface BezierConfig {
  /** Minimum number of points in the path */
  minPoints?: number;
  /** Maximum number of points in the path */
  maxPoints?: number;
  /** Spread of control points (higher = more curved paths) */
  spread?: number;
  /** Whether to add overshoot */
  overshoot?: boolean;
  /** Probability of overshoot (0-1) */
  overshootProbability?: number;
  /** Maximum overshoot distance as fraction of total distance */
  overshootSpread?: number;
}

const DEFAULT_CONFIG: Required<BezierConfig> = {
  minPoints: 50,
  maxPoints: 100,
  spread: 0.3,
  overshoot: true,
  overshootProbability: 0.1,
  overshootSpread: 0.15
};

/**
 * Calculate a point on a cubic Bezier curve
 * @param t - Parameter (0-1)
 * @param p0 - Start point
 * @param p1 - First control point
 * @param p2 - Second control point
 * @param p3 - End point
 */
function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
  };
}

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Generate control points for a Bezier curve
 * Control points are positioned on one side of the line to avoid unrealistic curves
 */
function generateControlPoints(
  start: Point,
  end: Point,
  spread: number
): { p1: Point; p2: Point } {
  const dist = distance(start, end);
  const spreadDistance = dist * spread;

  // Calculate perpendicular direction (always to the same side for consistency)
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);

  // Perpendicular angle (choose one side randomly)
  const perpAngle = angle + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2);

  // Random offsets for control points
  const offset1 = random(0.2, 0.4);
  const offset2 = random(0.6, 0.8);

  // Generate control points
  const p1: Point = {
    x: start.x + dx * offset1 + Math.cos(perpAngle) * random(-spreadDistance, spreadDistance),
    y: start.y + dy * offset1 + Math.sin(perpAngle) * random(-spreadDistance, spreadDistance)
  };

  const p2: Point = {
    x: start.x + dx * offset2 + Math.cos(perpAngle) * random(-spreadDistance, spreadDistance),
    y: start.y + dy * offset2 + Math.sin(perpAngle) * random(-spreadDistance, spreadDistance)
  };

  return { p1, p2 };
}

/**
 * Calculate the number of points based on Fitts' Law
 * More points for longer distances, fewer for short movements
 * @param dist - Distance in pixels
 * @param targetSize - Target element size (width/height average)
 */
export function calculatePointCount(
  dist: number,
  targetSize: number = 20,
  config: BezierConfig = {}
): number {
  const { minPoints, maxPoints } = { ...DEFAULT_CONFIG, ...config };

  // Fitts' Law: time = a + b * log2(2 * distance / targetSize)
  // We use this to determine point count (more points = slower movement)
  const fittsIndex = Math.log2(2 * dist / Math.max(targetSize, 1) + 1);

  // Scale to point count range
  const normalizedPoints = (fittsIndex / 10) * (maxPoints - minPoints) + minPoints;

  return clamp(Math.round(normalizedPoints), minPoints, maxPoints);
}

/**
 * Generate an overshoot point past the target
 */
function generateOvershootPoint(start: Point, end: Point, spread: number): Point {
  const dist = distance(start, end);
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Overshoot distance (as fraction of original distance)
  const overshootDist = dist * random(0.05, spread);
  const angle = Math.atan2(dy, dx) + random(-0.3, 0.3); // Slight angle variation

  return {
    x: end.x + Math.cos(angle) * overshootDist,
    y: end.y + Math.sin(angle) * overshootDist
  };
}

/**
 * Generate a Bezier curve path between two points
 * Produces human-like mouse movement trajectories
 */
export function generateBezierPath(
  start: Point,
  end: Point,
  config: BezierConfig = {}
): Point[] {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const dist = distance(start, end);

  // Handle very short distances
  if (dist < 5) {
    return [start, end];
  }

  const points: Point[] = [];
  const numPoints = calculatePointCount(dist, 20, mergedConfig);

  // Determine if we should overshoot
  const shouldOvershoot = mergedConfig.overshoot &&
    dist > 50 &&
    Math.random() < mergedConfig.overshootProbability;

  if (shouldOvershoot) {
    // Generate path to overshoot point, then correction path back
    const overshootPoint = generateOvershootPoint(start, end, mergedConfig.overshootSpread);

    // First part: to overshoot
    const { p1: cp1a, p2: cp2a } = generateControlPoints(start, overshootPoint, mergedConfig.spread);
    const firstPartPoints = Math.floor(numPoints * 0.7);

    for (let i = 0; i < firstPartPoints; i++) {
      const t = i / firstPartPoints;
      points.push(cubicBezier(t, start, cp1a, cp2a, overshootPoint));
    }

    // Second part: correction back to target
    const { p1: cp1b, p2: cp2b } = generateControlPoints(overshootPoint, end, mergedConfig.spread * 0.5);
    const secondPartPoints = numPoints - firstPartPoints;

    for (let i = 0; i <= secondPartPoints; i++) {
      const t = i / secondPartPoints;
      points.push(cubicBezier(t, overshootPoint, cp1b, cp2b, end));
    }
  } else {
    // Normal path without overshoot
    const { p1, p2 } = generateControlPoints(start, end, mergedConfig.spread);

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      points.push(cubicBezier(t, start, p1, p2, end));
    }
  }

  return points;
}

/**
 * Calculate timestamps for each point based on realistic movement timing
 * Uses easing to simulate acceleration and deceleration
 */
export function calculateTimestamps(
  points: Point[],
  totalDuration: number
): number[] {
  const timestamps: number[] = [];

  for (let i = 0; i < points.length; i++) {
    // Use ease-in-out timing for natural acceleration/deceleration
    const t = i / (points.length - 1);
    const eased = easeInOutQuad(t);
    timestamps.push(eased * totalDuration);
  }

  return timestamps;
}

/**
 * Ease-in-out quadratic function
 */
function easeInOutQuad(t: number): number {
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Calculate movement duration based on distance (Fitts' Law inspired)
 * @param dist - Distance in pixels
 * @param targetSize - Target size in pixels
 */
export function calculateDuration(dist: number, targetSize: number = 20): number {
  // Base timing: 100-500ms depending on distance
  const baseDuration = 100 + (dist / 10) * 20;

  // Fitts' Law adjustment
  const fittsIndex = Math.log2(2 * dist / Math.max(targetSize, 1) + 1);
  const fittsDuration = fittsIndex * 50;

  // Add randomness (±20%)
  const randomFactor = random(0.8, 1.2);

  return clamp((baseDuration + fittsDuration) * randomFactor, 100, 2000);
}
