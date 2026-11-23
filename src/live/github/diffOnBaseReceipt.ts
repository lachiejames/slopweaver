/**
 * The current-base receipt's own shape, and where `./diffOnBase.ts` lands it in a `--files` document.
 *
 * In two parts, because the console voice keeps only the first 20 KiB of `talk verb` output (`src/talk/verbOutput.ts`).
 * `data.diffOnBase` — the verdict, its reason and the tip — is a few hundred bytes, inserted immediately before
 * `commits`: after the pull request's own state fields, and ahead of a CI rollup that `--limit 100` can grow past the
 * cut on its own. `data.diffOnBaseFiles`, each file's own answer, goes last: a hundred long paths would
 * otherwise push the rollup's state out of the cut in turn, and the per-file detail is what a cut should lose.
 */

import type { DiffOnBaseFileVerdict, DiffOnBaseVerdict } from "./diffOnBaseJudge.js";

/** The receipt as it is carried at `data.diffOnBase`. */
export interface DiffOnBaseReceipt {
  readonly verdict: DiffOnBaseVerdict;
  /** The base branch it was checked against. */
  readonly baseRef: string;
  /**
   * The base branch's tip commit when it was checked — every file judged was read from this one commit. `null` only
   * on an `unknown` whose base was never read.
   */
  readonly baseOid: string | null;
  readonly checkedAtIso: string;
  readonly reason?: string;
}

/** The fields `diffOnBase` goes ahead of: the CI rollup's `commits`, else the body, whichever comes first. */
const RECEIPT_GOES_BEFORE = new Set(["commits", "body"]);

/**
 * The document's data with `diffOnBase` inserted ahead of the CI rollup and `diffOnBaseFiles` appended last, every
 * other field in its own order.
 *
 * @param data the pull request's `--files` read, as `./pullFiles.ts` wrote it
 * @param files each changed file's own answer, empty when the base was never read
 * @returns a new data object; `data` itself is untouched
 */
export function withReceipt({
  data,
  receipt,
  files,
}: {
  data: Readonly<Record<string, unknown>>;
  receipt: DiffOnBaseReceipt;
  files: readonly DiffOnBaseFileVerdict[];
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(data)) {
    if (RECEIPT_GOES_BEFORE.has(key) && !placed) {
      out["diffOnBase"] = receipt;
      placed = true;
    }
    out[key] = value;
  }
  if (!placed) {
    out["diffOnBase"] = receipt;
  }
  out["diffOnBaseFiles"] = files;
  return out;
}

/**
 * The receipt with its keys in the order a prefix cut should keep them: the verdict and its reason first.
 *
 * @returns the same fields, `reason` present only when the receipt carried one
 */
export function inCutOrder({ receipt }: { receipt: DiffOnBaseReceipt }): DiffOnBaseReceipt {
  const { verdict, reason, baseRef, baseOid, checkedAtIso } = receipt;
  return { verdict, ...(reason === undefined ? {} : { reason }), baseRef, baseOid, checkedAtIso };
}

/**
 * The receipt for a check that never read the base: `unknown`, with why.
 *
 * @param reason what kept the base from being read, said to the reader as it stands
 * @returns an `unknown` receipt with `baseOid: null`, in cut order
 */
export function unreadReceipt({
  baseRef,
  checkedAtIso,
  reason,
}: {
  baseRef: string;
  checkedAtIso: string;
  reason: string;
}): DiffOnBaseReceipt {
  return inCutOrder({ receipt: { baseOid: null, baseRef, checkedAtIso, reason, verdict: "unknown" } });
}
