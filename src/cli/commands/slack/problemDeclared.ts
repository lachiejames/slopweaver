/**
 * `slack draft record` requires the `problem` declaration (`../../../outbound/artifact/problemReach.ts`) on every
 * COMPOSED form, as-me and `--as bot` alike: a parked draft is the card they read to size a response, so it says
 * whether it is about a possible problem before it parks. The form schemas already refuse a declared problem whose
 * top omits its reach; this is the half that refuses no declaration at all.
 *
 * Composed means a form a session wrote word by word: the as-me `drip`, `one-card` and `one-list`, and the bot
 * `update` and `no-fold`. A bot `finding` leads with its own `blastRadius`; a derived card (a digest, an alert
 * summary) and the raw `plain` body have no authored top region to hold the word, and are the stated residue.
 */
import { err, ok, type Result } from "#lib/result.js";
import { PROBLEM_UNDECLARED } from "../../../outbound/artifact/problemReach.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { NOTHING_PARKED } from "./draftMedia.js";

/** The form kinds a recording requires the declaration of. */
const DECLARING_FORM_KINDS: ReadonlySet<string> = new Set(["drip", "one-card", "one-list", "update", "no-fold"]);

/**
 * Why a recording may not park for want of a `problem` declaration, or nothing when it made one or its form
 * kind owes none.
 *
 * @param formKind the form kind that produced the artifact — `finding` for a finding card, though it renders as
 *   an update
 * @param artifact the admitted artifact, whose `problem` field is read
 * @returns the refusal lines, empty when the row may park
 */
export function problemUndeclaredRefusals({
  formKind,
  artifact,
}: {
  formKind: string;
  artifact: object;
}): readonly string[] {
  const declared = "problem" in artifact && artifact.problem !== undefined;
  if (!DECLARING_FORM_KINDS.has(formKind) || declared) {
    return [];
  }
  return [PROBLEM_UNDECLARED, NOTHING_PARKED];
}

/**
 * An as-me recording's message, passed on when its form declared what {@link problemUndeclaredRefusals} asks of
 * it — the as-me form kind is the artifact's own, so the step reads nothing else.
 *
 * @param message the parkable message, whose prepared plan carries the artifact
 * @returns the same message, or the refusal lines
 */
export function problemDeclaredMessage<
  T extends { readonly prepared: { readonly plan: { readonly artifact: AsMeArtifact } } },
>({ message }: { message: T }): Result<T> {
  const { artifact } = message.prepared.plan;
  const refusals = problemUndeclaredRefusals({ artifact, formKind: artifact.kind });
  return refusals.length > 0 ? err(refusals) : ok(message);
}
