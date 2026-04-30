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
  fileId: "k",
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
  it("returns create at top edge when mouseY in first create zone", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      3,
      bands,
      [
        { top: 0, bottom: 6, newTrackIndex: 2 },
        { top: 62, bottom: 68, newTrackIndex: 1 },
        { top: 124, bottom: 130, newTrackIndex: 0 },
      ],
      1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 2 });
  });

  it("returns create at between-gap zone (insert between two tracks)", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      65,
      bands,
      [
        { top: 0, bottom: 6, newTrackIndex: 2 },
        { top: 62, bottom: 68, newTrackIndex: 1 },
        { top: 124, bottom: 130, newTrackIndex: 0 },
      ],
      1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 1 });
  });

  it("returns create at bottom edge zone (new track sat main)", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      127,
      bands,
      [
        { top: 0, bottom: 6, newTrackIndex: 2 },
        { top: 62, bottom: 68, newTrackIndex: 1 },
        { top: 124, bottom: 130, newTrackIndex: 0 },
      ],
      1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 0 });
  });

  it("returns into-existing when mouseY in track band", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      30,
      bands,
      [{ top: 0, bottom: 6, newTrackIndex: 2 }],
      1,
    );
    expect(out).toEqual({ mode: "into", trackIndex: 1 });
  });

  it("returns create-track-zero when no tracks exist (empty area)", () => {
    const out = pickTrack(
      28,
      [],
      [{ top: 0, bottom: 56, newTrackIndex: 0 }],
      -1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 0 });
  });

  it("falls back to create above all when mouseY outside any zone or band", () => {
    const bands = [{ trackIndex: 0, top: 6, bottom: 62 }];
    const out = pickTrack(
      9999,
      bands,
      [{ top: 0, bottom: 6, newTrackIndex: 1 }],
      0,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 1 });
  });
});
