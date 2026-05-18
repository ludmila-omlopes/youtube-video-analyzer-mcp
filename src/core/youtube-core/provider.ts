import type { GoogleGenAI } from "@google/genai";

export type AiClient = GoogleGenAI;
export type AiClientFactory = () => GoogleGenAI;

export {
  GEMINI_DEFAULT_TIMEOUTS,
  createAiClient as createDefaultAiClient,
  createAiClientWithApiKey,
} from "../lib/gemini.js";
