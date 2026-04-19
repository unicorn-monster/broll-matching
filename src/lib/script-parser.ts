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
//   HH:MM:SS,mmm --> HH:MM:SS,mmm || tag || text
//   MM:SS,mmm    --> MM:SS,mmm    || tag || text
//   HH:MM:SS     --> HH:MM:SS     || tag || text   (ms = 000)
//   MM:SS        --> MM:SS        || tag || text   (ms = 000)
const TIMESTAMP = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:,(\d{1,3}))?`;
const LINE_PATTERN = new RegExp(
  `^${TIMESTAMP}\\s*-->\\s*${TIMESTAMP}\\s*\\|\\|\\s*(.+?)\\s*\\|\\|\\s*(.*)$`,
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

export function parseScript(text: string, availableBaseNames: Set<string>): ParseResult {
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
        message: `Invalid format at line ${lineNumber} (expected "HH:MM:SS,mmm --> HH:MM:SS,mmm || tag || text")`,
      });
      return;
    }

    const [, sh, sm, ss, sms, eh, em, es, ems, tag, scriptText] = match;
    const rawStartMs = parseTimestampToMs(sh, sm, ss, sms);
    const rawEndMs = parseTimestampToMs(eh, em, es, ems);

    const startMs = snapMsToFrame(rawStartMs);
    const endMs = snapMsToFrame(rawEndMs);
    const durationMs = endMs - startMs;

    if (durationMs === 0) {
      warnings.push({
        line: lineNumber,
        message: `Line ${lineNumber}: zero-duration section for tag "${tag}"`,
      });
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

  return { sections, errors, warnings };
}
