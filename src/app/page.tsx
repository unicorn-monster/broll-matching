"use client";

import { useState } from "react";
import { FolderPicker } from "@/components/folder-picker";
import { EditorShell } from "@/components/editor/editor-shell";

export default function Home() {
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-2xl font-semibold">VSL Mix-n-Match</h1>
        <p className="text-sm text-muted-foreground max-w-md text-center">
          Chọn folder chứa B-roll (.mp4) + audio (.mp3/.wav). File names quy ước: <code>tag-NN.mp4</code>.
        </p>
        <FolderPicker onLoaded={() => setLoaded(true)} />
      </div>
    );
  }

  return <EditorShell />;
}
