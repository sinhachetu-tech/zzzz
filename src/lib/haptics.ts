/**
 * Haptic feedback utility for PWA feel.
 * Uses Vibration API (Android) — no-op on iOS Safari (no API yet).
 * Progressive enhancement: fails silently if unavailable.
 */

type HapticType = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';

const patterns: Record<HapticType, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 30,
  selection: 5,
  success: [10, 50, 10],
  warning: [15, 30, 15, 30, 15],
  error: [30, 50, 30],
};

export function haptic(type: HapticType = 'light'): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    const pattern = patterns[type];
    navigator.vibrate(pattern);
  } catch {
    // Silently fail — vibration is a progressive enhancement
  }
}

/**
 * Hook for easy haptic feedback in components.
 * Usage:
 *   const { haptic } = useHaptic();
 *   <button onClick={() => haptic('light')}>Tap me</button>
 */
import { useCallback } from 'react';

export function useHaptic() {
  return useCallback((type: HapticType = 'light') => haptic(type), []);
}

/**
 * Convenience: add haptic to any clickable element.
 * <button {...withHaptic('light')}>Tap</button>
 */
export function withHaptic(type: HapticType = 'light') {
  return {
    onClick: () => haptic(type),
    onTouchStart: () => haptic(type),
  } as React.ButtonHTMLAttributes<HTMLButtonElement>;
}