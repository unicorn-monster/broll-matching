// src/lib/talking-head/talking-head-types.ts

export const TH_LAYER_FILE_ID_PREFIX = "__th_layer__";

/** One talking-head source: a video file paired with a script tag.
 *  The File itself lives in BuildState (in-memory mirror of IndexedDB). */
export interface TalkingHeadLayer {
  /** Stable id (uuid). */
  id: string;
  /** Script tag this layer claims, stored lowercase. */
  tag: string;
  /** Synthetic file id used in MatchedClip.fileId and the multipart upload field name. */
  fileId: string;
  /** Optional human label (defaults to tag in UI when empty). */
  label?: string;
}

export function makeLayerFileId(layerId: string): string {
  return `${TH_LAYER_FILE_ID_PREFIX}${layerId}`;
}

export function isLayerFileId(fileId: string): boolean {
  return fileId.startsWith(TH_LAYER_FILE_ID_PREFIX);
}
