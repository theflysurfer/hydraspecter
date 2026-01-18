/**
 * Perplexity Exporter
 *
 * Extracts all conversations from Perplexity.ai via DOM scraping.
 * Requires an active SeleniumBase session with Perplexity logged in.
 *
 * Features:
 * - Tracker file for resume support after crash
 * - Skip already exported URLs
 * - Save progress incrementally
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Default export directory
const DEFAULT_EXPORT_DIR = 'C:/Users/julien/OneDrive/Coding/_Projets de code/2025.12 Fetch GPT chats/exports/perplexity';

// Tracker file location
const HYDRASPECTER_DIR = path.join(os.homedir(), '.hydraspecter');
const TRACKER_FILE = path.join(HYDRASPECTER_DIR, 'perplexity-export-tracker.json');

export interface ExportTracker {
  lastExportDate: string | null;
  exportedUrls: string[];
  failedUrls: string[];
  /** Retry counts per URL (normalized) */
  retryCounts: Record<string, number>;
  totalFound: number;
  exportDir: string;
}

/**
 * Load tracker from disk or create new one
 */
export function loadTracker(): ExportTracker {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      const data = fs.readFileSync(TRACKER_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`[Perplexity Export] Failed to load tracker: ${error}`);
  }

  // Return default tracker
  return {
    lastExportDate: null,
    exportedUrls: [],
    failedUrls: [],
    retryCounts: {},
    totalFound: 0,
    exportDir: DEFAULT_EXPORT_DIR
  };
}

/**
 * Save tracker to disk
 */
export function saveTracker(tracker: ExportTracker): void {
  try {
    if (!fs.existsSync(HYDRASPECTER_DIR)) {
      fs.mkdirSync(HYDRASPECTER_DIR, { recursive: true });
    }
    tracker.lastExportDate = new Date().toISOString();
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(tracker, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[Perplexity Export] Failed to save tracker: ${error}`);
  }
}

/**
 * Normalize URL by removing query params
 */
function normalizeUrl(url: string): string {
  return url.split('?')[0] || url;
}

/**
 * Check if URL was already exported
 */
export function isAlreadyExported(tracker: ExportTracker, url: string): boolean {
  const normalizedUrl = normalizeUrl(url);
  return tracker.exportedUrls.some(u => normalizeUrl(u) === normalizedUrl);
}

/**
 * Mark URL as exported
 */
export function markExported(tracker: ExportTracker, url: string): void {
  const normalizedUrl = normalizeUrl(url);
  if (!tracker.exportedUrls.includes(normalizedUrl)) {
    tracker.exportedUrls.push(normalizedUrl);
    saveTracker(tracker);
  }
}

/**
 * Mark URL as failed
 */
export function markFailed(tracker: ExportTracker, url: string): void {
  const normalizedUrl = normalizeUrl(url);
  if (!tracker.failedUrls.includes(normalizedUrl)) {
    tracker.failedUrls.push(normalizedUrl);
    saveTracker(tracker);
  }
}

/**
 * Get retry count for a URL
 */
export function getRetryCount(tracker: ExportTracker, url: string): number {
  const normalizedUrl = normalizeUrl(url);
  return tracker.retryCounts[normalizedUrl] || 0;
}

/**
 * Increment retry count for a URL
 */
export function incrementRetryCount(tracker: ExportTracker, url: string): number {
  const normalizedUrl = normalizeUrl(url);
  if (!tracker.retryCounts) {
    tracker.retryCounts = {};
  }
  tracker.retryCounts[normalizedUrl] = (tracker.retryCounts[normalizedUrl] || 0) + 1;
  saveTracker(tracker);
  return tracker.retryCounts[normalizedUrl];
}

/**
 * Clear retry count for a URL (on success)
 */
export function clearRetryCount(tracker: ExportTracker, url: string): void {
  const normalizedUrl = normalizeUrl(url);
  if (tracker.retryCounts && tracker.retryCounts[normalizedUrl]) {
    delete tracker.retryCounts[normalizedUrl];
    saveTracker(tracker);
  }
}

/**
 * Remove URL from failed list (for retry)
 */
export function unmarkFailed(tracker: ExportTracker, url: string): void {
  const normalizedUrl = normalizeUrl(url);
  const index = tracker.failedUrls.indexOf(normalizedUrl);
  if (index !== -1) {
    tracker.failedUrls.splice(index, 1);
    saveTracker(tracker);
  }
}

/** Maximum retry attempts per thread */
export const MAX_RETRY_ATTEMPTS = 3;

export interface PerplexitySource {
  title: string;
  url: string;
}

export interface PerplexityThread {
  id: string;
  title: string;
  url: string;
  date?: string;
  questions: string[];
  answers: string[];
  sources: (string | PerplexitySource)[];
}

export interface PerplexityExportResult {
  success: boolean;
  threadsFound: number;
  threadsExported: number;
  exportDir: string;
  errors: string[];
}

/**
 * Extract thread list from Perplexity library page
 */
export function getThreadListScript(): string {
  return `
    JSON.stringify({
      total: document.querySelectorAll('a[href*="/search/"]').length,
      threads: [...document.querySelectorAll('a[href*="/search/"]')].map(a => {
        const container = a.closest('div');
        const dateEl = container?.querySelector('time');
        return {
          id: a.href.split('/').pop(),
          title: a.textContent.trim().slice(0, 200),
          url: a.href,
          date: dateEl?.getAttribute('datetime') || dateEl?.textContent || null
        };
      })
    })
  `;
}

/**
 * Extract conversation content from a single thread page
 * Updated for Perplexity's 2026 UI structure
 * Now preserves HTML formatting for conversion to Markdown
 */
export function getThreadContentScript(): string {
  return `
    (function() {
      // Get title/question from document title (most reliable)
      const title = document.title.replace(/\\s*[-–|]\\s*Perplexity.*$/i, '').trim();

      // Use title as the primary question
      const questions = title ? [title] : [];

      // Extract answer HTML from prose/markdown container (preserves formatting)
      const answerEl = document.querySelector('.prose, .markdown, [class*="prose"]');
      const answerHtml = answerEl ? answerEl.innerHTML : '';

      // Simple HTML to Markdown conversion inline
      function htmlToMarkdown(html) {
        if (!html) return '';
        return html
          // Headers
          .replace(/<h1[^>]*>(.*?)<\\/h1>/gi, '# $1\\n\\n')
          .replace(/<h2[^>]*>(.*?)<\\/h2>/gi, '## $1\\n\\n')
          .replace(/<h3[^>]*>(.*?)<\\/h3>/gi, '### $1\\n\\n')
          .replace(/<h4[^>]*>(.*?)<\\/h4>/gi, '#### $1\\n\\n')
          // Bold and italic
          .replace(/<strong[^>]*>(.*?)<\\/strong>/gi, '**$1**')
          .replace(/<b[^>]*>(.*?)<\\/b>/gi, '**$1**')
          .replace(/<em[^>]*>(.*?)<\\/em>/gi, '*$1*')
          .replace(/<i[^>]*>(.*?)<\\/i>/gi, '*$1*')
          // Links - convert to markdown format
          .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\\/a>/gi, '[$2]($1)')
          // Lists
          .replace(/<ul[^>]*>/gi, '\\n')
          .replace(/<\\/ul>/gi, '\\n')
          .replace(/<ol[^>]*>/gi, '\\n')
          .replace(/<\\/ol>/gi, '\\n')
          .replace(/<li[^>]*>(.*?)<\\/li>/gi, '- $1\\n')
          // Paragraphs and line breaks
          .replace(/<p[^>]*>(.*?)<\\/p>/gi, '$1\\n\\n')
          .replace(/<br\\s*\\/?>/gi, '\\n')
          .replace(/<div[^>]*>/gi, '\\n')
          .replace(/<\\/div>/gi, '')
          // Code blocks
          .replace(/<pre[^>]*><code[^>]*>(.*?)<\\/code><\\/pre>/gi, '\\n\`\`\`\\n$1\\n\`\`\`\\n')
          .replace(/<code[^>]*>(.*?)<\\/code>/gi, '\`$1\`')
          // Remove remaining HTML tags
          .replace(/<[^>]+>/g, '')
          // Clean up whitespace
          .replace(/\\n{3,}/g, '\\n\\n')
          .replace(/^\\s+|\\s+$/g, '')
          // Decode HTML entities
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ');
      }

      const answers = answerHtml ? [htmlToMarkdown(answerHtml)] : [];

      // Extract external sources/citations with proper markdown links
      const sources = [...document.querySelectorAll('a[href^="http"]')]
        .filter(a => !a.href.includes('perplexity.ai'))
        .slice(0, 30)
        .map(a => ({ title: a.textContent?.trim().slice(0, 100), url: a.href }))
        .filter(s => s.title && s.title.length > 2 && s.url);

      return JSON.stringify({
        title,
        questions,
        answers,
        sources,
        url: window.location.href
      });
    })()
  `;
}

/**
 * Convert thread to Markdown format
 */
export function threadToMarkdown(thread: PerplexityThread): string {
  let md = `# ${thread.title}\n\n`;
  md += `> **URL**: ${thread.url}\n`;
  if (thread.date) {
    md += `> **Date**: ${thread.date}\n`;
  }
  md += `\n---\n\n`;

  // If we have questions and answers, interleave them
  const maxLen = Math.max(thread.questions.length, thread.answers.length);
  if (maxLen > 0) {
    for (let i = 0; i < maxLen; i++) {
      if (thread.questions[i]) {
        md += `## Question ${i + 1}\n\n${thread.questions[i]}\n\n`;
      }
      if (thread.answers[i]) {
        md += `### Answer\n\n${thread.answers[i]}\n\n`;
      }
    }
  } else {
    // Fallback: just show title as question
    md += `## Question\n\n${thread.title}\n\n`;
    md += `### Answer\n\n*No answer content extracted*\n\n`;
  }

  // Add sources as markdown links
  if (thread.sources.length > 0) {
    md += `---\n\n## Sources\n\n`;
    thread.sources.forEach((source, i) => {
      if (typeof source === 'object' && source.title && source.url) {
        md += `${i + 1}. [${source.title}](${source.url})\n`;
      } else {
        md += `${i + 1}. ${source}\n`;
      }
    });
  }

  return md;
}

/**
 * Generate safe filename from thread title
 */
export function safeFilename(title: string, id: string): string {
  const safe = title
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôùûüç\s-]/gi, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
  return `${safe}-${id.slice(-8)}.md`;
}

/**
 * Ensure export directory exists
 */
export function ensureExportDir(exportDir: string = DEFAULT_EXPORT_DIR): string {
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  return exportDir;
}

/**
 * Save thread to file
 */
export function saveThread(thread: PerplexityThread, exportDir: string): string {
  const filename = safeFilename(thread.title, thread.id);
  const filepath = path.join(exportDir, filename);
  const content = threadToMarkdown(thread);
  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

/**
 * Create index file with all exported threads
 */
export function createIndex(threads: PerplexityThread[], exportDir: string): string {
  const indexPath = path.join(exportDir, '_index.md');
  let content = `# Perplexity Export Index\n\n`;
  content += `> Exported: ${new Date().toISOString()}\n`;
  content += `> Total threads: ${threads.length}\n\n`;
  content += `---\n\n`;

  threads.forEach((thread, i) => {
    const filename = safeFilename(thread.title, thread.id);
    content += `${i + 1}. [${thread.title}](./${filename})`;
    if (thread.date) content += ` - ${thread.date}`;
    content += `\n`;
  });

  fs.writeFileSync(indexPath, content, 'utf-8');
  return indexPath;
}

export const DEFAULT_PERPLEXITY_EXPORT_DIR = DEFAULT_EXPORT_DIR;
