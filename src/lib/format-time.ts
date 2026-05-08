// Formats a millisecond duration as M:SS.mmm (e.g., 1833.333 → "0:01.833")
export function formatMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const secondsFloat = totalSeconds - minutes * 60;
  const wholeSeconds = Math.floor(secondsFloat);
  const fractionalMs = Math.round((secondsFloat - wholeSeconds) * 1000);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(fractionalMs).padStart(3, "0")}`;
}
