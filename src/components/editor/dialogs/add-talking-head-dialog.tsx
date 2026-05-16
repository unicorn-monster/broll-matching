"use client";

import { useEffect, useRef, useState } from "react";
import { Video, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBuildState } from "@/components/build/build-state-context";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const DEFAULT_NEW_TAG_BASE = "talking-head";

function suggestNextTag(existing: { tag: string }[]): string {
  const taken = new Set(existing.map((l) => l.tag));
  if (!taken.has(DEFAULT_NEW_TAG_BASE)) return DEFAULT_NEW_TAG_BASE;
  let n = 2;
  while (taken.has(`${DEFAULT_NEW_TAG_BASE}-${n}`)) n++;
  return `${DEFAULT_NEW_TAG_BASE}-${n}`;
}

export function AddTalkingHeadDialog({ open, onOpenChange }: Props) {
  const { talkingHeadLayers, addTalkingHeadLayer } = useBuildState();
  const [tag, setTag] = useState(() => suggestNextTag(talkingHeadLayers));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Reset to a fresh unique default whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setTag(suggestNextTag(talkingHeadLayers));
      setFile(null);
      setError(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".mp4")) {
      setError("File must be MP4.");
      return;
    }
    if (f.size === 0) {
      setError("File is empty.");
      return;
    }
    setError(null);
    setFile(f);
  }

  function onSubmit() {
    if (!file) {
      setError("Pick an MP4.");
      return;
    }
    if (tag.trim().length === 0) {
      setError("Tag is required.");
      return;
    }
    const result = addTalkingHeadLayer({ tag, file });
    if (!result.ok) {
      setError(
        result.reason === "duplicate-tag"
          ? "Tag already in use by another layer."
          : result.reason === "empty-tag"
            ? "Tag is required."
            : "Cannot add layer.",
      );
      return;
    }
    // Close on success so user can re-open to add another.
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-xl">
        <DialogHeader>
          <DialogTitle>Add talking-head layer</DialogTitle>
          <DialogDescription>
            Maps one MP4 (audio ignored) to a script tag. Sections with that tag are sliced from this video. Session-only — re-add after a page reload.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_1.5fr] gap-4">
          {/* Left column: Tag */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tag</label>
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="talking-head"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Script sections with this tag will play this video.
            </p>
          </div>

          {/* Right column: file dropzone */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Video (MP4, audio ignored)
            </label>
            {file ? (
              <div className="flex items-center gap-3 p-3 border border-border rounded-md bg-muted/30">
                <Video className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Clear file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-border rounded-md p-5 flex flex-col items-center gap-2 cursor-pointer hover:bg-muted/20"
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
              >
                <Video className="w-7 h-7 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drop MP4 here or click to browse</p>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".mp4,video/mp4"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-1.5 text-sm rounded-md hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!file || tag.trim().length === 0}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add layer
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
