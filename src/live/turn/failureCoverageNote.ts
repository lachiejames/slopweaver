/**
 * The one coverage line a failure card carries, and the accounting sentence underneath it.
 *
 * Split out of `./answer.ts` along a real seam rather than for length alone: everything here is about what
 * the card may CLAIM about the world model, which is a question of evidence rather than of rendering, and
 * `./answer.ts` is otherwise entirely about the latter. The measured defect each function guards is stated
 * on the function itself.
 */

import { type CoverageManifest, conservationBreaches } from "../../retrieval/coverage.js";
import type { TurnFailureCause } from "./answer.js";

/**
 * The conservation law, in one sentence.
 *
 * The law is `ingested = indexed + skipped`, per leg. It holding is worth SAYING rather than leaving
 * implicit: it is the one line that tells a reader the counts above are an accounting rather than a
 * sample, and its absence is how a silently-dropped record would show up.
 *
 * @param coverage the manifest from the corpus load
 * @returns the sentence, naming the breaching legs when the law does not hold
 */
export function conservationNote({ coverage }: { coverage: CoverageManifest }): string {
  const breaches = conservationBreaches({ manifest: coverage });
  if (breaches.length === 0) {
    return "Conservation holds on every leg: ingested = indexed + skipped.";
  }
  return `Conservation BREACHED — records are unaccounted for: ${breaches.join("; ")}`;
}

/**
 * The one coverage note a failure card carries — the manifest's own conservation line when there is one, and
 * otherwise a sentence about THIS CARD rather than about the turn.
 *
 * The absent-manifest arm used to read "The world model was never read, so there is no coverage to report.",
 * which is an inference from absence and was measured false: on `C0SYN000001/1790048248.995219`,
 * a door refusal printed it on a card for an answer standing on four compliance controls read live three
 * times. `./runContract.ts`'s `coverageOfFailure` only ever recovers a manifest from a `TurnQueryFailure`, so
 * a refusal at the door carries none no matter how much was read.
 *
 * The `unproven` arm stops short of the opposite claim on purpose. An answer WAS composed there, which is
 * more than the `broke` arm can say — but a composed answer does not prove a corpus load either: a
 * session-composed turn (`../../cli/commands/turn/postAnswer.ts`'s `sessionTurnQuery`) loads none, and
 * conversation grounding is a legitimate answer. So the card says what it actually knows: it has no manifest.
 *
 * @param cause why the turn ended without an answer
 * @param coverage the manifest, when the corpus load got far enough to produce one
 * @returns the note line
 */
export function missingCoverageNote({
  cause,
  coverage,
}: {
  cause: TurnFailureCause;
  coverage: CoverageManifest | undefined;
}): string {
  if (coverage !== undefined) {
    return conservationNote({ coverage });
  }
  if (cause === "unproven") {
    return "The answer was composed, but no coverage manifest is available for this refusal.";
  }
  return "The world model was never read, so there is no coverage to report.";
}
