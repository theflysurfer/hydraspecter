/**
 * Gmail Export Monitor
 *
 * Monitors Gmail for export emails from ChatGPT/Claude and downloads the export files.
 * Supports both DOM monitoring (if Gmail tab is open) and polling approach.
 *
 * Features:
 * - Detect emails from OpenAI or Anthropic with 'export' in subject
 * - Extract download link from email content
 * - Automatic download handling
 * - Configurable timeout and polling interval
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Default download directory
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');

// Gmail URLs
const GMAIL_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox';
const GMAIL_SEARCH_BASE = 'https://mail.google.com/mail/u/0/#search/';

export type ExportSource = 'chatgpt' | 'claude';

export interface WaitExportEmailOptions {
  /** Source of export: 'chatgpt' or 'claude' */
  source: ExportSource;
  /** Maximum time to wait in ms (default: 30 minutes) */
  timeout?: number;
  /** Polling interval in ms (default: 30 seconds) */
  pollInterval?: number;
  /** Download directory (default: ~/Downloads) */
  downloadDir?: string;
}

export interface WaitExportEmailResult {
  success: boolean;
  /** Path to downloaded ZIP file */
  downloadPath?: string;
  /** Email subject that matched */
  emailSubject?: string;
  /** Sender email address */
  sender?: string;
  /** Error message if failed */
  error?: string;
  /** Time spent waiting in ms */
  waitTimeMs?: number;
}

/**
 * Search queries for finding export emails
 */
export function getSearchQuery(source: ExportSource): string {
  switch (source) {
    case 'chatgpt':
      // OpenAI sends exports from help@openai.com with subject containing "export"
      return 'from:openai.com subject:export newer_than:1d';
    case 'claude':
      // Anthropic sends exports from support@anthropic.com
      return 'from:anthropic.com subject:export newer_than:1d';
    default:
      throw new Error(`Unknown export source: ${source}`);
  }
}

/**
 * Get Gmail search URL for export emails
 */
export function getGmailSearchUrl(source: ExportSource): string {
  const query = getSearchQuery(source);
  return GMAIL_SEARCH_BASE + encodeURIComponent(query);
}

/**
 * JavaScript to execute in Gmail to check for new export emails
 * Returns email info if found, null otherwise
 */
export function getCheckEmailScript(source: ExportSource): string {
  const senderPattern = source === 'chatgpt' ? 'openai.com' : 'anthropic.com';

  return `
    (function() {
      // Look for email rows in Gmail
      const emailRows = document.querySelectorAll('tr.zA');

      for (const row of emailRows) {
        const senderEl = row.querySelector('.yW span[email], .yW .bA4 span[email]');
        const subjectEl = row.querySelector('.bog, .y2');
        const dateEl = row.querySelector('.xW span[title], .xW span');

        if (!senderEl || !subjectEl) continue;

        const sender = senderEl.getAttribute('email') || senderEl.textContent || '';
        const subject = subjectEl.textContent || '';
        const date = dateEl?.getAttribute('title') || dateEl?.textContent || '';

        // Check if this is from the expected sender
        if (sender.toLowerCase().includes('${senderPattern}')) {
          // Check if subject contains export-related keywords
          const subjectLower = subject.toLowerCase();
          if (subjectLower.includes('export') ||
              subjectLower.includes('download') ||
              subjectLower.includes('data request') ||
              subjectLower.includes('your data')) {
            return JSON.stringify({
              found: true,
              sender: sender,
              subject: subject,
              date: date,
              rowIndex: Array.from(emailRows).indexOf(row)
            });
          }
        }
      }

      return JSON.stringify({ found: false });
    })()
  `;
}

/**
 * JavaScript to click on an email row by index
 */
export function getClickEmailScript(rowIndex: number): string {
  return `
    (function() {
      const emailRows = document.querySelectorAll('tr.zA');
      if (emailRows[${rowIndex}]) {
        emailRows[${rowIndex}].click();
        return JSON.stringify({ clicked: true });
      }
      return JSON.stringify({ clicked: false, error: 'Row not found' });
    })()
  `;
}

/**
 * JavaScript to extract download link from an open email
 * Looks for links to OpenAI/Anthropic download endpoints
 */
export function getExtractDownloadLinkScript(source: ExportSource): string {
  const linkPattern = source === 'chatgpt'
    ? 'openai.com'
    : 'anthropic.com';

  return `
    (function() {
      // Wait for email body to load
      const emailBody = document.querySelector('.a3s.aiL, .ii.gt');
      if (!emailBody) {
        return JSON.stringify({ found: false, error: 'Email body not loaded' });
      }

      // Find all links in the email
      const links = emailBody.querySelectorAll('a[href]');

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const text = link.textContent || '';

        // Look for download links
        // ChatGPT: Links to chatgpt.com or openai.com with download/export in URL
        // Claude: Links to anthropic.com or claude.ai with download/export
        if (href.includes('${linkPattern}') ||
            href.includes('download') ||
            href.includes('export')) {

          // Validate it looks like an actual download link
          const hrefLower = href.toLowerCase();
          const textLower = text.toLowerCase();

          if (hrefLower.includes('download') ||
              hrefLower.includes('export') ||
              hrefLower.includes('zip') ||
              textLower.includes('download') ||
              textLower.includes('export') ||
              textLower.includes('here')) {
            return JSON.stringify({
              found: true,
              downloadUrl: href,
              linkText: text.trim().slice(0, 100)
            });
          }
        }
      }

      // If no direct link found, look for any link in the email
      // that might be the download button
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const text = (link.textContent || '').toLowerCase();

        // Look for common download button text
        if (text.includes('download') ||
            text.includes('export') ||
            text.includes('get your data') ||
            text.includes('click here') ||
            text.includes('cliquez ici')) {
          return JSON.stringify({
            found: true,
            downloadUrl: href,
            linkText: text.trim().slice(0, 100)
          });
        }
      }

      return JSON.stringify({
        found: false,
        error: 'No download link found in email',
        linksChecked: links.length
      });
    })()
  `;
}

/**
 * Check if current page is Gmail inbox
 */
export function isGmailInbox(url: string): boolean {
  return url.includes('mail.google.com') &&
         (url.includes('#inbox') || url.includes('#search'));
}

/**
 * Check if current page is Gmail email view
 */
export function isGmailEmailView(url: string): boolean {
  return url.includes('mail.google.com') &&
         (url.includes('/m/') || !!url.match(/#[a-z]+\/[a-zA-Z0-9]+$/));
}

/**
 * Ensure download directory exists
 */
export function ensureDownloadDir(downloadDir: string = DEFAULT_DOWNLOAD_DIR): string {
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  return downloadDir;
}

/**
 * Generate expected filename pattern for downloads
 */
export function getExpectedFilenamePattern(source: ExportSource): RegExp {
  switch (source) {
    case 'chatgpt':
      // ChatGPT exports are typically named like:
      // conversations-2024-01-15.zip or chatgpt-export-*.zip
      return /^(conversations|chatgpt|export).*\.zip$/i;
    case 'claude':
      // Claude exports are typically named like:
      // claude-export-*.zip or anthropic-export-*.zip
      return /^(claude|anthropic|export).*\.zip$/i;
    default:
      return /\.zip$/i;
  }
}

/**
 * Wait for a file to appear in download directory
 */
export async function waitForDownloadFile(
  downloadDir: string,
  filenamePattern: RegExp,
  timeout: number = 60000
): Promise<string | null> {
  const startTime = Date.now();
  const checkInterval = 1000;

  while (Date.now() - startTime < timeout) {
    try {
      const files = fs.readdirSync(downloadDir);

      // Look for matching files
      for (const file of files) {
        if (filenamePattern.test(file)) {
          const filepath = path.join(downloadDir, file);
          const stats = fs.statSync(filepath);

          // Check if file was created recently (within last 5 minutes)
          if (Date.now() - stats.mtimeMs < 300000) {
            // Wait a bit to ensure download is complete
            await new Promise(r => setTimeout(r, 2000));

            // Verify file size is stable (download complete)
            const newStats = fs.statSync(filepath);
            if (newStats.size === stats.size && newStats.size > 0) {
              return filepath;
            }
          }
        }
      }
    } catch {
      // Ignore errors, continue polling
    }

    await new Promise(r => setTimeout(r, checkInterval));
  }

  return null;
}

export const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_POLL_INTERVAL = 30 * 1000; // 30 seconds
export const GMAIL_INBOX = GMAIL_INBOX_URL;
