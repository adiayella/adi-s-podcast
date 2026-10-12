import type { BriefStats } from "./brief-stats";
import type { Narrative } from "./brief-narrative";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const dateIST = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export type BriefDoc = { subject: string; title: string; sections: { heading: string; blocks: Block[] }[] };
type Block = { kind: "p"; text: string; muted?: boolean } | { kind: "item"; title: string; meta: string; body?: string[]; links?: { label: string; url: string }[] };

/** One structured document, rendered to markdown (stored), HTML (email) and plain text. */
export function buildBriefDoc(stats: BriefStats, narrative: Narrative | null): BriefDoc {
  const guestNote = new Map((narrative?.guestNotes ?? []).map((n) => [n.name, n]));
  const topicNote = new Map((narrative?.topicAngles ?? []).map((n) => [n.topic, n]));
  const sponsorNote = new Map((narrative?.sponsorNotes ?? []).map((n) => [n.brand, n]));
  const week = new Date(`${stats.weekStart}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

  const intro: Block[] = [];
  if (narrative?.summary) intro.push({ kind: "p", text: narrative.summary });
  else if (!narrative) intro.push({ kind: "p", text: "AI commentary was unavailable this week. Everything below is computed directly from the data.", muted: true });
  if (stats.health.syncErrors > 0 || stats.health.episodesLast7Days === 0)
    intro.push({ kind: "p", muted: true, text: `Data note: ${plural(stats.health.episodesLast7Days, "new episode")} in the last 7 days${stats.health.syncErrors ? `, ${plural(stats.health.syncErrors, "feed")} failed to sync` : ""}. Treat counts with care.` });

  const guestBlocks: Block[] = [];
  if (!stats.guestEvidence.sufficient)
    guestBlocks.push({ kind: "p", muted: true, text: `Thin evidence: none of the ${stats.guestEvidence.guestsInWindow} guests seen in the last ${stats.guestEvidence.windowDays} days appeared on more than one monitored show. These are the most recent guests, not confirmed media-round signals.` });
  else guestBlocks.push({ kind: "p", muted: true, text: `${plural(stats.guestEvidence.onMultipleShows, "guest")} appeared on 2+ shows in the last ${stats.guestEvidence.windowDays} days.` });
  for (const g of stats.guests) {
    const n = guestNote.get(g.name);
    guestBlocks.push({
      kind: "item",
      title: g.name,
      meta: `${[g.role, g.company].filter(Boolean).join(", ") || "role not stated"} · ${plural(g.distinctPodcasts, "show")} (${g.podcasts.join(", ")}) · ${plural(g.appearances, "appearance")} · latest ${dateIST(g.lastAt)} · activity score ${g.score}${g.newThisWeek ? " · new to the radar this week" : ""}`,
      body: n ? [n.why, `Tip: ${n.tip}`] : undefined,
      links: g.episodes.filter((e) => e.url).map((e) => ({ label: e.title, url: e.url! })),
    });
  }
  if (!stats.guests.length) guestBlocks.push({ kind: "p", text: "No guests found in the last 30 days." });

  const topicBlocks: Block[] = [];
  for (const t of stats.topics.slice(0, 5)) {
    const n = topicNote.get(t.name);
    const change = t.trend === "new" ? "new this week" : `${t.episodesThisWeek} episodes this week vs ${t.episodesPrevWeek} last week (${t.trend})`;
    topicBlocks.push({
      kind: "item",
      title: `${t.name}${n ? ` (${n.stance === "ride" ? "ride the wave" : "counter-programme"})` : ""}`,
      meta: `${plural(t.shows, "show")} · ${change} · momentum score ${t.score}`,
      body: n ? n.angles.map((a) => `Angle: ${a}`) : undefined,
      links: t.sampleEpisodes.filter((e) => e.url).slice(0, 2).map((e) => ({ label: `${e.podcast}: ${e.title}`, url: e.url! })),
    });
  }
  if (!topicBlocks.length) topicBlocks.push({ kind: "p", text: "No topic was covered by two or more shows recently.", muted: true });

  const sponsorBlocks: Block[] = [];
  if (!stats.sponsorEvidence.sufficient)
    sponsorBlocks.push({ kind: "p", muted: true, text: `Thin evidence: no brand was disclosed as a sponsor in the last ${stats.sponsorEvidence.windowDays} days. The leads below are unverified promotional mentions (links or codes), not confirmed sponsors.` });
  else sponsorBlocks.push({ kind: "p", muted: true, text: `${plural(stats.sponsorEvidence.disclosedBrands, "brand")} disclosed as sponsors; ${plural(stats.sponsorEvidence.promoBrands, "brand")} with unverified promotions. Advertising spend is unknown.` });
  for (const s of stats.sponsors) {
    const n = sponsorNote.get(s.name);
    const evidence = s.disclosedEpisodes > 0 ? `disclosed on ${plural(s.disclosedEpisodes, "episode")} across ${plural(s.disclosedShows, "show")}` : `${plural(s.promoEpisodes, "promotional mention")}, none disclosed as sponsorship`;
    sponsorBlocks.push({
      kind: "item",
      title: `${s.name}${s.category ? ` (${s.category})` : ""}`,
      meta: `Tier ${s.tier} · ${evidence}${s.platformFlaggedEpisodes ? ` · YouTube marks ${plural(s.platformFlaggedEpisodes, "video")} as paid placement` : ""} · latest ${dateIST(s.lastAt)}`,
      body: [...(s.evidenceQuote ? [`Evidence: “${s.evidenceQuote}”`] : []), ...(n ? [n.why, `Pitch: ${n.pitch}`] : [])],
      links: s.evidenceEpisode?.url ? [{ label: `${s.evidenceEpisode.podcast}: ${s.evidenceEpisode.title}`, url: s.evidenceEpisode.url }] : [],
    });
  }
  if (!stats.sponsors.length) sponsorBlocks.push({ kind: "p", text: "No promotional evidence found in the last 90 days." });

  const actions: Block[] = narrative?.actions.length
    ? narrative.actions.map((a) => ({ kind: "p" as const, text: a }))
    : [{ kind: "p", muted: true, text: "No AI-written actions this week. Use the ranked lists above: contact the top guests, plan around the top topics, and verify the sponsor leads before pitching." }];

  return {
    subject: `Monday brief: week of ${week}`,
    title: `Monday Intelligence Brief · week of ${week}`,
    sections: [
      ...(intro.length ? [{ heading: "This week", blocks: intro }] : []),
      { heading: "Guest opportunities", blocks: guestBlocks },
      { heading: "Trending topics", blocks: topicBlocks },
      { heading: "Sponsor opportunities", blocks: sponsorBlocks },
      { heading: "Recommended actions", blocks: actions },
    ],
  };
}

export function toMarkdown(doc: BriefDoc): string {
  const out = [`# ${doc.title}`];
  for (const s of doc.sections) {
    out.push(`\n## ${s.heading}\n`);
    for (const b of s.blocks) {
      if (b.kind === "p") out.push(b.muted ? `_${b.text}_\n` : `${b.text}\n`);
      else {
        out.push(`### ${b.title}\n${b.meta}\n`);
        for (const line of b.body ?? []) out.push(`- ${line}`);
        for (const l of b.links ?? []) out.push(`- [${l.label}](${l.url})`);
        out.push("");
      }
    }
  }
  return out.join("\n");
}

export function toText(doc: BriefDoc): string {
  return toMarkdown(doc).replace(/^#+ /gm, "").replace(/_/g, "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

/** Email-safe HTML: inline styles, every dynamic string escaped (episode text is untrusted). */
export function toHtml(doc: BriefDoc, dashboardUrl?: string): string {
  const parts: string[] = [];
  for (const s of doc.sections) {
    parts.push(`<h2 style="font-size:18px;margin:28px 0 10px;color:#1b2140;border-bottom:1px solid #e3e6f2;padding-bottom:6px">${esc(s.heading)}</h2>`);
    for (const b of s.blocks) {
      if (b.kind === "p") parts.push(`<p style="margin:8px 0;font-size:15px;line-height:1.55;color:${b.muted ? "#6b7390" : "#2a3050"}">${esc(b.text)}</p>`);
      else {
        parts.push(`<div style="margin:14px 0;padding:12px 14px;background:#f5f6fc;border-radius:10px"><div style="font-size:16px;font-weight:600;color:#1b2140">${esc(b.title)}</div><div style="font-size:13px;color:#6b7390;margin-top:3px">${esc(b.meta)}</div>`);
        for (const line of b.body ?? []) parts.push(`<div style="font-size:14px;line-height:1.5;color:#2a3050;margin-top:6px">${esc(line)}</div>`);
        for (const l of b.links ?? []) {
          if (/^https?:\/\//i.test(l.url)) parts.push(`<div style="font-size:13px;margin-top:6px"><a href="${esc(l.url)}" style="color:#4a56d6">${esc(l.label)}</a></div>`);
        }
        parts.push("</div>");
      }
    }
  }
  return `<!doctype html><html><body style="margin:0;background:#eceef8;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;padding:28px 26px"><h1 style="font-size:22px;margin:0 0 4px;color:#1b2140">${esc(doc.title)}</h1><p style="margin:0;font-size:13px;color:#6b7390">Podcast Ecosystem Radar</p>${parts.join("")}${dashboardUrl ? `<p style="margin:28px 0 0;font-size:13px"><a href="${esc(dashboardUrl)}" style="color:#4a56d6">Open the dashboard</a></p>` : ""}<p style="margin:18px 0 0;font-size:12px;color:#8a91ab">Counts come from the database. AI commentary is limited to the facts shown.</p></div></body></html>`;
}
