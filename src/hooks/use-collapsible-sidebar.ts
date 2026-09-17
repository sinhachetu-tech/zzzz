"use client";

import { useCallback, useEffect, useState } from "react";

/* Collapsible left panel — 228px of navigation that a laptop can't always
   spare. Three inputs decide the width:

     • the viewport — a narrow desktop (< 1180px) starts collapsed;
     • the user     — an explicit toggle is pinned in localStorage, so the
                      panel opens the way it was left;
     • the crossing — resizing across the breakpoint drops that pin, so the
                      panel goes back to being smart instead of stuck on a
                      choice made on another screen size.                     */

const NARROW_QUERY = "(max-width: 1180px)";
const STORAGE_KEY = "hfmc.sidebar"; // "open" | "closed"

type Pin = "open" | "closed" | null;

function persistPin(v: Pin) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode — the panel just falls back to viewport rules */ }
}

export function useCollapsibleSidebar() {
  const [narrow, setNarrow] = useState(false);
  const [pin, setPin] = useState<Pin>(null);
  // width transition is switched on by the first toggle: the panel opens at its
  // final width instead of folding in (and reflowing the page) on every load
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    let saved: Pin = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "open" || raw === "closed") saved = raw;
    } catch { /* private mode */ }

    /* eslint-disable react-hooks/set-state-in-effect -- the viewport and the
       saved pin are only knowable on the client; one pass seeds both */
    setNarrow(mql.matches);
    setPin(saved);
    /* eslint-enable react-hooks/set-state-in-effect */

    const onChange = (e: MediaQueryListEvent) => {
      setPin(null);      // a new screen size deserves a fresh smart decision
      persistPin(null);
      setNarrow(e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const collapsed = pin ? pin === "closed" : narrow;

  const toggle = useCallback(() => {
    const next: Pin = collapsed ? "open" : "closed";
    persistPin(next);
    setAnimated(true);
    setPin(next);
  }, [collapsed]);

  return { collapsed, toggle, animated };
}