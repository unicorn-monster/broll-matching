export const BROLL_NAME_PATTERN = /^[a-z0-9-]+-\d+$/;

export function deriveBaseName(brollName: string): string {
  return brollName.replace(/-\d+$/, "");
}

export function isValidBrollName(name: string): boolean {
  return BROLL_NAME_PATTERN.test(name);
}

export function filenameToBrollName(filename: string): string {
  return filename.replace(/\.mp4$/i, "").toLowerCase();
}
