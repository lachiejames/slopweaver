/**
 * What a session checks before it acts on a grant — the computable half of the typed refusal path.
 *
 * Pure by construction: the journal's entries and three observed facts go in, a row or ONE typed error comes
 * out. The facts are observed at the edge (`../cli/commands/grant/checkRow.ts`) because each is a different
 * kind of looking — the anchor classified by {@link anchorShapeOf} and, for a console record, read through the
 * reader that owns it; the target's presence against the filesystem; and what the session is about to write
 * against what it composed. A console record (`talk:`, `talk-call:`) is RESOLVED for real. The edge
 * does NOT open the transcript or fetch the URL an anchor names, so for those two shapes `anchorResolves` stays
 * a shape check, not a resolution.
 *
 * The order is deliberate and is the order the rule file tells a session to work through: a missing row
 * before an unresolvable anchor before a mismatched change, so the refusal a session prints names the FIRST
 * thing wrong rather than an incidental later one.
 *
 * `RAIL_CROSSED` is absent from this pipeline on purpose. Whether an act crosses the tier-3 set is judgement
 * no code can make, so a session supplies that refusal itself through `grant refuse`; this function's silence
 * on it is never permission.
 */
import { ownerWordsSchemeOf } from "../handover/hisWords.js";
import { err, ok, type Result } from "../lib/result.js";
import { type GrantCheckError, GrantCheckErrors } from "./errors.js";
import { type GrantEntry, type GrantRow, grantRowsOf, performancesOf, renderTarget } from "./grant.js";

/**
 * Whether the row's anchor resolves, and when it does not, why — so the refusal a session prints carries the owning
 * reader's own reason rather than a bare "does not resolve".
 */
export type AnchorResolution = { readonly kind: "resolved" } | { readonly kind: "unresolved"; readonly why: string };

/** What the edge observed about the world, so this stays pure. *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export interface ObservedFacts {
  /** Whether the row's anchor resolves to something a reader can go and look at. */
  readonly anchorResolves: AnchorResolution;
  /**
   * Whether the file or system the row names is there. `undefined` when the edge could not look — a system
   * target has no path to stat — which is NOT read as absent: "I could not look" and "it is not there" are
   * different answers, and collapsing them is how a blind check refuses the wrong thing.
   */
  readonly targetPresent: boolean | undefined;
  /**
   * Exactly what the session is about to write, or `undefined` when it is only READING the row (`grant
   * show`), where there is nothing yet to compare.
   */
  readonly proposedChange: string | undefined;
}

/**
 * Run every computable check on one row, in order.
 *
 * @param entries the whole journal
 * @param grantId the row the session was pointed at
 * @param facts what the edge observed
 * @returns the row when every computable check passes, else the FIRST check that failed
 */
export function verifyGrant({
  entries,
  grantId,
  facts,
}: {
  entries: readonly GrantEntry[];
  grantId: string;
  facts: ObservedFacts;
}): Result<GrantRow, GrantCheckError> {
  const row = grantRowsOf({ entries }).find((candidate) => candidate.id === grantId);
  if (row === undefined) {
    return err(GrantCheckErrors.rowMissing({ grantId }));
  }
  if (facts.anchorResolves.kind === "unresolved") {
    return err(GrantCheckErrors.anchorUnresolved({ anchor: row.anchor, why: facts.anchorResolves.why }));
  }
  const spent = performancesOf({ entries }).find((performance) => performance.grantId === grantId);
  if (spent !== undefined) {
    return err(GrantCheckErrors.alreadyPerformed({ grantId, performedAtIso: spent.performedAtIso }));
  }
  if (facts.targetPresent === false) {
    return err(GrantCheckErrors.stateAbsent({ target: renderTarget({ target: row.target }) }));
  }
  if (facts.proposedChange !== undefined && facts.proposedChange !== row.change) {
    return err(GrantCheckErrors.changeMismatch({ grantId }));
  }
  return ok(row);
}

/** The anchor shapes a row may carry, and the one that means "this points at nothing checkable". *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export type AnchorShape = "console-record" | "card-landing" | "transcript" | "url" | "unrecognised";

/**
 * Classify an anchor by shape alone — the cheap half of resolving one.
 *
 * `console-record` is an owner ruling typed or spoken to the console: a relay turn (`talk:<turn>`) or a call stretch
 * (`talk-call:<call>#<segment>`). The edge RESOLVES that shape for real through `../handover/hisWordsResolve.ts`, the
 * reader that owns those records, so a prefix alone never passes it.
 *
 * `card-landing` (`call:<call>#<segment>`) is REFUSED rather than resolved: its reader checks the landing and the call
 * file but not which console recorded the stretch, so a seat's test speech landed on a card would read as the owner's.
 * The stretch's own `talk-call:` anchor names the same words and is checked for that, so a row anchors there.
 *
 * For the other two shapes, shape is not resolution and never claims to be: a well-formed transcript pointer can
 * still name a turn that is not in the file, and nothing in the edge reads that file to find out — this shape check
 * is the whole of their anchor check. A prefix with nothing after it, such as a bare `transcript:`, still passes,
 * on purpose: tightening it would refuse rows accepted today. What it rules out is free prose like "the owner said
 * so", the one a fabricated row is most likely to carry.
 *
 * @param anchor the row's anchor
 * @returns which shape it is, or `unrecognised`
 */
export function anchorShapeOf({ anchor }: { anchor: string }): AnchorShape {
  // Untrimmed, exactly as the resolver reads it, so a padded console anchor never resolves a record it does not name.
  const scheme = ownerWordsSchemeOf({ anchor });
  if (scheme === "talk" || scheme === "talk-call") {
    return "console-record";
  }
  if (scheme === "call") {
    return "card-landing";
  }
  const trimmed = anchor.trim();
  if (trimmed.startsWith("transcript:")) {
    return "transcript";
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return "url";
  }
  return "unrecognised";
}
