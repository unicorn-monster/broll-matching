import { describe, it, expect } from "vitest";
import { listTracks, maxTrackIndex, pickTrack } from "../overlay-tracks";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (id: string, trackIndex: number): BrollVideoOverlay => ({
  id,
  kind: "broll-video",
  trackIndex,
  startMs: 0,
  durationMs: 1000,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c",
  indexeddbKey: "k",
  sourceStartMs: 0,
  sourceDurationMs: 1000,
});

describe("listTracks", () => {
  it("returns sorted unique track indices ascending", () => {
    const out = listTracks([make("a", 2), make("b", 0), make("c", 2), make("d", 1)]);
    expect(out).toEqual([0, 1, 2]);
  });
  it("returns [] when empty", () => {
    expect(listTracks([])).toEqual([]);
  });
});

describe("maxTrackIndex", () => {
  it("returns highest track index", () => {
    expect(maxTrackIndex([make("a", 0), make("b", 3), make("c", 1)])).toBe(3);
  });
  it("returns -1 when no overlays exist", () => {
    expect(maxTrackIndex([])).toBe(-1);
  });
});

describe("pickTrack", () => {
  it("returns create-new-track when mouseY in top zone", () => {
    const bands = [
      { trackIndex: 1, top: 50, bottom: 90 },
      { trackIndex: 0, top: 90, bottom: 130 },
    ];
    const out = pickTrack(20, bands, { topZoneTop: 0, topZoneBottom: 50 }, 1);
    expect(out).toEqual({ mode: "create", trackIndex: 2 });
  });

  it("returns into-existing when mouseY in track band", () => {
    const bands = [
      { trackIndex: 1, top: 50, bottom: 90 },
      { trackIndex: 0, top: 90, bottom: 130 },
    ];
    const out = pickTrack(70, bands, { topZoneTop: 0, topZoneBottom: 50 }, 1);
    expect(out).toEqual({ mode: "into", trackIndex: 1 });
  });

  it("returns create-track-zero when no tracks exist (empty timeline drop)", () => {
    const out = pickTrack(50, [], { topZoneTop: 0, topZoneBottom: 100 }, -1);
    expect(out).toEqual({ mode: "create", trackIndex: 0 });
  });
});
