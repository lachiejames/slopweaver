/**
 * The words a deferred resync attempt prints after its target label — one line per stop that gives a slot back
 * rather than failing it (`../../../live/resync/outcome.ts#resyncExitCode`). Pure: an attempt in, a line out.
 */
import { signInProviderOfHost } from "../../../browser/signInPress.js";
import type { ResyncAttempt } from "../../../live/resync/outcome.js";
import { hostOf } from "../../../monitor/resyncSignedOut.js";

/**
 * The line a deferred attempt prints, naming what it waits for — so a reader of one tick's output never has to
 * know what exit 4 means here. A Datadog or GitHub wall names the press, never the owner's card.
 *
 * @param attempt the attempt that gave its slot back
 * @returns the words after the target label
 */
export function deferredWhy({ attempt }: { attempt: ResyncAttempt }): string {
  if (attempt.signInWall !== undefined) {
    const provider = signInProviderOfHost({ host: hostOf({ origin: attempt.signInWall }) });
    if (provider !== undefined) {
      return (
        `DEFERRED · stopped at ${attempt.signInWall}'s sign-in page — the fleet's to press: ` +
        `run \`slopweaver browser sign-in --provider ${provider}\`, press what it names, then re-run this resync`
      );
    }
    return `DEFERRED · stopped at ${attempt.signInWall}'s sign-in page — the slot waits on their sign-in card, not a retry floor`;
  }
  // A relay collision outranks the step's own exit 4: a walk that met a held Chrome may defer for that reason.
  if (attempt.relayCollision === undefined && attempt.stepDeferred !== undefined) {
    const waitsOn = attempt.stepDeferred.startsWith("slopweaver refresh ")
      ? "another process holds the source's refresh slot"
      : "a prerequisite is still in progress, per its own lines above";
    return `DEFERRED · \`${attempt.stepDeferred}\` exited 4: ${waitsOn} — the slot is given back for the next pass, not cooled`;
  }
  return "DEFERRED · another browser walk held their Chrome — the slot is given back for the next pass, not cooled";
}
