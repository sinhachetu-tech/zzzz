"use client";

import { useEffect, useState } from "react";

/* "Lights on" splash — the house draws, then the gold H switches on like a
   window at dusk. Shown once per browser session, on WEB and inside the
   installed PWA alike (mounted in src/app/layout.tsx, so both routes share
   it).

   This is the ANIMATED half of the cold-start experience. It cannot replace
   the OS startup image: iOS/Android draw the static splash-*.png BEFORE the
   web view exists, and those are strictly still images. So on an installed
   PWA you get PNG → this overlay. In a plain browser tab you get only this.

   `aria-hidden` is intentional: the mark duplicates branding the page already
   announces, and it is decorative. Escape and a tap both dismiss it, and it
   self-dismisses in ~3.6s, so nothing here depends on the pointer — it never
   satisfies a WCAG 2.1.2 "stop moving content" obligation, it just makes it
   skippable. The overlay is `position: fixed` and paints OVER the app, so it
   never delays or blocks first paint or data loading. */
export default function Splash({ greeting }: { greeting?: string }) {
  // False on the server AND on the first client render, so the splash can
  // never cause a hydration mismatch — it appears one tick after mount.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      // sessionStorage (not localStorage): show once per session/tab, so a
      // reload doesn't replay it but a fresh visit still gets the moment.
      if (sessionStorage.getItem("hfmc.splash")) return;
      sessionStorage.setItem("hfmc.splash", "1");
    } catch {
      /* storage blocked (private mode): just show it */
    }
    // Deferred a tick rather than set synchronously: the overlay must never
    // paint in the same commit that mounts it, and storage can only be read
    // here (client-only). Keeps this off the cascading-render path.
    const start = setTimeout(() => setShow(true), 0);
    // 3600 > the CSS 3s auto-hide, so React unmounts it rather than leaving a
    // visibility:hidden node pinned over the app.
    const t = setTimeout(() => setShow(false), 3600);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShow(false);
    };
    window.addEventListener("keydown", esc);
    return () => {
      clearTimeout(start);
      clearTimeout(t);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  if (!show) return null;
  return (
    <div className="hf-splash" aria-hidden="true" onClick={() => setShow(false)}>
      {/* The mark below is the OFFICIAL artwork — the same path data as
          public/brand/hfmc_mark_white.svg and the `LogoMark` component, split
          into three groups so each can animate (house stroke draw -> gold H
          bars grow -> HFMC letters rise). Do not redraw it: if the brand mark
          changes, update LogoMark in src/components/icons.tsx to match. */}
      <svg viewBox="40 30 970 320">
        <defs>
          <radialGradient id="hfg">
            <stop offset="0" stopColor="#E9AB3E" stopOpacity=".6" />
            <stop offset="1" stopColor="#E9AB3E" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="hf-glow" cx="204" cy="218" r="190" fill="url(#hfg)" />
        <g fill="none" stroke="#fff" strokeWidth={24}>
          <path className="hf-draw" pathLength={1} d="M76 322V188L206 64l46 42" />
          <path className="hf-draw b" pathLength={1} d="M334 142V322H160" />
        </g>
        <g className="hf-lit" fill="#E9AB3E">
          <rect className="hf-bar" x="108" y="176" width="30" height="162" />
          <rect className="hf-cross" x="108" y="205" width="192" height="28" />
          <rect className="hf-bar r" x="270" y="98" width="30" height="192" />
        </g>
        <g className="hf-ltr f" fill="none" stroke="#fff" strokeWidth={28}>
          <path d="M399 128V335M385 142H518M399 232H506" />
        </g>
        <polygon className="hf-ltr m" fill="#fff" points="560,335 560,128 594,128 664,252 734,128 769,128 769,335 741,335 741,184 676,298 652,298 588,184 588,335" />
        <g className="hf-ltr c" fill="none" stroke="#fff" strokeWidth={28}>
          <path d="M983 174A90 90 0 1 0 983 290" />
        </g>
      </svg>
      {greeting && <p className="hf-greet">{greeting}</p>}
    </div>
  );
}
