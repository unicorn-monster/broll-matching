"use client";

import { Shuffle } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { Button } from "@/components/ui/button";

export function ShuffleButton() {
  const { timeline, shuffleTimeline } = useBuildState();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!timeline}
      onClick={shuffleTimeline}
      title="Re-roll all auto-matched B-roll sections"
    >
      <Shuffle className="w-3.5 h-3.5 mr-1.5" />
      Shuffle
    </Button>
  );
}
