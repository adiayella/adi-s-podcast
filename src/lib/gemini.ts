import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return (client ??= new GoogleGenAI({ apiKey }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  return status === 429 || status === 500 || status === 503 || /429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded/i.test(msg);
}

export type JsonResult = { text: string; inputTokens: number; outputTokens: number };

/** One structured-output call to Gemini Flash, with exponential backoff on rate limits. */
export async function generateJson(opts: {
  system: string;
  content: string;
  jsonSchema: unknown;
}): Promise<JsonResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await ai().models.generateContent({
        model: GEMINI_MODEL,
        contents: opts.content,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: opts.jsonSchema,
          temperature: 0,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      if (!res.text) throw new Error(`Empty response (finish: ${res.candidates?.[0]?.finishReason ?? "unknown"})`);
      return {
        text: res.text,
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } catch (e) {
      lastError = e;
      if (!isRetryable(e)) break;
      await sleep(1500 * 2 ** attempt + Math.random() * 500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
