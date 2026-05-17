export type SupportResult =
  | { ok: true }
  | { ok: false; reason: "no-webcodecs" | "mobile-not-supported" };

export function canMatte(env: { hasVideoEncoder: boolean; isMobile: boolean }): SupportResult {
  if (!env.hasVideoEncoder) return { ok: false, reason: "no-webcodecs" };
  if (env.isMobile) return { ok: false, reason: "mobile-not-supported" };
  return { ok: true };
}

export function detectMattingSupport(): SupportResult {
  if (typeof window === "undefined") return { ok: false, reason: "no-webcodecs" };
  const hasVideoEncoder = typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === "function";
  const isMobile = /Android|Mobile|iPhone|iPad/i.test(navigator.userAgent);
  return canMatte({ hasVideoEncoder, isMobile });
}
