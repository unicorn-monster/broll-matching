import { cn } from "@/lib/utils";

interface StepWrapperProps {
  step: number;
  title: string;
  active: boolean;
  waitingFor?: string;
  children: React.ReactNode;
}

export function StepWrapper({ step, title, active, waitingFor, children }: StepWrapperProps) {
  return (
    <section className={cn("border border-border rounded-xl p-6 transition-opacity", !active && "opacity-40 pointer-events-none")}>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
          {step}
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
        {!active && waitingFor && (
          <span className="ml-auto text-xs text-muted-foreground uppercase tracking-wide">
            Waiting for {waitingFor}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
