// Topic trend rubric: decides whether a topic is rising, new, steady or falling from counted episodes only.
// It replaces "this week > last week = rising", which called 1 -> 2 episodes "+100% rising".
// Every label is a set of written rules (gates); the 0-100 score only orders topics and explains strength.

export const TOPIC_TREND_RUBRIC = {
  version: "topic-trend-v1",
  baseline: "Normal level = average episodes per week over the 4 weeks before this one (not just last week).",
  gates: [
    { key: "volume", label: "Enough volume", rule: "At least 3 episodes on the topic in the last 7 days." },
    { key: "breadth", label: "Across shows", rule: "From at least 2 different shows in the last 7 days, so one show's burst cannot make a trend." },
    { key: "lift", label: "Clear lift", rule: "At least 1.5x the normal level AND at least 2 more episodes than normal." },
    { key: "sustained", label: "Sustained", rule: "The last two weeks together are at least 1.25x a normal fortnight, so a one-week blip is not a trend." },
    { key: "evidence", label: "Reliable tagging", rule: "Average extraction confidence of the topic's episodes is at least 0.5." },
  ],
  labels: [
    { label: "rising", rule: "All five gates pass." },
    { label: "new", rule: "Almost absent before (normal level under 0.5 a week), now 3+ episodes from 2+ shows with reliable tagging." },
    { label: "falling", rule: "Normal level of 2+ a week and this week at half of it or less." },
    { label: "steady", rule: "Anything else, including one-show bursts and one-week blips." },
  ],
  score: [
    { key: "lift", max: 35, rule: "How far above normal: 1.5x lift = 12, 2.5x or more = 35." },
    { key: "breadth", max: 25, rule: "Shows covering it this week: 4 or more = full marks." },
    { key: "persistence", max: 20, rule: "Last two weeks vs a normal fortnight: double or more = full marks." },
    { key: "volume", max: 20, rule: "Episodes this week: 6 or more = full marks." },
  ],
} as const;

export type TopicTrendLabel = "rising" | "steady" | "falling" | "new";

export type TopicTrendInput = {
  weeks: [number, number, number, number, number]; // episodes in rolling 7-day windows, most recent first
  showsThisWeek: number;
  confidence: number | null; // average extraction confidence, 0-1
};

export type TopicTrend = {
  rubricVersion: string;
  label: TopicTrendLabel;
  score: number;
  baseline: number; // average episodes a week over the 4 weeks before this one
  lift: number | null; // this week / baseline; null when there is no baseline
  momentumPct: number | null; // change vs the baseline; null when the baseline is under 1 a week
  gates: { key: string; label: string; met: boolean; detail: string }[];
  summary: string;
};

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function topicTrend(input: TopicTrendInput): TopicTrend {
  const [w0, w1, w2, w3, w4] = input.weeks;
  const baseline = (w1 + w2 + w3 + w4) / 4;
  const lift = baseline > 0 ? w0 / baseline : null;
  const fortnight = (w0 + w1) / (2 * Math.max(baseline, 0.5));
  const conf = input.confidence ?? 0;

  const gates = [
    { key: "volume", label: "Enough volume", met: w0 >= 3, detail: `${w0} episodes in the last 7 days (needs 3)` },
    { key: "breadth", label: "Across shows", met: input.showsThisWeek >= 2, detail: `${input.showsThisWeek} show(s) this week (needs 2)` },
    { key: "lift", label: "Clear lift", met: w0 >= baseline * 1.5 && w0 - baseline >= 2, detail: `${w0} vs a normal ${round(baseline, 1)} a week${lift === null ? "" : ` (${round(lift, 1)}x)`}` },
    { key: "sustained", label: "Sustained", met: fortnight >= 1.25, detail: `last two weeks ${w0 + w1} vs a normal fortnight of ${round(2 * baseline, 1)}` },
    { key: "evidence", label: "Reliable tagging", met: conf >= 0.5, detail: `average confidence ${round(conf)}` },
  ];
  const ok = (k: string) => gates.find((g) => g.key === k)!.met;

  const isNew = baseline < 0.5 && ok("volume") && ok("breadth") && ok("evidence");
  const rising = gates.every((g) => g.met);
  const falling = baseline >= 2 && w0 <= baseline * 0.5;
  const label: TopicTrendLabel = isNew ? "new" : rising ? "rising" : falling ? "falling" : "steady";

  const liftPts = lift === null ? (w0 >= 3 ? 35 : 0) : lift <= 1 ? 0 : 35 * clamp01((lift - 1) / 1.5);
  const score = round(liftPts + 25 * clamp01(input.showsThisWeek / 4) + 20 * clamp01(fortnight - 1) + 20 * clamp01(w0 / 6), 1);

  const failed = gates.filter((g) => !g.met).map((g) => g.label.toLowerCase());
  const summary =
    label === "rising"
      ? `Rising: ${w0} episodes from ${input.showsThisWeek} shows vs a normal ${round(baseline, 1)} a week, sustained over two weeks.`
      : label === "new"
        ? `New: almost absent in the previous 4 weeks, now ${w0} episodes from ${input.showsThisWeek} shows.`
        : label === "falling"
          ? `Falling: ${w0} episodes vs a normal ${round(baseline, 1)} a week.`
          : `Steady: not a trend yet (missing ${failed.join(", ") || "a clear change"}).`;

  return {
    rubricVersion: TOPIC_TREND_RUBRIC.version,
    label,
    score,
    baseline: round(baseline),
    lift: lift === null ? null : round(lift),
    momentumPct: baseline >= 1 ? round(((w0 - baseline) / baseline) * 100, 0) : null,
    gates,
    summary,
  };
}
