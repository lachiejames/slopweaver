/**
 * The repository operation lock `slopweaver github stack push` takes, the one flag that changes how it is
 * taken, and the send that runs while it is held.
 *
 * Its own file for the reason the verb's header already gives: `stackPushRun.ts` states the order and calls
 * the edges, and the file-size ratchet is what keeps that true. This is a real seam rather than a slice —
 * the lock is the only step of the sequence with two spellings, and the caller wants one of them back.
 */

import { acquireOperationLock, type OperationLockResult } from "../../../admit/operationLock.js";
import { acquireOperationLockWaiting } from "../../../admit/operationLockWait.js";
import { locusOf } from "../../../outbound/github/prLedger.js";
import type { SelfReviewForm } from "../../../outbound/github/selfReview.js";
import type { WaitOptions } from "../../../wait/flags.js";
import { realWaitClock } from "../../../wait/loop.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { StackCarryGate } from "./stackCarryRun.js";
import type { GatedStackPushPlan, GithubStackPushArgs } from "./stackPushCore.js";
import type { GithubStackPushDeps } from "./stackPushDeps.js";
import { sendStackPush } from "./stackPushSend.js";
import type { StackPushWrite } from "./stackPushUpdate.js";

/**
 * Take the repository's operation lock — at once, or, under `--wait`, on the shared wait contract until the
 * stack verb already running there finishes.
 *
 * The waiting path is the ONE difference: a timeout hands back the last attempt's own refusal, so the caller
 * prints the same line it prints without `--wait` and the reader still learns which pid holds it and how old
 * that hold is. MEASURED: about 25 of the 215 poll loops written after the wait contract existed
 * were re-running this verb until that refusal stopped coming back (`src/admit/operationLockWait.ts`).
 *
 * @param deps only the clock and the output sink, so a test drives this without the verb's whole edge set
 * @param key the lock key, lower-cased by the caller exactly as the no-wait path lower-cases it
 * @param wait `--wait`/`--timeout-seconds`, as this invocation parsed them
 * @returns the lock handle, or the reason this push does not hold it
 */
export async function takeStackPushLock({
  deps,
  home,
  key,
  wait,
}: {
  deps: Pick<GithubStackPushDeps, "now" | "out">;
  home: string;
  key: string;
  wait: WaitOptions;
}): Promise<OperationLockResult> {
  if (!wait.wait) {
    return acquireOperationLock({ home, key, nowIso: deps.now().toISOString() });
  }
  return acquireOperationLockWaiting({
    clock: realWaitClock(),
    emit: (line) => {
      deps.out({ line });
    },
    home,
    key,
    nowIso: () => deps.now().toISOString(),
    timeoutSeconds: wait.timeoutSeconds,
  });
}

/**
 * Take the repository's operation lock, send the push under it, and release it whatever the send did.
 *
 * @param carry the carry gate's verdict, already past its refusal
 * @param deps the edges, their writers already withholding a credential-shaped line
 * @param token the resolved GitHub token each fresh API client is minted with
 * @returns the process exit code
 */
export async function sendUnderStackPushLock({
  args,
  carry,
  deps,
  home,
  plan,
  selfReview,
  token,
  write,
}: {
  args: GithubStackPushArgs;
  carry: StackCarryGate;
  deps: GithubStackPushDeps;
  home: string;
  plan: GatedStackPushPlan;
  selfReview: SelfReviewForm | undefined;
  token: string;
  /** The create, or the update of the branch's open pull request, decided and gated before the lock. */
  write: StackPushWrite;
}): Promise<number> {
  // `locusOf`, never a hand-built string. The ledger's own definition lower-cases the repository and joins
  // with `#`; this verb used to spell it `owner/repo:base...head` by hand, which is a DIFFERENT key — so the
  // duplicate-reservation guard could not see a reservation the ledger had already written, and a
  // differently-cased remote for the same repository minted a second one. Now that this verb is the only
  // door that opens a pull request, its locus has to be the ledger's.
  const locus = locusOf({ target: plan.form.target });
  // Lower-cased: GitHub owner/repo names are case-insensitive, but the lock hashes this key verbatim, so a
  // differently-cased remote for the SAME repository would otherwise contend on a different lock entirely —
  // letting a concurrent stack operation on that repository race this one instead of waiting for it.
  const lockKey = `${plan.form.target.owner}/${plan.form.target.repo}`.toLowerCase();
  const lock = await takeStackPushLock({ deps, home, key: lockKey, wait: args.lockWait });
  if (!lock.isOk()) {
    deps.out({ line: `refused: another stack operation is in progress on ${lockKey} (${lock.error})` });
    return EXIT_ERROR;
  }
  try {
    return await sendStackPush({
      args,
      carry,
      deps,
      freshApi: () => deps.makeApi({ home, token }),
      home,
      locus,
      plan,
      selfReview,
      write,
    });
  } finally {
    // The release's own warning quotes the lock path, which comes from `--home`, so it goes through the filtered
    // writer too rather than straight to standard error.
    lock.value.release({ warn: deps.out });
  }
}
