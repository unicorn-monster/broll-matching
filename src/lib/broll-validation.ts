const VIDEO_EXTS = [".mp4", ".mov", ".webm"];
const BROLL_PATTERN = /^[a-z0-9-]+-\d+$/;

export type SkippedReason =
  | "not a video file"
  | "must be lowercase, no spaces"
  | "must end with -NN"
  | "must match tag-NN pattern"
  | "broll name already exists in this folder"
  | "failed to read video metadata";

export type ValidationResult =
  | { valid: true; brollName: string }
  | { valid: false; reason: SkippedReason };

export function validateBrollFile(file: File): ValidationResult {
  const name = file.name;
  const lower = name.toLowerCase();
  const matchedExt = VIDEO_EXTS.find((e) => lower.endsWith(e));
  if (!matchedExt) return { valid: false, reason: "not a video file" };

  const stem = name.slice(0, name.length - matchedExt.length);

  if (stem !== stem.toLowerCase() || /\s/.test(stem)) {
    return { valid: false, reason: "must be lowercase, no spaces" };
  }

  if (BROLL_PATTERN.test(stem)) {
    return { valid: true, brollName: stem };
  }

  if (!/-\d+$/.test(stem)) {
    return { valid: false, reason: "must end with -NN" };
  }

  return { valid: false, reason: "must match tag-NN pattern" };
}
