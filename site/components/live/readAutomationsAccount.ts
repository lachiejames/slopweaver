/**
 * The five answers a broken or paused automation owes the owner, and their readers. A sibling of `./readAutomations.ts`,
 * under every rule its module doc states.
 */

import { type Bag, nullableStr, str, strings, sub } from "../../lib/bag";

/**
 * The five answers a broken or paused automation owes the owner (`src/automations/brokenAccount.ts`): why, since when, who
 * fixes it, what is worse, and what runs instead. Every instant is ISO, said in the owner's clock at draw time.
 */
export interface BrokenAccount {
  readonly state: "broken" | "paused";
  readonly why: string;
  /**
   * What went wrong with the run that finished last and what would fix it, in one sentence — what the row leads with
   * when present; absent when nothing typed in its record says why, and the row leads with `why` instead.
   */
  readonly plainly: string | undefined;
  readonly said: string | undefined;
  /** The record behind the answers, verbatim and technical — for the fold, never above it. */
  readonly detail: string | undefined;
  readonly sinceIso: string | undefined;
  readonly lastWorkedIso: string | undefined;
  readonly fix: {
    readonly by: "fleet" | "you" | "unknown";
    readonly words: string;
    readonly sinceIso: string | undefined;
  };
  readonly worse: string;
  readonly freshness:
    { readonly lastCompleteIso: string | undefined; readonly newestRowsIso: string | undefined } | undefined;
  readonly meanwhile: readonly string[];
}

/** Whether a wire value is one of the three owners a fix can rest on. */
function isFixOwner(value: string | undefined): value is BrokenAccount["fix"]["by"] {
  return value === "fleet" || value === "you" || value === "unknown";
}

/** The fix line of an account. */
function fixOf({ bag }: { bag: Bag | undefined }): BrokenAccount["fix"] | undefined {
  if (bag === undefined) {
    return undefined;
  }
  const by = str({ bag, key: "by" });
  const words = str({ bag, key: "words" });
  const sinceIso = nullableStr({ bag, key: "sinceIso" });
  if (!isFixOwner(by) || words === undefined || sinceIso === false) {
    return undefined;
  }
  return { by, sinceIso, words };
}

/** A sync's freshness, `null` meaning the row syncs no corpus source. */
function freshnessOf({ bag }: { bag: Bag }): BrokenAccount["freshness"] | false {
  if (bag["freshness"] === null) {
    return undefined;
  }
  const inner = sub({ bag, key: "freshness" });
  if (inner === undefined) {
    return false;
  }
  const lastCompleteIso = nullableStr({ bag: inner, key: "lastCompleteIso" });
  const newestRowsIso = nullableStr({ bag: inner, key: "newestRowsIso" });
  if (lastCompleteIso === false || newestRowsIso === false) {
    return false;
  }
  return { lastCompleteIso, newestRowsIso };
}

/**
 * The five answers, `null` meaning the row is neither broken nor paused.
 *
 * @returns the account, `undefined` for `null`, or `false` when its shape moved
 */
export function accountOf({ bag }: { bag: Bag }): BrokenAccount | undefined | false {
  if (bag["account"] === null) {
    return undefined;
  }
  const inner = sub({ bag, key: "account" });
  if (inner === undefined) {
    return false;
  }
  const state = str({ bag: inner, key: "state" });
  const why = str({ bag: inner, key: "why" });
  const worse = str({ bag: inner, key: "worse" });
  const said = nullableStr({ bag: inner, key: "said" });
  const plainly = nullableStr({ bag: inner, key: "plainly" });
  const detail = nullableStr({ bag: inner, key: "detail" });
  const sinceIso = nullableStr({ bag: inner, key: "sinceIso" });
  const lastWorkedIso = nullableStr({ bag: inner, key: "lastWorkedIso" });
  const fix = fixOf({ bag: sub({ bag: inner, key: "fix" }) });
  const freshness = freshnessOf({ bag: inner });
  const meanwhile = strings({ bag: inner, key: "meanwhile" });
  if ((state !== "broken" && state !== "paused") || why === undefined || worse === undefined || fix === undefined) {
    return false;
  }
  if (
    said === false ||
    plainly === false ||
    detail === false ||
    sinceIso === false ||
    lastWorkedIso === false ||
    freshness === false ||
    meanwhile === undefined
  ) {
    return false;
  }
  return { detail, fix, freshness, lastWorkedIso, meanwhile, plainly, said, sinceIso, state, why, worse };
}
