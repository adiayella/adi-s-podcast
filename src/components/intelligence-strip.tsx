import Link from "next/link";
import { connection } from "next/server";
import { Badge, Panel } from "@/components/ui";
import { MessageCircleQuestion, Mail, TrendingUp, UserSearch } from "lucide-react";
import { formatDateTimeIST } from "@/lib/format";
import { latestReports } from "@/services/brief";
import { topAudienceThemes } from "@/services/audience";
import { getSectorTrends, latestOpportunities } from "@/services/intelligence";

/** The "what should I do this week" strip at the top of the Overview. Every figure links to the page that explains it. */
export async function IntelligenceStrip() {
  await connection();
  const [guests, sectors, themes, [report]] = await Promise.all([latestOpportunities("guest", 3), getSectorTrends(), topAudienceThemes(3), latestReports(1)]);
  const movers = sectors.filter((s) => s.trend === "rising" || s.trend === "new").sort((a, b) => b.episodesThisWeek - b.episodesPrevWeek - (a.episodesThisWeek - a.episodesPrevWeek)).slice(0, 3);
  return (
    <div className="mb-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
      <Panel title="Guests to approach" icon={UserSearch} right={<Link href="/rubrics" className="text-sm text-soft hover:underline">why</Link>}>
        <ul className="grid gap-2.5">
          {guests.map((g) => (
            <li key={g.entity_id} className="flex items-center justify-between gap-3 text-[15px]">
              <span className="truncate">{g.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={g.confidence.level === "high" ? "good" : g.confidence.level === "medium" ? "warn" : "neutral"}>{g.confidence.level}</Badge>
                <span className="font-semibold tabular-nums">{Number(g.score).toFixed(0)}</span>
              </span>
            </li>
          ))}
          {!guests.length && <li className="text-sm text-muted">Scores appear after the daily job.</li>}
        </ul>
      </Panel>
      <Panel title="Sectors gaining ground" icon={TrendingUp} right={<Link href="/sectors" className="text-sm text-soft hover:underline">all</Link>}>
        <ul className="grid gap-2.5">
          {movers.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3 text-[15px]">
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 tabular-nums text-good">
                {s.episodesThisWeek} vs {s.episodesPrevWeek}
              </span>
            </li>
          ))}
          {!movers.length && <li className="text-sm text-muted">No topic is rising this week.</li>}
        </ul>
      </Panel>
      <Panel title="What the audience asks" icon={MessageCircleQuestion} right={<Link href="/audience" className="text-sm text-soft hover:underline">all</Link>}>
        <ul className="grid gap-2.5">
          {themes.map((t) => (
            <li key={t.id} className="text-[15px]">
              <span className="line-clamp-2">{t.label}</span>
              <span className="text-sm text-muted">
                {t.support} comments · {t.kind.replace("_", " ")}
              </span>
            </li>
          ))}
          {!themes.length && <li className="text-sm text-muted">No comment themes yet.</li>}
        </ul>
      </Panel>
      <Panel title="Monday brief" icon={Mail} right={<Link href="/brief" className="text-sm text-soft hover:underline">open</Link>}>
        {report ? (
          <div className="grid gap-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={report.generationStatus === "ready" ? "good" : "bad"}>generated</Badge>
              <Badge tone={report.sendStatus === "accepted" ? "good" : report.sendStatus === "failed" ? "bad" : "neutral"}>{report.sendStatus === "accepted" ? "handed over" : report.sendStatus.replace("_", " ")}</Badge>
              <Badge tone={report.deliveryStatus === "delivered" ? "good" : report.deliveryStatus === "unknown" ? "neutral" : "bad"}>{report.deliveryStatus === "unknown" ? "delivery unconfirmed" : report.deliveryStatus}</Badge>
            </div>
            <p className="text-muted">Week of {report.weekStart}{report.emailedAt ? ` · sent ${formatDateTimeIST(report.emailedAt)} IST` : ""}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">No brief yet. The next one is Monday 07:00 IST.</p>
        )}
      </Panel>
    </div>
  );
}

