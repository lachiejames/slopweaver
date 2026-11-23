/*
 * The cut flags of a record that kept every word the owner said at both ends, and says so — spread into a `RawWords`
 * fixture whose test is about something other than a cut.
 */
import type { RawWords } from "../handover/hisWordsResolve.js";

/** Both ends kept, and both known to be kept. */
export const WHOLE_ENDS = {
  headKnown: true,
  headLost: false,
  tailKnown: true,
  tailLost: false,
} as const satisfies Pick<RawWords, "headKnown" | "headLost" | "tailKnown" | "tailLost">;
