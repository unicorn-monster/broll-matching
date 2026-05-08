"use client";

import { Play } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { Button } from "@/components/ui/button";

export function ExportButton() {
  const { canExport, setExportDialogOpen } = useBuildState();
  return (
    <Button
      size="sm"
      disabled={!canExport}
      onClick={() => setExportDialogOpen(true)}
    >
      <Play className="w-3.5 h-3.5 mr-1.5" />
      Export
    </Button>
  );
}
