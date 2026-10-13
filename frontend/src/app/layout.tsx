import type { Metadata, Viewport } from "next";
import "./globals.css";
import ClientRuntimeRecovery from "./ClientRuntimeRecovery";

// Cloudflare Pages frontend URL (fallback to local or configured environment domain)
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://personal-ai-genie-ten.vercel.app";

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: "Personal AI Genie — Intelligent Collaboration Hub",
  description:
    "Zero-retention, encrypted collaborative workspace and real-time multi-agent intelligence.",
  metadataBase: new URL(siteUrl),
  applicationName: "Genie AI",
  keywords: [
    "Personal AI Genie",
    "Genie AI",
    "Autonomous Multi-User Workspace",
    "Real-time Voice Intelligence",
    "AI Study Engine",
    "Encrypted Collaboration",
  ],
  authors: [{ name: "Personal AI Genie Team" }],
  creator: "Personal AI Genie",
  publisher: "Personal AI Genie",
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
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Genie AI",
  },
  openGraph: {
    title: "Personal AI Genie — Intelligent Collaboration Hub",
    description:
      "Zero-retention, encrypted collaborative workspace and real-time multi-agent intelligence.",
    url: siteUrl,
    siteName: "Personal AI Genie",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/icon-512x512.png",
        width: 512,
        height: 512,
        alt: "Personal AI Genie App Icon",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Personal AI Genie",
    description:
      "Zero-retention, encrypted collaborative workspace and real-time multi-agent intelligence.",
    images: ["/icon-512x512.png"],
  },
  verification: {
    google: "NGxRq5mFXrJoHtH2lQSVC_47TEjiL654u7ktVqM32UI",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="h-full min-h-[100dvh] w-full bg-slate-900 text-slate-100 antialiased overflow-x-hidden">
        <ClientRuntimeRecovery />
        {children}
      </body>
    </html>
  );
}