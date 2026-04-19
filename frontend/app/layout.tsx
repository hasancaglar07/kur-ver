import type { Metadata } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import { Suspense } from "react";

import { AppSidebarShell } from "@/components/AppSidebarShell";
import { FeedbackProvider } from "@/components/ui/feedback-center";
import { cn } from "@/lib/utils";

import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://kurban.verenel.com.tr"),
  title: "Kurban Video Operasyon Merkezi",
  description: "Operatör upload, AI doğrulama, yönetim inceleme ve SMS teslim süreçleri tek panelde.",
  openGraph: {
    title: "Kurban Video Operasyon Merkezi",
    description: "Kurban kesim videoları için güvenli, hızlı ve şeffaf teslim sistemi.",
    type: "website",
    locale: "tr_TR",
    siteName: "Verenel Kurban",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kurban Video Operasyon Merkezi",
    description: "Kurban kesim videoları için güvenli, hızlı ve şeffaf teslim sistemi.",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: [{ url: "/icon", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
    shortcut: ["/icon"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={cn(outfit.variable, jetbrainsMono.variable)}>
      <body>
        <FeedbackProvider>
          <Suspense fallback={<>{children}</>}>
            <AppSidebarShell>{children}</AppSidebarShell>
          </Suspense>
        </FeedbackProvider>
      </body>
    </html>
  );
}
