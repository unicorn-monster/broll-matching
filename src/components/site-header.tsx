import Link from "next/link";
import { Bot } from "lucide-react";
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
          className="px-3 py-4 flex justify-between items-center"
          aria-label="Main navigation"
        >
          <h1>
            <Link
              href="/"
              className="flex items-center text-primary hover:text-primary/80 transition-colors"
              aria-label="Go to homepage"
            >
              <div
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10"
                aria-hidden="true"
              >
                <Bot className="h-5 w-5" />
              </div>
            </Link>
          </h1>
          <div className="flex items-center gap-4" role="group" aria-label="User actions">
            <ModeToggle />
          </div>
        </nav>
      </header>
    </>
  );
}
