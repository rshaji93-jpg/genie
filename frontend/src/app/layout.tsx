import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal AI Genie — Autonomous Workspace & AI Companion",
  description:
    "Autonomous Multi-User Workspace, Personal AI Companion, and Unified Study Engine powered by high-performance multi-model cascades.",
  metadataBase: new URL("https://personal-ai-genie-ten.vercel.app"),
  keywords: [
    "Personal AI Genie",
    "Personal AI Canvas",
    "AI Study Engine",
    "Autonomous Multi-User Workspace",
    "Gemini AI Assistant",
    "Unified Study Engine",
    "Notes to Flashcards AI",
    "AI Team Collaboration",
  ],
  authors: [{ name: "Personal AI Genie Team" }],
  creator: "Personal AI Genie",
  publisher: "Personal AI Genie",
  applicationName: "Personal AI Genie",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "Personal AI Genie — Autonomous Workspace & AI Companion",
    description:
      "Autonomous Multi-User Workspace, Personal AI Companion, and Unified Study Engine.",
    url: "https://personal-ai-genie-ten.vercel.app",
    siteName: "Personal AI Genie",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Personal AI Genie",
    description:
      "Autonomous Multi-User Workspace, Personal AI Companion, and Unified Study Engine.",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
    apple: "/icon-512.png",
  },
  verification: {
    google: "NGxRq5mFXrJoHtH2lQSVC_47TEjiL654u7ktVqM32UI",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full min-h-[100dvh] w-full bg-slate-50 text-slate-900 antialiased overflow-x-hidden">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
