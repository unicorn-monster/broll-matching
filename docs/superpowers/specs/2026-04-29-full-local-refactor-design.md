# Full-local Refactor — Design

**Date:** 2026-04-29
**Branch:** `feat/srt-style-script-format`
**Scope:** Bỏ Supabase + IndexedDB + FFmpeg-on-import, chuyển app sang full-local CapCut-style.

## Goal

Biến app từ "upload-then-process" (20–30s/clip) thành "instant-import" (<1s cho cả folder) bằng cách dùng `showDirectoryPicker` + đọc metadata qua `HTMLVideoElement`. Toàn bộ video bytes ở lại disk, không lưu vào DB hay IndexedDB.

App là dev-tool localhost-only, Chrome-only — được phép dùng File System Access API.

## Non-goals

- Cross-browser support (Safari/Firefox không support `showDirectoryPicker`)
- Persist state qua refresh (refresh = chọn folder lại; user đã đồng ý)
- Migration data cũ trong Supabase (xoá hẳn)
- Multi-audio (chỉ 1 audio chính, giữ đơn giản)

## Architecture

### Entry flow

```
Trang chủ "/" → button "Chọn folder"
  ↓
showDirectoryPicker() → FileSystemDirectoryHandle
  ↓
Walk recursive → File[]
  ↓
Phân loại theo extension:
  .mp4/.mov/.webm  → videos: File[]
  .mp3/.wav/.m4a   → audios: File[]
  ↓
Parallel HTMLVideoElement metadata extract (~5–50ms/file)
  ↓
Build ClipMetadata[] + AudioFile[] → media-pool context
  ↓
Render editor view, auto-match có thể chạy ngay
```

### Module boundaries

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `src/lib/folder-import.ts` | `pickFolder(): Promise<{videos: File[], audios: File[]}>` — show picker + recursive walk + filter extension | Browser File System Access API |
| `src/lib/video-metadata.ts` | `extractMetadata(file: File): Promise<{durationMs, width, height}>` qua HTMLVideoElement + ObjectURL | DOM API |
| `src/state/media-pool.tsx` | React Context giữ `videos: ClipMetadata[]`, `audios: AudioFile[]`, `fileMap: Map<id, File>`, `selectedAudioId` | React |
| `src/components/folder-picker.tsx` | Landing UI: button + progress bar khi extract metadata | media-pool, folder-import, video-metadata |
| `src/components/render/output-size-select.tsx` | Dropdown 1080x1350 / 1080x1920 / 1920x1080 / custom | UI lib |
| `src/lib/auto-match.ts` | Đổi `indexeddbKey` → `fileId`. Logic không đổi | (none) |
| `src/workers/render-worker.ts` | (a) Đã nhận `clips: Record<string, ArrayBuffer>` — không đổi protocol. (b) Thêm `outputWidth/outputHeight` trong message + scale+pad filter | FFmpeg.wasm |

### Data flow render

```ts
// Main thread khi user bấm Export
const usedIds = collectUsedFileIds(timeline);
const clips: Record<string, ArrayBuffer> = {};
for (const id of usedIds) {
  clips[id] = await fileMap.get(id)!.arrayBuffer();
}
worker.postMessage({
  cmd: 'render',
  timeline,
  audioBuffer: await selectedAudio.arrayBuffer(),
  clips,
  outputWidth: 1080,
  outputHeight: 1350,
});
```

```ts
// Worker per-segment filter
await ffmpeg.exec([
  '-y', '-i', inputName,
  ...(trim ? ['-t', String(trim/1000)] : []),
  '-vf',
  `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
  `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,` +
  `setpts=${(1/speed).toFixed(4)}*PTS`,
  '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
  '-tune', 'fastdecode', '-pix_fmt', 'yuv420p', '-r', '30',
  segName,
]);
```

FFmpeg chỉ load khi user bấm Export, không load lúc import.

## Identity của clips

`ClipMetadata.fileId` = `crypto.randomUUID()` generate lúc import. Lifetime = session. Không stable qua refresh — không cần vì state cũng không persist.

`fileMap: Map<fileId, File>` giữ trong context — render lookup qua đây.

## Audio element behavior

- Audio file trong folder → hiện trong "Media library" panel (filter audio)
- Drag audio xuống audio track → `setSelectedAudioId(id)`
- Render dùng `selectedAudioId` để tìm File trong fileMap → arrayBuffer
- Nếu user chưa chọn audio → render disabled

## Output size

Dropdown trong export dialog:
- 1080×1350 (default, Instagram feed 4:5)
- 1080×1920 (vertical 9:16)
- 1920×1080 (horizontal 16:9)
- Custom (2 input W×H)

Validate: W, H ∈ [240, 4096], cả hai chia hết cho 2 (yêu cầu của libx264 yuv420p).

## Files to remove

```
src/lib/db.ts
src/lib/schema.ts
drizzle.config.ts
drizzle/                          # toàn bộ migrations folder
src/app/api/products/             # toàn bộ
src/app/api/folders/              # toàn bộ (nếu có)
src/app/api/diagnostics/
src/lib/clip-storage.ts
src/components/broll/clip-upload.tsx
scripts/check-db.mjs
scripts/delete-clips.mjs
scripts/setup.ts
src/lib/env.ts                    # nếu chỉ dùng cho POSTGRES_URL
```

`package.json` xoá scripts: `db:generate`, `db:migrate`, `db:push`, `db:studio`, `db:dev`, `db:reset`, `setup`, `env:check`. Sửa `build` bỏ `db:migrate` prefix.

`.env` xoá `POSTGRES_URL`. Có thể xoá luôn `.env` nếu không còn biến nào khác.

Dependencies xoá khỏi `package.json`: `drizzle-orm`, `drizzle-kit`, `postgres`.

## Files to add

```
src/lib/folder-import.ts
src/lib/video-metadata.ts
src/state/media-pool.tsx
src/components/folder-picker.tsx
src/components/render/output-size-select.tsx
```

## Files to modify

| File | Change |
|---|---|
| `src/lib/auto-match.ts` | Rename `ClipMetadata.indexeddbKey` → `fileId`. Sửa các call site. |
| `src/workers/render-worker.ts` | Thêm `outputWidth`/`outputHeight` trong render message. Update filter chain thêm scale+pad. |
| `src/components/build/script-paste.tsx` | Bỏ `fetch('/api/products/.../clips')`, đọc từ media-pool context |
| `src/components/broll/clip-grid.tsx` | Read từ media-pool, hiển thị thumbnail từ ObjectURL của File |
| `src/app/page.tsx` (hoặc layout entry) | Landing = folder picker. Sau khi chọn → mount editor view |
| `src/app/layout.tsx` | Wrap với `<MediaPoolProvider>` |
| Bất cứ chỗ nào dùng `productId` route param | Bỏ — single-page app, không có concept product |

## Testing strategy

- **Unit**:
  - `extractMetadata` — mock `HTMLVideoElement` (jsdom), assert returns duration/width/height
  - `folder-import` — mock `FileSystemDirectoryHandle.values()`, assert filter extension đúng
  - `auto-match` — tests cũ giữ nguyên, chỉ update field name `indexeddbKey` → `fileId`
- **Integration**: render worker với 2 segments khác kích thước → verify output đúng W×H đã set
- **Manual** (Chrome):
  1. Tạo folder `/tmp/test-broll/` chứa 10 file `.mp4` 1080p + 1080×1920 mix, tag theo filename `hook-01.mp4`, `problem-02.mp4`...
  2. Bấm Chọn folder → đo thời gian load < 1s
  3. Paste SRT script → auto-match populate timeline
  4. Drag audio file xuống audio track
  5. Export 1080×1350 → verify output đúng
  6. Export 1080×1920 → verify resize đúng
  7. Refresh → app về landing, state mất hết (expected)

## Error handling

| Scenario | Behavior |
|---|---|
| User cancel folder picker | No-op, ở lại landing |
| Folder rỗng (0 file media) | Toast "Không tìm thấy file media nào" |
| File `.mp4` corrupt → HTMLVideoElement error | Skip file đó, log warning, không break batch |
| User export khi chưa pick audio | Button Export disabled |
| Render fail | Hiện error message từ worker (đã có sẵn) |

## Migration

Không có. Branch này commit `974817b` "trước khi local full" là checkpoint quay về nếu cần.

## Risks

- **Memory**: nếu user pick folder có 100+ video lớn, `File.arrayBuffer()` lúc render sẽ load tất cả vào RAM. Mitigation: chỉ đọc bytes của clips thực sự dùng trong timeline (dedupe theo `fileId`), worker xoá file khỏi memfs sau mỗi segment (đã có sẵn).
- **Permission timeout**: `FileSystemDirectoryHandle` mất permission sau idle. Vì không persist nên user mỗi session đều grant lại — không phải vấn đề.
- **Filename → tag ambiguity**: nếu user đặt tên không theo convention `tag-NN.mp4`, derive sai. Logic `filenameToBrollName` + `isValidBrollName` đã có — hiển thị warning trong UI khi parse fail.
