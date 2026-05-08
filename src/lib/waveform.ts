/**
 * Decode an audio file's bytes and downsample to `peakCount` peaks
 * (max-abs of each window). Returns Float32Array in [0, 1] range.
 *
 * Decoding is async and main-thread; for typical VSL audio (<10MB / <30 min)
 * this finishes in ~100ms on a modern machine. Caller decides cache strategy.
 */
export async function computeWaveformPeaks(
  audioBytes: ArrayBuffer,
  peakCount: number,
): Promise<Float32Array> {
  const Ctx: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    // decodeAudioData mutates the buffer in some browsers — copy first.
    const decoded = await ctx.decodeAudioData(audioBytes.slice(0));
    const channel = decoded.getChannelData(0);
    const windowSize = Math.max(1, Math.floor(channel.length / peakCount));
    const peaks = new Float32Array(peakCount);
    for (let i = 0; i < peakCount; i++) {
      let max = 0;
      const start = i * windowSize;
      // Floor division leaves a remainder when channel.length is not a
      // multiple of peakCount. Extend the final window to channel.length
      // so trailing samples are included in the last peak instead of dropped.
      const end =
        i === peakCount - 1
          ? channel.length
          : Math.min(start + windowSize, channel.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]!);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  } finally {
    void ctx.close();
  }
}
