"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isAdmin, requireAdmin } from "@/lib/admin";
import { FREQUENCIES, splitTerms } from "@/research/config";
import { approveCandidate, setCandidateStatus, type DecisionStatus } from "@/services/discovery-review";
import { runDiscovery, runFocused } from "@/services/jobs";
import { restoreVersion, saveConfig } from "@/services/research-settings";

export type FormState = { ok: boolean; message: string } | null;
const denied: FormState = { ok: false, message: "Admin login required" };

const num = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Turn the preferences form into a config and save it as a new version. Takes effect on the next job run. */
export async function savePreferences(_prev: FormState, fd: FormData): Promise<FormState> {
  if (!(await isAdmin())) return denied;
  const discoveryEffort = Math.round(Math.min(100, Math.max(0, num(fd.get("discoveryEffort"), 30))));
  const freq = z.enum(FREQUENCIES.map((f) => f.value) as [string, ...string[]]);
  const input = {
    modes: { focused: { enabled: fd.get("focusedEnabled") === "on" }, discovery: { enabled: fd.get("discoveryEnabled") === "on" } },
    effort: { focused: 100 - discoveryEffort, discovery: discoveryEffort },
    categories: fd.getAll("categories").map(String),
    keywords: splitTerms(String(fd.get("keywords") ?? "")),
    founders: splitTerms(String(fd.get("founders") ?? "")),
    companies: splitTerms(String(fd.get("companies") ?? "")),
    products: splitTerms(String(fd.get("products") ?? "")),
    excludedTopics: fd.getAll("excludedTopics").map(String),
    excludedKeywords: splitTerms(String(fd.get("excludedKeywords") ?? "")),
    priorityTopics: fd.getAll("priorityTopics").map(String),
    priorityPodcastIds: fd.getAll("priorityPodcastIds").map(Number),
    languages: fd.getAll("languages").map(String),
    markets: fd.getAll("markets").map(String),
    dateRangeDays: num(fd.get("dateRangeDays"), 90),
    frequency: { focused: freq.catch("daily").parse(fd.get("freqFocused")), discovery: freq.catch("weekly").parse(fd.get("freqDiscovery")) },
    quotaBudgetUnits: num(fd.get("quotaBudgetUnits"), 3000),
  };
  const note = String(fd.get("note") ?? "").trim().slice(0, 140) || undefined;
  const res = await saveConfig(input, note);
  if (!res.ok) return { ok: false, message: res.error };
  refresh();
  return { ok: true, message: res.changed ? `Saved as version ${res.version}. It applies from the next research run.` : `No changes: still version ${res.version}.` };
}

export async function restoreSettings(fd: FormData) {
  await requireAdmin();
  await restoreVersion(Number(fd.get("version")));
  refresh();
}

function summarise(job: string, r: { ok: boolean; detail: Record<string, unknown> }): FormState {
  const d = r.detail;
  if (!r.ok) return { ok: false, message: `${job} failed: ${String(d.error ?? "unknown error")}` };
  if (d.skipped) return { ok: true, message: `${job}: ${String(d.skipped)}.` };
  if (job === "Discovery") return { ok: true, message: `Discovery finished: ${d.feedsFetched ?? 0} feeds read, ${d.candidatesKept ?? 0} new candidates kept, ${d.episodesAnalysed ?? 0} episodes analysed, ${d.youtubeUnitsSpent ?? 0} YouTube units used.` };
  const ing = d.ingest as { newEpisodes?: number } | undefined;
  return { ok: true, message: `Focused research finished: ${ing?.newEpisodes ?? 0} new episodes, ${String(d.analysed ?? 0)} analysed.` };
}

export async function runFocusedNow(): Promise<FormState> {
  if (!(await isAdmin())) return denied;
  const r = await runFocused({ force: true });
  refresh();
  return summarise("Focused research", r);
}

export async function runDiscoveryNow(): Promise<FormState> {
  if (!(await isAdmin())) return denied;
  const r = await runDiscovery({ force: true });
  refresh();
  return summarise("Discovery", r);
}

/** Review-queue decisions. Approve is the only path that adds a discovered show to the watchlist. */
export async function reviewCandidate(_prev: FormState, fd: FormData): Promise<FormState> {
  if (!(await isAdmin())) return denied;
  const id = Number(fd.get("id"));
  const action = String(fd.get("action"));
  if (!Number.isInteger(id)) return { ok: false, message: "Invalid candidate" };
  const res =
    action === "approve"
      ? await approveCandidate(id)
      : await setCandidateStatus(id, ({ dismiss: "dismissed", saved: "saved", excluded: "excluded", new: "new" } as Record<string, DecisionStatus>)[action] ?? "new");
  refresh();
  return res.ok ? { ok: true, message: res.message } : { ok: false, message: res.error };
}
