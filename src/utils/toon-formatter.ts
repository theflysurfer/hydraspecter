/**
 * TOON (Token-Oriented Object Notation) Formatter
 *
 * TOON is a hybrid format optimized for LLM token efficiency:
 * - YAML-style indentation for structure (no braces/quotes)
 * - CSV-style tabular data for arrays of similar objects
 *
 * Achieves 40-60% token reduction vs JSON with improved LLM accuracy.
 * Reference: https://github.com/microsoft/toon (16.8K stars)
 */

export type ToonFormat = 'json' | 'toon';

/**
 * Check if an array contains objects with consistent keys (tabular data)
 */
function isTabularArray(arr: any[]): boolean {
  if (arr.length === 0) return false;
  if (typeof arr[0] !== 'object' || arr[0] === null) return false;

  const firstKeys = Object.keys(arr[0]).sort().join(',');
  return arr.every(item =>
    typeof item === 'object' &&
    item !== null &&
    Object.keys(item).sort().join(',') === firstKeys
  );
}

/**
 * Format a value for TOON output
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    // Escape commas and newlines in strings
    if (value.includes(',') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Convert array to TOON tabular format
 *
 * Input:
 * [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]
 *
 * Output:
 * name, age
 * Alice, 30
 * Bob, 25
 */
function arrayToToonTable(arr: any[], indent: string = ''): string {
  if (arr.length === 0) return `${indent}(empty)`;

  const keys = Object.keys(arr[0]);
  const lines: string[] = [];

  // Header row
  lines.push(`${indent}${keys.join(', ')}`);

  // Data rows
  for (const item of arr) {
    const values = keys.map(key => formatValue(item[key]));
    lines.push(`${indent}${values.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Convert any value to TOON format
 */
function toToonValue(value: any, indent: string = ''): string {
  if (value === null || value === undefined) return 'null';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isTabularArray(value)) {
      return '\n' + arrayToToonTable(value, indent + '  ');
    }
    // Simple array
    return value.map(v => `\n${indent}- ${formatValue(v)}`).join('');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';

    return entries.map(([key, val]) => {
      if (Array.isArray(val) && isTabularArray(val)) {
        return `\n${indent}${key}:${toToonValue(val, indent)}`;
      } else if (typeof val === 'object' && val !== null) {
        return `\n${indent}${key}:${toToonValue(val, indent + '  ')}`;
      } else {
        return `\n${indent}${key}: ${formatValue(val)}`;
      }
    }).join('');
  }

  return formatValue(value);
}

/**
 * Format data as TOON
 *
 * @example
 * formatAsToon({
 *   requests: [
 *     { url: "https://api.com", method: "GET", status: 200 },
 *     { url: "https://api.com/data", method: "POST", status: 201 }
 *   ],
 *   total: 2
 * })
 *
 * Output:
 * requests:
 *   url, method, status
 *   https://api.com, GET, 200
 *   https://api.com/data, POST, 201
 * total: 2
 */
export function formatAsToon(data: any): string {
  if (typeof data !== 'object' || data === null) {
    return formatValue(data);
  }

  // Handle arrays at root level
  if (Array.isArray(data)) {
    if (isTabularArray(data)) {
      return arrayToToonTable(data);
    }
    return data.map(item => `- ${formatValue(item)}`).join('\n');
  }

  // Handle objects
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && isTabularArray(value)) {
      lines.push(`${key}:`);
      lines.push(arrayToToonTable(value, '  '));
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      value.forEach(item => {
        if (typeof item === 'object' && item !== null) {
          lines.push(`  -${toToonValue(item, '    ')}`);
        } else {
          lines.push(`  - ${formatValue(item)}`);
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${key}:${toToonValue(value, '  ')}`);
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format data as either JSON or TOON based on format parameter
 */
export function formatOutput(data: any, format: ToonFormat = 'json'): string {
  if (format === 'toon') {
    return formatAsToon(data);
  }
  return JSON.stringify(data, null, 2);
}

/**
 * Calculate token savings between JSON and TOON formats
 */
export function calculateTokenSavings(data: any): { json: number; toon: number; savings: string } {
  const jsonStr = JSON.stringify(data, null, 2);
  const toonStr = formatAsToon(data);

  // Rough token estimate: ~4 chars per token for JSON, ~3 chars per token for TOON
  const jsonTokens = Math.ceil(jsonStr.length / 4);
  const toonTokens = Math.ceil(toonStr.length / 3);

  const savingsPercent = Math.round((1 - toonTokens / jsonTokens) * 100);

  return {
    json: jsonTokens,
    toon: toonTokens,
    savings: `${savingsPercent}%`
  };
}

/**
 * Threshold for auto-applying TOON format (in estimated tokens)
 * If JSON would be > 500 tokens and data is tabular, use TOON
 */
const AUTO_TOON_THRESHOLD = 500;

/**
 * Smart format: auto-apply TOON when beneficial
 * Returns { format, content, tokenStats }
 */
export function smartFormat(data: any): {
  format: 'json' | 'toon';
  content: string;
  tokenStats?: { jsonTokens: number; toonTokens: number; savings: string };
} {
  // Check if data has tabular arrays
  const hasTabular = checkForTabularData(data);

  // Estimate JSON size
  const jsonStr = JSON.stringify(data, null, 2);
  const jsonTokens = Math.ceil(jsonStr.length / 4);

  // Use TOON if data is large enough and has tabular structure
  if (hasTabular && jsonTokens > AUTO_TOON_THRESHOLD) {
    const toonStr = formatAsToon(data);
    const toonTokens = Math.ceil(toonStr.length / 3);
    const savings = Math.round((1 - toonTokens / jsonTokens) * 100);

    return {
      format: 'toon',
      content: toonStr,
      tokenStats: {
        jsonTokens,
        toonTokens,
        savings: `${savings}%`
      }
    };
  }

  // Otherwise use JSON
  return {
    format: 'json',
    content: jsonStr
  };
}

/**
 * Check if data contains tabular arrays that would benefit from TOON
 */
function checkForTabularData(data: any, depth: number = 0): boolean {
  if (depth > 3) return false; // Don't go too deep

  if (Array.isArray(data)) {
    return isTabularArray(data) && data.length >= 3; // At least 3 items
  }

  if (typeof data === 'object' && data !== null) {
    for (const value of Object.values(data)) {
      if (checkForTabularData(value, depth + 1)) {
        return true;
      }
    }
  }

  return false;
}
