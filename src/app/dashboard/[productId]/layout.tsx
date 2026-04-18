"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  const { productId } = useParams<{ productId: string }>();
  const pathname = usePathname();
  const isBuild = pathname.endsWith("/build");

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="border-b border-border px-4 flex gap-4 shrink-0">
        <Link
          href={`/dashboard/${productId}`}
          className={cn("py-3 text-sm font-medium border-b-2 transition-colors", !isBuild ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          Library
        </Link>
        <Link
          href={`/dashboard/${productId}/build`}
          className={cn("py-3 text-sm font-medium border-b-2 transition-colors", isBuild ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          Build Video
        </Link>
      </div>
      {children}
    </div>
  );
}
