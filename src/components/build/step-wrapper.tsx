"use client";

import { cn } from "@/lib/utils";

interface StepWrapperProps {
  stepNumber: number;
  title: string;
  isActive: boolean;
  children: React.ReactNode;
}

export function StepWrapper({ stepNumber, title, isActive, children }: StepWrapperProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border transition-opacity",
        !isActive && "opacity-40 pointer-events-none select-none"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0",
            isActive
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground"
          )}
        >
          {stepNumber}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
