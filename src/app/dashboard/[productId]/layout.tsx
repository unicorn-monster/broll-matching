// src/app/dashboard/[productId]/layout.tsx
"use client";

import { BuildStateProvider } from "@/components/build/build-state-context";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <BuildStateProvider>{children}</BuildStateProvider>;
}
