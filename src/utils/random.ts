/**
 * Random utility functions for human-like behavior simulation
 */

/**
 * Generate a random number between min and max (inclusive)
 */
export function random(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Generate a random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(random(min, max + 1));
}

/**
 * Delay execution for a random amount of time between min and max milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delay execution for a random amount of time between min and max milliseconds
 */
export function randomDelay(min: number, max: number): Promise<void> {
  return delay(random(min, max));
}

/**
 * Generate a random boolean with given probability
 * @param probability - Chance of returning true (0-1)
 */
export function randomBool(probability: number = 0.5): boolean {
  return Math.random() < probability;
}

/**
 * Pick a random element from an array
 */
export function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]!;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Generate a random offset for position variation
 */
export function randomOffset(maxOffset: number): { x: number; y: number } {
  return {
    x: random(-maxOffset, maxOffset),
    y: random(-maxOffset, maxOffset)
  };
}
