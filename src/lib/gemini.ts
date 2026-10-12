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

/** L2-normalise: gemini-embedding-001 only returns unit-length vectors at full size, so truncated 768-d vectors are rescaled. */
export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Embed texts (batches of up to 100) as 768-dimension unit vectors, with backoff on rate limits. */
export async function embedTexts(texts: string[], taskType: "CLUSTERING" | "SEMANTIC_SIMILARITY" = "CLUSTERING"): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    let lastError: unknown;
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      try {
        const res = await ai().models.embedContent({ model: EMBEDDING_MODEL, contents: batch, config: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType } });
        const vectors = (res.embeddings ?? []).map((e) => normalizeVector(e.values ?? []));
        if (vectors.length !== batch.length) throw new Error(`Expected ${batch.length} embeddings, got ${vectors.length}`);
        out.push(...vectors);
        done = true;
      } catch (e) {
        lastError = e;
        if (!isRetryable(e)) throw e;
        await sleep(1500 * 2 ** attempt + Math.random() * 500);
      }
    }
    if (!done) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  return out;
}
