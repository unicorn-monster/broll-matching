export interface ParsedSection {
  lineNumber: number;
  startTime: number; // seconds
  endTime: number; // seconds
  tag: string; // original tag text (trimmed)
  scriptText: string; // script content
  durationMs: number; // (endTime - startTime) * 1000
}

export interface ParseResult {
  sections: ParsedSection[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

// Matches: HH:MM:SS or MM:SS
const TIMESTAMP_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;

// Full line: <timestamp> - <timestamp> || <tag> || <script>
const LINE_RE =
  /^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\|\|\s*(.+?)\s*\|\|\s*(.+)$/;

/**
 * Parse a timestamp string ("MM:SS" or "HH:MM:SS") to seconds.
 * Returns null if the string is not a valid timestamp.
 */
function parseTimestamp(ts: string): number | null {
  if (!TIMESTAMP_RE.test(ts)) return null;
  const parts = ts.split(":").map(Number);
  if (parts.some((p) => isNaN(p))) return null;

  if (parts.length === 2) {
    // MM:SS
    const [m, s] = parts as [number, number];
    if (s >= 60) return null;
    return m * 60 + s;
  }

  // HH:MM:SS
  const [h, m, s] = parts as [number, number, number];
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/**
 * Parse a multi-line timestamped script into structured sections.
 *
 * Each non-blank line must follow the format:
 *   HH:MM:SS - HH:MM:SS || Tag Name || Script text
 *   MM:SS    - MM:SS    || Tag Name || Script text  (shorthand)
 *
 * @param input     - Raw script text from textarea
 * @param knownTags - List of tag names to validate against (case-insensitive)
 */
export function parseScript(input: string, knownTags: string[]): ParseResult {
  const sections: ParsedSection[] = [];
  const errors: { line: number; message: string }[] = [];
  const warnings: { line: number; message: string }[] = [];

  if (!input.trim()) {
    return { sections, errors, warnings };
  }

  const knownLower = new Set(knownTags.map((t) => t.toLowerCase()));
  const lines = input.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();

    // Skip blank lines silently
    if (!trimmed) continue;

    const match = LINE_RE.exec(trimmed);
    if (!match) {
      errors.push({
        line: lineNumber,
        message: `Invalid format. Expected: HH:MM:SS - HH:MM:SS || Tag || Script text`,
      });
      continue;
    }

    const rawStart = match[1]!;
    const rawEnd = match[2]!;
    const tag = match[3]!;
    const scriptText = match[4]!;

    const startTime = parseTimestamp(rawStart);
    if (startTime === null) {
      errors.push({ line: lineNumber, message: `Invalid start timestamp: "${rawStart}"` });
      continue;
    }

    const endTime = parseTimestamp(rawEnd);
    if (endTime === null) {
      errors.push({ line: lineNumber, message: `Invalid end timestamp: "${rawEnd}"` });
      continue;
    }

    if (endTime < startTime) {
      errors.push({
        line: lineNumber,
        message: `End time (${rawEnd}) is before start time (${rawStart})`,
      });
      continue;
    }

    const durationMs = (endTime - startTime) * 1000;

    if (durationMs === 0) {
      warnings.push({
        line: lineNumber,
        message: `Section has zero duration (${rawStart} - ${rawEnd})`,
      });
    }

    if (!knownLower.has(tag.toLowerCase())) {
      warnings.push({
        line: lineNumber,
        message: `Unrecognized tag: "${tag}"`,
      });
    }

    sections.push({
      lineNumber,
      startTime,
      endTime,
      tag,
      scriptText,
      durationMs,
    });
  }

  return { sections, errors, warnings };
}
