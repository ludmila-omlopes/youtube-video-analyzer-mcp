export type ErrorStage =
  | "config"
  | "metadata"
  | "download"
  | "upload"
  | "file_processing"
  | "token_budget"
  | "cache_create"
  | "short_video_generate"
  | "single_pass_generate"
  | "chunk_generate"
  | "chunk_synthesis"
  | "follow_up_generate"
  | "unknown";

export type DiagnosticErrorOptions = {
  tool: string;
  code: string;
  stage: ErrorStage;
  message: string;
  retryable: boolean;
  strategyRequested?: string;
  strategyAttempted?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
};

export class DiagnosticError extends Error {
  readonly tool: string;
  readonly code: string;
  readonly stage: ErrorStage;
  readonly retryable: boolean;
  readonly strategyRequested?: string;
  readonly strategyAttempted?: string;
  readonly causeMessage?: string;
  readonly details?: Record<string, unknown>;

  constructor(options: DiagnosticErrorOptions) {
    super(options.message);
    this.name = "DiagnosticError";
    this.tool = options.tool;
    this.code = options.code;
    this.stage = options.stage;
    this.retryable = options.retryable;
    this.strategyRequested = options.strategyRequested;
    this.strategyAttempted = options.strategyAttempted;
    this.causeMessage = sanitizeErrorMessage(options.cause);
    this.details = options.details;
  }
}

export function sanitizeErrorMessage(error: unknown): string | undefined {
  if (error instanceof DiagnosticError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === undefined || error === null) {
    return undefined;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return error.name === "AbortError" || message.includes("aborted") || message.includes("cancelled");
  }

  return typeof error === "string" && /(aborted|cancelled)/i.test(error);
}

export function isTimeoutError(error: unknown): boolean {
  const message = sanitizeErrorMessage(error)?.toLowerCase() ?? "";
  return message.includes("timeout") || message.includes("timed out");
}

export function isRetryableError(error: unknown): boolean {
  const message = sanitizeErrorMessage(error)?.toLowerCase() ?? "";
  if (isAbortError(error)) {
    return false;
  }

  return [
    "fetch failed",
    "timeout",
    "timed out",
    "temporarily unavailable",
    "internal",
    "\"status\":\"internal\"",
    "\"code\":500",
    "\"code\":503",
    "503",
    "500",
    "econnreset",
    "etimedout",
    "socket hang up",
    "network",
    "service unavailable",
  ].some((token) => message.includes(token));
}

export function asDiagnosticError(
  error: unknown,
  fallback: Omit<DiagnosticErrorOptions, "cause" | "retryable"> & { retryable?: boolean }
): DiagnosticError {
  if (error instanceof DiagnosticError) {
    return error;
  }

  return new DiagnosticError({
    ...fallback,
    retryable: fallback.retryable ?? isRetryableError(error),
    cause: error,
  });
}
