"use client";

import { useEffect, useMemo, useState } from "react";

/* Flash rows whose data changed underneath the user.
 *
 * The worklist re-sorts and re-renders whenever the store hydrates or a case
 * is saved, so a row can move or change status while you are looking at it.
 * Without a signal you just re-read the same table and assume nothing moved.
 *
 * Three rules make this safe to drop into any list:
 *
 *   1. The FIRST snapshot never flashes. On mount there is no "previous" state,
 *      so every row would light up at once — which reads as a bug, not as
 *      feedback. The null `prev` gates that.
 *   2. Only ids the caller declares interesting are watched. Change
 *      `fingerprintOf` to whatever the user would actually notice moving (a
 *      status, an owner) and the row will not flash because, say, a timestamp
 *      ticked.
 *   3. New rows count as changed: a case landing in your book IS an update.
 *
 * WHY THE DIFF RUNS DURING RENDER (React's "adjust state when props change"
 * pattern) rather than in an effect: the comparison is a pure function of
 * props. Doing it in an effect means rendering once with stale highlighting
 * and again to correct it — the wrong rows flash first — and React flags
 * synchronous setState-in-effect as a cascading render. Deriving it here makes
 * the class correct in the same paint.
 *
 * The clear-timer is the only thing that writes state later, and it does so
 * from a timeout callback rather than the effect body, which keeps it out of
 * the same warning. */

type Snapshot<K> = {
  /** fingerprints as of the last committed render */
  prev: Map<K, string> | null;
  /** ids currently lit, with the timestamp their highlight expires */
  flagged: Map<K, number>;
};

export function useChangedIds<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
  /** Secondary values in the fingerprint (e.g. status + owner). */
  fingerprintOf?: (item: T) => string,
  /** ms the highlight stays lit. Keep it under ~2s — it's a "look here", not a state. */
  holdMs = 1600,
) {
  const [snap, setSnap] = useState<Snapshot<K>>({ prev: null, flagged: new Map() });

  const next = useMemo(() => {
    const m = new Map<K, string>();
    for (const item of items) {
      const id = keyOf(item);
      m.set(id, fingerprintOf ? fingerprintOf(item) : String(id));
    }
    return m;
  }, [items, keyOf, fingerprintOf]);

  const changed = useMemo(() => {
    const prev = snap.prev;
    if (prev === null) return new Set<K>();
    const moved = new Set<K>();
    for (const [id, fp] of next) {
      if (prev.get(id) !== fp) moved.add(id);
    }
    return moved;
  }, [next, snap.prev]);

  // Render-phase adjustment: record this render's fingerprints and light any
  // row that moved. Guarded by `prev !== next`, so it settles after one extra
  // render and cannot loop.
  if (snap.prev !== next) {
    const flagged = new Map(snap.flagged);
    const expires = Date.now() + holdMs;
    for (const id of changed) flagged.set(id, expires);
    setSnap({ prev: next, flagged });
  }

  // Expire. The timeout callback is async, so this is not a synchronous
  // setState-in-effect. Expired ids are dropped, and anything still flagged is
  // re-armed so a second change mid-highlight restarts the clock.
  useEffect(() => {
    if (snap.flagged.size === 0) return;
    const t = setTimeout(() => {
      setSnap((s) => {
        const live = new Map<K, number>();
        const now = Date.now();
        for (const [id, at] of s.flagged) if (at > now) live.set(id, at);
        if (live.size === s.flagged.size) return s;
        return { prev: s.prev, flagged: live };
      });
    }, holdMs);
    return () => clearTimeout(t);
  }, [snap.flagged, holdMs]);

  return changed.size > 0 ? changed : snap.flagged;
}


