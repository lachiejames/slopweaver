/**
 * The triage half of the desktop shell's bridge (`desktopShell.ts`): the two methods the voice's window uses to
 * mirror its triage pass into the shell and to take the presses the menu bar and the floating notes send back. The shell's half of these shapes is `desktop/src/triageClock.ts` — a separate
 * project, so each side parses what it receives. Pure.
 */

/**
 * Where a page's triage pass and its clock stand, as the shell is told it: triage off; on with a card's clock running to
 * an absolute deadline; on with the clock paused; or on between cards, no clock running. The shell parses it strictly
 * (`desktop/src/triageClock.ts`), never trusting this declaration.
 */
export type TriageClockReport =
  | { readonly on: false }
  | { readonly on: true; readonly phase: "running"; readonly deadlineMs: number }
  | { readonly on: true; readonly phase: "paused" }
  | { readonly on: true; readonly phase: "between" };

/** What the menu bar or a floating note asks of the triage pass. */
export type TriageCommand = "start" | "pause" | "resume" | "off";

/** The bridge's triage methods, both optional: under an older shell the clock is still the page's, only not mirrored. */
export interface TriageBridge {
  /**
   * The voice's window only, the one page that runs a triage pass in the shell (it alone draws the Messenger and holds
   * the call): where the pass and its clock stand, so the shell shows the countdown beside the menu bar item and the
   * floating notes draw their triage buttons. Main refuses it from the console window.
   */
  readonly reportTriageClock?: (input: { readonly report: TriageClockReport }) => void;
  /** The voice's window only: each triage command the menu bar or a floating note sends ({@link triageCommandOf}). */
  readonly onTriageCommand?: (listener: (command: unknown) => void) => () => void;
}

/** The {@link TriageBridge} methods, for the bridge's check that each is absent or a function. */
export const TRIAGE_OPTIONAL_METHODS = ["reportTriageClock", "onTriageCommand"] as const;

/**
 * One triage command off the shell.
 *
 * @param value what the shell sent
 * @returns the command, or `undefined` when it is not one
 */
export function triageCommandOf({ value }: { value: unknown }): TriageCommand | undefined {
  if (value === "start" || value === "pause" || value === "resume" || value === "off") {
    return value;
  }
  return undefined;
}
