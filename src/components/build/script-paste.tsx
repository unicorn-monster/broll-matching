"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseScript, type ParsedSection } from "@/lib/script-parser";
import { buildClipsByBaseName, matchSections, type MatchedSection } from "@/lib/auto-match";
import { useMediaPool } from "@/state/media-pool";

interface ScriptPasteProps {
  text: string;
  onTextChange: (t: string) => void;
  availableBaseNames: Set<string>;
  audioDurationMs: number | null;
  onParsed: (sections: ParsedSection[], timeline: MatchedSection[]) => void;
}

interface ParsedResult {
  sections: ParsedSection[];
  timeline: MatchedSection[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

interface LineStatus {
  lineNumber: number;
  status: "ok" | "warning" | "error";
  tag: string | undefined;
  messages: string[];
  scriptText: string | undefined;
}

function buildLineStatuses(text: string, result: ParsedResult): LineStatus[] {
  const lines = text.split("\n");
  const errorsByLine = new Map<number, string[]>();
  result.errors.forEach((e) => {
    if (!errorsByLine.has(e.line)) errorsByLine.set(e.line, []);
    errorsByLine.get(e.line)!.push(e.message);
  });
  const warningsByLine = new Map<number, string[]>();
  result.warnings.forEach((w) => {
    if (!warningsByLine.has(w.line)) warningsByLine.set(w.line, []);
    warningsByLine.get(w.line)!.push(w.message);
  });
  const sectionsByLine = new Map(result.sections.map((s) => [s.lineNumber, s]));

  const statuses: LineStatus[] = [];
  lines.forEach((raw, idx) => {
    const lineNumber = idx + 1;
    if (!raw.trim()) return;
    const errs = errorsByLine.get(lineNumber);
    const warns = warningsByLine.get(lineNumber);
    const section = sectionsByLine.get(lineNumber);
    if (errs) {
      statuses.push({ lineNumber, status: "error", tag: section?.tag, messages: errs, scriptText: undefined });
    } else if (warns) {
      statuses.push({ lineNumber, status: "warning", tag: section?.tag, messages: warns, scriptText: section?.scriptText });
    } else {
      statuses.push({ lineNumber, status: "ok", tag: section?.tag, messages: [], scriptText: section?.scriptText });
    }
  });
  return statuses;
}

export function ScriptPaste({ text, onTextChange, availableBaseNames, audioDurationMs, onParsed }: ScriptPasteProps) {
  const mediaPool = useMediaPool();
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleParse() {
    const result = parseScript(text, availableBaseNames, audioDurationMs);

    if (result.errors.length > 0) {
      setParsedResult({ sections: result.sections, timeline: [], errors: result.errors, warnings: result.warnings });
      return;
    }

    setLoading(true);
    try {
      const clips = mediaPool.videos;
      const clipsByBaseName = buildClipsByBaseName(clips);
      const timeline = matchSections(result.sections, clipsByBaseName);
      setParsedResult({ sections: result.sections, timeline, errors: [], warnings: result.warnings });
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    if (!parsedResult || parsedResult.errors.length > 0) return;
    onParsed(parsedResult.sections, parsedResult.timeline);
  }

  const lineStatuses = parsedResult ? buildLineStatuses(text, parsedResult) : null;
  const hasErrors = !!parsedResult && parsedResult.errors.length > 0;
  const okCount = lineStatuses?.filter((l) => l.status === "ok").length ?? 0;
  const warnCount = lineStatuses?.filter((l) => l.status === "warning").length ?? 0;
  const errCount = lineStatuses?.filter((l) => l.status === "error").length ?? 0;

  return (
    <div className="space-y-3 min-w-0">
      <textarea
        value={text}
        onChange={(e) => { onTextChange(e.target.value); setParsedResult(null); }}
        wrap="soft"
        style={{ wordBreak: "break-all", overflowWrap: "anywhere", maxWidth: "100%" }}
        className="block w-full h-64 font-mono text-xs border border-border rounded-lg p-3 bg-background resize-y focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={"00:00:01,250 --> 00:00:02,833 || Script text here || hook\n00:00:02,833 --> 00:00:12,000 || More script || fs-clipper-freakout"}
      />

      {lineStatuses && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex gap-4 px-3 py-2 bg-muted/50 text-xs font-medium border-b border-border">
            <span className="text-green-600">{okCount} OK</span>
            {warnCount > 0 && <span className="text-yellow-600">{warnCount} warning{warnCount > 1 ? "s" : ""}</span>}
            {errCount > 0 && <span className="text-destructive">{errCount} error{errCount > 1 ? "s" : ""}</span>}
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-border">
            {lineStatuses.map(({ lineNumber, status, tag, messages, scriptText }) => (
              <div key={lineNumber} className="flex gap-2 items-baseline px-3 py-1.5 text-sm">
                <span className={
                  status === "ok" ? "text-green-600 shrink-0" :
                  status === "warning" ? "text-yellow-600 shrink-0" :
                  "text-destructive shrink-0"
                }>
                  {status === "ok" ? "✓" : status === "warning" ? "⚠" : "✗"}
                </span>
                <span className="text-muted-foreground font-mono shrink-0 text-xs">L{lineNumber}</span>
                {tag && (
                  <span className="font-mono font-semibold shrink-0 text-xs">[{tag}]</span>
                )}
                {messages.length > 0 ? (
                  <span className={`text-xs flex-1 min-w-0 break-words ${status === "warning" ? "text-yellow-600" : "text-destructive"}`}>
                    {messages.join(" · ")}
                  </span>
                ) : (
                  scriptText && (
                    <span className="text-muted-foreground text-xs flex-1 min-w-0 truncate" title={scriptText}>{scriptText}</span>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleParse} disabled={!text.trim() || loading} variant="outline">
          {loading ? "Parsing…" : parsedResult ? "Re-parse" : "Parse Script"}
        </Button>
        {parsedResult && !hasErrors && (
          <Button onClick={handleApply}>
            Apply to Timeline
          </Button>
        )}
      </div>
    </div>
  );
}
