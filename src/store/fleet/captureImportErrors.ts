/**
 * The failures of importing a turn an outside app captured (`../schema/ownerCapture.ts`) — members of the fleet
 * import's one union and factory object in `./errors.ts`, declared here so that file stays under the size cap.
 */

/**
 * A captured turn the store cannot hold as the owner said it, with the instant it was said.
 *
 * Its own variant rather than a reuse of the owner-turn one: that one names an `owner-turn-*.txt` file, and
 * these name a dictation's `meta.json` or a Codex message row. Every reason is a refusal to ALTER or GUESS — a
 * body that is not UTF-8 or carries a NUL, an instant that will not read or disagrees with its folder, a message
 * with no single text part — and each names the record and is never cleaned into something storable.
 */
export interface UnstorableOwnerCaptureError {
  readonly code: "UNSTORABLE_OWNER_CAPTURE";
  readonly message: string;
  /** The record: a `meta.json` path, or `<database>#<thread>/<turn>/<item>`. */
  readonly path: string;
  readonly reason: string;
}

/** The factories for {@link UnstorableOwnerCaptureError}, spread into `FleetImportErrors`. */
export const CaptureImportErrors = {
  unstorableOwnerCapture: ({ path, reason }: { path: string; reason: string }): UnstorableOwnerCaptureError => ({
    code: "UNSTORABLE_OWNER_CAPTURE",
    message: `${path} cannot be stored as the owner's captured words: ${reason}`,
    path,
    reason,
  }),
} as const;
