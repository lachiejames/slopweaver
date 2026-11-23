/**
 * The hand-step register's own typed failure union.
 *
 * A union rather than `readonly string[]` because these kinds are BRANCHED ON, which is the test
 * `.claude/rules/error-handling.md` sets: `hand post` exits differently on a step it could not build than
 * on a register it could not write, `hand done` answers "no open step carries that id" as its own kind, and
 * `hand show` must tell a platform that cannot raise a note apart from a note that failed to raise — the
 * first is a fact about the machine and the second is something a caller can act on.
 *
 * This file is the ONE place the domain's union and factory are composed, so every consumer imports
 * `HandStepError` and `HandStepErrors` from here and a caller's exhaustive switch is checked against the whole
 * list. The variants live in three groups by concern, each with its interfaces, a sub-union and a sub-factory:
 * `./handPostingErrors.ts` (a step's own fields and text refused at posting), `./handRegisterErrors.ts` (the
 * register and its row store) and `./handSurfaceErrors.ts` (the note and notification surfaces, and the Later
 * and snooze ledgers). A new kind of failure is added to its group's file and reaches here through the
 * composition below; a group file nearing 300 code lines splits again.
 */
import { type HandPostingError, HandPostingErrors } from "./handPostingErrors.js";
import { type HandRegisterError, HandRegisterErrors } from "./handRegisterErrors.js";
import { type HandSurfaceError, HandSurfaceErrors } from "./handSurfaceErrors.js";

/** Every way this domain fails. */
export type HandStepError = HandPostingError | HandRegisterError | HandSurfaceError;

/** Constructors for {@link HandStepError}. The only place a hand-step error is built. */
export const HandStepErrors = {
  ...HandPostingErrors,
  ...HandRegisterErrors,
  ...HandSurfaceErrors,
} as const;
