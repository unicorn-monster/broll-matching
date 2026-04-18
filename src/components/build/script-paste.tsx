"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseScript, type ParsedSection } from "@/lib/script-parser";
import { buildClipsByBaseName, matchSections, type MatchedSection, type ClipMetadata } from "@/lib/auto-match";
import { deriveBaseName } from "@/lib/broll";

interface ScriptPasteProps {
  availableBaseNames: Set<string>;
  productId: string;
  onParsed: (sections: ParsedSection[], timeline: MatchedSection[]) => void;
}

export function ScriptPaste({ availableBaseNames, productId, onParsed }: ScriptPasteProps) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [warnings, setWarnings] = useState<{ line: number; message: string }[]>([]);
  const [parsed, setParsed] = useState(false);

  async function handleParse() {
    const result = parseScript(text, availableBaseNames);
    setErrors(result.errors);
    setWarnings(result.warnings);

    if (result.errors.length > 0) return;

    const clipsRes = await fetch(`/api/products/${productId}/clips`);
    const rawClips = await clipsRes.json();
    const clips: ClipMetadata[] = rawClips.map((c: any) => ({
      ...c,
      baseName: deriveBaseName(c.brollName),
      createdAt: new Date(c.createdAt),
    }));
    const clipsByBaseName = buildClipsByBaseName(clips);
    const timeline = matchSections(result.sections, clipsByBaseName);

    setParsed(true);
    onParsed(result.sections, timeline);
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setParsed(false); }}
        className="w-full h-48 font-mono text-sm border border-border rounded-lg p-3 bg-background resize-y focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={"00:00 - 00:04 || hook || Script text here\n00:04 - 00:12 || fs-clipper-freakout || More script"}
      />

      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-sm text-destructive">Line {e.line}: {e.message}</p>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-yellow-600">⚠ Line {w.line}: {w.message}</p>
          ))}
        </div>
      )}

      <Button onClick={handleParse} disabled={!text.trim()}>
        {parsed ? "Re-parse" : "Parse Script"}
      </Button>
    </div>
  );
}
