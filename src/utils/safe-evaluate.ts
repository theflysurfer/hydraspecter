/**
 * Safe Evaluate Wrapper
 *
 * Wraps page.evaluate() calls with a configurable timeout to detect freezes early.
 * Returns a standardized result object instead of throwing on timeout.
 */

export interface SafeEvaluateResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: 'timeout' | string;
  needsReinit?: boolean;
}

export interface SafeEvaluatePage {
  evaluate: (script: string | (() => unknown)) => Promise<unknown>;
}

const DEFAULT_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a single evaluate attempt with timeout
 */
async function executeWithTimeout<T>(
  page: SafeEvaluatePage,
  script: string | (() => unknown),
  timeout: number
): Promise<SafeEvaluateResult<T>> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve({ success: false, error: 'timeout' });
    }, timeout);

    page.evaluate(script)
      .then((result) => {
        clearTimeout(timeoutId);
        resolve({ success: true, result: result as T });
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        const errorMessage = err instanceof Error ? err.message : String(err);
        resolve({ success: false, error: errorMessage });
      });
  });
}

/**
 * Execute page.evaluate with a timeout and automatic retry on failure
 *
 * @param page - Browser page with evaluate method
 * @param script - JavaScript code to execute
 * @param timeout - Timeout in ms (default: 10000)
 * @returns SafeEvaluateResult with success status and result or error
 *
 * Retry behavior:
 * - On timeout, retries up to 3 times with exponential backoff (1s, 2s, 4s)
 * - Logs '[SafeEvaluate] Retry {n}/3 after timeout...' for each retry
 * - After 3 failed attempts, returns { success: false, needsReinit: true }
 *
 * @example
 * const result = await safeEvaluate(page, 'document.title', 5000);
 * if (result.success) {
 *   console.log('Title:', result.result);
 * } else if (result.needsReinit) {
 *   console.log('Driver needs reinitialization');
 * } else {
 *   console.error('Failed:', result.error);
 * }
 */
export async function safeEvaluate<T = unknown>(
  page: SafeEvaluatePage,
  script: string | (() => unknown),
  timeout: number = DEFAULT_TIMEOUT
): Promise<SafeEvaluateResult<T>> {
  let lastResult: SafeEvaluateResult<T> = { success: false, error: 'unknown' };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // First attempt (attempt = 0) is the initial try, not a retry
    if (attempt > 0) {
      const retryDelay = RETRY_DELAYS[attempt - 1] ?? 4000;
      console.error(`[SafeEvaluate] Retry ${attempt}/${MAX_RETRIES} after timeout...`);
      await sleep(retryDelay);
    }

    lastResult = await executeWithTimeout<T>(page, script, timeout);

    if (lastResult.success) {
      return lastResult;
    }

    // Only retry on timeout errors
    if (lastResult.error !== 'timeout') {
      console.error(`[SafeEvaluate] Error: ${lastResult.error}`);
      return lastResult;
    }

    // Log timeout on first attempt
    if (attempt === 0) {
      console.error(`[SafeEvaluate] Timeout after ${timeout / 1000}s, will retry...`);
    }
  }

  // All retries exhausted
  console.error(`[SafeEvaluate] All ${MAX_RETRIES} retries failed, needs reinitialization`);
  return {
    success: false,
    error: 'timeout',
    needsReinit: true
  };
}
