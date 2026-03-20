import assert from "node:assert/strict";

import { DiagnosticError } from "../lib/errors.js";
import { generateStructuredJson } from "../lib/gemini.js";

const logger = {
  requestId: "test-request",
  tool: "test-tool",
  child: () => logger,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
  },
  required: ["summary"],
} as const;

export async function run(): Promise<void> {
  let successCalls = 0;
  const successAi = {
    models: {
      generateContent: async () => {
        successCalls += 1;
        return { text: '{"summary":"ok"}' };
      },
    },
  };

  const successResult = await generateStructuredJson(
    successAi as never,
    {
      model: "gemini-test",
      prompt: "Analyze",
      responseSchema: responseSchema as Record<string, unknown>,
    },
    {
      logger,
      tool: "test-tool",
      stage: "short_video_generate",
      code: "TEST_FAILED",
      failureMessage: "Structured generation failed.",
    }
  );

  assert.equal(successCalls, 1);
  assert.deepEqual(successResult, { summary: "ok" });

  let failureCalls = 0;
  const failureAi = {
    models: {
      generateContent: async () => {
        failureCalls += 1;
        return { text: '{"wrong":"shape"}' };
      },
    },
  };

  await assert.rejects(
    () =>
      generateStructuredJson(
        failureAi as never,
        {
          model: "gemini-test",
          prompt: "Analyze",
          responseSchema: responseSchema as Record<string, unknown>,
          allowTextJsonFallback: true,
        },
        {
          logger,
          tool: "test-tool",
          stage: "short_video_generate",
          code: "TEST_FAILED",
          failureMessage: "Structured generation failed.",
        }
      ),
    (error: unknown) => {
      assert.equal(failureCalls, 1);
      assert.ok(error instanceof DiagnosticError);
      assert.equal(error.details?.reason, "invalid_json_response");
      return true;
    }
  );
}
