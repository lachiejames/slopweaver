/**
 * The owner-judgement half of `slopweaver turn brief`: read the owner's active directives through the store's
 * port, and the refusal a turn earns when that authority cannot be read.
 *
 * ## Why this refuses while the other two profiles degrade
 *
 * An unreadable capability profile costs breadth and an unreadable judgement profile costs voice; both are
 * honestly degraded and the turn continues (`./brief.ts`). The owner's judgement is not like that. It holds the owner's
 * standing rulings and the specific things the owner has said the bot got WRONG about specific records, and a turn
 * composed without them can repeat, in public, a mistake the owner has already corrected, with nothing in the output to
 * say the correction was never consulted. That is the expensive failure: an answer that searches gold and silver
 * and directly contradicts the feedback makes the same mistake a second time in public.
 *
 * So an EMPTY authority is fine — nothing has been recorded, an honest state — and a store that answers is read
 * whatever it holds, while a store that cannot be read stops the turn. The port draws that line
 * (`../../../judgement/ownerDirectiveStore.ts`); this module only words the refusal.
 */
import type { OwnerDirective } from "../../../judgement/ownerDirective.js";
import type { OwnerDirectivePort } from "../../../judgement/ownerDirectivePort.js";

/** What the brief carries forward: the active directives, or the refusal that stops the turn. */
export type BriefOwnerDirectives =
  | { readonly kind: "refusal"; readonly message: string }
  | { readonly kind: "directives"; readonly directives: readonly OwnerDirective[] };

/**
 * The complete refusal message for an owner-judgement authority that could not be read.
 *
 * @param why the port's own account of what failed
 * @returns the refusal message
 */
export function ownerDirectiveRefusal({ why }: { why: string }): string {
  return (
    `turn brief REFUSES: the owner's directives and corrections in the store could not be read — ${why}. ` +
    "They hold the owner's current rulings and their corrections to specific records, and an answer composed " +
    "without them can repeat a mistake the owner has already corrected, in public, with nothing saying the " +
    "correction was never consulted. Restore the store, then re-run: an EMPTY authority is a legitimate " +
    "state (nothing recorded yet); an unreadable one is not (something may be recorded and cannot be read)."
  );
}

/**
 * Read the owner's active directives for one brief.
 *
 * @param home the resolved state home whose store is read
 * @param port the owner-judgement door — the store in production, an in-memory fake in a test
 * @returns the active directives, or the refusal
 */
export async function ownerDirectivesForBrief({
  home,
  port,
}: {
  home: string;
  port: OwnerDirectivePort;
}): Promise<BriefOwnerDirectives> {
  const read = await port.readActive({ home });
  if (read.isErr()) {
    return { kind: "refusal", message: ownerDirectiveRefusal({ why: read.error.message }) };
  }
  return { directives: read.value.directives, kind: "directives" };
}
