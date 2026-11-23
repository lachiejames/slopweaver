/**
 * Why a control shot cannot address a page — the typed union `controlShot.ts` refuses with.
 *
 * Its failures are genuinely distinct KINDS rather than a list of messages, which is what earns a union
 * here rather than the default `readonly string[]`: "you named no control" is a usage fault the caller can
 * fix on the command line, "this atlas holds no controls at all" is a missing sync, "this id matches
 * nothing" is a wrong id, and "the control kind will not read" is another module's failure forwarded. The
 * CLI branches on the first of those to answer a USAGE exit code rather than an error one, which is the
 * whole reason `code` exists — see `.claude/rules/error-handling.md`.
 */

/** No `--control` was named, so there is nothing to address. A usage fault rather than a state one. */
export interface NoControlAskedError {
  readonly code: "NO_CONTROL_ASKED";
  readonly message: string;
}

/** The atlas holds no control entities at all, so no id could be placed against anything. */
export interface AtlasHoldsNoControlsError {
  readonly code: "ATLAS_HOLDS_NO_CONTROLS";
  readonly message: string;
}

/** One or more ids matched no control the atlas holds, by either of the two ids a control carries. */
export interface ControlNotPlacedError {
  readonly code: "CONTROL_NOT_PLACED";
  readonly message: string;
  /** Exactly what the caller typed, so a report can echo it back in their own words. */
  readonly unplaced: readonly string[];
}

/** The stored control kind could not be read, carrying the store's own reasons forward. */
export interface ControlSetUnreadableError {
  readonly code: "CONTROL_SET_UNREADABLE";
  readonly message: string;
  /** What the store said, kept whole rather than collapsed into the display string. */
  readonly reasons: readonly string[];
}

/** Every way a control shot refuses before it opens a browser. */
export type VantaControlShotError =
  NoControlAskedError | AtlasHoldsNoControlsError | ControlNotPlacedError | ControlSetUnreadableError;

/** The factory the real code calls, so a test builds a fixture the same way. */
export const VantaControlShotErrors = {
  atlasHoldsNoControls: (): AtlasHoldsNoControlsError => ({
    code: "ATLAS_HOLDS_NO_CONTROLS",
    message:
      "this atlas holds no controls, so no control id can be placed and no page can be addressed — run: " +
      "slopweaver atlas vanta sync",
  }),
  controlSetUnreadable: ({ reasons }: { reasons: readonly string[] }): ControlSetUnreadableError => ({
    code: "CONTROL_SET_UNREADABLE",
    message: reasons.join("; "),
    reasons,
  }),
  noControlAsked: (): NoControlAskedError => ({
    code: "NO_CONTROL_ASKED",
    message: "--control names at least one control to photograph, by its Vanta id or its external id",
  }),
  notPlaced: ({ unplaced }: { unplaced: readonly string[] }): ControlNotPlacedError => ({
    code: "CONTROL_NOT_PLACED",
    message:
      `this atlas holds no control matching ${unplaced.map((one) => `"${one}"`).join(", ")} — an id is ` +
      "matched against a control's Vanta provider id and its external id, and nothing else, because a URL " +
      "built from an unplaced id would photograph a different control without saying so; run: slopweaver " +
      "atlas vanta read --kind control --json to see what this atlas holds",
    unplaced,
  }),
} as const;
