/**
 * Human-like typing simulation with realistic delays and occasional typos
 * Based on Pydoll's typing engine
 */

import { Page } from 'playwright';
import { random, delay, randomBool, randomChoice } from './random.js';

export interface TypingConfig {
  /** Minimum delay between keystrokes in ms */
  minDelay: number;
  /** Maximum delay between keystrokes in ms */
  maxDelay: number;
  /** Probability of making a typo (0-1) */
  typoRate: number;
  /** Probability of pausing after a space (0-1) */
  pauseChance: number;
  /** Minimum pause duration in ms */
  pauseMin: number;
  /** Maximum pause duration in ms */
  pauseMax: number;
  /** Whether to simulate thinking pauses at punctuation */
  pauseAtPunctuation: boolean;
  /** Delay after pressing backspace to correct typo */
  typoCorrectDelay: { min: number; max: number };
  /** Whether to occasionally double-type a character */
  doubleTypeChance: number;
}

const DEFAULT_TYPING_CONFIG: TypingConfig = {
  minDelay: 30,
  maxDelay: 150,
  typoRate: 0.02,
  pauseChance: 0.05,
  pauseMin: 200,
  pauseMax: 500,
  pauseAtPunctuation: true,
  typoCorrectDelay: { min: 100, max: 300 },
  doubleTypeChance: 0.01
};

// QWERTY keyboard layout for realistic typos
// Maps each key to its adjacent keys
const ADJACENT_KEYS: Record<string, string[]> = {
  // Top row
  'q': ['w', 'a'],
  'w': ['q', 'e', 's', 'a'],
  'e': ['w', 'r', 'd', 's'],
  'r': ['e', 't', 'f', 'd'],
  't': ['r', 'y', 'g', 'f'],
  'y': ['t', 'u', 'h', 'g'],
  'u': ['y', 'i', 'j', 'h'],
  'i': ['u', 'o', 'k', 'j'],
  'o': ['i', 'p', 'l', 'k'],
  'p': ['o', 'l'],

  // Middle row
  'a': ['q', 'w', 's', 'z'],
  's': ['a', 'w', 'e', 'd', 'x', 'z'],
  'd': ['s', 'e', 'r', 'f', 'c', 'x'],
  'f': ['d', 'r', 't', 'g', 'v', 'c'],
  'g': ['f', 't', 'y', 'h', 'b', 'v'],
  'h': ['g', 'y', 'u', 'j', 'n', 'b'],
  'j': ['h', 'u', 'i', 'k', 'm', 'n'],
  'k': ['j', 'i', 'o', 'l', 'm'],
  'l': ['k', 'o', 'p'],

  // Bottom row
  'z': ['a', 's', 'x'],
  'x': ['z', 's', 'd', 'c'],
  'c': ['x', 'd', 'f', 'v'],
  'v': ['c', 'f', 'g', 'b'],
  'b': ['v', 'g', 'h', 'n'],
  'n': ['b', 'h', 'j', 'm'],
  'm': ['n', 'j', 'k'],

  // Numbers
  '1': ['2', 'q'],
  '2': ['1', '3', 'q', 'w'],
  '3': ['2', '4', 'w', 'e'],
  '4': ['3', '5', 'e', 'r'],
  '5': ['4', '6', 'r', 't'],
  '6': ['5', '7', 't', 'y'],
  '7': ['6', '8', 'y', 'u'],
  '8': ['7', '9', 'u', 'i'],
  '9': ['8', '0', 'i', 'o'],
  '0': ['9', 'o', 'p'],
};

// Punctuation that might cause thinking pauses
const PAUSE_PUNCTUATION = ['.', ',', '!', '?', ';', ':'];

/**
 * Get a random adjacent key for a typo
 */
function getTypoKey(char: string): string {
  const lowerChar = char.toLowerCase();
  const adjacent = ADJACENT_KEYS[lowerChar];

  if (adjacent && adjacent.length > 0) {
    const typoChar = randomChoice(adjacent);
    // Preserve case
    return char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar;
  }

  // For characters without defined adjacents, return a random nearby character
  return char;
}

/**
 * Calculate typing speed based on character type
 * Numbers and special characters are typically typed slower
 */
function getCharacterDelay(char: string, config: TypingConfig): number {
  let baseDelay = random(config.minDelay, config.maxDelay);

  // Numbers are often typed slightly slower
  if (/[0-9]/.test(char)) {
    baseDelay *= 1.2;
  }

  // Special characters require shifting, so they're slower
  if (/[!@#$%^&*()_+{}|:"<>?]/.test(char)) {
    baseDelay *= 1.5;
  }

  // Capital letters require shift key
  if (char !== char.toLowerCase() && /[A-Z]/.test(char)) {
    baseDelay *= 1.1;
  }

  return baseDelay;
}

/**
 * Type text with human-like behavior
 */
export async function humanType(
  page: Page,
  text: string,
  config: Partial<TypingConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_TYPING_CONFIG, ...config };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    // Check for double-type (pressing same key twice accidentally)
    if (i > 0 && randomBool(mergedConfig.doubleTypeChance)) {
      const prevChar = text[i - 1]!;
      await page.keyboard.type(prevChar);
      await delay(random(50, 100));
      await page.keyboard.press('Backspace');
      await delay(random(80, 150));
    }

    // Check for typo
    if (randomBool(mergedConfig.typoRate) && ADJACENT_KEYS[char.toLowerCase()]) {
      // Make a typo
      const typoChar = getTypoKey(char);
      await page.keyboard.type(typoChar);

      // Wait, notice the error
      await delay(random(
        mergedConfig.typoCorrectDelay.min,
        mergedConfig.typoCorrectDelay.max
      ));

      // Delete the typo
      await page.keyboard.press('Backspace');

      // Slight pause before typing correct character
      await delay(random(50, 150));
    }

    // Type the character
    await page.keyboard.type(char);

    // Calculate delay for next character
    const charDelay = getCharacterDelay(char, mergedConfig);
    await delay(charDelay);

    // Pause after space (simulating thinking)
    if (char === ' ' && randomBool(mergedConfig.pauseChance)) {
      await delay(random(mergedConfig.pauseMin, mergedConfig.pauseMax));
    }

    // Pause at punctuation (end of sentence/clause thinking)
    if (mergedConfig.pauseAtPunctuation && PAUSE_PUNCTUATION.includes(char)) {
      await delay(random(100, 400));
    }
  }
}

/**
 * Type text into a specific element with human-like behavior
 */
export async function humanTypeInElement(
  page: Page,
  selector: string,
  text: string,
  config: Partial<TypingConfig> = {}
): Promise<void> {
  // Focus the element first
  await page.click(selector);
  await delay(random(50, 150));

  // Type the text
  await humanType(page, text, config);
}

/**
 * Clear an input field and type new text with human-like behavior
 */
export async function humanClearAndType(
  page: Page,
  selector: string,
  text: string,
  config: Partial<TypingConfig> = {}
): Promise<void> {
  // Focus the element
  await page.click(selector);
  await delay(random(50, 150));

  // Select all (Ctrl+A)
  await page.keyboard.press('Control+a');
  await delay(random(50, 100));

  // Delete selected text
  await page.keyboard.press('Backspace');
  await delay(random(100, 200));

  // Type new text
  await humanType(page, text, config);
}

/**
 * Type text character by character with custom delay function
 * Useful for when you need more control over timing
 */
export async function typeWithCustomDelay(
  page: Page,
  text: string,
  delayFn: (char: string, index: number) => number
): Promise<void> {
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    await page.keyboard.type(char);
    await delay(delayFn(char, i));
  }
}

/**
 * Simulate pressing Enter after typing (e.g., for form submission)
 */
export async function humanTypeAndSubmit(
  page: Page,
  selector: string,
  text: string,
  config: Partial<TypingConfig> = {}
): Promise<void> {
  await humanTypeInElement(page, selector, text, config);

  // Pause before submitting (simulating hesitation)
  await delay(random(200, 500));

  // Press Enter
  await page.keyboard.press('Enter');
}

/**
 * Get default typing configuration
 */
export function getDefaultTypingConfig(): TypingConfig {
  return { ...DEFAULT_TYPING_CONFIG };
}

/**
 * Create a fast typing config (for less critical inputs)
 */
export function getFastTypingConfig(): TypingConfig {
  return {
    ...DEFAULT_TYPING_CONFIG,
    minDelay: 20,
    maxDelay: 80,
    typoRate: 0.01,
    pauseChance: 0.02
  };
}

/**
 * Create a slow/careful typing config (for passwords, important fields)
 */
export function getCarefulTypingConfig(): TypingConfig {
  return {
    ...DEFAULT_TYPING_CONFIG,
    minDelay: 80,
    maxDelay: 250,
    typoRate: 0.005,
    pauseChance: 0.1,
    pauseMin: 300,
    pauseMax: 800
  };
}
