"use client";

import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RenderTriggerProps {
  onRender: () => void;
  disabled: boolean;
}

export function RenderTrigger({ onRender, disabled }: RenderTriggerProps) {
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={onRender}
        disabled={disabled}
      >
        <Clapperboard className="w-4 h-4" />
        Render Video
      </Button>
      {disabled && (
        <p className="text-xs text-muted-foreground text-center">
          Complete Steps 1–3 to enable rendering
        </p>
      )}
    </div>
  );
}
