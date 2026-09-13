"use client";

import { useEffect } from "react";

// Registers the HFMC service worker. Only in production — in dev, the SW
// would cache stale builds and fight Turbopack HMR.
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // registration failures are non-fatal — the app still works online
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
