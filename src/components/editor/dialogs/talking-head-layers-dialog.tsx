"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
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

export function TalkingHeadLayersDialog({ open, onOpenChange }: Props) {
  const {
    talkingHeadLayers,
    addTalkingHeadLayer,
    removeTalkingHeadLayer,
    renameTalkingHeadLayer,
  } = useBuildState();
  const [tag, setTag] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setTag("");
    setFile(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onAdd() {
    if (!file) {
      setError("Pick an MP4.");
      return;
    }
    if (tag.trim().length === 0) {
      setError("Tag is required.");
      return;
    }
    if (file.size === 0) {
      setError("File is empty.");
      return;
    }
    const result = await addTalkingHeadLayer({ tag, file });
    if (!result.ok) {
      setError(
        result.reason === "duplicate-tag" ? "Tag already in use by another layer." :
        result.reason === "empty-tag" ? "Tag is required." :
        result.reason === "persist-failed" ? "Browser storage failed. File too big?" :
        "Cannot add layer.",
      );
      return;
    }
    reset();
  }

  async function onRename(id: string, newTag: string) {
    const result = await renameTalkingHeadLayer(id, newTag);
    if (!result.ok) {
      setError(result.reason === "duplicate-tag" ? "Tag already in use." : "Cannot rename.");
    } else {
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-lg">
        <DialogHeader>
          <DialogTitle>Talking-head layers</DialogTitle>
          <DialogDescription>
            Each layer maps one MP4 (audio ignored) to a script tag. Sections with that tag will be sliced from this video.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {talkingHeadLayers.map((l) => (
            <li key={l.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30">
              <input
                defaultValue={l.tag}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== l.tag) void onRename(l.id, v);
                }}
                className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded"
              />
              <button
                onClick={() => void removeTalkingHeadLayer(l.id)}
                className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                aria-label={`Delete layer ${l.tag}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
          {talkingHeadLayers.length === 0 && (
            <li className="text-xs text-muted-foreground italic">No layers yet.</li>
          )}
        </ul>

        <div className="pt-3 border-t border-border space-y-2">
          <div className="text-xs font-medium">Add new</div>
          <div className="flex gap-2">
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="tag (e.g. doctor)"
              className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted"
            >
              <Upload className="w-3 h-3" /> {file ? file.name.slice(0, 20) : "Pick MP4"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => void onAdd()}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Add
            </button>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
