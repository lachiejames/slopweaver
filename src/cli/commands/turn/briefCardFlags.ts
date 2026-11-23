/**
 * The flags that say which progress card a brief carries: the capture-time one it already has
 * (`--turn-id`/`--working-ts`, reconciled with the ask-lifecycle log), or the one it RIDES (`--rides`).
 * Split out of `./brief.ts` along that seam — both answer "one card, never a second", and `turn dispatch`'s
 * card gate (`./ensureCard.ts`) is what acts on either.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { startedRefForAsk } from "../../../live/ask/store.js";
import type { StartedChecklistMismatchError } from "../../../live/turn/errors.js";
import { reconcileStartedChecklist } from "../../../live/turn/startedReconcile.js";
import { str } from "./core.js";

/**
 * The capture-time checklist's identity, when the listener already posted one.
 *
 * BOTH flags or NEITHER: a partial pair cannot reconstruct a `PostedRef` (a `ts` with no `turnId`, or vice
 * versa), and silently falling back to "no checklist was posted" would hide the caller's typo behind a
 * turn that quietly posts a second working message — the exact defect this whole feature exists to remove.
 *
 * @param values the parsed flag values
 * @returns the started pair, absent when neither flag was given, or the refusal naming the partial pair
 */
export function startedFromFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}):
  | { readonly started: { readonly turnId: string; readonly workingTs: string } | undefined }
  | { readonly error: string } {
  const turnId = str({ key: "turn-id", values });
  const workingTs = str({ key: "working-ts", values });
  if (turnId === undefined && workingTs === undefined) {
    return { started: undefined };
  }
  if (turnId === undefined || workingTs === undefined) {
    return {
      error:
        "--turn-id and --working-ts must both be given, or neither — a partial pair cannot reconstruct the " +
        "posted checklist, and answering would silently post a second one",
    };
  }
  return { started: { turnId, workingTs } };
}

/**
 * The `started` ref actually used for this brief — reconciled between the flags and the durable ledger,
 * never one source trusted unconditionally.
 *
 * This is the code-level guarantee `skills/loop/SKILL.md`'s prompt convention never had: if the driving session
 * forgot to carry `started.turnId`/`started.workingTs` through from `listen`'s stdout line, the capture-time
 * checklist used to be orphaned for good — `turn answer` would post a second, independently-resolving one and
 * leave the first to freeze. `listen`'s `withChecklistPostedLifecycle` now durably records the same ref the
 * moment it posts, so the ledger is ALWAYS consulted here, not just when the flags are absent — an explicit
 * pair that disagrees with it is a real mismatch worth refusing over, not a reason to skip the lookup.
 *
 * @param flagsStarted the started ref `startedFromFlags` parsed, when the caller passed both flags
 * @param home the resolved state home the lifecycle log lives under
 * @param target the brief's target — its `channel`/`messageTs`/`threadTs` key the lookup and the flags share
 * @returns the started ref to build the brief with, or the refusal naming an explicit/ledger mismatch
 */
export function resolvedStarted({
  flagsStarted,
  home,
  target,
}: {
  flagsStarted: { readonly turnId: string; readonly workingTs: string } | undefined;
  home: string;
  target: AskIdentity;
}): Result<{ readonly turnId: string; readonly workingTs: string } | undefined, StartedChecklistMismatchError> {
  const recorded = startedRefForAsk({ askIdentity: target, home });
  const reconciled = reconcileStartedChecklist({ explicit: flagsStarted, recorded });
  if (reconciled.isErr()) {
    return reconciled;
  }
  if (flagsStarted === undefined && reconciled.value !== undefined) {
    logger.info({
      msg:
        `turn brief: recovered the capture-time checklist ref from the ask-lifecycle log — ` +
        `--turn-id/--working-ts were not passed for ${target.channel}/${target.messageTs}`,
    });
  }
  return reconciled;
}

/**
 * The ask this one rides the card of, from `--rides` — a sub-ask the loop dispatched from inside that ask's
 * turn (`skills/loop/reference/edge-cases.md`). Refused when blank or naming this ask itself.
 *
 * @param values the parsed flag values
 * @param target the ask the brief is for
 * @returns the parent's messageTs, absent when the flag was not given, or the refusal
 */
export function ridesFromFlags({
  values,
  target,
}: {
  values: Readonly<Record<string, string | boolean>>;
  target: AskIdentity;
}): { readonly ridesOn: string | undefined } | { readonly error: string } {
  const rides = str({ key: "rides", values });
  if (rides !== undefined && (rides.trim().length === 0 || rides === target.messageTs)) {
    return { error: `turn brief: --rides names the ask this one was dispatched from, never itself — got "${rides}"` };
  }
  return { ridesOn: rides };
}
