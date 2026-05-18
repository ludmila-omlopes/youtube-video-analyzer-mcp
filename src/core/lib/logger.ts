import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type Logger = {
  requestId: string;
  tool: string;
  child(bindings: LogContext): Logger;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
};

function emit(level: LogLevel, tool: string, requestId: string, bindings: LogContext, event: string, context: LogContext) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    tool,
    requestId,
    event,
    ...bindings,
    ...context,
  };

  console.error(JSON.stringify(payload));
}

function createBoundLogger(tool: string, requestId: string, bindings: LogContext): Logger {
  return {
    requestId,
    tool,
    child(extraBindings: LogContext) {
      return createBoundLogger(tool, requestId, { ...bindings, ...extraBindings });
    },
    info(event: string, context: LogContext = {}) {
      emit("info", tool, requestId, bindings, event, context);
    },
    warn(event: string, context: LogContext = {}) {
      emit("warn", tool, requestId, bindings, event, context);
    },
    error(event: string, context: LogContext = {}) {
      emit("error", tool, requestId, bindings, event, context);
    },
  };
}

export function createRequestLogger(tool: string, requestId = randomUUID()): Logger {
  return createBoundLogger(tool, requestId, {});
}
