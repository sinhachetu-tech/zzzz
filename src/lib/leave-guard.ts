// "You have unsaved changes" — ONE flag, read by every exit route.
//
// WHY THIS EXISTS AS A MODULE AND NOT A PROP: the exit points are scattered
// across unrelated components. `beforeunload` in the sheet only catches a real
// page unload (refresh, closing the tab), but the sidebar links to Leads,
// Dashboard, Cases and Clients are CLIENT-SIDE `nav()` calls in the store — they
// swap a route in memory and never unload anything, so beforeunload never fires.
// That is why the warning appeared to do nothing.
//
// So the flag lives here, the sheet sets it, and the store's `nav()` consults it
// before it navigates. Deliberately a module-level singleton rather than React
// state: it must be readable from a Zustand action, and it must survive the
// component that set it being unmounted mid-navigation.

let unsaved = false;

export function setUnsavedChanges(v: boolean): void {
  unsaved = v;
}

export function hasUnsavedChanges(): boolean {
  return unsaved;
}

/**
 * Confirm before leaving. Returns true when it is safe to navigate.
 *
 * Uses the native confirm because the decision is "lose the work or not", and a
 * custom modal here would have to race the navigation it is trying to prevent.
 * Kept to ONE sentence on purpose: a long warning about a text field is easier
 * to click through than a short one.
 */
export function confirmDiscard(label = "your changes"): boolean {
  if (!unsaved) return true;
  if (typeof window === "undefined") return true;
  return window.confirm(`You have unsaved ${label}. Leave without saving?`);
}
