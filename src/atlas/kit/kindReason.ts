/**
 * WHY one kind holds nothing, as ONE WORD decided once, so no reader ever infers it.
 *
 * Owner ruling: the reason must be very visible, so an agent never has to guess whether coverage is missing
 * because the atlas is wrong or because of permissions.
 *
 * `./permissionBlock.ts` carries the FACT half of that ruling — a kind carries `permissionBlocked`, and
 * `unblockedBy` names the grant that would lift it. This module is the other half: the ruling asks for a
 * reader to be told, not for each reader to work it out. MEASURED when this file was written, four readers each answered that question with a different predicate over the same
 * kind:
 *
 * - `./answerable.ts` called a kind never-acquired on `lastSuccessAt === null && publishedCount === 0`,
 *   which also swallows a kind that WAS attempted and failed;
 * - `./pageModel.ts` called it dark-without-reason on a four-term disjunction over coverage cells and gaps
 *   that the other three do not read at all;
 * - `../../route/atlasReading.ts` restated `answerable.ts`'s pair structurally, so the two can drift
 *   without a compiler noticing;
 * - `../../cli/commands/atlas/doctorCore.ts` asked the question NOT AT ALL — the one verb whose whole job
 *   is "is this atlas usable" printed no word for a permission boundary anywhere.
 *
 * Four predicates for one question is the guess the ruling bans, arrived at honestly. So the predicate is
 * here, once, and every one of those readers takes its answer.
 *
 * ## The five reasons, and the precedence between them
 *
 * Precedence is the decision worth stating, because every pair of these can be true of the same kind at
 * once and only one of them is what a reader should act on.
 *
 * 1. **`permission-boundary`** outranks everything. It is safe for it to, and that safety is not this
 *    module's to assume — the STAMPING side already required every failure on the kind to be a permission
 *    classification before writing the field (GitHub's `permissionBlockedField`, JumpCloud's
 *    `PERMISSION_REFUSED`, Cloudflare's `permission-refused`), so a block is never masking a defect that a
 *    later run could clear. See `docs/atlases/publication.md` § "A surface the credential's PERMISSIONS do not reach publishes".
 * 2. **`product-absent`** — the provider answered that this organisation has no such product
 *    (`./productAbsence.ts`, owner ruling). Below a permission boundary because a
 *    fenced credential cannot tell whether the product exists behind the fence; above everything else for the same
 *    reason a boundary is — the stamping side required every failure on the kind to be that answer and
 *    nothing to have been read.
 * 3. **`reached`** — the kind has entities, or has ever been read successfully. A kind read successfully
 *    that holds nothing is REACHED and holds nothing, which is a fact about the organisation rather than a
 *    limit on the credential, and reporting it as either of the two below would be the same lie in reverse.
 * 4. **`gap`** — an attempt was made and this kind has still never been acquired. Our defect, or a real
 *    absence the atlas has not yet named. This is the arm that a fix closes.
 * 5. **`not-attempted`** — no run has ever tried. Nothing is broken and nothing is fenced; the atlas simply
 *    does not go here yet.
 *
 * ## What this deliberately does NOT fold in
 *
 * A DARK kind — one the manifest vouches for whose file the reader cannot open — is a store-level
 * disagreement (`AtlasGenerationView.missing`/`superseded`/`mismatched`), not a statement about what the
 * credential can reach, and `./answerable.ts` already refuses the whole atlas on it. Folding it in here
 * would let a corrupt generation be reported as a coverage question. The five reasons above are about ONE
 * kind's own history; darkness is about the generation the kind sits in.
 *
 * Staleness is likewise not here. A kind read last week and failing today is `reached` with a failing
 * latest attempt — `./freshness.ts` owns the currency question, and answering it in the same word as the
 * reachability question is what made `lastAttempt.outcome` mean different things on different atlases.
 */
import type { AtlasPermissionBlock } from "./permissionBlock.js";
import type { AtlasProductAbsence } from "./productAbsence.js";

/** The one word. See this module's header for the precedence between them. */
export type AtlasKindReasonCode = "gap" | "not-attempted" | "permission-boundary" | "product-absent" | "reached";

/**
 * Why one kind holds what it holds.
 *
 * A discriminated union rather than a record with a nullable remedy, so that a `permission-boundary`
 * carrying no `unblockedBy` is unrepresentable. The ruling's own words are that a boundary must say what
 * would lift it; a shape in which that field can be absent is a shape in which it will eventually be
 * absent.
 */
export type AtlasKindReason =
  | {
      readonly reason: "gap";
      /** One sentence a table, a page or a card prints unchanged. */
      readonly because: string;
    }
  | {
      readonly reason: "not-attempted";
      readonly because: string;
    }
  | {
      readonly reason: "permission-boundary";
      readonly because: string;
      /** The platform's own words for the refusal, carried from the block rather than paraphrased. */
      readonly detail: string;
      /** When the boundary was last observed, so a stale one is visible as stale. */
      readonly observedAt: string;
      /** The named grant that would make this surface reachable. */
      readonly unblockedBy: string;
    }
  | {
      readonly reason: "product-absent";
      readonly because: string;
      /** The provider's own answer, carried from the stamp rather than paraphrased. */
      readonly detail: string;
      /** When the provider last answered that the product is absent. */
      readonly observedAt: string;
    }
  | {
      readonly reason: "reached";
      readonly because: string;
    };

/**
 * The half of a kind that decides its reachability.
 *
 * Structural rather than `AtlasKindView`, so this module imports no read code and a caller holding only a
 * manifest cell can ask the same question of it.
 * @internal
 */
export interface AtlasKindReasonInput {
  readonly entityCount: number;
  readonly kind: string;
  /** `true` exactly when the most recent attempt recorded `outcome: "failed"`. */
  readonly latestAttemptFailed: boolean;
  readonly lastSuccessAt: string | null;
  readonly permissionBlocked: AtlasPermissionBlock | null;
  /** Optional because only an atlas that classifies the provider's absence answer ever stamps one. */
  readonly productAbsent?: AtlasProductAbsence | null | undefined;
}

/**
 * Decide, in one word, why a kind holds what it holds.
 *
 * Pure and total over every state a kind can be in, which is the property that lets the page, the doctor
 * table, the capability profile and the answerability grade all print the same word for the same kind.
 *
 * @param entityCount how many entities the reader projected, which is what `reached` is really about
 * @param latestAttemptFailed whether the most recent attempt recorded a failure
 * @param permissionBlocked the manifest's own boundary for this kind, or `null` when it declared none
 * @param productAbsent the provider's own answer that this organisation has no such product, or `null`/absent
 * @returns the reason, and the sentence that explains it
 */
export function kindReason({
  entityCount,
  kind,
  lastSuccessAt,
  latestAttemptFailed,
  permissionBlocked,
  productAbsent,
}: AtlasKindReasonInput): AtlasKindReason {
  if (permissionBlocked !== null) {
    return {
      because:
        `${kind} is not reachable under the current permissions — ${permissionBlocked.detail}.` +
        ` Reachable if ${permissionBlocked.unblockedBy}; the atlas is not missing it.`,
      detail: permissionBlocked.detail,
      observedAt: permissionBlocked.at,
      reason: "permission-boundary",
      unblockedBy: permissionBlocked.unblockedBy,
    };
  }
  if (productAbsent != null) {
    return {
      because:
        `${kind} is not reachable because this organisation has no such product — ${productAbsent.detail}.` +
        " Only adopting the product would change that; the atlas is not missing it.",
      detail: productAbsent.detail,
      observedAt: productAbsent.at,
      reason: "product-absent",
    };
  }
  if (entityCount > 0) {
    return {
      because: `${kind} holds ${String(entityCount)} entities`,
      reason: "reached",
    };
  }
  if (lastSuccessAt !== null) {
    return {
      because: `${kind} was read successfully at ${lastSuccessAt} and this organisation holds none`,
      reason: "reached",
    };
  }
  if (latestAttemptFailed) {
    return {
      because: `${kind} has been attempted and never acquired, and no permission boundary explains it`,
      reason: "gap",
    };
  }
  return {
    because: `${kind} has never been attempted — no run has been here, and nothing is blocking one`,
    reason: "not-attempted",
  };
}

/**
 * Every kind whose reachability is one given reason, named.
 *
 * The four readers each want one or two of the arms as a sorted name list, and a `filter` written per
 * reader is how the four predicates this module replaced came to disagree in the first place.
 *
 * @param kinds every kind, in any order
 * @param reason which arm to select
 * @returns the kind names, sorted, so two runs over the same generation print identically
 */
export function kindsWithReason({
  kinds,
  reason,
}: {
  kinds: readonly AtlasKindReasonInput[];
  reason: AtlasKindReasonCode;
}): readonly string[] {
  return kinds
    .filter((kind) => kindReason(kind).reason === reason)
    .map((kind) => kind.kind)
    .toSorted();
}
