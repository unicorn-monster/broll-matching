"use client";

import { useState, useCallback } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseScript, type ParseResult } from "@/lib/script-parser";

interface ScriptPasteProps {
  knownTags: string[];
  onParsed: (result: ParseResult) => void;
}

export function ScriptPaste({ knownTags, onParsed }: ScriptPasteProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);

  const handleParse = useCallback(() => {
    const parsed = parseScript(text, knownTags);
    setResult(parsed);
    if (parsed.errors.length === 0 && parsed.sections.length > 0) {
      onParsed(parsed);
    }
  }, [text, knownTags, onParsed]);

  const hasErrors = result && result.errors.length > 0;
  const hasWarnings = result && result.warnings.length > 0;
  const isSuccess =
    result && result.errors.length === 0 && result.sections.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        className="font-mono text-xs resize-none min-h-[160px]"
        placeholder={"00:00 - 00:05 || Hook || Script text here\n00:05 - 00:12 || Product || More script text"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        spellCheck={false}
      />

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleParse} disabled={!text.trim()}>
          Parse Script
        </Button>
        {isSuccess && (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {result.sections.length} section{result.sections.length !== 1 ? "s" : ""} parsed
          </span>
        )}
      </div>

      {(hasErrors || hasWarnings) && (
        <div className="flex flex-col gap-1">
          {result!.errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">Line {e.line}:</span> {e.message}
              </span>
            </div>
          ))}
          {result!.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-400"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">Line {w.line}:</span> {w.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
