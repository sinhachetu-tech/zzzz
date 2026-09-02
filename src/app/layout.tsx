import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SwRegister } from "@/components/sw-register";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-disp",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlex = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "HFMC — Mortgage Case Tracker",
  description:
    "HFMC mortgage case tracker for UAE home finance — pipeline, tasks, morning bulletin, and a CBUAE-style affordability calculator with an AI copilot.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HFMC",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b171d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const themeScript = `
(function(){try{var t=localStorage.getItem('hfmc.theme');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${ibmPlex.variable} ${ibmPlexMono.variable} antialiased`}
        style={{ background: "var(--bg)", color: "var(--ink)" }}
      >
        <Providers>{children}</Providers>
        <SwRegister />
      </body>
    </html>
  );
}
