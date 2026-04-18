import { deriveBaseName } from "./broll";
import type { ParsedSection } from "./script-parser";

export interface ClipMetadata {
  id: string;
  brollName: string;
  baseName: string;
  durationMs: number;
  indexeddbKey: string;
  folderId: string;
  productId: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: Date;
}

export interface MatchedClip {
  clipId: string;
  indexeddbKey: string;
  speedFactor: number;
  trimDurationMs?: number;
  isPlaceholder: boolean;
}

export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  durationMs: number;
  clips: MatchedClip[];
  warnings: string[];
}

export function buildClipsByBaseName(clips: ClipMetadata[]): Map<string, ClipMetadata[]> {
  const map = new Map<string, ClipMetadata[]>();
  for (const clip of clips) {
    const key = deriveBaseName(clip.brollName);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(clip);
  }
  return map;
}

function pickRandom<T>(arr: T[], avoid?: T): T {
  if (arr.length === 1) return arr[0];
  const choices = avoid ? arr.filter((x) => x !== avoid) : arr;
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : arr[0];
}

function scenarioA(clip: ClipMetadata, sectionMs: number): MatchedClip {
  const speedFactor = clip.durationMs / sectionMs;
  if (speedFactor <= 2.0) {
    return { clipId: clip.id, indexeddbKey: clip.indexeddbKey, speedFactor, isPlaceholder: false };
  }
  return {
    clipId: clip.id,
    indexeddbKey: clip.indexeddbKey,
    speedFactor: 2.0,
    trimDurationMs: sectionMs * 2,
    isPlaceholder: false,
  };
}

export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
): MatchedSection[] {
  return sections.map((section, sectionIndex) => {
    const warnings: string[] = [];

    if (section.durationMs === 0) {
      return { sectionIndex, tag: section.tag, durationMs: 0, clips: [], warnings };
    }

    const key = section.tag.toLowerCase();
    const candidates = clipsByBaseName.get(key) ?? [];

    if (candidates.length === 0) {
      warnings.push(`No B-roll found for tag: ${section.tag}`);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1.0, isPlaceholder: true }],
        warnings,
      };
    }

    // Scenario A: section fits in one clip
    if (section.durationMs <= candidates[0].durationMs) {
      const clip = pickRandom(candidates);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [scenarioA(clip, section.durationMs)],
        warnings,
      };
    }

    // Scenario B: chain clips
    const matched: MatchedClip[] = [];
    let remaining = section.durationMs;
    let lastClip: ClipMetadata | undefined;

    while (remaining > 0) {
      const clip = pickRandom(candidates, lastClip);
      lastClip = clip;

      if (clip.durationMs <= remaining) {
        matched.push({ clipId: clip.id, indexeddbKey: clip.indexeddbKey, speedFactor: 1.0, isPlaceholder: false });
        remaining -= clip.durationMs;
      } else {
        matched.push(scenarioA(clip, remaining));
        remaining = 0;
      }
    }

    return { sectionIndex, tag: section.tag, durationMs: section.durationMs, clips: matched, warnings };
  });
}
