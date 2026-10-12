import { z } from "zod";
import { EPISODE_TYPES, GUEST_CATEGORIES, SPONSOR_CLASSES, TOPICS } from "./taxonomy";

// Zod validates what Gemini returns. The hand-written JSON Schema below tells Gemini the shape
// to produce; Zod is the second line of defence if it ever drifts.
const confidence = z.number().min(0).max(1);

export const extractionSchema = z.object({
  episodeType: z.enum(EPISODE_TYPES),
  guests: z.array(
    z.object({
      name: z.string().min(1),
      role: z.string(),
      company: z.string(),
      category: z.enum(GUEST_CATEGORIES),
      confidence,
      evidence: z.string(),
    }),
  ),
  topics: z.array(z.object({ topic: z.enum(TOPICS), confidence })).max(6),
  sponsors: z.array(
    z.object({
      brand: z.string().min(1),
      category: z.string(),
      classification: z.enum(SPONSOR_CLASSES),
      selfPromotion: z.boolean(),
      evidence: z.string(),
      confidence,
    }),
  ),
});

export type Extraction = z.infer<typeof extractionSchema>;

export const extractionJsonSchema = {
  type: "object",
  properties: {
    episodeType: { type: "string", enum: [...EPISODE_TYPES] },
    guests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          company: { type: "string" },
          category: { type: "string", enum: [...GUEST_CATEGORIES] },
          confidence: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["name", "role", "company", "category", "confidence", "evidence"],
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: [...TOPICS] },
          confidence: { type: "number" },
        },
        required: ["topic", "confidence"],
      },
    },
    sponsors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          brand: { type: "string" },
          category: { type: "string" },
          classification: { type: "string", enum: [...SPONSOR_CLASSES] },
          selfPromotion: { type: "boolean" },
          evidence: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["brand", "category", "classification", "selfPromotion", "evidence", "confidence"],
      },
    },
  },
  required: ["episodeType", "guests", "topics", "sponsors"],
} as const;
