// The rights gate. Every transcript source goes through here, so what we are allowed to hold and process is
// decided in one place. Published transcripts may be read unless the show is switched off; audio is never
// transcribed unless the founder has recorded that we have the rights for that show.

export type SourceKind = "rss_tag" | "public_page" | "licensed_provider" | "audio_transcription" | "youtube_owner_caption";
export type AudioRights = "none" | "authorized";
export type TranscriptPolicy = { allowPublicTranscripts: boolean; audioTranscriptionRights: AudioRights | string };

export type Permission = { allowed: true; basis: string } | { allowed: false; reason: string };

export function permissionFor(source: SourceKind, policy: TranscriptPolicy, opts: { providerConfigured?: boolean } = {}): Permission {
  switch (source) {
    case "rss_tag":
      return policy.allowPublicTranscripts
        ? { allowed: true, basis: "Published by the creator in the podcast's RSS feed" }
        : { allowed: false, reason: "Reading published transcripts is switched off for this show" };
    case "public_page":
      return policy.allowPublicTranscripts
        ? { allowed: true, basis: "Publicly posted by the show and linked from its episode page" }
        : { allowed: false, reason: "Reading published transcripts is switched off for this show" };
    case "licensed_provider":
      return opts.providerConfigured ? { allowed: true, basis: "Licensed from a transcript provider under its terms" } : { allowed: false, reason: "No licensed transcript provider is configured" };
    case "audio_transcription":
    case "youtube_owner_caption":
      return policy.audioTranscriptionRights === "authorized"
        ? { allowed: true, basis: "The founder recorded that we have the rights to process this show's audio" }
        : { allowed: false, reason: "No recorded permission to process this show's audio or captions" };
  }
}
