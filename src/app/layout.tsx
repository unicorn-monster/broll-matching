import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { MediaPoolProvider } from "@/state/media-pool";
import type { Metadata } from "next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "B-roll Matching",
    template: "%s | B-roll Matching",
  },
  description:
    "Complete agentic coding boilerplate with authentication, database, AI integration, and modern tooling - perfect for building AI-powered applications and autonomous agents by Leon van Zyl",
  keywords: [
    "Next.js",
    "React",
    "TypeScript",
    "AI",
    "OpenRouter",
    "Boilerplate",
    "Authentication",
    "PostgreSQL",
  ],
  authors: [{ name: "Leon van Zyl" }],
  creator: "Leon van Zyl",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Agentic Coding Boilerplate",
    title: "Agentic Coding Boilerplate",
    description:
      "Complete agentic coding boilerplate with authentication, database, AI integration, and modern tooling",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agentic Coding Boilerplate",
    description:
      "Complete agentic coding boilerplate with authentication, database, AI integration, and modern tooling",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// JSON-LD structured data for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Agentic Coding Boilerplate",
  description:
    "Complete agentic coding boilerplate with authentication, database, AI integration, and modern tooling",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Person",
    name: "Leon van Zyl",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SiteHeader />
          <MediaPoolProvider>
            <main id="main-content">{children}</main>
          </MediaPoolProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
