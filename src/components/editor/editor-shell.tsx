// src/components/editor/editor-shell.tsx
"use client";

interface EditorShellProps {
  productId: string;
}

export function EditorShell({ productId }: EditorShellProps) {
  return (
    <div
      className="grid h-[calc(100vh-4rem)] w-full bg-background text-foreground"
      style={{
        gridTemplateColumns: "320px 1fr 360px",
        gridTemplateRows: "48px 1fr 220px",
      }}
    >
      {/* Toolbar — spans all 3 cols */}
      <div className="col-span-3 row-start-1 flex items-center px-3 border-b border-border bg-muted/30 text-sm">
        <span className="text-muted-foreground">Toolbar (product: {productId})</span>
      </div>

      {/* Library */}
      <div className="row-start-2 col-start-1 border-r border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Library
      </div>

      {/* Preview */}
      <div className="row-start-2 col-start-2 overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-black/30">
        Preview
      </div>

      {/* Inspector */}
      <div className="row-start-2 col-start-3 border-l border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Inspector
      </div>

      {/* Timeline — spans all 3 cols */}
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-muted/10">
        Timeline
      </div>
    </div>
  );
}
