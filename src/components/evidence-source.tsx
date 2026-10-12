import { Badge } from "@/components/ui";
import { formatTimestamp } from "@/transcripts/parse";

/** Where a piece of evidence came from: the transcript (with the time it was said) or the title and description. */
export function EvidenceSource({ src, seconds }: { src?: string | null; seconds?: number | null }) {
  const fromTranscript = src === "transcript";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={fromTranscript ? "good" : "neutral"}>{fromTranscript ? "Transcript" : "Title and description"}</Badge>
      {fromTranscript && seconds !== null && seconds !== undefined && <span className="text-xs tabular-nums text-muted">at {formatTimestamp(seconds)}</span>}
    </span>
  );
}
