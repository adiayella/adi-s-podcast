import { TrendingUp } from "lucide-react";
import { Panel } from "@/components/ui";
import { DISCOVERY_TREND_RUBRIC } from "@/discovery/evaluate";
import { SPOTIFY_TREND_RUBRIC } from "@/discovery/spotify-trend";
import { TOPIC_TREND_RUBRIC } from "@/scoring/trend";

// Every "trending" label in the app comes from one of these three written rubrics. Nothing is labelled by an AI opinion.

function Block({ title, version, where, children }: { title: string; version: string; where: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-panel2 p-4 ring-1 ring-line">
      <p className="font-semibold">
        {title} <span className="text-sm font-normal text-muted">· {version}</span>
      </p>
      <p className="mt-0.5 text-sm text-muted">{where}</p>
      <div className="mt-3 grid gap-3 text-sm">{children}</div>
    </div>
  );
}

const Rules = ({ heading, items }: { heading: string; items: readonly { label: string; rule: string }[] }) => (
  <div>
    <p className="font-medium text-ink/90">{heading}</p>
    <ul className="mt-1 grid gap-1">
      {items.map((i) => (
        <li key={i.label}>
          <span className="text-ink/90">{i.label}:</span> <span className="text-muted">{i.rule}</span>
        </li>
      ))}
    </ul>
  </div>
);

export function TrendRubrics() {
  return (
    <Panel title="How trends are identified" icon={TrendingUp}>
      <div className="grid gap-4 xl:grid-cols-3">
        <Block title="Topic trend" version={TOPIC_TREND_RUBRIC.version} where="Topics page, Sector Intelligence, Overview insights and the Monday brief.">
          <p className="text-muted">{TOPIC_TREND_RUBRIC.baseline}</p>
          <Rules heading="Gates" items={TOPIC_TREND_RUBRIC.gates} />
          <Rules heading="Labels" items={TOPIC_TREND_RUBRIC.labels} />
          <Rules heading="Strength score (orders topics, never decides the label)" items={TOPIC_TREND_RUBRIC.score.map((s) => ({ label: `${s.key} (${s.max})`, rule: s.rule }))} />
        </Block>
        <Block title="Spotify sector trend" version={SPOTIFY_TREND_RUBRIC.version} where="Sector Intelligence: shows Spotify ranks for each sector in India.">
          <Rules heading="Score components" items={SPOTIFY_TREND_RUBRIC.components.map((c) => ({ label: `${c.label} (${c.max})`, rule: c.rule }))} />
          <Rules heading="Labels" items={SPOTIFY_TREND_RUBRIC.labels} />
          <p className="text-muted">{SPOTIFY_TREND_RUBRIC.notAvailable}</p>
        </Block>
        <Block title="Discovered show trend" version={DISCOVERY_TREND_RUBRIC.version} where="Research Center: podcasts found outside your watchlist.">
          <Rules heading="Signals" items={DISCOVERY_TREND_RUBRIC.signals} />
          <Rules heading="Labels" items={DISCOVERY_TREND_RUBRIC.labels} />
        </Block>
      </div>
    </Panel>
  );
}
