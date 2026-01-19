/**
 * Export Status Manager
 *
 * Provides real-time status tracking for long-running export operations.
 * Creates and updates ~/.hydraspecter/export-status.json during exports.
 *
 * Features:
 * - Real-time progress tracking
 * - Error collection
 * - Step-by-step status updates
 * - Automatic cleanup on completion
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HYDRASPECTER_DIR = path.join(os.homedir(), '.hydraspecter');
const STATUS_FILE = path.join(HYDRASPECTER_DIR, 'export-status.json');

/** Export sources */
export type ExportSource = 'chatgpt' | 'claude' | 'perplexity';

/** Possible export statuses */
export type ExportStatusValue =
  | 'starting'
  | 'waiting_email'
  | 'downloading'
  | 'extracting'
  | 'converting'
  | 'exporting'
  | 'completed'
  | 'failed';

/** Export progress tracking */
export interface ExportProgress {
  current: number;
  total: number;
}

/** Export status structure */
export interface ExportStatus {
  source: ExportSource;
  status: ExportStatusValue;
  progress: ExportProgress;
  startedAt: string;
  lastUpdate: string;
  currentStep: string;
  errors: string[];
}

/**
 * Ensure ~/.hydraspecter directory exists
 */
function ensureDir(): void {
  if (!fs.existsSync(HYDRASPECTER_DIR)) {
    fs.mkdirSync(HYDRASPECTER_DIR, { recursive: true });
  }
}

/**
 * Create a new export status file
 */
export function createExportStatus(source: ExportSource, initialStep: string = 'Initializing'): ExportStatus {
  ensureDir();

  const now = new Date().toISOString();
  const status: ExportStatus = {
    source,
    status: 'starting',
    progress: { current: 0, total: 0 },
    startedAt: now,
    lastUpdate: now,
    currentStep: initialStep,
    errors: [],
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
  console.error(`[ExportStatus] Created status file for ${source}: ${initialStep}`);

  return status;
}

/**
 * Update export status
 */
export function updateExportStatus(
  updates: Partial<Omit<ExportStatus, 'source' | 'startedAt'>>
): ExportStatus | null {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      console.error('[ExportStatus] No status file found to update');
      return null;
    }

    const current = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) as ExportStatus;
    const updated: ExportStatus = {
      ...current,
      ...updates,
      lastUpdate: new Date().toISOString(),
    };

    // Preserve source and startedAt from original
    updated.source = current.source;
    updated.startedAt = current.startedAt;

    fs.writeFileSync(STATUS_FILE, JSON.stringify(updated, null, 2), 'utf-8');

    if (updates.currentStep) {
      console.error(`[ExportStatus] ${current.source}: ${updates.currentStep}`);
    }

    return updated;
  } catch (error) {
    console.error(`[ExportStatus] Failed to update status: ${error}`);
    return null;
  }
}

/**
 * Update progress only
 */
export function updateExportProgress(current: number, total: number): ExportStatus | null {
  return updateExportStatus({
    progress: { current, total },
  });
}

/**
 * Add an error to the status
 */
export function addExportError(error: string): ExportStatus | null {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      console.error('[ExportStatus] No status file found');
      return null;
    }

    const current = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) as ExportStatus;
    current.errors.push(error);
    current.lastUpdate = new Date().toISOString();

    fs.writeFileSync(STATUS_FILE, JSON.stringify(current, null, 2), 'utf-8');
    console.error(`[ExportStatus] Error added: ${error}`);

    return current;
  } catch (err) {
    console.error(`[ExportStatus] Failed to add error: ${err}`);
    return null;
  }
}

/**
 * Mark export as completed and keep the file (status: completed)
 */
export function completeExportStatus(): ExportStatus | null {
  const status = updateExportStatus({
    status: 'completed',
    currentStep: 'Export completed successfully',
  });

  if (status) {
    console.error(`[ExportStatus] ${status.source} export completed in ${getElapsedTime(status)}ms`);
  }

  return status;
}

/**
 * Mark export as failed
 */
export function failExportStatus(error: string): ExportStatus | null {
  addExportError(error);
  const status = updateExportStatus({
    status: 'failed',
    currentStep: `Failed: ${error}`,
  });

  if (status) {
    console.error(`[ExportStatus] ${status.source} export failed: ${error}`);
  }

  return status;
}

/**
 * Delete the status file (cleanup)
 */
export function deleteExportStatus(): void {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE);
      console.error('[ExportStatus] Status file deleted');
    }
  } catch (error) {
    console.error(`[ExportStatus] Failed to delete status file: ${error}`);
  }
}

/**
 * Read current export status
 */
export function readExportStatus(): ExportStatus | null {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) as ExportStatus;
  } catch (error) {
    console.error(`[ExportStatus] Failed to read status: ${error}`);
    return null;
  }
}

/**
 * Check if an export is currently in progress
 */
export function isExportInProgress(): boolean {
  const status = readExportStatus();
  if (!status) return false;

  return !['completed', 'failed'].includes(status.status);
}

/**
 * Get elapsed time since export started
 */
export function getElapsedTime(status: ExportStatus): number {
  const started = new Date(status.startedAt).getTime();
  return Date.now() - started;
}

/**
 * Get status file path (for documentation)
 */
export function getStatusFilePath(): string {
  return STATUS_FILE;
}
