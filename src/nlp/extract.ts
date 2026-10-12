import { generateJson } from "@/lib/gemini";
import { buildUserContent, SYSTEM_INSTRUCTION, type PromptEpisode } from "./prompt";
import { extractionJsonSchema, extractionSchema } from "./schema";
import { verifyExtraction, type VerifiedExtraction } from "./verify";

export type ExtractionResult = VerifiedExtraction & { inputTokens: number; outputTokens: number };

/** Episode text in, verified structured extraction out. No database access. */
export async function extractEpisode(ep: PromptEpisode): Promise<ExtractionResult> {
  const out = await generateJson({
    system: SYSTEM_INSTRUCTION,
    content: buildUserContent(ep),
    jsonSchema: extractionJsonSchema,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(out.text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${out.text.slice(0, 120)}`);
  }
  const validated = extractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Output failed schema validation: ${validated.error.issues[0].path.join(".")} ${validated.error.issues[0].message}`);
  }
  const verified = verifyExtraction(validated.data, ep.title, ep.description);
  return { ...verified, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
}
