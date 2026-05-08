export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
}

export function extractVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeEventListener("loadedmetadata", onLoad);
      video.removeEventListener("error", onError);
    };

    const onLoad = () => {
      // Livestreams and malformed files can produce non-finite durations.
      if (!Number.isFinite(video.duration)) {
        cleanup();
        reject(new Error(`Invalid duration for ${file.name}`));
        return;
      }
      // Corrupt headers can leave dimensions at zero.
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        cleanup();
        reject(new Error(`Invalid dimensions for ${file.name}`));
        return;
      }
      const meta = {
        durationMs: Math.round(video.duration * 1000),
        width: video.videoWidth,
        height: video.videoHeight,
      };
      cleanup();
      resolve(meta);
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load metadata for ${file.name}`));
    };

    video.addEventListener("loadedmetadata", onLoad);
    video.addEventListener("error", onError);
    video.src = url;
  });
}
