"use client";

interface TimelineRulerProps {
  totalMs: number;
  pxPerSecond: number;
}

function formatTick(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TimelineRuler({ totalMs, pxPerSecond }: TimelineRulerProps) {
  const totalSec = totalMs / 1000;
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120];
  const major = candidates.find((c) => c * pxPerSecond >= 60) ?? 60;
  const tickCount = Math.ceil(totalSec / major) + 1;

  return (
    <div className="relative h-5 border-b border-border text-[10px] text-muted-foreground select-none">
      {Array.from({ length: tickCount }, (_, i) => {
        const sec = i * major;
        const left = sec * pxPerSecond;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/60 pl-1"
            style={{ left: `${left}px` }}
          >
            {formatTick(sec)}
          </div>
        );
      })}
    </div>
  );
}
