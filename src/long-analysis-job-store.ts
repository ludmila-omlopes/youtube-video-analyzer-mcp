import { randomBytes } from "node:crypto";

import type { LongToolInput, LongToolOutput, ProgressUpdate } from "@ludylops/video-analysis-core";

export type LongAnalysisJobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type LongAnalysisJobError = {
  code: string;
  stage: string;
  message: string;
  retryable: boolean;
  causeMessage: string | null;
  details: Record<string, unknown> | null;
};

export type LongAnalysisJob = {
  jobId: string;
  status: LongAnalysisJobStatus;
  input: LongToolInput;
  controller: AbortController;
  progress: ProgressUpdate | null;
  result: LongToolOutput | null;
  error: LongAnalysisJobError | null;
  statusMessage: string | null;
  createdAt: string;
  updatedAt: string;
  ttl: number | null;
};

export class LongAnalysisJobStore {
  private readonly jobs = new Map<string, LongAnalysisJob>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  createJob(input: LongToolInput, ttl: number | null): LongAnalysisJob {
    const jobId = this.generateJobId();
    const now = new Date().toISOString();
    const job: LongAnalysisJob = {
      jobId,
      status: "queued",
      input,
      controller: new AbortController(),
      progress: null,
      result: null,
      error: null,
      statusMessage: null,
      createdAt: now,
      updatedAt: now,
      ttl,
    };

    this.jobs.set(jobId, job);
    this.scheduleCleanup(job);
    return job;
  }

  getJob(jobId: string): LongAnalysisJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  markRunning(jobId: string): void {
    this.updateJob(jobId, (job) => {
      if (job.status === "queued") {
        job.status = "running";
        job.statusMessage = "Long-video analysis is running.";
      }
    });
  }

  updateProgress(jobId: string, progress: ProgressUpdate): void {
    this.updateJob(jobId, (job) => {
      if (job.status === "queued" || job.status === "running") {
        job.status = "running";
        job.progress = progress;
        job.statusMessage = progress.message;
      }
    });
  }

  completeJob(jobId: string, result: LongToolOutput): void {
    this.updateJob(jobId, (job) => {
      if (this.isTerminal(job.status)) {
        return;
      }

      job.status = "done";
      job.result = result;
      job.statusMessage = "Long-video analysis completed.";
    });
  }

  failJob(jobId: string, error: LongAnalysisJobError): void {
    this.updateJob(jobId, (job) => {
      if (this.isTerminal(job.status)) {
        return;
      }

      job.status = "error";
      job.error = error;
      job.statusMessage = error.message;
    });
  }

  cancelJob(jobId: string, message = "Long-video analysis cancelled."): LongAnalysisJob | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    if (!this.isTerminal(job.status)) {
      job.controller.abort(message);
      job.status = "cancelled";
      job.statusMessage = message;
      job.updatedAt = new Date().toISOString();
      this.scheduleCleanup(job);
    }

    return job;
  }

  cleanup(): void {
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.jobs.clear();
  }

  private generateJobId(): string {
    let jobId = randomBytes(16).toString("hex");
    while (this.jobs.has(jobId)) {
      jobId = randomBytes(16).toString("hex");
    }
    return jobId;
  }

  private updateJob(jobId: string, update: (job: LongAnalysisJob) => void): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    update(job);
    job.updatedAt = new Date().toISOString();
    this.scheduleCleanup(job);
  }

  private scheduleCleanup(job: LongAnalysisJob): void {
    if (!job.ttl) {
      return;
    }

    const existingTimer = this.cleanupTimers.get(job.jobId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.jobs.delete(job.jobId);
      this.cleanupTimers.delete(job.jobId);
    }, job.ttl);
    timer.unref?.();
    this.cleanupTimers.set(job.jobId, timer);
  }

  private isTerminal(status: LongAnalysisJobStatus): boolean {
    return status === "done" || status === "error" || status === "cancelled";
  }
}
