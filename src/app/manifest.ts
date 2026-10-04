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
    theme_color: "#0a1626",
    background_color: "#0a1626",
    categories: ["business", "finance", "productivity"],
    icons: [
      // Official brand kit (public/icons/), per app-icons/manifest-icons.json.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Dashboard", url: "/", description: "Pipeline overview" },
      { name: "New case", url: "/?action=new-case", description: "Open a new case" },
      { name: "Calculator", url: "/?view=calculator", description: "Affordability calculator" },
      { name: "My tasks", url: "/?view=tasks", description: "My open tasks" },
    ],
  };
}
