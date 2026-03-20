import * as AjvModule from "ajv";
import * as AjvFormatsModule from "ajv-formats";

import type { ErrorObject } from "ajv";

import type { JsonObject } from "./types.js";

const AjvCtor = (((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as unknown) as new (
  options?: Record<string, unknown>
) => {
  compile: (schema: JsonObject) => {
    (value: unknown): boolean;
    errors?: ErrorObject[] | null;
  };
};

const addFormats = (((AjvFormatsModule as unknown as { default?: unknown }).default ?? AjvFormatsModule) as unknown) as (
  ajv: unknown
) => void;

const ajv = new AjvCtor({
  allErrors: true,
  strict: false,
  validateFormats: true,
});

addFormats(ajv);

export function validateJsonObjectAgainstSchema(schema: JsonObject, value: unknown): void {
  const validate = ajv.compile(schema);
  const valid = validate(value);
  if (valid) {
    return;
  }

  const details = (validate.errors ?? [])
    .map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? "schema validation error"}`.trim())
    .join("; ");

  throw new Error(`Gemini returned JSON that does not match the requested schema: ${details}`);
}
