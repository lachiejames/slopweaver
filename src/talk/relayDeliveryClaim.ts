/**
 * One turn's delivery claim: the file that lets exactly one run type a relay's line into the supervisor's chat.
 *
 * The claim sits beside the turn's own record (`./relayStore.ts`) as `<turnId>.delivery`, created with `O_EXCL`
 * before anything is typed. Two readers ask about it: a run about to type ({@link claimDelivery}), and the chair's
 * courier recovering a request a dead courier took ({@link deliveryClaimed}, `./relayCourier.ts`), because a claim
 * taken may be a line already pasted and a re-offer would type it twice.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { isNotFoundError } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { createFileExclusive, ensureDirectory } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type TalkError, TalkErrors } from "./errors.js";

/** Where one turn's delivery claim is created, beside its `<turnId>.json` record. */
function deliveryClaimPath({ home, turnId }: { home: string; turnId: string }): string {
  return join(stateHomePaths({ home }).talkTurns, `${turnId}.delivery`);
}

/**
 * Claim this turn's one delivery into the supervisor's chat. The claim is a file created with `O_EXCL`, so
 * of two runs of one turn racing each other exactly one is told to type — the turn record alone cannot say
 * that, because both runs read it before either writes.
 *
 * @param home the Slopweaver home
 * @param turnId the turn being delivered
 * @returns `true` when this run holds the claim, `false` when another run already took it
 */
export function claimDelivery({ home, turnId }: { home: string; turnId: string }): Result<boolean, TalkError> {
  const path = deliveryClaimPath({ home, turnId });
  try {
    ensureDirectory({ directory: stateHomePaths({ home }).talkTurns });
    createFileExclusive({ contents: `${new Date().toISOString()}\n`, path });
    return ok(true);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST") {
      return ok(false);
    }
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
}

/**
 * Whether some run already took this turn's delivery claim — the courier's recovery asks before it re-offers a request
 * a dead courier took, because a claim taken may be a line already pasted.
 *
 * @param home the Slopweaver home
 * @returns `true` when the claim file is there
 */
export function deliveryClaimed({ home, turnId }: { home: string; turnId: string }): Result<boolean, TalkError> {
  const path = deliveryClaimPath({ home, turnId });
  try {
    statSync(path);
    return ok(true);
  } catch (cause) {
    if (isNotFoundError({ error: cause })) {
      return ok(false);
    }
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
}
