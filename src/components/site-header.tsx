import Link from "next/link";
import { Film } from "lucide-react";
import { ModeToggle } from "./ui/mode-toggle";

export function SiteHeader() {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:border focus:rounded-md"
      >
        Skip to main content
      </a>
      <header className="border-b" role="banner">
        <nav
          className="container mx-auto px-4 py-4 flex justify-between items-center"
          aria-label="Main navigation"
        >
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold text-foreground hover:text-foreground/80 transition-colors"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <Film className="h-5 w-5 text-primary" />
            </div>
            <span>Mix & Match VSL</span>
          </Link>
          <ModeToggle />
        </nav>
      </header>
    </>
  );
}
