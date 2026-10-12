"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { saveRubric, scoreOpportunities } from "@/services/intelligence";

export type RubricState = { ok: boolean; message: string } | null;

export async function saveRubricAction(kind: "guest" | "sponsor", _prev: RubricState, formData: FormData): Promise<RubricState> {
  await requireAdmin();
  const input: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (k !== "note") input[k] = Number(v) / 100; // the form shows percentages
  const row = await saveRubric(kind, input, String(formData.get("note") ?? ""));
  if (!row) return { ok: false, message: "Each weight must be between 0 and 100, and at least one must be above 0." };
  await scoreOpportunities();
  refresh();
  return { ok: true, message: `Saved as rubric version ${row.id} and every score was recalculated.` };
}
