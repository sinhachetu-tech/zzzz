import type { MetadataRoute } from "next";

// HFMC PWA manifest. Served at /manifest.webmanifest by Next.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HFMC — Mortgage Case Tracker",
    short_name: "HFMC",
    description:
      "UAE mortgage case tracker — pipeline, tasks, morning bulletin, and a CBUAE-style affordability calculator with an AI copilot.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    theme_color: "#0b171d",
    background_color: "#0b171d",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      // Splash screens for iOS (auto-selected by device)
      { src: "/splash-640x1136.png", sizes: "640x1136", type: "image/png", purpose: "any" },
      { src: "/splash-750x1334.png", sizes: "750x1334", type: "image/png", purpose: "any" },
      { src: "/splash-828x1792.png", sizes: "828x1792", type: "image/png", purpose: "any" },
      { src: "/splash-1125x2436.png", sizes: "1125x2436", type: "image/png", purpose: "any" },
      { src: "/splash-1170x2532.png", sizes: "1170x2532", type: "image/png", purpose: "any" },
      { src: "/splash-1290x2796.png", sizes: "1290x2796", type: "image/png", purpose: "any" },
      // Android adaptive icon
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Dashboard", url: "/", description: "Pipeline overview" },
      { name: "New case", url: "/?action=new-case", description: "Open a new case" },
      { name: "Calculator", url: "/?view=calculator", description: "Affordability calculator" },
      { name: "My tasks", url: "/?view=tasks", description: "My open tasks" },
    ],
  };
}
