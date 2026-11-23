/**
 * What `handover settle` was asked to do, read off its parsed flags. Its own file so `./settleRowRun.ts` stays under
 * the file-size ratchet; the seam is the flags, which this reads and nothing else.
 */

import { type AskSettlement, asAskSettlement, declineNeedsAnchor } from "../../../handover/rowKind.js";
import { type CardDisposition, cardDispositionOf } from "../../../handover/settleCard.js";

/**
 * What `handover settle` was asked to do, or the usage refusal to print instead.
 *
 * @param positionals the words left after the flags, the row's slug first
 * @param values the parsed flag values
 * @returns the settle to perform, or the refusal
 */
export function settlePlan({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}):
  | { readonly refusal: string }
  | {
      readonly slug: string;
      readonly settlement: AskSettlement;
      readonly witness: string;
      readonly reason: string | undefined;
      readonly disposition: CardDisposition | undefined;
    } {
  const slug = positionals[0];
  if (slug === undefined) {
    return { refusal: "which ask? Pass its slug" };
  }
  const settlement = asAskSettlement({ value: typeof values["as"] === "string" ? values["as"] : undefined });
  if (settlement === undefined) {
    return { refusal: "--as must be filed, answered or declined" };
  }
  const witness = typeof values["witness"] === "string" ? values["witness"].trim() : "";
  if (witness.length === 0) {
    return {
      refusal: `--witness is required for --as ${settlement} — the doc slug, the permalink, or the anchor behind it`,
    };
  }
  const reason = typeof values["reason"] === "string" ? values["reason"] : undefined;
  if (declineNeedsAnchor({ settlement }) && (reason === undefined || reason.trim().length === 0)) {
    return {
      refusal: "--reason is required for --as declined — only the owner declines an ask, and a decline says why",
    };
  }
  const text = ({ key }: { key: string }): string | undefined =>
    typeof values[key] === "string" ? values[key] : undefined;
  const disposition = cardDispositionOf({
    card: text({ key: "card" }),
    cardNew: text({ key: "card-new" }),
    cardWhy: text({ key: "card-why" }),
  });
  if (disposition.isErr()) {
    return { refusal: disposition.error.message };
  }
  return { disposition: disposition.value, reason, settlement, slug, witness };
}
