# Overlay Flexible Drop Zones (CapCut-Style)

**Date:** 2026-04-29
**Status:** Approved (awaiting implementation plan)

## Problem

Khi kéo b-roll clip từ thư viện vào timeline, hiện tại chỉ có **một** drop zone khả dụng: dải 24px ("+ New track") nằm ở đỉnh container `OverlayTracks`. Container này lại nằm **dưới** main `TrackClips` trong layout, nên drop zone xuất hiện như một sliver hẹp giữa main clips và audio.

Hệ quả:
- Người dùng không thể drop b-roll lên trên main clips (phía trên main là `TrackClips` area, không nhận drop)
- Khi đã có nhiều overlay tracks, không có cách tạo track mới ở **dưới** stack overlay
- Drop zone 24px rất nhỏ, khó nhắm

User mong muốn behavior giống CapCut: main là 1 track ở dưới cùng, overlays/b-roll xếp chồng phía **trên** main, có thể chèn track mới ở bất kỳ vị trí nào trong stack overlay.

## Goals

- Overlays render visually **above** main `TrackClips` (CapCut layout)
- Drop b-roll vào bất kỳ vị trí nào trong overlay area:
  - Vào band của track có sẵn → thêm clip vào track đó
  - Vào gap giữa 2 tracks → tạo track mới chèn vào giữa
  - Trên đỉnh tất cả tracks → tạo track mới ở top
  - Dưới đáy tất cả tracks (sát main) → tạo track mới ở bottom
- Khi chưa có overlay nào: cả vùng overlay area (chỉ visible khi đang drag) là drop zone tạo track đầu tiên
- Không hiển thị các "drop zone strip" cố định — chỉ tính từ vị trí chuột khi drag

## Non-Goals

- Không đụng tới logic drop của main `TrackClips` hoặc `TrackAudio`
- Không thay đổi cách overlay render trên video preview
- Không refactor `addOverlayWithNewTrack` (đã hỗ trợ shift)
- Không build full Premiere/FCP-style multi-target drag

## Approach

### Layout change

Trong `timeline-panel.tsx`, đổi thứ tự render:

| Trước | Sau |
|---|---|
| TimelineRuler | TimelineRuler |
| TrackTags | TrackTags |
| TrackClips (main) | **OverlayTracks** ← lên trên |
| **OverlayTracks** | TrackClips (main) |
| TrackAudio | TrackAudio |

### Drop zone computation (no static UI)

Trong `OverlayTracks` component:

1. Tính `tracksTopDown` (track có index lớn nhất ở trên)
2. Mỗi track render 1 band cao `TRACK_HEIGHT` với spacing `GAP_HEIGHT` (6px) giữa các band
3. Khi đang drag, dựa vào `mouseY` so với layout:
   - Mouse Y trong **band** → mode `"into"`, trackIndex = band's track
   - Mouse Y trong **gap** giữa rowIdx `i` và `i+1` (hoặc trên đỉnh / dưới đáy) → mode `"create"`, trackIndex tính theo insertion point
4. Khi 0 overlays + dragging → 1 zone duy nhất phủ toàn bộ area, tạo trackIndex 0

### `pickTrack` API refactor

Thay `topZone: TopZone` (single zone) bằng `createZones: CreateZone[]` (multiple zones với explicit `newTrackIndex`):

```ts
export interface CreateZone {
  top: number;       // pixel Y (relative to container)
  bottom: number;
  newTrackIndex: number;  // index to insert at (others shift via addOverlayWithNewTrack)
}

export function pickTrack(
  mouseY: number,
  trackBands: TrackBand[],
  createZones: CreateZone[],
  fallbackMaxIdx: number,
): PickResult
```

Component compose `createZones` từ:
- `{ top: 0, bottom: GAP_HEIGHT, newTrackIndex: maxIdx + 1 }` (top edge → new track ở đỉnh)
- Cho mỗi gap giữa rowIdx `i` (track index `T_i`) và rowIdx `i+1` (track index `T_{i+1}`):
  `{ top: gap_top, bottom: gap_bottom, newTrackIndex: T_{i+1} + 1 }` — chèn vào giữa, dùng `addOverlayWithNewTrack` để shift các track phía trên lên
- `{ top: bottom_edge_top, bottom: bottom_edge_bottom, newTrackIndex: 0 }` (bottom edge → new track sát main, shift tất cả lên)

### Insertion semantics

`addOverlayWithNewTrack(overlays, next)`:
- Shift mọi `o` có `o.trackIndex >= next.trackIndex` lên 1
- Append `next`

→ Đã đủ cho cả 3 case (top / between / bottom). Không cần đổi.

### Ghost preview

Tính `top` và `height` cho ghost trong `onDragOver` dựa trên pick result:
- Mode `"into"`: ghost ở band của track tương ứng, cao `TRACK_HEIGHT`, border cyan
- Mode `"create"`: ghost ở vị trí gap (chỗ track mới sẽ chèn), cao `TRACK_HEIGHT`, border orange. Block tự nó đủ chỉ insertion point — không cần thêm line indicator.

Lưu trực tiếp `top` và `height` trong `GhostState` thay vì tính lại lúc render.

### Empty state

Khi `tracks.length === 0`:
- Idle: component return null (như hiện tại)
- Drag: render area cao `EMPTY_ZONE_HEIGHT` (= TRACK_HEIGHT, 56px) với một zone duy nhất `{ top: 0, bottom: EMPTY_ZONE_HEIGHT, newTrackIndex: 0 }`. Ghost orange phủ full area khi mouse ở trong.

## Components & data flow

```
User drags clip from library
  → overlay-drag-context (startDrag with sourceDurationMs)
  → enter OverlayTracks area
  → onDragOver:
      compute trackBands + createZones
      pickTrack(mouseY, bands, createZones, maxIdx) → PickResult
      computeSnap(rawStartMs, ...) → snappedStartMs
      compute ghost top/height from PickResult
      setGhost({ ..., top, height, mode, trackIndex, valid })
  → render ghost block at computed (top, left, width, height)
  → user drops:
      onDrop:
        if mode === "create": addOverlayWithNewTrack(prev, newOverlay)
        if mode === "into":   addOverlay(prev, newOverlay)
        clear ghost
```

Move existing overlay (mode `"move"`) follows same path with `moveOverlay` + `compactTracks` on drop.

## Error handling

- Drop ngoài area → `onDragLeave` clear ghost
- Drop với `valid: false` (collision in `"into"` mode) → giữ ghost border đỏ, ignore drop
- Pick fallback (mouse Y ngoài tất cả zones/bands) → tạo track mới ở top (`maxIdx + 1`) — defensive, ít khi xảy ra

## Testing

Lib tests (Vitest, `overlay-tracks.test.ts`):
- `pickTrack` mode `"create"` từ top zone
- `pickTrack` mode `"create"` từ bottom zone
- `pickTrack` mode `"create"` từ between-tracks gap
- `pickTrack` mode `"into"` khi mouse trong band
- `pickTrack` mode `"create"` empty timeline (single zone phủ all)
- `pickTrack` fallback khi mouse Y ngoài tất cả zones/bands

Component test: skip (drag/drop UI khó test programmatically; verify manual qua dev server).

UAT (manual):
- Empty overlays + drag → entire area highlight, drop tạo track đầu tiên
- 1 overlay track + drag trên đỉnh → ghost orange ở trên, drop tạo track mới ở top
- 2+ tracks + drag vào gap giữa → ghost orange tại gap, drop chèn track giữa, các track phía trên shift index
- Drag vào band có sẵn → ghost cyan, drop thêm clip vào track đó
- Drag vào band có overlap → ghost border đỏ, drop bị ignore
- Drag dưới đáy stack → ghost orange ở dưới, drop tạo track sát main

## Risks

- **Visual stacking đảo ngược**: hiện overlay nằm dưới main, đổi lên trên có thể ảnh hưởng các UI khác (playhead overlay, scrub click handling). Cần verify scrubbing vẫn hoạt động qua tất cả tracks.
- **Gap height tradeoff**: gap quá nhỏ (2-3px) khó nhắm, quá lớn (10px+) phá visual density. Chọn 6px; điều chỉnh sau visual check nếu cần.
- **Empty state height**: 56px area chỉ visible lúc drag — nếu user kéo qua nhanh, có thể không thấy. Acceptable vì cyan ghost đủ rõ.
