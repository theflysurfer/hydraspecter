/**
 * Job Manager for HydraSpecter
 *
 * Handles background/async operations that may exceed MCP timeout limits.
 * Implements the Async Job Pattern recommended for long-running MCP tools.
 *
 * Usage:
 * 1. Start a job: jobManager.createJob('browser_create', async () => { ... })
 * 2. Query status: jobManager.getJob(jobId)
 * 3. Cancel if needed: jobManager.cancelJob(jobId)
 */

import { v4 as uuidv4 } from 'uuid';

/** Job status states */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Job result structure */
export interface Job<T = any> {
  id: string;
  type: string;
  status: JobStatus;
  progress?: string;
  progressPercent?: number;
  result?: T;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

/** Job creation options */
export interface CreateJobOptions {
  metadata?: Record<string, any>;
  onProgress?: (progress: string, percent?: number) => void;
}

/**
 * Job Manager - Singleton
 *
 * Manages background tasks that would otherwise timeout in MCP.
 */
export class JobManager {
  private jobs: Map<string, Job> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  // Cleanup old completed jobs after 1 hour
  private readonly JOB_RETENTION_MS = 60 * 60 * 1000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupOldJobs(), 5 * 60 * 1000);
  }

  /**
   * Create and start a background job
   * Returns immediately with job ID - actual work runs in background
   */
  createJob<T>(
    type: string,
    executor: (signal: AbortSignal, reportProgress: (msg: string, percent?: number) => void) => Promise<T>,
    options: CreateJobOptions = {}
  ): Job<T> {
    const id = uuidv4();
    const abortController = new AbortController();

    const job: Job<T> = {
      id,
      type,
      status: 'pending',
      createdAt: new Date(),
      metadata: options.metadata,
    };

    this.jobs.set(id, job);
    this.abortControllers.set(id, abortController);

    // Report progress helper
    const reportProgress = (msg: string, percent?: number) => {
      const currentJob = this.jobs.get(id);
      if (currentJob && currentJob.status === 'running') {
        currentJob.progress = msg;
        currentJob.progressPercent = percent;
        options.onProgress?.(msg, percent);
      }
    };

    // Start execution in background (non-blocking)
    setImmediate(async () => {
      const currentJob = this.jobs.get(id);
      if (!currentJob) return;

      currentJob.status = 'running';
      currentJob.startedAt = new Date();
      currentJob.progress = 'Starting...';

      try {
        const result = await executor(abortController.signal, reportProgress);

        // Check if job was cancelled during execution
        if (abortController.signal.aborted) {
          currentJob.status = 'cancelled';
          currentJob.completedAt = new Date();
          return;
        }

        currentJob.status = 'completed';
        currentJob.result = result;
        currentJob.completedAt = new Date();
        currentJob.progress = 'Completed';
        currentJob.progressPercent = 100;

        console.error(`[JobManager] Job ${id} completed successfully`);
      } catch (error) {
        if (abortController.signal.aborted) {
          currentJob.status = 'cancelled';
        } else {
          currentJob.status = 'failed';
          currentJob.error = error instanceof Error ? error.message : String(error);
          console.error(`[JobManager] Job ${id} failed:`, currentJob.error);
        }
        currentJob.completedAt = new Date();
      } finally {
        this.abortControllers.delete(id);
      }
    });

    console.error(`[JobManager] Created job ${id} of type ${type}`);
    return job;
  }

  /**
   * Get job status and result
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs, optionally filtered by status
   */
  listJobs(filter?: { status?: JobStatus; type?: string }): Job[] {
    let jobs = Array.from(this.jobs.values());

    if (filter?.status) {
      jobs = jobs.filter(j => j.status === filter.status);
    }
    if (filter?.type) {
      jobs = jobs.filter(j => j.type === filter.type);
    }

    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    const controller = this.abortControllers.get(jobId);

    if (!job) return false;

    if (job.status === 'pending' || job.status === 'running') {
      controller?.abort();
      job.status = 'cancelled';
      job.completedAt = new Date();
      console.error(`[JobManager] Job ${jobId} cancelled`);
      return true;
    }

    return false;
  }

  /**
   * Wait for a job to complete (with timeout)
   * Useful for polling pattern
   */
  async waitForJob(jobId: string, timeoutMs: number = 30000): Promise<Job | undefined> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const job = this.jobs.get(jobId);

      if (!job) return undefined;

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return job;
      }

      // Poll every 500ms
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Return current state on timeout
    return this.jobs.get(jobId);
  }

  /**
   * Clean up old completed jobs
   */
  private cleanupOldJobs(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, job] of this.jobs) {
      if (
        (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
        job.completedAt &&
        now - job.completedAt.getTime() > this.JOB_RETENTION_MS
      ) {
        this.jobs.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.error(`[JobManager] Cleaned up ${cleaned} old jobs`);
    }
  }

  /**
   * Shutdown - cancel all pending jobs and cleanup
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cancel all running jobs
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      const job = this.jobs.get(id);
      if (job) {
        job.status = 'cancelled';
        job.completedAt = new Date();
      }
    }

    this.abortControllers.clear();
  }
}

// Singleton instance
let instance: JobManager | null = null;

export function getJobManager(): JobManager {
  if (!instance) {
    instance = new JobManager();
  }
  return instance;
}
