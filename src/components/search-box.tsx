"use client";

import { useEffect, useRef } from "react";
import { CornerDownLeft, Search } from "lucide-react";

export function SearchBox({ defaultValue = "" }: { defaultValue?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form action="/search" role="search" className="relative w-full max-w-xl">
      <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input ref={ref} name="q" defaultValue={defaultValue} minLength={2} maxLength={80} required placeholder="Search podcasts, guests, topics, or companies…" aria-label="Search" className="w-full rounded-xl bg-panel/80 py-2.5 pr-20 pl-10 text-[15px] ring-1 ring-line placeholder:text-muted focus:outline-none focus:ring-accent" />
      <button type="submit" aria-label="Search" className="absolute top-1/2 right-2 inline-flex -translate-y-1/2 items-center gap-1 rounded-md bg-panel2 px-2 py-1 text-xs text-muted ring-1 ring-line hover:text-ink hover:ring-accent/60">
        Enter <CornerDownLeft size={13} />
      </button>
    </form>
  );
}
