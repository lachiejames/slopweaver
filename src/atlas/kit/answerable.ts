/**
 * Whether an atlas can actually ANSWER, decided once for every platform rather than per adapter.
 *
 * ## The failure this closes
 *
 * `read` was total over whatever the store handed back: a generation whose kind files the reader could not
 * see projected to zero entities and exited 0, which reads as _"this organisation holds none"_. The
 * JumpCloud adapter had already written the sentence that says why that is wrong — answering with zero
 * entities is indistinguishable from an organisation that holds nothing — but it said it about ONE state
 * (no manifest at all) in ONE adapter, so the sharper state went unguarded everywhere.
 *
 * MEASURED over the real `~/.slopweaver`: registered atlases held a published manifest
 * vouching for kinds whose files the reader could not open, and every one of them answered `entities: []`
 * with exit 0. Vanta vouched for every kind it had on disk while `slopweaver atlas vanta read`
 * reported nothing at all. Reproduce the class on any install with `slopweaver atlas doctor`.
 *
 * ## Why it lives in the kit and is applied by the registry
 *
 * A refusal each adapter has to remember is a refusal the next adapter forgets — five of them already had.
 * `registry.ts` wraps every `readSnapshot` in {@link refuseUnanswerableAtlas`}, so a new atlas inherits the
 * guard by being registered and there is no unguarded door to reach around.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type AtlasKindReasonInput, kindsWithReason } from "./kindReason.js";
import { type AtlasReadError, AtlasReadErrors, type AtlasReadSnapshot } from "./read.js";

/** The half of a snapshot that decides whether it can answer: the generation, and what each kind holds. */
export type AtlasGeneratedView = Pick<AtlasReadSnapshot, "generation" | "kinds">;

/** How well an atlas can answer, as one word. */
export type AtlasAnswerGrade = "answerable" | "dark" | "unpublished";

/** What grading one atlas's generation found. */
export interface AtlasAnswerability {
  readonly platform: string;
  readonly grade: AtlasAnswerGrade;
  /** What the manifest vouches for, summed over every kind. */
  readonly vouchedFor: number;
  /** What the reader could actually project out of the store. */
  readonly readable: number;
  /** Kinds the manifest vouches for and the reader cannot see, sorted, so a refusal names them. */
  readonly darkKinds: readonly string[];
  /**
   * The subset of {@link AtlasAnswerability.darkKinds} whose records are on disk under the pre-`.jsonl`
   * name — dark because of a FORMAT change, with the bytes intact. Named separately because the remedy is
   * different from every other way of being dark: nothing has to be fetched again.
   */
  readonly supersededKinds: readonly string[];
  /**
   * Kinds this credential is FENCED out of, sorted — dark for permissions rather than for a defect.
   *
   * Separated from every other emptiness because the remedy is a grant rather than a fix, and because a
   * reader that cannot tell the two apart is exactly what the owner's ruling forbids. See
   * `./permissionBlock.ts`.
   */
  readonly permissionBlockedKinds: readonly string[];
  /**
   * Kinds the provider answered this organisation has no such product for, sorted — dark because there is
   * nothing to read, not because the atlas is wrong or fenced. See `./productAbsence.ts`.
   */
  readonly productAbsentKinds: readonly string[];
  /**
   * Kinds an attempt has reached for and never acquired, sorted, with no permission boundary explaining it.
   *
   * This is the arm a FIX closes, and separating it from {@link AtlasAnswerability.notAttemptedKinds} is
   * the whole point of the owner's ruling: one of them means the atlas is wrong and the other means the atlas
   * has simply not gone there yet, and an agent must not have to read a paragraph to tell which. Decided by
   * `./kindReason.ts`, not here.
   */
  readonly gapKinds: readonly string[];
  /**
   * Kinds no run has ever attempted, sorted.
   *
   * The Vanta `audit` case that opened this row: an `authoritative` surface with `lastAttempt: null` inside
   * a generation the grade calls ANSWERABLE, correctly by its own criterion and misleadingly for the
   * question "is this atlas complete". `kit/mandatoryKinds.ts` cannot see it — no publish writes its group —
   * so the READ side is where it has to be reported.
   */
  readonly notAttemptedKinds: readonly string[];
  /** One sentence a refusal, a report row or a card can print unchanged. */
  readonly because: string;
}

/**
 * The kinds a generation vouches for and cannot produce.
 *
 * Four store-level disagreements and one arithmetic one, unioned rather than ranked: the file is gone, the
 * file is on disk under the previous format's name, the file is not the one the manifest published, and —
 * the case no store field names — the manifest vouches for entities the reader projected none of, which is
 * what a half-written file looks like once it has parsed.
 *
 * `superseded` has to be in that union explicitly, and this is the seam where forgetting it would be
 * silent. The store grades a kind left behind by the format change `superseded` rather than `missing`, so
 * without this arm a kind whose manifest cell records `entityCount: 0` falls out of BOTH the missing arm
 * and the shortfall arm — `publishedCount` is 0, so nothing is short — and an atlas holding a whole
 * generation in the old layout grades ANSWERABLE while producing nothing.
 */
function darkKindsOf({ snapshot }: { snapshot: AtlasGeneratedView }): readonly string[] {
  const short = snapshot.kinds
    .filter((kind) => kind.publishedCount > 0 && kind.entities.length === 0)
    .map((kind) => kind.kind);
  return [
    ...new Set([
      ...snapshot.generation.missing,
      ...snapshot.generation.superseded,
      ...snapshot.generation.mismatched,
      ...short,
    ]),
  ].toSorted();
}

/**
 * The three ways a kind can hold nothing, each named, decided by `./kindReason.ts` rather than here.
 *
 * Split out of {@link gradeAtlasAnswerability} so that function stays inside the length cap, and the seam
 * is the right one: everything here is "why is each kind the way it is", while the grade around it is
 * "can this generation answer at all".
 *
 * @param snapshot the generation and its kinds
 * @returns the fenced, gapped and never-attempted kind names, each sorted
 */
function reasonedKinds({ snapshot }: { snapshot: AtlasGeneratedView }): {
  gapKinds: readonly string[];
  notAttemptedKinds: readonly string[];
  permissionBlockedKinds: readonly string[];
  productAbsentKinds: readonly string[];
} {
  const kinds = snapshot.kinds.map((kind): AtlasKindReasonInput => ({
    entityCount: kind.entities.length,
    kind: kind.kind,
    lastSuccessAt: kind.lastSuccessAt,
    latestAttemptFailed: kind.latestAttemptFailed,
    permissionBlocked: kind.permissionBlocked,
    productAbsent: kind.productAbsent,
  }));
  return {
    gapKinds: kindsWithReason({ kinds, reason: "gap" }),
    notAttemptedKinds: kindsWithReason({ kinds, reason: "not-attempted" }),
    permissionBlockedKinds: kindsWithReason({ kinds, reason: "permission-boundary" }),
    productAbsentKinds: kindsWithReason({ kinds, reason: "product-absent" }),
  };
}

/**
 * Grade one atlas's generation on whether a reader can be given an answer from it.
 *
 * Pure and total: it reads the snapshot the adapter already built and never touches disk, so the same
 * grading serves the read guard, the sweep verb and a test with a hand-built snapshot.
 *
 * @param snapshot the generation and its kinds, as the platform's adapter projected them — the descriptor
 *   is deliberately not part of the input, so a test grades a state without building a whole atlas
 * @returns the grade, the counts behind it, and the sentence that explains it
 */
export function gradeAtlasAnswerability({ snapshot }: { snapshot: AtlasGeneratedView }): AtlasAnswerability {
  const platform = snapshot.generation.platform;
  const vouchedFor = snapshot.kinds.reduce((total, kind) => total + kind.publishedCount, 0);
  const readable = snapshot.kinds.reduce((total, kind) => total + kind.entities.length, 0);
  const darkKinds = darkKindsOf({ snapshot });
  const supersededKinds = [...snapshot.generation.superseded].toSorted();
  const { gapKinds, notAttemptedKinds, permissionBlockedKinds, productAbsentKinds } = reasonedKinds({ snapshot });
  if (snapshot.generation.updatedAt === null) {
    return {
      because: `no generation has been published, so the ${platform} atlas has never held anything`,
      darkKinds: [],
      gapKinds: [],
      grade: "unpublished",
      notAttemptedKinds: [],
      permissionBlockedKinds: [],
      platform,
      productAbsentKinds: [],
      readable: 0,
      supersededKinds: [],
      vouchedFor: 0,
    };
  }
  if (darkKinds.length > 0) {
    return {
      because:
        `the generation published ${snapshot.generation.updatedAt} vouches for ${vouchedFor} entities across` +
        ` ${darkKinds.length} kind(s) the reader cannot see (${darkKinds.join(", ")}), and produced` +
        ` ${readable}`,
      darkKinds,
      gapKinds,
      grade: "dark",
      notAttemptedKinds,
      permissionBlockedKinds,
      platform,
      productAbsentKinds,
      readable,
      supersededKinds,
      vouchedFor,
    };
  }
  return {
    because: `${readable} entities readable from the generation published ${snapshot.generation.updatedAt}`,
    darkKinds: [],
    gapKinds,
    grade: "answerable",
    notAttemptedKinds,
    permissionBlockedKinds,
    platform,
    productAbsentKinds,
    readable,
    supersededKinds: [],
    vouchedFor,
  };
}

/**
 * Hand back a snapshot only when it can answer, and say which way it cannot when it cannot.
 *
 * @param snapshot the platform's whole atlas, as its adapter projected it
 * @returns the same snapshot, or the typed refusal a caller displays and a sweep grades on
 */
export function refuseUnanswerableAtlas({
  snapshot,
}: {
  snapshot: AtlasReadSnapshot;
}): Result<AtlasReadSnapshot, AtlasReadError> {
  const graded = gradeAtlasAnswerability({ snapshot });
  if (graded.grade === "unpublished") {
    return err(AtlasReadErrors.generationUnpublished({ platform: graded.platform }));
  }
  if (graded.grade === "dark") {
    return err(
      AtlasReadErrors.generationDark({
        darkKinds: graded.darkKinds,
        platform: graded.platform,
        readable: graded.readable,
        supersededKinds: graded.supersededKinds,
        vouchedFor: graded.vouchedFor,
      }),
    );
  }
  return ok(snapshot);
}
