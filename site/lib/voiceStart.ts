/**
 * Where a press that starts the console voice goes. The owner never has two calls at the same time, so two
 * floating widgets earn nothing. The desktop app's overlay is the one place a call runs, the
 * desktop app's console window hands its start to that overlay, and a browser tab has no start at all — never a widget
 * or a call of its own.
 *
 * The route is a capability the provider is given, never one a control works out for itself, so there is one answer
 * to "can a call start from here" and a browser's provider refuses a start even if a control is ever drawn by
 * mistake.
 */

/** How a start goes from this window: run here (the desktop overlay), or handed to the window that runs it. */
export type VoiceStartRoute = { readonly kind: "local" } | { readonly kind: "elsewhere"; readonly run: () => void };

/**
 * Send one start where the route says: handed on, run here, or — with no route, as in a browser tab — nowhere.
 *
 * @param route the start route the provider was given; `undefined` in a browser and before the desktop role is known
 * @param startHere opens the call in this window, for the overlay's own route
 */
export function runVoiceStart({
  route,
  startHere,
}: {
  readonly route: VoiceStartRoute | undefined;
  readonly startHere: () => Promise<void>;
}): void {
  if (route === undefined) {
    return;
  }
  if (route.kind === "elsewhere") {
    route.run();
    return;
  }
  void startHere();
}

/**
 * Whether a control should offer to start a call: only where a start can go, and never while one is already up here
 * or in the desktop app's other window.
 *
 * @param canStart this window has a start route
 * @param callActiveAnywhere a call is up here or in the overlay
 * @returns true when a start control is drawn
 */
export function voiceStartOffered({
  callActiveAnywhere,
  canStart,
}: {
  readonly callActiveAnywhere: boolean;
  readonly canStart: boolean;
}): boolean {
  return canStart && !callActiveAnywhere;
}
