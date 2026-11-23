/**
 * Why `handover park` stopped before or during the close, and the lines that say so. Pure, so every failure's
 * wording has a test; `./parkRun.ts` owns the socket, the append and the hatch read.
 */

import type { CmuxError } from "../../../cmux/errors.js";
import type { ParkSeatError } from "../../../handover/parkPolicy.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { EscapeHatch } from "../../../hatch/types.js";
import type { SessionHarnessError } from "../../../sessionHarness/errors.js";
import type { CloseHeldVerdict } from "../../../sessions/closeForce.js";

/** The hatch past a standing-session refusal; `./parkRun.ts` reads its variable. */
const PARK_STANDING_SESSION_HATCH = hatchFor({ id: "park-standing-session" });

/** Why the act stopped before the close — the seat could not be chosen, read or closed, or may not be closed now. */
export type ParkFailure =
  | { readonly kind: "seat"; readonly error: ParkSeatError }
  | { readonly kind: "cmux"; readonly error: CmuxError | SessionHarnessError; readonly journalled: boolean }
  | { readonly kind: "pinned"; readonly workspaceRef: string }
  | { readonly kind: "mid-turn"; readonly workspaceRef: string; readonly shows: string }
  /** A foreign seat cmux would close only with force, whose re-read screen no longer proved it idle — journalled. */
  | {
      readonly kind: "held";
      readonly journalled: true;
      readonly workspaceRef: string;
      readonly verdict: CloseHeldVerdict;
    }
  /** The row carries the owner's standing-session ruling, in force — nothing journalled, nothing closed. */
  | { readonly kind: "standing-session"; readonly why: string }
  /** The owner spoke over the held question's card since it was asked, unread — nothing journalled, nothing closed. */
  | { readonly kind: "owner-words"; readonly lines: readonly string[] }
  | { readonly kind: "journal"; readonly message: string };

/**
 * One failure, as the lines that say what stopped and what was or was not written.
 *
 * @param hatch the park verb's own hatch, which a running seat's refusal names
 * @param slug the run being parked, named when the journal says parked but the close failed
 * @returns the lines to print on stderr, in order
 */
export function parkFailureLines({
  failure,
  hatch,
  slug,
}: {
  failure: ParkFailure;
  hatch: EscapeHatch;
  slug: string;
}): readonly string[] {
  switch (failure.kind) {
    case "seat":
      return [`handover park: ${failure.error.message}`];
    case "journal":
      return [`handover park: nothing closed — ${failure.message}`];
    case "pinned":
      return [
        `handover park: ${failure.workspaceRef} is the pinned chair, which is never parked — name the seat with --workspace`,
      ];
    case "cmux":
      if (failure.journalled) {
        return [
          `handover park: ${slug} is journalled parked but the close failed — ${failure.error.message}; close it with slopweaver cmux close`,
        ];
      }
      return [`handover park: nothing written — ${failure.error.message}`];
    case "held":
      return [
        `handover park: ${slug} is journalled parked but ${failure.workspaceRef} was held open — cmux wants force for its running process, and its screen no longer proves Claude idle at a prompt (${failure.verdict}); close it with slopweaver cmux close once it is at rest`,
      ];
    case "mid-turn":
      return hatchRefusalLines({ detail: `${failure.workspaceRef} shows ${failure.shows}`, hatch });
    case "standing-session":
      return hatchRefusalLines({ detail: `${slug}: ${failure.why}`, hatch: PARK_STANDING_SESSION_HATCH });
    case "owner-words":
      return failure.lines;
    default: {
      const unreachable: never = failure;
      return unreachable;
    }
  }
}
