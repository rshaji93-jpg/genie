import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegistrar from "@/components/genie/PwaRegistrar";

export const metadata: Metadata = {
  title: "Personal AI Genie",
  description: "A private, encrypted workspace for people and AI.",
  applicationName: "Personal AI Genie",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Genie" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#0f5132",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaRegistrar />{children}</body>
    </html>
  );
}
