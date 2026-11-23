/**
 * `github landing --pr` on a pull request that has already ENDED — merged or closed — answered as ended.
 *
 * The fleet read selects with `is:open`, so it never lists an ended pull request. `--pr` does not: it reads the
 * one pull request by NUMBER (`./reviewStateFleet.ts`'s `readOnePr`), which GitHub answers whatever its state, and
 * the landing ladder (`../../../review/landing.ts`) has no arm for an ended one, so a merged pull request this
 * machine had pressed read `waiting/pressed-not-queued` for as long as anybody asked. MEASURED:
 * `slopweaver github landing --author @me --pr <number> --repo <this repository>` read a merged pull request
 * `pressed-not-queued` over an hour after `main` carried its merge commit.
 *
 * So `--pr` asks GitHub's own state FIRST, through the same ended-pull-request read `--register` settles with,
 * and an ended one prints its witness — the merge commit or the close instant — instead of a landing row. A read
 * that could not establish the state refuses rather than printing a row that might describe a merged pull
 * request as still waiting on the queue.
 */

import { closureWitness } from "../../../review/landingClosure.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { LandingClosureDeps } from "./landingClosureRun.js";

/**
 * Settle `--pr` on an ended pull request before the landing read runs, or say it is open.
 *
 * @param slug the one `--repo` the pull request lives in, `owner/name`
 * @param number the pull request `--pr` named, or undefined for the fleet read, which has none to settle
 * @param home the state home the GitHub credentials resolve from
 * @param deps the ended-pull-request read and the two output channels
 * @returns the exit code when this settled the invocation, or undefined when there is no `--pr` or GitHub reads
 *   it OPEN, and the landing read should run
 */
export async function endedLandingPr({
  slug,
  number,
  home,
  deps,
}: {
  slug: string;
  number: number | undefined;
  home: string | undefined;
  deps: Pick<LandingClosureDeps, "prClosure"> & {
    readonly writeOut: (line: string) => void;
    readonly writeDiagnostic: (line: string) => void;
  };
}): Promise<number | undefined> {
  if (number === undefined) {
    return undefined;
  }
  const closure = await deps.prClosure({ home, number, repoSlug: slug });
  if (closure.isErr()) {
    deps.writeDiagnostic(
      `landing: could not read whether ${slug}#${String(number)} is still open, so no landing row is printed for ` +
        `it: ${closure.error.message}`,
    );
    return EXIT_ERROR;
  }
  const witness = closureWitness({ closure: closure.value });
  if (witness === undefined) {
    return undefined;
  }
  deps.writeOut(`${slug}#${String(number)} has ended — ${witness} — so there is nothing to land`);
  return EXIT_OK;
}
