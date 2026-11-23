/**
 * The escape-hatch row for a pull request's PROOF PATH — the publishing verbs refusing a branch whose proof
 * evidence is not where the pull request says it is.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position, directly before
 * the proof-capture rows. Add a row for a new proof-path refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on a pull request's proof path, in register order. */
export const PROOF_PATH_HATCHES = [
  {
    caught:
      "the head carries proof output — a proof, proofs, screenshots or .proof folder, or a picture or recording named for proof or a screenshot — and the owner ruled there is no need for a proof folder in any pull request",
    command: "slopweaver github <push|stack push|stack submit|ready>",
    exceptions: [
      "a deliberate throwaway pull request whose subject IS this gate, closed and deleted as part of the same exercise",
    ],
    id: "proof-path",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PROOF_PATH" },
    lane: "ambient",
    reader: "src/admit/pushProofPathGate.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
