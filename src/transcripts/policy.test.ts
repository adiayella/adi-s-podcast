import { describe, expect, it } from "vitest";
import { permissionFor } from "./policy";

const open = { allowPublicTranscripts: true, audioTranscriptionRights: "none" };

describe("transcript rights gate", () => {
  it("allows a creator-published RSS transcript by default", () => {
    expect(permissionFor("rss_tag", open).allowed).toBe(true);
  });

  it("blocks published transcripts when the show is switched off", () => {
    const r = permissionFor("rss_tag", { ...open, allowPublicTranscripts: false });
    expect(r.allowed).toBe(false);
  });

  it("never allows audio transcription without recorded rights", () => {
    expect(permissionFor("audio_transcription", open).allowed).toBe(false);
    expect(permissionFor("youtube_owner_caption", open).allowed).toBe(false);
    expect(permissionFor("audio_transcription", { ...open, audioTranscriptionRights: "authorized" }).allowed).toBe(true);
  });

  it("allows audio transcription for an authorised show even if published transcripts are off", () => {
    expect(permissionFor("audio_transcription", { allowPublicTranscripts: false, audioTranscriptionRights: "authorized" }).allowed).toBe(true);
  });

  it("allows a licensed provider only when one is configured", () => {
    expect(permissionFor("licensed_provider", open).allowed).toBe(false);
    expect(permissionFor("licensed_provider", open, { providerConfigured: true }).allowed).toBe(true);
  });

  it("always says why a source is allowed or refused", () => {
    const yes = permissionFor("rss_tag", open);
    const no = permissionFor("audio_transcription", open);
    expect(yes.allowed && yes.basis.length).toBeGreaterThan(10);
    expect(!no.allowed && no.reason.length).toBeGreaterThan(10);
  });
});
