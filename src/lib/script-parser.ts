import { snapMsToFrame } from "./frame-align";

export interface ParsedSection {
  lineNumber: number;
  startTime: number;   // seconds (frame-snapped, may have fractional ms)
  endTime: number;     // seconds (frame-snapped)
  tag: string;
  scriptText: string;
  durationMs: number;  // frame-snapped (endMs - startMs)
}

export interface ParseResult {
  sections: ParsedSection[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

// Matches:
//   HH:MM:SS,mmm --> HH:MM:SS,mmm || text || tag
//   MM:SS,mmm    --> MM:SS,mmm    || text || tag
//   HH:MM:SS     --> HH:MM:SS     || text || tag   (ms = 000)
//   MM:SS        --> MM:SS        || text || tag   (ms = 000)
// Decimal separator: "," (SRT standard) or "." (WebVTT / common variant).
const TIMESTAMP = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?`;
// Separator accepts SRT standard "-->", plain hyphen, en-dash (\u2013), em-dash (\u2014)
const SEPARATOR = String.raw`(?:-->|[-\u2013\u2014])`;
const LINE_PATTERN = new RegExp(
  `^${TIMESTAMP}\\s*${SEPARATOR}\\s*${TIMESTAMP}\\s*\\|\\|\\s*(.+?)\\s*\\|\\|\\s*(.*)$`,
);

function parseTimestampToMs(
  h: string | undefined,
  m: string,
  s: string,
  ms: string | undefined,
): number {
  const hours = h ? Number(h) : 0;
  const mins = Number(m);
  const secs = Number(s);
  const millis = ms ? Number(ms.padEnd(3, "0").slice(0, 3)) : 0;
  return ((hours * 3600 + mins * 60 + secs) * 1000) + millis;
}

export function parseScript(
  text: string,
  availableBaseNames: Set<string>,
  audioDurationMs: number | null = null,
): ParseResult {
  const sections: ParsedSection[] = [];
  const errors: { line: number; message: string }[] = [];
  const warnings: { line: number; message: string }[] = [];

  const lines = text.split("\n");
  lines.forEach((raw, idx) => {
    const lineNumber = idx + 1;
    const line = raw.trim();
    if (!line) return;

    const match = line.match(LINE_PATTERN);
    if (!match) {
      errors.push({
        line: lineNumber,
        message: `Invalid format at line ${lineNumber} (expected "HH:MM:SS,mmm --> HH:MM:SS,mmm || text || tag"; "." also accepted as decimal separator; separators -, \u2013, \u2014 also accepted)`,
      });
      return;
    }

    const [, sh, sm, ss, sms, eh, em, es, ems, scriptText, tag] = match;
    // Regex guarantees these groups are present when the overall match succeeds.
    if (!sm || !ss || !em || !es || !tag || scriptText === undefined) {
      errors.push({ line: lineNumber, message: `Internal regex error at line ${lineNumber}` });
      return;
    }
    const rawStartMs = parseTimestampToMs(sh, sm, ss, sms);
    const rawEndMs = parseTimestampToMs(eh, em, es, ems);

    const startMs = snapMsToFrame(rawStartMs);
    const endMs = snapMsToFrame(rawEndMs);
    const durationMs = endMs - startMs;

    if (durationMs < 0) {
      errors.push({
        line: lineNumber,
        message: `Line ${lineNumber}: end time is before start time for tag "${tag}"`,
      });
      return;
    }

    if (durationMs === 0) {
      warnings.push({
        line: lineNumber,
        message: `Line ${lineNumber}: zero-duration section for tag "${tag}"`,
      });
    }

    // Validate against the raw user-typed end time, not the frame-snapped
    // value. Frame-snap rounds to the nearest 30fps frame, which can shift
    // the end up by sub-frame ms (e.g. 315533 → 315533.333) and produce a
    // false-positive when the timestamp lands exactly at audio end.
    if (audioDurationMs !== null && rawEndMs > audioDurationMs) {
      errors.push({
        line: lineNumber,
        message: `Line ${lineNumber}: end time ${formatTimestamp(rawEndMs / 1000)} exceeds audio duration ${formatTimestamp(audioDurationMs / 1000)}`,
      });
      return;
    }

    if (!availableBaseNames.has(tag.toLowerCase())) {
      warnings.push({
        line: lineNumber,
        message: `Line ${lineNumber}: tag "${tag}" has no matching B-roll base name. Will render black frames.`,
      });
    }

    sections.push({
      lineNumber,
      startTime: startMs / 1000,
      endTime: endMs / 1000,
      tag,
      scriptText: scriptText.trim(),
      durationMs,
    });
  });

  // Overlap detection: sort by startTime, check adjacent pairs.
  const sorted = [...sections].sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (curr.startTime < prev.endTime) {
      errors.push({
        line: curr.lineNumber,
        message: `Line ${curr.lineNumber}: time range [${formatTimestamp(curr.startTime)}, ${formatTimestamp(curr.endTime)}] overlaps line ${prev.lineNumber} [${formatTimestamp(prev.startTime)}, ${formatTimestamp(prev.endTime)}]`,
      });
    }
  }

  return { sections, errors, warnings };
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}
