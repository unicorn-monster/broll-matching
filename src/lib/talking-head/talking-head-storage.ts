import { openMediaDB, type TalkingHeadLayerRecord, type FileRecord } from "@/lib/media-storage";
import type { TalkingHeadLayer } from "./talking-head-types";

export async function loadAllTalkingHeadLayers(): Promise<{
  layers: TalkingHeadLayer[];
  files: Map<string, File>;
}> {
  const db = await openMediaDB();
  try {
    const records = (await db.getAll("talkingHeadLayers")) as TalkingHeadLayerRecord[];
    const layers: TalkingHeadLayer[] = records.map((r) => ({
      id: r.id,
      tag: r.tag,
      fileId: r.fileId,
      ...(r.label ? { label: r.label } : {}),
    }));
    const files = new Map<string, File>();
    for (const r of records) {
      const fileRec = (await db.get("files", r.fileId)) as FileRecord | undefined;
      if (!fileRec) continue;
      files.set(r.fileId, new File([fileRec.blob], fileRec.filename, { type: fileRec.type }));
    }
    return { layers, files };
  } finally {
    db.close();
  }
}

export async function persistTalkingHeadLayer(
  layer: TalkingHeadLayer,
  file: File,
): Promise<void> {
  const db = await openMediaDB();
  try {
    const tx = db.transaction(["talkingHeadLayers", "files"], "readwrite");
    await tx.objectStore("talkingHeadLayers").put({
      id: layer.id,
      tag: layer.tag,
      fileId: layer.fileId,
      ...(layer.label ? { label: layer.label } : {}),
      createdAt: new Date(),
    } satisfies TalkingHeadLayerRecord);
    await tx.objectStore("files").put({
      id: layer.fileId,
      blob: file,
      type: file.type || "video/mp4",
      filename: file.name || "talking-head.mp4",
    });
    await tx.done;
  } finally {
    db.close();
  }
}

export async function persistTalkingHeadLayerTagOnly(layer: TalkingHeadLayer): Promise<void> {
  const db = await openMediaDB();
  try {
    await db.put("talkingHeadLayers", {
      id: layer.id,
      tag: layer.tag,
      fileId: layer.fileId,
      ...(layer.label ? { label: layer.label } : {}),
      createdAt: new Date(),
    } satisfies TalkingHeadLayerRecord);
  } finally {
    db.close();
  }
}

export async function deleteTalkingHeadLayer(layerId: string, fileId: string): Promise<void> {
  const db = await openMediaDB();
  try {
    const tx = db.transaction(["talkingHeadLayers", "files"], "readwrite");
    await tx.objectStore("talkingHeadLayers").delete(layerId);
    await tx.objectStore("files").delete(fileId);
    await tx.done;
  } finally {
    db.close();
  }
}
