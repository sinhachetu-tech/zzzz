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
    ],
    shortcuts: [
      { name: "Dashboard", url: "/", description: "Pipeline overview" },
      { name: "New case", url: "/?action=new-case", description: "Open a new case" },
    ],
  };
}
