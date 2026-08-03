"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/**
 * Honors the OS "reduce motion" setting for every `motion/react` animation in
 * the app (WCAG 2.3.3). `reducedMotion="user"` keeps opacity crossfades but
 * disables transform and layout animations when the user has asked for less
 * motion.
 *
 * The `prefers-reduced-motion` block in `styles.css` covers CSS-driven
 * animation; this covers the JS-driven ones, which CSS cannot reach.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
