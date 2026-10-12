import { Suspense } from "react";
import { connection } from "next/server";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import { Badge, Panel, PanelSkeleton, PageHeader } from "@/components/ui";
import { AddPodcastForm, DeleteButton } from "@/components/podcast-forms";
import { getPodcastRows, type PodcastRow } from "@/lib/queries";
import { formatDateIST, timeAgo } from "@/lib/format";
import { setEnabled, syncPodcast, updatePodcast } from "./actions";

const inputCls =
  "w-full rounded-lg bg-panel2 px-3 py-2 text-sm text-ink ring-1 ring-line focus:ring-2 focus:ring-accent focus:outline-none";

export default function ManagePodcastsPage() {
  return (
    <>
      <PageHeader
        title="Manage Podcasts"
        subtitle="Choose which shows are monitored. Changes apply immediately, with no code changes or redeploy."
      />
      <div className="grid gap-5">
        <Panel title="Add a podcast" icon={Plus}>
          <AddPodcastForm />
        </Panel>
        <Suspense fallback={<PanelSkeleton className="h-96" />}>
          <PodcastTable />
        </Suspense>
      </div>
    </>
  );
}

function SyncBadge({ p }: { p: PodcastRow }) {
  if (!p.lastSyncStatus) return <Badge>Not synced</Badge>;
  if (p.lastSyncStatus === "error") return <Badge tone="bad">Error</Badge>;
  return <Badge tone="good">Synced</Badge>;
}

async function PodcastTable() {
  await connection();
  const rows = await getPodcastRows();
  const enabled = rows.filter((r) => r.enabled).length;
  return (
    <Panel title={`Podcasts · ${enabled} monitored of ${rows.length}`} right={<span className="text-sm text-muted">Disabled shows keep their stored episodes but are not synced.</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[15px]">
          <thead className="text-sm text-muted">
            <tr className="border-b border-line">
              <th className="py-2.5 pr-3 font-normal">Monitoring</th>
              <th className="py-2.5 pr-3 font-normal">Podcast</th>
              <th className="py-2.5 pr-3 font-normal">Episodes</th>
              <th className="py-2.5 pr-3 font-normal">Latest episode</th>
              <th className="py-2.5 pr-3 font-normal">Last sync</th>
              <th className="py-2.5 text-right font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-line/60 align-top">
                <td className="py-3 pr-3">
                  <form action={setEnabled}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="enabled" value={String(!p.enabled)} />
                    <button
                      type="submit"
                      role="switch"
                      aria-checked={p.enabled}
                      aria-label={`${p.enabled ? "Disable" : "Enable"} monitoring for ${p.name}`}
                      className={`relative h-6 w-11 rounded-full transition-colors ${p.enabled ? "bg-accent" : "bg-panel2 ring-1 ring-line"}`}
                    >
                      <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${p.enabled ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </form>
                </td>
                <td className="py-3 pr-3">
                  <p className="font-medium">{p.name}</p>
                  <p className="max-w-[320px] truncate text-xs text-muted" title={p.rssUrl ?? ""}>
                    {p.rssUrl ?? "No RSS URL"}
                  </p>
                  {p.youtubeChannelId && <p className="text-xs text-muted">YouTube {p.youtubeChannelId}</p>}
                  {p.lastSyncError && <p className="mt-1 max-w-[320px] text-xs text-bad">{p.lastSyncError}</p>}
                </td>
                <td className="py-3 pr-3 tabular-nums">{p.episodes}</td>
                <td className="py-3 pr-3 text-muted">{p.latestEpisode ? formatDateIST(p.latestEpisode) : "—"}</td>
                <td className="py-3 pr-3">
                  <SyncBadge p={p} />
                  <p className="mt-1 text-xs text-muted">{timeAgo(p.lastSyncAt)}</p>
                </td>
                <td className="py-3">
                  <div className="flex items-center justify-end gap-1">
                    <form action={syncPodcast}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" aria-label={`Sync ${p.name} now`} title="Sync now" className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-accent/20 hover:text-soft">
                        <RefreshCw size={17} />
                      </button>
                    </form>
                    <details className="relative">
                      <summary aria-label={`Edit ${p.name}`} title="Edit" className="grid size-9 cursor-pointer list-none place-items-center rounded-lg text-muted transition hover:bg-accent/20 hover:text-soft [&::-webkit-details-marker]:hidden">
                        <Pencil size={17} />
                      </summary>
                      <form action={updatePodcast} className="absolute right-0 z-10 mt-2 grid w-80 gap-2.5 rounded-xl bg-panel2 p-4 text-left shadow-2xl ring-1 ring-line">
                        <input type="hidden" name="id" value={p.id} />
                        <label className="grid gap-1 text-xs text-muted">Name<input name="name" defaultValue={p.name} required className={inputCls} /></label>
                        <label className="grid gap-1 text-xs text-muted">RSS feed URL<input name="rssUrl" type="url" defaultValue={p.rssUrl ?? ""} className={inputCls} /></label>
                        <label className="grid gap-1 text-xs text-muted">YouTube channel ID<input name="youtubeChannelId" defaultValue={p.youtubeChannelId ?? ""} className={inputCls} /></label>
                        <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/85">Save changes</button>
                      </form>
                    </details>
                    <DeleteButton id={p.id} name={p.name} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
