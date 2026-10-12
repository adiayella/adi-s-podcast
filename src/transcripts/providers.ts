import type { Segment } from "./parse";
import type { SourceKind } from "./policy";

// Pluggable transcript sources beyond the RSS tag. A provider is one small file that implements this interface and
// is added to PROVIDERS. The fetch stage never calls a provider unless the rights gate (policy.ts) allows it for
// that show, so adding one cannot by itself cause audio or third-party text to be processed.
//
// NOT BUILT YET (by design, until the founder supplies a licence or written permission):
//  - licensed providers (for example a paid transcript API): needs an account and a read of its licensing terms
//  - audio transcription: needs recorded permission per show, and a worker outside Vercel because a long episode
//    does not finish inside a 300 second function
// Both are intentionally absent so that nothing can run by accident.

export type ProviderResult = { format: string; body: string; language?: string };

export type TranscriptProvider = {
  kind: Extract<SourceKind, "licensed_provider" | "audio_transcription" | "youtube_owner_caption">;
  name: string;
  /** True only when credentials and licence are in place. */
  isConfigured(): boolean;
  /** Return a transcript for one episode, or null if the provider has none. */
  fetch(episode: { id: number; title: string; audioUrl: string | null }): Promise<ProviderResult | null>;
};

export const PROVIDERS: TranscriptProvider[] = [];

export const anyProviderConfigured = () => PROVIDERS.some((p) => p.isConfigured());

// Kept so a provider can hand back already-parsed segments if it prefers.
export type { Segment };
