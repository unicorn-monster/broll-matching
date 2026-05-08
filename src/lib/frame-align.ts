export const DEFAULT_FPS = 30;

export function msToFrames(ms: number, fps: number = DEFAULT_FPS): number {
  return Math.round((ms * fps) / 1000);
}

export function framesToMs(frames: number, fps: number = DEFAULT_FPS): number {
  return (frames * 1000) / fps;
}

export function snapMsToFrame(ms: number, fps: number = DEFAULT_FPS): number {
  return framesToMs(msToFrames(ms, fps), fps);
}
