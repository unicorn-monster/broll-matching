// src/app/dashboard/[productId]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { EditorShell } from "@/components/editor/editor-shell";

export default function WorkspacePage() {
  const { productId } = useParams<{ productId: string }>();
  return <EditorShell productId={productId} />;
}
