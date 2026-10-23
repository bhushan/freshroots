import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { jsonSchemaFor } from "./schema";
import type { AiDeps, Generator } from "./service";

/** Documented in README; confirmed as a free-tier model on the official pricing page. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Hard ceiling on generated tokens. Answers use roughly 300 to 400. Gemini counts hidden reasoning
 * toward this cap, so reasoning is set to LOW (MINIMAL is rejected by this model); at the default
 * level a 700-token cap was consumed by reasoning and the JSON came back truncated.
 */
const MAX_OUTPUT_TOKENS = 1200;

function createGenerator(apiKey: string, model: string, timeoutMs: number): Generator {
  const ai = new GoogleGenAI({ apiKey });
  return async (req, signal) => {
    const res = await ai.models.generateContent({
      model,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchemaFor(req.kind),
        abortSignal: signal,
        httpOptions: { timeout: timeoutMs },
      },
    });
    return {
      text: res.text ?? "",
      inputTokens: res.usageMetadata?.promptTokenCount,
      outputTokens: res.usageMetadata?.candidatesTokenCount,
    };
  };
}

const intFromEnv = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * Reads AI settings from the environment (server only). The key never reaches the browser.
 * The model is exactly GEMINI_MODEL; there is deliberately no fallback to any other model.
 */
export function aiDepsFromEnv(env: NodeJS.ProcessEnv = process.env): AiDeps {
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const timeoutMs = intFromEnv(env.AI_TIMEOUT_MS, 20_000);
  const apiKey = env.GEMINI_API_KEY?.trim();
  return {
    generate: apiKey ? createGenerator(apiKey, model, timeoutMs) : null,
    model,
    timeoutMs,
    limits: {
      perMinute: intFromEnv(env.AI_MAX_REQUESTS_PER_MINUTE, 4),
      perDay: intFromEnv(env.AI_MAX_REQUESTS_PER_DAY, 40),
    },
  };
}
