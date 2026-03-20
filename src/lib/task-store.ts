import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental";
import type { Result } from "@modelcontextprotocol/sdk/types.js";

export class ManagedTaskStore extends InMemoryTaskStore {
  private readonly controllers = new Map<string, AbortController>();

  registerAbortController(taskId: string, controller: AbortController): void {
    this.controllers.set(taskId, controller);
  }

  releaseAbortController(taskId: string): void {
    this.controllers.delete(taskId);
  }

  override async storeTaskResult(taskId: string, status: "completed" | "failed", result: Result): Promise<void> {
    this.releaseAbortController(taskId);
    await super.storeTaskResult(taskId, status, result);
  }

  override async updateTaskStatus(
    taskId: string,
    status: "working" | "input_required" | "completed" | "failed" | "cancelled",
    statusMessage?: string
  ): Promise<void> {
    if (status === "cancelled") {
      this.controllers.get(taskId)?.abort(statusMessage || "Task cancelled.");
      this.releaseAbortController(taskId);
    }

    await super.updateTaskStatus(taskId, status, statusMessage);
  }
}

