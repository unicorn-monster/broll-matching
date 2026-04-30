"use client";

import { useState } from "react";

export interface OutputSize {
  width: number;
  height: number;
}

const PRESETS: { label: string; size: OutputSize }[] = [
  { label: "1080×1350 (4:5)", size: { width: 1080, height: 1350 } },
  { label: "1080×1920 (9:16)", size: { width: 1080, height: 1920 } },
  { label: "1920×1080 (16:9)", size: { width: 1920, height: 1080 } },
];

export function isValidSize(s: OutputSize): boolean {
  return (
    s.width >= 240 && s.width <= 4096 && s.width % 2 === 0 &&
    s.height >= 240 && s.height <= 4096 && s.height % 2 === 0
  );
}

interface Props {
  value: OutputSize;
  onChange: (s: OutputSize) => void;
}

export function OutputSizeSelect({ value, onChange }: Props) {
  const matchedPreset = PRESETS.find(
    (p) => p.size.width === value.width && p.size.height === value.height,
  );
  const [mode, setMode] = useState<"preset" | "custom">(matchedPreset ? "preset" : "custom");

  return (
    <div className="space-y-2">
      <select
        value={mode === "preset" && matchedPreset ? matchedPreset.label : "custom"}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setMode("custom");
          } else {
            const p = PRESETS.find((p) => p.label === e.target.value);
            if (p) {
              setMode("preset");
              onChange(p.size);
            }
          }
        }}
        className="w-full border border-border rounded px-2 py-1 text-sm bg-background"
      >
        {PRESETS.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {mode === "custom" && (
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={value.width}
            onChange={(e) => onChange({ ...value, width: Number(e.target.value) })}
            className="w-20 border border-border rounded px-2 py-1 text-sm"
          />
          <span>×</span>
          <input
            type="number"
            value={value.height}
            onChange={(e) => onChange({ ...value, height: Number(e.target.value) })}
            className="w-20 border border-border rounded px-2 py-1 text-sm"
          />
          {!isValidSize(value) && (
            <span className="text-xs text-destructive">Invalid (need even, 240–4096)</span>
          )}
        </div>
      )}
    </div>
  );
}
