export interface ParsedSection {
  lineNumber: number;
  startTime: number;
  endTime: number;
  tag: string;
  scriptText: string;
  durationMs: number;
}

export interface ParseResult {
  sections: ParsedSection[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

const LINE_PATTERN =
  /^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\|\|\s*(.+?)\s*\|\|\s*(.*)$/;

function parseTime(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
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
      errors.push({ line: lineNumber, message: `Invalid format at line ${lineNumber}` });
      return;
    }

    const [, startStr, endStr, tag, scriptText] = match;
    const startTime = parseTime(startStr);
    const endTime = parseTime(endStr);
    const durationMs = (endTime - startTime) * 1000;

    if (durationMs === 0) {
      warnings.push({ line: lineNumber, message: `Line ${lineNumber}: zero-duration section for tag "${tag}"` });
    }

    if (!availableBaseNames.has(tag.toLowerCase())) {
      warnings.push({
        line: lineNumber,
        message: `Line ${lineNumber}: tag "${tag}" has no matching B-roll base name. Will render black frames.`,
      });
    }

    sections.push({ lineNumber, startTime, endTime, tag, scriptText: scriptText.trim(), durationMs });
  });

  return { sections, errors, warnings };
}
