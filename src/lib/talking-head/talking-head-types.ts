// src/lib/talking-head/talking-head-types.ts

export const TH_LAYER_FILE_ID_PREFIX = "__th_layer__";
export const TH_MATTED_FILE_ID_PREFIX = "__th_matted__";

export type TalkingHeadKind = "full" | "overlay";
export type MattingStatus = "processing" | "ready" | "failed";

export interface MattingProgress {
  framesDone: number;
  totalFrames: number;
}

/** One talking-head source: a video file paired with a script tag.
 *  Files (original and, for overlay layers, the matted webm) live in BuildState. */
export interface TalkingHeadLayer {
  /** Stable id (uuid). */
  id: string;
  /** Script tag this layer claims — for fixed layers this is always
   *  'talking-head-full' or 'talking-head-overlay' (lowercase). */
  tag: string;
  /** Synthetic file id used in MatchedClip.fileId and the multipart upload field name. */
  fileId: string;
  /** Optional human label (defaults to filename in UI). */
  label?: string;
  /** Layer kind. Defaults to 'full' for legacy records (see store.normalizeLegacyLayer). */
  kind: TalkingHeadKind;
  /** Synthetic id for the matted webm file. Only set on overlay layers when matting succeeded. */
  mattedFileId?: string;
  /** Overlay-layer matting state machine. Absent on full layers. */
  mattingStatus?: MattingStatus;
  /** Overlay-layer matting progress while `mattingStatus === 'processing'`. */
  mattingProgress?: MattingProgress;
}

export function makeLayerFileId(layerId: string): string {
  return `${TH_LAYER_FILE_ID_PREFIX}${layerId}`;
}

export function isLayerFileId(fileId: string): boolean {
  return fileId.startsWith(TH_LAYER_FILE_ID_PREFIX);
}

export function makeMattedFileId(layerId: string): string {
  return `${TH_MATTED_FILE_ID_PREFIX}${layerId}`;
}

export function isMattedFileId(fileId: string): boolean {
  return fileId.startsWith(TH_MATTED_FILE_ID_PREFIX);
}

export const FULL_LAYER_TAG = "talking-head-full";
export const OVERLAY_LAYER_TAG = "talking-head-overlay";
