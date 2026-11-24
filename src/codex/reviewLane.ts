/**
 * Which review LANE a review occupies: the general lane every review has always been, or the baseline-bump
 * witness lane, which holds only the one adversarial review a ratchet bump's landing requires
 * (`./baselineBumpWitness.ts`). Each lane has its own two-diff count (`./reviewPassCap.ts`), and only the general
 * lane serves the pairing floor (`./ledgerReviewHalf.ts`).
 *
 * ## Why a witness needs a lane of its own
 *
 * The witness must be CURRENT for the pull request's head, so it is taken over the branch's final diff. On a
 * branch that already spent its two general passes on earlier diffs, that is a third distinct diff, and the
 * general cap refused it before spend — while `baseline-bump-unwitnessed` has no acknowledgement and no hatch. So
 * the two rules together held such a landing with no sanctioned way through.
 *
 * ## Admission is exact; the fold is row-local, and why that is enough
 *
 * Every property id starting `baseline-bump-` is RESERVED. `codex review` admits an invocation carrying one only
 * when the WHOLE invocation is the witness: pass `r3`, exactly one property, the full-digest id of a bump record
 * that exists, and the record's exact claim. Anything else carrying a reserved id is refused before spend, and
 * no acknowledgement or hatch opens that refusal — the general cap's hatch included.
 *
 * A pass record holds ONE property, so a row read back later cannot show how many properties its invocation had.
 * The fold classifies by the row alone ({@link reviewLaneOfEntry}) and that is still exact for the cap: every
 * property of one fan-out shares the fan-out's diff, so a witness-classified row beside any general sibling
 * leaves that diff in the general count through the sibling. Only an invocation whose EVERY row is
 * witness-classified escapes the general count, and admission lets exactly one such shape through.
 *
 * **The residue, stated:** a review recorded BEFORE admission existed, typed by hand rather than by
 * `witnessCommand`, that used a full witness id and a statement opening with the witness prefix but then claimed
 * something broader, is read as witness lane. Its diff spends no general slot. The only supported producer of
 * such an id was `witnessCommand`, which always printed one property with the exact claim.
 *
 * Pure.
 */

import { witnessClaim, witnessPropertyId } from "../devLint/baselineBump.js";
import type { BumpRecord } from "./bumpRecordStore.js";
import type { LedgerEntry } from "./ledger.js";
import type { ReviewPassId, ReviewProperty } from "./types.js";

/** The lane a review occupies. */
export type ReviewLane = "general" | "baseline-bump-witness";

/** Every property id starting with this is reserved for the baseline-bump witness. */
const RESERVED_PREFIX = "baseline-bump-";

/** The one reserved id shape a witness can carry: the prefix and a full sha256 digest. */
const FULL_WITNESS_ID = /^baseline-bump-([0-9a-f]{64})$/u;

/**
 * Whether a property id is in the reserved witness namespace, at any length or shape.
 *
 * @param propertyId the id a review was asked to judge under
 * @returns true when it starts with `baseline-bump-`
 */
export function isReservedWitnessPropertyId({ propertyId }: { propertyId: string }): boolean {
  return propertyId.startsWith(RESERVED_PREFIX);
}

/**
 * The opening every witness claim carries, digest included. Pinned against {@link witnessClaim} by its test, so a
 * change to the claim's wording that moved this opening fails there rather than demoting every witness.
 *
 * @internal exported so its test can pin it against the claim's real wording.
 * @param digest the bump record's digest
 * @returns `Ratchet bump <digest>:`
 */
export function witnessClaimPrefix({ digest }: { digest: string }): string {
  return `Ratchet bump ${digest}:`;
}

/**
 * The lane one recorded review row occupies, read from the row alone. Verdict, freshness and retirement decide
 * whether a row COUNTS or WITNESSES, never which lane the review was taken in, so none of them is read.
 *
 * @param entry the ledger row
 * @returns the witness lane for a Codex r3 review under a full witness id whose statement opens with that
 *   digest's witness prefix; the general lane for everything else
 */
export function reviewLaneOfEntry({ entry }: { entry: LedgerEntry }): ReviewLane {
  if (entry.propertyId === undefined) {
    return "general";
  }
  const digest = FULL_WITNESS_ID.exec(entry.propertyId)?.[1];
  const witness =
    digest !== undefined &&
    entry.provider === "codex" &&
    entry.mode === "review" &&
    entry.pass === "r3" &&
    typeof entry.propertyStatement === "string" &&
    entry.propertyStatement.startsWith(witnessClaimPrefix({ digest }));
  return witness ? "baseline-bump-witness" : "general";
}

/**
 * What admission says about one `codex review` invocation, before anything is spent.
 *
 * @internal the return of {@link reviewLaneAdmission}, matched by `kind` rather than imported.
 */
export type ReviewLaneAdmission =
  /** No property carries a reserved id: the general lane, as every review was. */
  | { readonly kind: "general" }
  /** The whole invocation is the exact witness for one existing bump record. */
  | { readonly kind: "witness"; readonly digest: string }
  /** A reserved id outside the one admitted shape: refused, and no hatch opens it. */
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Admit one review invocation to a lane, or refuse it. Only an invocation that carries a reserved id needs
 * `records`; a general one is decided without them.
 *
 * @param pass the review profile the invocation runs
 * @param properties every property the invocation would fan out over
 * @param records the bump records a landing would judge — the home's, then the change's committed manifests
 * @returns general, witness with its digest, or refused with the reason
 */
export function reviewLaneAdmission({
  pass,
  properties,
  records,
}: {
  pass: ReviewPassId;
  properties: readonly ReviewProperty[];
  records: readonly BumpRecord[];
}): ReviewLaneAdmission {
  if (!properties.some((property) => isReservedWitnessPropertyId({ propertyId: property.id }))) {
    return { kind: "general" };
  }
  const [only, ...rest] = properties;
  if (only === undefined || rest.length > 0) {
    return { kind: "refused", reason: "a witness review runs exactly one property, and this invocation runs more" };
  }
  if (pass !== "r3") {
    return { kind: "refused", reason: `a witness review runs pass r3, and this one runs ${pass}` };
  }
  const record = records.find((one) => witnessPropertyId({ digest: one.manifest.digest }) === only.id);
  if (record === undefined) {
    return { kind: "refused", reason: `no bump record has property id ${only.id}` };
  }
  if (only.statement !== witnessClaim({ manifest: record.manifest })) {
    return { kind: "refused", reason: `the property is not the exact claim of ${record.path}` };
  }
  return { digest: record.manifest.digest, kind: "witness" };
}
