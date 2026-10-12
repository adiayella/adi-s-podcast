import { SearchBox } from "@/components/search-box";

export function TopBar() {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xl font-semibold tracking-tight sm:text-2xl">Podcast Ecosystem Radar</p>
        <p className="text-sm text-muted">Discover people. Understand conversations. Find opportunity.</p>
      </div>
      <SearchBox />
      <span className="rounded-xl bg-panel/80 px-3.5 py-2 text-sm text-muted ring-1 ring-line">Last 90 days · YouTube + RSS</span>
    </div>
  );
}
