// src/lib/talking-head/talking-head-types.ts

export const TH_LAYER_FILE_ID_PREFIX = "__th_layer__";

export type TalkingHeadKind = "full" | "overlay";

/** One talking-head source: a video file paired with a script tag.
 *  Files live in BuildState (talkingHeadFiles, keyed by fileId).
 *
 *  For overlay-kind layers the uploaded file IS the matted/transparent video
 *  (user pre-processes background removal in CapCut → HEVC-alpha mp4). The
 *  app does no in-browser matting — ffmpeg's overlay filter handles the
 *  alpha composition server-side. */
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
}

export function makeLayerFileId(layerId: string): string {
  return `${TH_LAYER_FILE_ID_PREFIX}${layerId}`;
}

export function isLayerFileId(fileId: string): boolean {
  return fileId.startsWith(TH_LAYER_FILE_ID_PREFIX);
}

export const FULL_LAYER_TAG = "talking-head-full";
export const OVERLAY_LAYER_TAG = "talking-head-overlay";
