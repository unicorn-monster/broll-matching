// src/app/dashboard/[productId]/page.tsx
// Legacy route — kept for backward compatibility but now just renders EditorShell
// without productId since the app is now fully local (folder-picker based).
"use client";

import { EditorShell } from "@/components/editor/editor-shell";

export default function WorkspacePage() {
  return <EditorShell />;
}
