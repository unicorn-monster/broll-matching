import {
  FULL_LAYER_TAG,
  makeLayerFileId,
  OVERLAY_LAYER_TAG,
  type TalkingHeadKind,
  type TalkingHeadLayer,
} from "./talking-head-types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function tagForKind(kind: TalkingHeadKind): string {
  return kind === "full" ? FULL_LAYER_TAG : OVERLAY_LAYER_TAG;
}

export type StoreOk = { ok: true; layers: TalkingHeadLayer[]; files: Map<string, File> };
export type RemoveResult = { layers: TalkingHeadLayer[]; files: Map<string, File> };

/** Adds a new layer of the given kind. If one already exists with that kind,
 *  it is REPLACED — both the layer record and the file belonging to the old
 *  one are removed. Overlay layers are ready immediately on upload (no
 *  matting state): the uploaded file is expected to already contain alpha. */
export function addOrReplaceLayer(
  layers: TalkingHeadLayer[],
  args: { kind: TalkingHeadKind; file: File; label?: string },
  filesArg?: Map<string, File>,
): StoreOk {
  const existing = layers.find((l) => l.kind === args.kind);
  const remainingLayers = existing ? layers.filter((l) => l.id !== existing.id) : layers;
  const files = new Map(filesArg);
  if (existing) {
    files.delete(existing.fileId);
  }

  const id = newId();
  const fileId = makeLayerFileId(id);
  const layer: TalkingHeadLayer = {
    id,
    tag: tagForKind(args.kind),
    fileId,
    kind: args.kind,
    ...(args.label ? { label: args.label } : {}),
  };
  files.set(fileId, args.file);
  return { ok: true, layers: [...remainingLayers, layer], files };
}

export function getLayerByKind(
  layers: TalkingHeadLayer[],
  kind: TalkingHeadKind,
): TalkingHeadLayer | undefined {
  return layers.find((l) => l.kind === kind);
}

export function findLayerByTag(
  layers: TalkingHeadLayer[],
  tag: string,
): TalkingHeadLayer | undefined {
  const k = tag.trim().toLowerCase();
  return layers.find((l) => l.tag === k);
}

export function removeLayer(
  layers: TalkingHeadLayer[],
  id: string,
  filesArg?: Map<string, File>,
): RemoveResult {
  const target = layers.find((l) => l.id === id);
  const files = new Map(filesArg);
  if (target) {
    files.delete(target.fileId);
  }
  return {
    layers: layers.filter((l) => l.id !== id),
    files,
  };
}

/** Backfills `kind: 'full'` on any layer read from older IDB records that
 *  pre-date the kind field. Idempotent. */
export function normalizeLegacyLayer(
  layer: TalkingHeadLayer & { kind?: TalkingHeadKind },
): TalkingHeadLayer {
  if (layer.kind) return layer;
  return { ...layer, kind: "full", tag: FULL_LAYER_TAG };
}
