import { generateJson } from "@/lib/gemini";
import { condenseForPrompt, locateQuote, toPlainText, type Segment } from "@/transcripts/parse";
import { buildUserContent, buildUserContentWithTranscript, SYSTEM_INSTRUCTION, TRANSCRIPT_ADDENDUM, type PromptEpisode } from "./prompt";
import { extractionJsonSchema, extractionSchema } from "./schema";
import { verifyExtraction, type VerifiedExtraction } from "./verify";

export type Timestamps = { guests: Record<string, number>; sponsors: Record<string, number> };

export type ExtractionResult = VerifiedExtraction & {
  inputTokens: number;
  outputTokens: number;
  coverage: "metadata" | "transcript";
  /** Seconds into the audio where evidence was said, found by code in the transcript. Empty without a transcript. */
  timestamps: Timestamps;
};

/**
 * Episode text in, verified structured extraction out. No database access.
 * With a transcript the model reads it too, and evidence quotes are verified against it. Without one this is
 * exactly the metadata-only analysis, so every episode still gets analysed.
 */
export async function extractEpisode(ep: PromptEpisode, transcript?: Segment[] | null): Promise<ExtractionResult> {
  const useTranscript = Boolean(transcript && transcript.length > 0);
  const out = await generateJson({
    system: useTranscript ? `${SYSTEM_INSTRUCTION}\n\n${TRANSCRIPT_ADDENDUM}` : SYSTEM_INSTRUCTION,
    content: useTranscript ? buildUserContentWithTranscript(ep, condenseForPrompt(transcript!)) : buildUserContent(ep),
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

  // Quotes must appear in the description OR the transcript, whichever the model was shown.
  const text = useTranscript ? `${ep.description}\n${toPlainText(transcript!)}` : ep.description;
  const verified = verifyExtraction(validated.data, ep.title, text);

  const timestamps: Timestamps = { guests: {}, sponsors: {} };
  if (useTranscript) {
    for (const g of verified.extraction.guests) {
      const at = (g.evidence ? locateQuote(transcript!, g.evidence) : null) ?? locateQuote(transcript!, g.name, 1);
      if (at !== null) timestamps.guests[g.name] = at;
    }
    for (const s of verified.extraction.sponsors) {
      const at = s.evidence ? locateQuote(transcript!, s.evidence) : null;
      if (at !== null) timestamps.sponsors[s.brand] = at;
    }
  }
  return { ...verified, inputTokens: out.inputTokens, outputTokens: out.outputTokens, coverage: useTranscript ? "transcript" : "metadata", timestamps };
}
