/**
 * Build this platform's coverage cell for one kind — the place a withheld field is finally SAID, and the
 * place a partial read is refused the word `synced`.
 *
 * ## Why this exists rather than the sync calling the kit directly
 *
 * The kit's `succeededCoverageCell`/`failedCoverageCell` take a `reason` string and know nothing about
 * projections. Left to itself, a sync writes `reason: "synced <n> systems"` and the fact that every one of
 * them had a field removed is nowhere. This module is the seam that makes the drop reach the reader, and
 * putting it beside the projection rather than in the sync means it is testable without a network call and
 * cannot be forgotten by whoever writes the sync.
 *
 * ## It FAILS CLOSED, and that is the load-bearing rule
 *
 * A cell builder that takes a record count and nothing else has no way to tell a family that finished from
 * one whose second page threw, so it publishes both as `synced` — and the kit's success predicate is
 * existential, meaning one such cell is enough to make a partly-failed generation look routable. So the
 * read's own outcome is a REQUIRED input: a caller must state that the family completed, and cannot get a
 * `synced` cell by omitting the bad news. `records` is a count, never evidence of completeness.
 *
 * ## The drops are not a separate argument, and that is deliberate
 *
 * An earlier shape took a record COUNT and a drop list as two independent inputs, which let a caller pair a
 * truncated projection with an empty drop list and get `synced` — the metadata could disagree with the data
 * it described and nothing noticed. So this takes the PROJECTIONS themselves: the count is how many there
 * are and the drops are their own, so a truncation cannot be separated from the document it truncated.
 *
 * ## Where the honesty guarantee actually stops
 *
 * Stated rather than implied, because a reader is entitled to know the edge. This module reads its input by
 * index and never calls a method off it, so an array that overrides `flatMap` cannot hide its own drops.
 * What it cannot survive is a caller that lies about the input itself — a `Proxy` reporting `length: 0`
 * over a real truncated projection, or a hand-built `{ value, dropped: [] }` literal. Nothing in-process
 * defends against that, a nominal brand would need a type assertion `no-unsafe-type-assertion` refuses, and
 * the only caller is the sync in this repository. The guarantee is therefore: coverage cannot become
 * dishonest by ACCIDENT, and a caller that forges its own evidence is a defect in the sync, not a hole
 * this function can close.
 *
 * ## A failure is attributed to the kind whose surface produced it, and the registry decides that
 *
 * `kind` and the failing surface arrive as two independent strings, so nothing but this check stops a sync
 * loop from filing a `systems` failure under `applications` — which would publish an unreadable cell for a
 * kind that was fine and NO cell at all for the kind that broke, the exact omission this whole rule exists
 * to prevent. The generated registry already knows which kind each surface contributes to, so the
 * association is verified against it rather than trusted.
 *
 * A mismatch therefore yields TWO cells, which is why this returns a list rather than a cell: an
 * `invalid-configuration` cell for the kind the caller named, saying its fate is unknown because the
 * failure it was handed belongs elsewhere, and an `unreadable` cell scoped to the kind the registry
 * attributes that surface to. Publishing only one of them would omit a kind whichever one was chosen.
 *
 * Two things can therefore deny a kind `synced`, and they are different: the read did not finish, or the
 * projection hit its depth bound and truncated a document it did store. Both publish a non-`synced` state
 * with a reason rather than dropping the kind out of the generation, because a kind that vanishes reads as
 * a kind that does not exist.
 *
 * Nothing here changes what the sensitivity gate refuses. A KNOWN denied field being dropped is the
 * boundary working, on every application record that carries it; the gate exists for
 * material the projection could not have known about. Those are different checks and conflating them would
 * make the `applications` family permanently unsyncable.
 */
import type { AtlasCoverageState, AtlasEvidenceRole } from "../kit/contract.js";
import { type AtlasCoverageCell, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";

import type { AtlasDroppedField, AtlasProjection } from "../kit/projection.js";
import type { JumpcloudReadError } from "./errors.js";
import { JUMPCLOUD_SURFACES } from "./generated/surfaces.js";
import { JUMPCLOUD_VISIBILITY_SCOPE } from "./model.js";
import { summariseJumpcloudWithholding, withholdingIsTruncated, withholdingSentence } from "./withheld.js";

/**
 * Whether a kind's read actually finished, stated by the caller that ran it.
 *
 * Deliberately not inferable from a record count: 100 records is what a complete family and a family whose
 * second page threw both look like from here.
 * @internal
 */
export type JumpcloudReadOutcome =
  | {
      readonly status: "complete";
      /** Operations that answered they hold nothing here — `kindBoundary.ts`'s `providerAnswers`. Empty when none. */
      readonly answered: readonly string[];
    }
  | { readonly status: "incomplete"; readonly error: JumpcloudReadError };

/**
 * Every removal across a family's projections, read without calling a method off the caller's array.
 *
 * Indexed for the same reason `projection.ts` walks arrays by index: the array is the caller's, and calling
 * a method off it — `flatMap`, or the iterator — lets the caller decide what the drop report says about its
 * own documents.
 *
 * @param projections the family's projected records, each carrying its own removals
 * @returns every removal, in projection order
 */
function everyDrop({ projections }: { projections: readonly AtlasProjection[] }): readonly AtlasDroppedField[] {
  const dropped: AtlasDroppedField[] = [];
  for (let index = 0; index < projections.length; index += 1) {
    // Present: `index` is inside the array's own length, and `dropped` is a required field of every projection.
    const drops = projections[index]!.dropped;
    for (let at = 0; at < drops.length; at += 1) {
      const drop = drops[at];
      if (drop !== undefined) {
        dropped.push(drop);
      }
    }
  }
  return dropped;
}

/**
 * The coverage state one failure kind earns, and what would unblock it.
 *
 * A `switch` over every variant with a `never` default, so a new member of the union fails to compile here
 * rather than falling through to a state somebody guessed at runtime.
 */
// max-lines-exempt: one arm per failure kind, each a state plus the sentence that says what would unblock it — splitting it would put half the union in another function and lose the exhaustiveness check that is the point.
function stateFor({ error }: { error: JumpcloudReadError }): {
  readonly state: AtlasCoverageState;
  readonly unblockedBy: string;
} {
  switch (error.code) {
    case "SURFACE_REFUSED":
      return {
        state: "invalid-configuration",
        unblockedBy:
          "the sync asked for a surface the closed registry does not admit — a defect in this repository rather than a provider condition, so fix the caller or regenerate the registry",
      };
    case "PATH_UNBOUND":
      return {
        state: "deferred",
        unblockedBy:
          "read the collection that supplies the path parameter first — this operation is admitted and callable, and nothing bound an id to it in this generation",
      };
    case "CREDENTIAL_REJECTED":
      return {
        state: "unreadable",
        unblockedBy:
          "the credential was rejected outright — replace the JumpCloud API key and re-run, which the resume journal makes cheap",
      };
    case "PERMISSION_REFUSED":
      return {
        state: "unreadable",
        unblockedBy:
          "this administrator may not read this family. One family refused while others succeed is a permission boundary rather than a broken credential, and widening it is the owner's decision",
      };
    case "ROUTE_ABSENT":
      return {
        state: "unavailable",
        unblockedBy:
          "nothing here: a 404 is this organisation answering that it holds no such route, product or record — provisioning the product at JumpCloud is what would change it",
      };
    case "NOT_IMPLEMENTED":
      return {
        state: "unavailable",
        unblockedBy:
          "nothing here: a 501 is the provider answering that it does not implement this operation at all, so no request this atlas could construct would be served",
      };
    case "REDIRECT_REFUSED":
      return {
        state: "unreadable",
        unblockedBy:
          "the provider redirected and the boundary refuses to follow, because the allowlist checked the request that was sent rather than the one it would land on",
      };
    case "OPERATION_UNUSABLE":
      return {
        state: "unavailable",
        unblockedBy:
          "the operation needs a request contract this atlas does not hold — a required query parameter, or a response that is not a JSON document. Pin that contract from the specification and it becomes callable",
      };
    case "UNEXPECTED_SHAPE":
      return {
        state: "unreadable",
        unblockedBy:
          "the provider answered with a shape this surface does not admit — compare the response against the pinned specification before widening anything",
      };
    case "BODY_SHAPE_CHANGED":
      return {
        state: "unreadable",
        unblockedBy:
          "the provider answered a shape this surface's strict boundary does not read, and the refusal names each drifted field — declare the change in the surface's boundary and rebuild",
      };
    case "TRANSPORT_FAILED":
      return { state: "unreadable", unblockedBy: "re-run the sync; a transport failure is usually transient" };
    default: {
      const exhaustive: never = error;
      return { state: "unreadable", unblockedBy: JSON.stringify(exhaustive) };
    }
  }
}

/**
 * Which kind the generated registry says a surface contributes to.
 *
 * `null` for a name the registry does not hold at all, which is itself a mismatch: a failure can only be
 * attributed to a kind through a surface the registry admits.
 */
function registeredKindOf({ surface }: { surface: string }): string | null {
  const row = JUMPCLOUD_SURFACES.find((candidate) => candidate.name === surface);
  if (row === undefined) {
    // Absent by design: a name the registry does not hold contributes to no kind, which IS the mismatch.
    return null;
  }
  return row.kind;
}

/** How a mis-filing reason names the kind the registry attributes a surface to, including to none. */
function attributedKindPhrase({ attributed }: { attributed: string | null }): string {
  if (attributed === null) {
    return "no kind at all";
  }
  return attributed;
}

/**
 * The cell for a kind whose read stopped, including the case where the failure belongs to another kind.
 *
 * @param error what stopped the read
 * @param kind the kind this cell is being filed against
 * @param previous the cell as it stood before this attempt
 * @param read the English count of what was read before it stopped
 * @param role what the surface's evidence is worth here
 * @param surface which declared surface attempted the read
 * @returns a non-`synced` cell naming what stopped it, or the mis-attribution if that is what happened
 */
function incompleteKindCells({
  error,
  kind,
  previous,
  read,
  role,
  surface,
}: {
  error: JumpcloudReadError;
  kind: string;
  previous: AtlasCoverageCell | null;
  read: string;
  role: AtlasEvidenceRole;
  surface: string;
}): readonly [AtlasCoverageCell, ...AtlasCoverageCell[]] {
  const { state, unblockedBy } = stateFor({ error });
  const stopped = ({ scope }: { scope: string }): AtlasCoverageCell =>
    failedCoverageCell({
      previous: scope === kind ? previous : null,
      reason: `${read} before the read stopped: ${error.message}`,
      role,
      scope,
      state,
      surface,
      unblockedBy,
      visibilityScope: JUMPCLOUD_VISIBILITY_SCOPE,
    });
  const attributed = registeredKindOf({ surface: error.surface });
  if (attributed === kind) {
    return [stopped({ scope: kind })];
  }
  const misfiled = failedCoverageCell({
    previous,
    reason: `${read}, and then a failure on surface ${error.surface} was filed against ${kind}: the registry attributes that surface to ${attributedKindPhrase({ attributed })}, so what actually became of ${kind} is unknown`,
    role,
    scope: kind,
    state: "invalid-configuration",
    surface,
    unblockedBy:
      "fix the sync loop to build each kind's cell from its own surfaces — the mis-attribution is a defect in this repository rather than a provider condition",
    visibilityScope: JUMPCLOUD_VISIBILITY_SCOPE,
  });
  // The failed kind gets its own cell too. Publishing only the mis-filing would omit the kind that broke,
  // which is precisely the silence this module exists to prevent.
  return attributed === null ? [misfiled] : [misfiled, stopped({ scope: attributed })];
}

/**
 * Build the coverage cell for one kind, folding in both what was withheld and whether the read finished.
 *
 * @param kind the atlas kind this cell covers, used as the cell's own scope
 * @param surface which declared surface produced the read
 * @param role what that surface's evidence is worth for this kind
 * @param outcome whether the read finished, stated by whoever ran it
 * @param projections every record the family projected, each carrying its own removals — the count and the
 * drops both come from here, so neither can contradict the other
 * @param alsoDropped removals a previous projection already made, which re-projecting can no longer find.
 * They join the drops WITHOUT joining the record count, because they belong to records already counted
 * @param at this run's ISO timestamp
 * @param previous the cell as it stood before this attempt, carried forward when this one fails
 * @returns one `synced` cell naming what it withheld, one non-`synced` cell naming what stopped it, or
 *   two when a failure was filed against the wrong kind — never an empty list, because a kind that vanishes
 *   from a generation reads as a kind that does not exist, and the non-empty return type is what holds that
 */
export function jumpcloudKindCoverageCells({
  kind,
  surface,
  role,
  outcome,
  projections,
  alsoDropped = [],
  at,
  previous,
}: {
  kind: string;
  surface: string;
  role: AtlasEvidenceRole;
  outcome: JumpcloudReadOutcome;
  projections: readonly AtlasProjection[];
  alsoDropped?: readonly AtlasDroppedField[];
  at: string;
  previous: AtlasCoverageCell | null;
}): readonly [AtlasCoverageCell, ...AtlasCoverageCell[]] {
  const withholding = summariseJumpcloudWithholding({
    dropped: [...everyDrop({ projections }), ...alsoDropped],
  });
  const sentence = withholdingSentence({ withholding });
  const answered =
    outcome.status === "complete" && outcome.answered.length > 0
      ? `; ${String(outcome.answered.length)} operation(s) answered that this organisation holds nothing there: ${outcome.answered.join("; ")}`
      : "";
  const read = `read ${String(projections.length)} ${kind} record(s)${answered}`;
  if (outcome.status === "incomplete") {
    return incompleteKindCells({ error: outcome.error, kind, previous, read, role, surface });
  }
  if (withholdingIsTruncated({ withholding })) {
    return [
      failedCoverageCell({
        previous,
        reason: `${read}, but the projection could not walk them all: ${sentence}`,
        role,
        scope: kind,
        state: "unreadable",
        surface,
        unblockedBy:
          "inspect the document at the named pointer — a legitimate one that deep means the projection's bound needs raising, and a cyclic one means the family needs a different reduction",
        visibilityScope: JUMPCLOUD_VISIBILITY_SCOPE,
      }),
    ];
  }
  return [
    succeededCoverageCell({
      artifacts: [],
      at,
      reason: sentence === "" ? `${read}; nothing was withheld at the boundary` : `${read}; ${sentence}`,
      role,
      scope: kind,
      state: "synced",
      surface,
      visibilityScope: JUMPCLOUD_VISIBILITY_SCOPE,
    }),
  ];
}
