/**
 * Whether a whole-form `pr update` input may replace the live description at all.
 *
 * Split out of `./updateCore.ts` under the file-size ratchet, along the seam between the decisions about WHO
 * may write and WHAT is being replaced: everything here compares the supplied form with the live body.
 */
import { bodyHash } from "../../../outbound/github/prLedger.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import type { LivePr } from "./updateCore.js";

/**
 * Why a whole-form `--form`/`--file` input must not replace the live description, or `undefined` when it may.
 *
 * A `--pull`ed file whose digest disagrees with the live body was pulled from a description that has since
 * changed, so writing it would discard whatever changed. A C3 description carries no review or grade, so there is
 * nothing else a whole form could change as a side effect.
 *
 * @param input the supplied form, and the digest a `--pull` stamped on it
 * @param live the pull request the address resolved to
 * @returns the refusal reason, or `undefined`
 */
export function wholeFormInputRefusal({
  input,
  live,
}: {
  input: { form: PrFormDraft; pulledBodyHash?: string | undefined };
  live: Pick<LivePr, "body">;
}): string | undefined {
  if (input.pulledBodyHash !== undefined && input.pulledBodyHash !== bodyHash({ body: live.body })) {
    return (
      "the live description has changed since this file was pulled — re-run `pr update --pull` to get the " +
      "current description, redo your edit on top of it, and try again"
    );
  }
  return undefined;
}
