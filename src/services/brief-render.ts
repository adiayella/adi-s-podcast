import type { BriefStats } from "./brief-stats";
import type { Narrative } from "./brief-narrative";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const dateIST = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
/** "5 Oct to 11 Oct 2026" from the instant the reported week began (Monday 00:00 IST). */
const periodShort = (fromIso: string) => {
  const from = new Date(fromIso);
  const to = new Date(from.getTime() + 6 * 86_400_000);
  const f = (d: Date, y: boolean) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(y ? { year: "numeric" } : {}), timeZone: "Asia/Kolkata" });
  return `${f(from, false)} to ${f(to, true)}`;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type Block = { kind: "p"; text: string; muted?: boolean } | { kind: "item"; title: string; meta: string; body?: string[]; links?: { label: string; url: string }[] };
export type Section = { group?: string; groupNote?: string; heading: string; blocks: Block[] };
export type BriefDoc = { subject: string; title: string; sections: Section[] };

const CLASS_LABEL: Record<string, string> = { explicit_sponsor: "explicit sponsor", paid_promotion: "paid promotion", possible_affiliate: "promo link or code (unverified)", unknown: "unclear promotion (unverified)" };

/** One structured document, rendered to markdown (stored), HTML (email) and plain text. */
export function buildBriefDoc(stats: BriefStats, narrative: Narrative | null): BriefDoc {
  const guestNote = new Map((narrative?.guestNotes ?? []).map((n) => [n.name, n]));
  const topicNote = new Map((narrative?.topicAngles ?? []).map((n) => [n.topic, n]));
  const sponsorNote = new Map((narrative?.sponsorNotes ?? []).map((n) => [n.brand, n]));
  const unexpectedNote = new Map((narrative?.unexpectedNotes ?? []).map((n) => [n.topic, n]));
  const discoveryNote = new Map((narrative?.discoveryNotes ?? []).map((n) => [n.podcast, n]));
  const week = new Date(`${stats.weekStart}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

  const universe = stats.focus?.universe ?? "your monitored podcasts";
  const focusGroup = stats.focus || stats.discovery ? "Focused Intelligence" : undefined;
  const focusNote = stats.focus
    ? `Source: ${universe}. Ranked with your research settings (version ${stats.focus.settingsVersion})${stats.focus.interests.length ? `, prioritising ${stats.focus.interests.slice(0, 4).join(", ")}` : ""}${stats.focus.excludedEpisodes ? `; ${plural(stats.focus.excludedEpisodes, "episode")} excluded` : ""}.`
    : undefined;

  const intro: Block[] = [];
  const a = stats.activity;
  if (stats.period && a) {
    const delta = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? "no change" : "up from 0") : `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%`);
    intro.push({ kind: "p", muted: true, text: `Reporting period: ${stats.period.label} (Monday to Sunday, IST), compared with ${stats.period.previousLabel}. Monitored shows published ${plural(a.episodes, "episode")} across ${plural(a.shows, "show")} (${delta(a.episodes, a.previousEpisodes)} vs ${a.previousEpisodes}); ${plural(a.newGuests, "guest")} first appeared on the radar (${a.previousNewGuests} the week before).` });
  }
  for (const note of stats.dataNotes ?? []) intro.push({ kind: "p", muted: true, text: `Data note: ${note}` });
  if (narrative?.summary) intro.push({ kind: "p", text: narrative.summary });
  else if (!narrative) intro.push({ kind: "p", text: "AI commentary was unavailable this week. Everything below is computed directly from the data.", muted: true });
  if (stats.coverage && stats.coverage.total > 0)
    intro.push({ kind: "p", muted: true, text: `Analysis depth: ${stats.coverage.transcript} of ${stats.coverage.total} monitored episodes (${Math.round((stats.coverage.transcript / stats.coverage.total) * 100)}%) were analysed from a transcript; the rest from titles and descriptions only.` });
  if (stats.health.syncErrors > 0 || stats.health.episodesLast7Days === 0)
    intro.push({ kind: "p", muted: true, text: `Data note: ${plural(stats.health.episodesLast7Days, "new episode")} in the last 7 days${stats.health.syncErrors ? `, ${plural(stats.health.syncErrors, "feed")} failed to sync` : ""}. Treat counts with care.` });

  // ---------------------------------------------------------------- focused: guests
  const guestBlocks: Block[] = [];
  if (!stats.guestEvidence.sufficient)
    guestBlocks.push({ kind: "p", muted: true, text: `Thin evidence: none of the ${stats.guestEvidence.guestsInWindow} guests seen in the last ${stats.guestEvidence.windowDays} days appeared on more than one monitored show. These are the most recent guests, not confirmed media-round signals.` });
  else guestBlocks.push({ kind: "p", muted: true, text: `${plural(stats.guestEvidence.onMultipleShows, "guest")} appeared on 2+ monitored shows in the last ${stats.guestEvidence.windowDays} days.` });
  for (const g of stats.guests) {
    const n = guestNote.get(g.name);
    guestBlocks.push({
      kind: "item",
      title: g.name,
      meta: `${[g.role, g.company].filter(Boolean).join(", ") || "role not stated"} · ${plural(g.distinctPodcasts, "show")} (${g.podcasts.join(", ")}) · ${plural(g.appearances, "appearance")} · latest ${dateIST(g.lastAt)} · activity score ${g.score}${g.focus ? " · matches your focus" : ""}${g.newThisWeek ? " · new to the radar this week" : ""}`,
      body: n ? [n.why, `Tip: ${n.tip}`] : undefined,
      links: g.episodes.filter((e) => e.url).map((e) => ({ label: e.title, url: e.url! })),
    });
  }
  if (!stats.guests.length) guestBlocks.push({ kind: "p", text: "No guests found in this period." });

  // ---------------------------------------------------------------- focused: topics
  const topicBlocks: Block[] = [];
  for (const t of stats.topics.slice(0, 5)) {
    const n = topicNote.get(t.name);
    const change = t.trend === "new" ? "new this week" : `${t.episodesThisWeek} episodes this week vs ${t.episodesPrevWeek} last week (${t.trend})`;
    topicBlocks.push({
      kind: "item",
      title: `${t.name}${n ? ` (${n.stance === "ride" ? "ride the wave" : "counter-programme"})` : ""}`,
      meta: `${plural(t.shows, "show")} · ${change} · momentum score ${t.score}${t.focus ? " · matches your focus" : ""}`,
      body: n ? n.angles.map((a) => `Angle: ${a}`) : undefined,
      links: t.sampleEpisodes.filter((e) => e.url).slice(0, 2).map((e) => ({ label: `${e.podcast}: ${e.title}`, url: e.url! })),
    });
  }
  if (!topicBlocks.length) topicBlocks.push({ kind: "p", text: "No topic was covered by two or more monitored shows recently.", muted: true });

  // ---------------------------------------------------------------- focused: unexpected trends
  const unexpectedBlocks: Block[] = (stats.unexpected ?? []).map((u) => ({
    kind: "item" as const,
    title: u.name,
    meta: `${plural(u.shows, "monitored show")} · ${u.trend === "new" ? "new this week" : `${u.episodesThisWeek} episodes this week vs ${u.episodesPrevWeek} last week`} · not in your preferences`,
    body: unexpectedNote.get(u.name) ? [unexpectedNote.get(u.name)!.note] : undefined,
    links: u.sampleEpisodes.filter((e) => e.url).map((e) => ({ label: `${e.podcast}: ${e.title}`, url: e.url! })),
  }));

  // ---------------------------------------------------------------- focused: sponsors
  const sponsorBlocks: Block[] = [];
  if (!stats.sponsorEvidence.sufficient)
    sponsorBlocks.push({ kind: "p", muted: true, text: `Thin evidence: no brand was disclosed as a sponsor on monitored shows in the last ${stats.sponsorEvidence.windowDays} days. The leads below are unverified promotional mentions (links or codes), not confirmed sponsors.` });
  else sponsorBlocks.push({ kind: "p", muted: true, text: `${plural(stats.sponsorEvidence.disclosedBrands, "brand")} disclosed as sponsors; ${plural(stats.sponsorEvidence.promoBrands, "brand")} with unverified promotions. Advertising spend is unknown.` });
  for (const s of stats.sponsors) {
    const n = sponsorNote.get(s.name);
    const evidence = s.disclosedEpisodes > 0 ? `disclosed on ${plural(s.disclosedEpisodes, "episode")} across ${plural(s.disclosedShows, "show")}` : `${plural(s.promoEpisodes, "promotional mention")}, none disclosed as sponsorship`;
    sponsorBlocks.push({
      kind: "item",
      title: `${s.name}${s.category ? ` (${s.category})` : ""}`,
      meta: `Tier ${s.tier} · ${evidence}${s.platformFlaggedEpisodes ? ` · YouTube marks ${plural(s.platformFlaggedEpisodes, "video")} as paid placement` : ""} · latest ${dateIST(s.lastAt)}${s.focus ? " · matches your focus" : ""}`,
      body: [...(s.evidenceQuote ? [`Evidence: “${s.evidenceQuote}”`] : []), ...(n ? [n.why, `Pitch: ${n.pitch}`] : [])],
      links: s.evidenceEpisode?.url ? [{ label: `${s.evidenceEpisode.podcast}: ${s.evidenceEpisode.title}`, url: s.evidenceEpisode.url }] : [],
    });
  }
  if (!stats.sponsors.length) sponsorBlocks.push({ kind: "p", text: "No promotional evidence found on monitored shows in this period." });

  // ---------------------------------------------------------------- discovery group
  const d = stats.discovery;
  const discoveryGroup = d ? "Discovery Opportunities" : undefined;
  const discoveryNoteText = d
    ? d.enabled
      ? `Source: ${d.universe}. These shows are NOT on your watchlist and are not counted in any ranking above. ${plural(d.inQueue, "podcast")} awaiting review${d.saved ? `, ${d.saved} saved` : ""}${d.lastRunAt ? `; last discovery run ${dateIST(d.lastRunAt)}` : ""}.`
      : "Discovery research is switched off."
    : undefined;
  const discoverySections: Section[] = [];
  if (d) {
    if (!d.enabled) {
      discoverySections.push({ group: discoveryGroup, groupNote: discoveryNoteText, heading: "New podcasts worth reviewing", blocks: [{ kind: "p", muted: true, text: "Discovery research is switched off in your research settings. Switch it on in the Research Control Center to receive suggestions." }] });
    } else {
      const cand: Block[] = d.candidates.length
        ? d.candidates.map((c) => {
            const n = discoveryNote.get(c.name);
            return {
              kind: "item" as const,
              title: c.name,
              meta: `${c.trend === "trending" ? "Trending" : "Active and relevant"} · relevance ${c.relevance}${c.language ? ` · ${c.language.toUpperCase()}` : ""}${c.rssKnown ? "" : " · no RSS feed known yet"}`,
              body: [c.reason, ...(n ? [n.why, `Next step: ${n.nextStep}`] : [])].filter(Boolean),
              links: c.episodes.filter((e) => e.url).slice(0, 2).map((e) => ({ label: e.title, url: e.url! })),
            };
          })
        : [{ kind: "p" as const, muted: true, text: "No new podcasts passed the relevance and activity checks yet. Nothing is suggested without real evidence." }];
      discoverySections.push({ group: discoveryGroup, groupNote: discoveryNoteText, heading: "New podcasts worth reviewing", blocks: cand });
      discoverySections.push({
        heading: "Emerging themes beyond your keywords",
        blocks: d.themes.length
          ? d.themes.map((t) => ({ kind: "item" as const, title: t.theme, meta: `${plural(t.shows, "discovered show")} · ${plural(t.episodes, "episode")} · ${t.recent} in the last 30 days`, links: t.example?.url ? [{ label: `${t.example.candidate}: ${t.example.title}`, url: t.example.url }] : [] }))
          : [{ kind: "p", muted: true, text: "No theme yet appears across two or more discovered shows." }],
      });
      discoverySections.push({
        heading: "Founders appearing across discovered shows",
        blocks: d.founders.length
          ? d.founders.map((f) => ({ kind: "item" as const, title: f.name, meta: `${[f.role, f.company].filter(Boolean).join(", ") || "role not stated"} · on ${f.shows.join(", ")}` }))
          : [{ kind: "p", muted: true, text: "No founder has appeared on two or more discovered shows yet." }],
      });
      discoverySections.push({
        heading: "Sponsor leads from discovered shows",
        blocks: d.sponsors.length
          ? d.sponsors.map((s) => ({ kind: "item" as const, title: s.brand, meta: `${CLASS_LABEL[s.classification] ?? s.classification} · ${s.shows.join(", ")}`, body: [`Evidence: “${s.quote}”`], links: s.example.url ? [{ label: `${s.example.candidate}: ${s.example.title}`, url: s.example.url }] : [] }))
          : [{ kind: "p", muted: true, text: "No promotional evidence found in discovered shows yet." }],
      });
    }
  }

  const actions: Block[] = narrative?.actions.length
    ? narrative.actions.map((a) => ({ kind: "p" as const, text: a }))
    : [{ kind: "p", muted: true, text: "No AI-written actions this week. Use the ranked lists above: contact the top guests, plan around the top topics, and verify the sponsor leads before pitching." }];

  return {
    subject: stats.period ? `Monday brief: ${periodShort(stats.period.from)}` : `Monday brief: week of ${week}`,
    title: stats.period ? `Monday Intelligence Brief · ${periodShort(stats.period.from)}` : `Monday Intelligence Brief · week of ${week}`,
    sections: [
      ...(intro.length ? [{ heading: "This week", blocks: intro }] : []),
      { group: focusGroup, groupNote: focusNote, heading: "Guest opportunities", blocks: guestBlocks },
      { heading: "Trending topics", blocks: topicBlocks },
      ...(unexpectedBlocks.length ? [{ heading: "Unexpected trends in your monitored shows", blocks: unexpectedBlocks }] : []),
      { heading: "Sponsor opportunities", blocks: sponsorBlocks },
      ...discoverySections,
      { group: stats.discovery || stats.focus ? "Next steps" : undefined, heading: "Recommended actions", blocks: actions },
    ],
  };
}

export function toMarkdown(doc: BriefDoc): string {
  const out = [`# ${doc.title}`];
  for (const s of doc.sections) {
    if (s.group) out.push(`\n# ${s.group}\n${s.groupNote ? `\n_${s.groupNote}_\n` : ""}`);
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
    if (s.group) {
      parts.push(`<div style="margin:34px 0 4px;padding:10px 14px;background:#1b2140;border-radius:10px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#aab2e8">Section</div><div style="font-size:20px;font-weight:700;color:#ffffff">${esc(s.group)}</div>${s.groupNote ? `<div style="font-size:13px;color:#c9cef0;margin-top:4px;line-height:1.45">${esc(s.groupNote)}</div>` : ""}</div>`);
    }
    parts.push(`<h2 style="font-size:18px;margin:24px 0 10px;color:#1b2140;border-bottom:1px solid #e3e6f2;padding-bottom:6px">${esc(s.heading)}</h2>`);
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
  return `<!doctype html><html><body style="margin:0;background:#eceef8;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;padding:28px 26px"><h1 style="font-size:22px;margin:0 0 4px;color:#1b2140">${esc(doc.title)}</h1><p style="margin:0;font-size:13px;color:#6b7390">Podcast Ecosystem Radar</p>${parts.join("")}${dashboardUrl ? `<p style="margin:28px 0 0;font-size:13px"><a href="${esc(dashboardUrl)}" style="color:#4a56d6">Open the dashboard</a></p>` : ""}<p style="margin:18px 0 0;font-size:12px;color:#8a91ab">Counts come from the database. AI commentary is limited to the facts shown. Monitored and discovered podcasts are never combined in any ranking.</p></div></body></html>`;
}
