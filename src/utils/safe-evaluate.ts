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
}

export interface SafeEvaluatePage {
  evaluate: (script: string | (() => unknown)) => Promise<unknown>;
}

const DEFAULT_TIMEOUT = 10000;

/**
 * Execute page.evaluate with a timeout
 *
 * @param page - Browser page with evaluate method
 * @param script - JavaScript code to execute
 * @param timeout - Timeout in ms (default: 10000)
 * @returns SafeEvaluateResult with success status and result or error
 *
 * @example
 * const result = await safeEvaluate(page, 'document.title', 5000);
 * if (result.success) {
 *   console.log('Title:', result.result);
 * } else {
 *   console.error('Failed:', result.error);
 * }
 */
export async function safeEvaluate<T = unknown>(
  page: SafeEvaluatePage,
  script: string | (() => unknown),
  timeout: number = DEFAULT_TIMEOUT
): Promise<SafeEvaluateResult<T>> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.error(`[SafeEvaluate] Timeout after ${timeout / 1000}s, will retry...`);
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
        console.error(`[SafeEvaluate] Error: ${errorMessage}`);
        resolve({ success: false, error: errorMessage });
      });
  });
}
