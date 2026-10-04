import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SwRegister } from "@/components/sw-register";
import Splash from "@/components/hfmc/Splash";

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
      // Official brand kit (public/icons/). The SVG favicon is the crisp one;
      // the PNGs are fallbacks for browsers that still ask for raster icons.
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      // browsers request /favicon.ico at the site root by default; the kit ships
      // one under /icons/, so point at it explicitly or that request 404s
      { url: "/icons/favicon.ico", sizes: "any" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    /* Was "black-translucent". Apple docs: that value makes the web content
       fill the ENTIRE screen, partially obscured by the status bar — so the
       web view paints over the startup image immediately and the splash is
       never seen. "black" keeps the status bar as its own strip (matching the
       navy #0a1626 chrome) and lets apple-touch-startup-image below do its
       job. Change back only if you'd rather have edge-to-edge than a splash. */
    statusBarStyle: "black",
    title: "HFMC",
  },
};

export const viewport: Viewport = {
  // brand navy — matches the dark `--bg` in the globals.css brand layer.
  // Was #0b171d (old teal-slate), left over from the previous palette.
  themeColor: "#0a1626",
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
        {/* iOS startup images — official brand kit, all 14 sizes
            (public/splash/, navy, "plain-navy" so it blends straight into the
            animated Splash overlay). Copied verbatim from the kit's
            splash-screens/apple-startup-links.html.

            The PNGs are ALSO declared in manifest.ts, but **iOS ignores splash
            entries in a web manifest** — it only reads these link tags. Without
            them the splash never renders.

            Each media query must match the device's CSS viewport + DPR exactly;
            iOS picks the first that matches and shows nothing if none do. The
            set now covers current iPhones AND iPads (1536x2048, 2048x2732,
            1668x2224, 1668x2388). */}
        <link rel="apple-touch-startup-image" href="/splash/splash-1320x2868.png"
          media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1206x2622.png"
          media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1290x2796.png"
          media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1179x2556.png"
          media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1284x2778.png"
          media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1170x2532.png"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1125x2436.png"
          media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1242x2688.png"
          media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-828x1792.png"
          media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-750x1334.png"
          media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1668x2388.png"
          media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1668x2224.png"
          media="(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1536x2048.png"
          media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-2048x2732.png"
          media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${ibmPlex.variable} ${ibmPlexMono.variable} antialiased`}
        style={{ background: "var(--bg)", color: "var(--ink)" }}
      >
        {/* First child so it paints above everything and is shared by every
            route. Fixed + no hydration-blocking (it returns null on the server
            and on first client render), so it never delays app boot. */}
        <Splash greeting="HFMC — your all-in-one financial partner." />
        <Providers>{children}</Providers>
        <SwRegister />
      </body>
    </html>
  );
}
