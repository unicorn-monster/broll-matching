import { makeLayerFileId, type TalkingHeadLayer } from "./talking-head-types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function normalize(tag: string): string {
  return tag.trim().toLowerCase();
}

export type StoreOk = { ok: true; layers: TalkingHeadLayer[]; files: Map<string, File> };
export type StoreErr = { ok: false; reason: "duplicate-tag" | "empty-tag" | "not-found" };
export type StoreResult = StoreOk | StoreErr;

/** Rename does not touch the files Map; the return shape omits it so callers cannot
 *  accidentally clobber their in-memory file mirror. */
export type RenameOk = { ok: true; layers: TalkingHeadLayer[] };
export type RenameResult = RenameOk | StoreErr;

export function addLayer(
  layers: TalkingHeadLayer[],
  args: { tag: string; file: File; label?: string },
  filesArg?: Map<string, File>,
): StoreResult {
  const tag = normalize(args.tag);
  if (tag.length === 0) return { ok: false, reason: "empty-tag" };
  if (layers.some((l) => l.tag === tag)) return { ok: false, reason: "duplicate-tag" };
  const id = newId();
  const fileId = makeLayerFileId(id);
  const layer: TalkingHeadLayer = { id, tag, fileId, ...(args.label ? { label: args.label } : {}) };
  const files = new Map(filesArg);
  files.set(fileId, args.file);
  return { ok: true, layers: [...layers, layer], files };
}

export function removeLayer(layers: TalkingHeadLayer[], id: string): TalkingHeadLayer[] {
  return layers.filter((l) => l.id !== id);
}

export function renameLayer(
  layers: TalkingHeadLayer[],
  id: string,
  newTag: string,
): RenameResult {
  const tag = normalize(newTag);
  if (tag.length === 0) return { ok: false, reason: "empty-tag" };
  const target = layers.find((l) => l.id === id);
  if (!target) return { ok: false, reason: "not-found" };
  if (layers.some((l) => l.id !== id && l.tag === tag)) return { ok: false, reason: "duplicate-tag" };
  return {
    ok: true,
    layers: layers.map((l) => (l.id === id ? { ...l, tag } : l)),
  };
}

export function findLayerByTag(
  layers: TalkingHeadLayer[],
  tag: string,
): TalkingHeadLayer | undefined {
  const k = normalize(tag);
  return layers.find((l) => l.tag === k);
}

export function migrateFromLegacyTh(
  legacyFile: File | null,
  legacyTag: string,
): { layers: TalkingHeadLayer[]; files: Map<string, File> } {
  if (!legacyFile || legacyTag.trim().length === 0) return { layers: [], files: new Map() };
  const id = newId();
  const fileId = makeLayerFileId(id);
  return {
    layers: [{ id, tag: normalize(legacyTag), fileId }],
    files: new Map([[fileId, legacyFile]]),
  };
}
