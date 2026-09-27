"use client";

/* Motion provider — the one place framer-motion is wired in.
 *
 * Two deliberate choices:
 *
 * 1. `LazyMotion` + `domMax` instead of bare `motion.*`. framer-motion is already
 *    a dependency, but the full bundle pulls in drag/pan/gesture machinery this
 *    app never uses. LazyMotion defers the feature bundle and `domMax` gives us
 *    layout animations (the sliding tab indicator) without the drag code.
 *
 * 2. `MotionConfig reducedMotion="user"`. The CSS kill-switch in globals.css
 *    neutralises @keyframes/transitions, but it CANNOT neutralise a JS-driven
 *    animation. With this set, framer drops transform/layout animations for
 *    anyone who asked for reduced motion — so new framer usage is safe by
 *    default instead of relying on everyone remembering the CSS class list.
 *
 * Anything added with framer should be non-essential polish: the app is fully
 * usable with all motion disabled. */

import { LazyMotion, MotionConfig, domMax } from "framer-motion";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
