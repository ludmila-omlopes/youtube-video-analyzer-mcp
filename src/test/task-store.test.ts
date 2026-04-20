import assert from "node:assert/strict";

import { ManagedTaskStore } from "../task-store.js";

export async function run(): Promise<void> {
  const cancelledStore = new ManagedTaskStore();
  const cancelledController = new AbortController();
  const cancelledTask = await cancelledStore.createTask(
    { ttl: 60_000 },
    "request-1",
    {
      method: "tools/call",
      params: { name: "test", arguments: {} },
    } as never
  );

  cancelledStore.registerAbortController(cancelledTask.taskId, cancelledController);
  await cancelledStore.updateTaskStatus(cancelledTask.taskId, "cancelled", "Cancelled by test");
  assert.equal(cancelledController.signal.aborted, true);

  const completedStore = new ManagedTaskStore();
  const completedController = new AbortController();
  const completedTask = await completedStore.createTask(
    { ttl: 60_000 },
    "request-2",
    {
      method: "tools/call",
      params: { name: "test", arguments: {} },
    } as never
  );

  completedStore.registerAbortController(completedTask.taskId, completedController);
  await completedStore.storeTaskResult(completedTask.taskId, "completed", {
    content: [{ type: "text", text: "done" }],
  });

  await assert.rejects(() => completedStore.updateTaskStatus(completedTask.taskId, "cancelled", "too late"));
  assert.equal(completedController.signal.aborted, false);
}
