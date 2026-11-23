/**
 * The one home of "unavailable evidence is not negative evidence", at the seam a READER actually sees.
 *
 * ## The defect this closes, measured
 *
 * Owner ruling: a checkable trap is a gate, and what can be refused gets refused. The rule with no single
 * home was this one, stated four separate times
 * in four vocabularies: the kit's own `listed` is deliberately not `exhaustive`; a Datadog lookup returning
 * nothing has three causes identical at the wire; a 404 or a withheld field means you could not READ the
 * setting, never that it is off; a missing source is coverage-degraded, never a healthy zero.
 *
 * Every one of those four was already true of this tree's VOCABULARY and false of its ANSWER.
 * `kit/contract.ts` has carried eight coverage states since the kit existed, `AtlasKindView` carries the
 * permission block, the acquisition history and the open gaps, and `kit/answerable.ts` refuses a whole
 * generation the reader cannot read back. And then `selectEntities` flattened every kind into a bare page
 * of entities and both `atlas <platform> read` encodings threw the rest away.
 *
 * MEASURED by a Codex comprehension pass over a frozen copy of this tree and
 * re-derived by hand: a published generation holding an `audit` kind with no entities, `lastSuccessAt:
 * null` and an `unavailable` coverage cell graded `answerable`, passed `refuseUnanswerableAtlas`, and
 * answered `vanta atlas — 0 matching entities` / `no entity matched — widen the filters` on the text
 * channel and `{"entities":[],"page":{"matched":0}}` on the JSON one, both at exit 0. A reader cannot tell
 * that from an organisation that holds no audit records. Reproduce the shape with
 * `slopweaver atlas <platform> read --kind <a never-acquired kind>`.
 *
 * ## The criterion, stated so it can be argued with
 *
 * > A successful generic atlas read describes a selection of STORED RECORDS. When nothing matched and the
 * > evidence boundary of ANY selected kind cannot establish that a zero was ever measured, the read
 * > refuses instead of answering zero.
 *
 * Any rather than every, and that is the conservative half: a selection spanning a well-measured kind and
 * an unmeasured one produces one zero, and that zero is unproven — the reader cannot tell which kind the
 * absence came from. Narrowing `--kind` is how a caller asks the question the measured kind CAN answer.
 *
 * What makes an empty selection unprovable is a closed list, computed per kind over the cells the caller's
 * own `--surface` filter selects, and each entry is a fact on the record rather than a judgement:
 *
 * 1. the kind declares no coverage cell at all for the selected surface — nothing ever said it looked;
 * 2. a relevant cell is in any state but `synced` — `unavailable`, `unreadable`, `not-configured`,
 *    `invalid-configuration`, `deferred`, `excluded` and `held-elsewhere` are all "this atlas is not the
 *    thing that answers here", and `held-elsewhere` is the sharpest of them because it is a COMPLETE
 *    answer living somewhere else;
 * 3. a relevant cell has never succeeded, or its latest attempt failed;
 * 4. the kind carries a permission block — the credential is fenced out, which is the 404 case verbatim;
 * 5. the kind has an open gap — the atlas has already written down that it could not see something;
 * 6. the generation itself disagrees with its manifest about this kind (`missing`, `mismatched`,
 *    `unpublished`, `superseded`);
 * 7. the kind's freshness is `never-synced` or `indeterminate` — no instant to measure a zero at.
 *
 * ## Three things it deliberately ALLOWS, because a gate that refuses everything is not a gate
 *
 * **A historical zero is answered, not refused.** `assessFreshness` grading a kind `historical` means a
 * successful acquisition really did happen and is simply older than the atlas's own window. That zero WAS
 * measured; what it needs is its date attached, which {@link AtlasReadKindBoundary.freshness} carries and
 * both encodings print. Refusing it would turn every atlas synced more than four hours ago into a verb
 * that cannot answer, which is a different defect wearing this one's clothes.
 *
 * **A partial positive is answered.** The refusal is reachable only when `page.matched === 0`: an atlas
 * that returns records is giving a reader something real, and the boundary rides along beside it saying
 * what the records are not.
 *
 * **A field inside `detail` is never judged.** `AtlasEntityView.detail` is `unknown` — the provider's own
 * JSON — so kind-level coverage cannot establish whether a particular missing setting was withheld, unset
 * or never read. {@link AtlasReadBoundary.fieldAbsence} states that limit rather than pretending to a
 * decoder this kit does not have.
 *
 * ## Why the exclusions carried are a SUBSET, against the plan that proposed all of them
 *
 * `AtlasDescriptor.excludes` held 226 entries across 36 descriptors when the grounds were split, and most
 * of them withhold no record at all — they bound what the atlas DOES rather than what it holds.
 * {@link withholdsRecords} is the kit's own predicate for the difference, so {@link
 * AtlasReadBoundary.withheldBy} carries the ones that really do drop a family and
 * {@link AtlasReadBoundary.boundedByCount} counts the rest. Carrying all 226 on every read would be a wall
 * of prose a reader learns to skip, which is how an honest boundary becomes decoration.
 *
 * ## A POSITIVE gets qualified too, and that is a different rule
 *
 * Everything above qualifies a ZERO. {@link AtlasReadKindBoundary.estateNotEstablished} qualifies a
 * POSITIVE: a kind can hand back 29 records and still establish nothing about what this organisation holds,
 * because not one of them is a record a surface the descriptor declares `role: "authoritative"` REVEALED —
 * a surface filling in the contents of a record a `discovery` surface had already declared says what the
 * platform offers, never what this organisation has. `kit/estateEvidence.ts` carries the criterion, the
 * measurement and the two drafts that got it wrong; the reason it is a separate field rather than a ninth
 * entry in the list above is that the two fire on opposite inputs — this one is only ever interesting when
 * records WERE returned.
 *
 * ## What this is NOT
 *
 * It is a bounded honesty contract on one verb's answer, not a proof that any later sentence is true. A
 * model handed a correctly qualified page can still write "Vanta holds no audit records" in a Slack card.
 * The type makes the qualification impossible to DROP; it cannot make it impossible to ignore.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type AtlasDescriptor, type AtlasExclusion, withholdsRecords } from "./contract.js";
import { estateNotEstablishedReason } from "./estateEvidence.js";
import { assessFreshness, type FreshnessAssessment } from "./freshness.js";
import { atlasFreshnessWindowMs } from "./freshnessWindow.js";
import type { AtlasPermissionBlock } from "./permissionBlock.js";
import type { AtlasProductAbsence } from "./productAbsence.js";
import type {
  AtlasCoverageCellView,
  AtlasGapView,
  AtlasGenerationView,
  AtlasKindView,
  AtlasReadSnapshot,
} from "./read.js";
import { type AtlasEntityPage, type AtlasEntitySelection, selectEntities } from "./selectEntities.js";

/**
 * What one selected kind's evidence can and cannot support.
 *
 * Every field here already existed on {@link AtlasKindView}; what is new is that the answer carries them
 * instead of the selector discarding them. {@link AtlasReadKindBoundary.emptyIsUnproven} is the computed
 * half — a list of reasons rather than a boolean, because the reasons are what a reader has to act on and
 * a boolean would have to be re-derived by whoever printed it.
 */
export interface AtlasReadKindBoundary {
  readonly kind: string;
  /** The cells the caller's own `--surface` filter selected; all of them when no surface was named. */
  readonly coverage: readonly AtlasCoverageCellView[];
  readonly gaps: readonly AtlasGapView[];
  readonly permissionBlocked: AtlasPermissionBlock | null;
  /** The provider's own answer that this organisation has no such product — see `./productAbsence.ts`. */
  readonly productAbsent?: AtlasProductAbsence | null | undefined;
  readonly lastSuccessAt: string | null;
  readonly latestAttemptFailed: boolean;
  readonly freshness: FreshnessAssessment;
  /**
   * Why a zero over this kind would prove nothing, one sentence per reason, empty when a zero here IS a
   * measured zero. Non-empty is exactly the condition {@link assessAtlasReadAnswer} refuses on.
   */
  readonly emptyIsUnproven: readonly string[];
  /**
   * Why this kind's records cannot answer about this organisation's own estate, or `null` when they can.
   *
   * Orthogonal to {@link AtlasReadKindBoundary.emptyIsUnproven}, and deliberately not folded into it: that
   * list qualifies a ZERO, and this one qualifies a POSITIVE. A kind can hand back 29 records and still
   * establish nothing about what this organisation holds — `kit/estateEvidence.ts` carries the measurement
   * that made the distinction worth a field.
   */
  readonly estateNotEstablished: string | null;
}

/**
 * The claim boundary a whole answer is made under — three constants a reader may quote, and the per-kind
 * evidence behind them.
 *
 * The three literal fields are deliberately not booleans and not prose. They are the sentences this verb is
 * ALWAYS making, so a consumer that renders them cannot accidentally render a stronger one, and a consumer
 * that ignores them has ignored something present rather than something that was never there.
 */
export interface AtlasReadBoundary {
  /** What the counts count. Never the provider's population. */
  readonly countScope: "stored-selection";
  /** What a full page does not establish. This kit holds no completeness receipt for a generic read. */
  readonly providerCompleteness: "not-established";
  /** What an absent field inside `detail` does not establish. See this file's header. */
  readonly fieldAbsence: "not-evidence-of-absence";
  readonly selection: AtlasEntitySelection;
  readonly kinds: readonly AtlasReadKindBoundary[];
  /** The declared exclusions that really do drop records — see this file's header. */
  readonly withheldBy: readonly AtlasExclusion[];
  /** How many further exclusions bound what the atlas does without withholding a record. */
  readonly boundedByCount: number;
  readonly surfaces: AtlasDescriptor["surfaces"];
}

/** A page of stored records, and the boundary it was selected under. Never one without the other. */
export interface AtlasReadAnswer {
  readonly generation: AtlasGenerationView;
  readonly boundary: AtlasReadBoundary;
  readonly page: AtlasEntityPage;
}

/**
 * Nothing matched, and the evidence cannot establish that anything was ever looked for.
 *
 * Carries the whole boundary rather than a summary sentence: the caller printing this refusal is the same
 * code that would have printed the answer, and a refusal that says less than the answer would have is one
 * a reader routes around.
 * @internal — an arm of {@link AtlasReadAnswerError}; callers branch on `code`, never on this name.
 */
export interface AtlasReadEmptyUnprovenError {
  readonly code: "ATLAS_READ_EMPTY_UNPROVEN";
  readonly message: string;
  readonly platform: string;
  readonly generation: AtlasGenerationView;
  readonly boundary: AtlasReadBoundary;
}

/**
 * The caller filtered on a surface this atlas does not declare.
 *
 * A refusal rather than an empty result, for the same reason `narrowToKinds` refuses an unknown kind: a
 * typo'd `--surface consoel` selects no cell, matches no entity, and would otherwise answer zero in the
 * confident voice of a measurement.
 * @internal — an arm of {@link AtlasReadAnswerError}; callers branch on `code`, never on this name.
 */
export interface AtlasReadSurfaceUnknownError {
  readonly code: "ATLAS_READ_SURFACE_UNKNOWN";
  readonly message: string;
  readonly platform: string;
  readonly surface: string;
  readonly known: readonly string[];
}

export type AtlasReadAnswerError = AtlasReadEmptyUnprovenError | AtlasReadSurfaceUnknownError;

/** Construct one {@link AtlasReadAnswerError}. Tests build fixtures through these, never a hand-built literal. */
export const AtlasReadAnswerErrors = {
  emptyUnproven: ({
    platform,
    generation,
    boundary,
  }: {
    platform: string;
    generation: AtlasGenerationView;
    boundary: AtlasReadBoundary;
  }): AtlasReadEmptyUnprovenError => ({
    boundary,
    code: "ATLAS_READ_EMPTY_UNPROVEN",
    generation,
    message:
      `no stored ${platform} record matched, and this atlas cannot establish that a zero was ever` +
      ` measured: ${unprovenSentence({ boundary })}. Answering zero here would be indistinguishable from` +
      " an organisation that holds none",
    platform,
  }),
  surfaceUnknown: ({
    platform,
    surface,
    known,
  }: {
    platform: string;
    surface: string;
    known: readonly string[];
  }): AtlasReadSurfaceUnknownError => ({
    code: "ATLAS_READ_SURFACE_UNKNOWN",
    known: [...known],
    message: `${platform} declares no surface ${surface} — it declares: ${known.join(", ")}`,
    platform,
    surface,
  }),
} as const;

/**
 * Fold every kind's unproven reasons into the one clause a refusal message quotes.
 *
 * @param boundary the boundary whose kinds are being summarised
 * @returns the clause, reading after "cannot establish that a zero was ever measured:"
 */
function unprovenSentence({ boundary }: { boundary: AtlasReadBoundary }): string {
  return boundary.kinds
    .filter((kind) => kind.emptyIsUnproven.length > 0)
    .map((kind) => `${kind.kind} — ${kind.emptyIsUnproven.join("; ")}`)
    .join(" · ");
}

/**
 * The cells one selection actually rests on.
 *
 * A `--surface api` read may not lean on a browser cell that synced yesterday, and a read with no surface
 * filter rests on every cell the kind declares. Getting this backwards is how the original defect reappears
 * under a narrower filter: one successful surface standing in for an unmeasured one.
 *
 * @param kind the kind whose cells are being narrowed
 * @param surface the caller's surface filter, or `undefined` for all of them
 * @returns the cells this selection's honesty rests on
 */
function relevantCells({
  kind,
  surface,
}: {
  kind: AtlasKindView;
  surface: string | undefined;
}): readonly AtlasCoverageCellView[] {
  if (surface === undefined) {
    return kind.coverage;
  }
  return kind.coverage.filter((cell) => cell.surface === surface);
}

/**
 * Which of the generation's four disagreements name this kind.
 *
 * Partly unreachable through `atlas <platform> read` today, and kept anyway: `registry.ts` wraps every
 * `readSnapshot` in `refuseUnanswerableAtlas`, which refuses a whole generation whose manifest vouches for
 * kinds the reader cannot see — so a `missing` kind is refused BEFORE a selection is ever made. A Codex
 * review pass found that precedence. It is the right order (the stronger guard first, and it refuses
 * rather than answering zero either way), and this check stays because the assessor is also called
 * directly and because `superseded` and `unpublished` are not all covered by that guard.
 *
 * @param generation the generation view, carrying all four anomaly arrays
 * @param kind the kind being judged
 * @returns one sentence per anomaly naming this kind, empty when the generation agrees with its manifest
 */
function generationAnomalies({
  generation,
  kind,
}: {
  generation: AtlasGenerationView;
  kind: string;
}): readonly string[] {
  const named: readonly { readonly kinds: readonly string[]; readonly why: string }[] = [
    { kinds: generation.missing, why: "the manifest vouches for this kind and its file is gone" },
    { kinds: generation.mismatched, why: "this kind's file is not the generation the manifest published" },
    { kinds: generation.unpublished, why: "this kind's file is one the manifest does not vouch for" },
    { kinds: generation.superseded, why: "this kind's records are on disk under the pre-`.jsonl` name" },
  ];
  return named.filter((entry) => entry.kinds.includes(kind)).map((entry) => entry.why);
}

/**
 * Every reason a zero over one kind would prove nothing. The closed list in this file's header, computed.
 *
 * @param kind the kind view being judged
 * @param cells the cells this selection rests on, already narrowed by surface
 * @param freshness this kind's freshness under the atlas's own window
 * @param generation the generation view, for the four manifest disagreements
 * @returns one sentence per reason, empty when a zero here is a measured zero
 */
function unprovenReasons({
  kind,
  cells,
  freshness,
  generation,
}: {
  kind: AtlasKindView;
  cells: readonly AtlasCoverageCellView[];
  freshness: FreshnessAssessment;
  generation: AtlasGenerationView;
}): readonly string[] {
  const reasons: string[] = [];
  if (cells.length === 0) {
    reasons.push("no coverage cell says anything ever looked at this kind on the selected surface");
  }
  for (const cell of cells) {
    if (cell.state !== "synced") {
      reasons.push(`its ${cell.surface} coverage is ${cell.state} (${cell.reason})`);
      continue;
    }
    if (cell.lastSuccessAt === null) {
      reasons.push(`its ${cell.surface} coverage has never synced successfully`);
    }
    if (cell.latestAttemptFailed) {
      reasons.push(`the latest ${cell.surface} attempt failed, so the stored records may be short`);
    }
  }
  if (kind.permissionBlocked !== null) {
    reasons.push(
      `this credential is not permitted to read it (${kind.permissionBlocked.detail}), which is a refusal to` +
        " read rather than a reading of nothing",
    );
  }
  for (const gap of kind.gaps.filter((candidate) => candidate.status === "open")) {
    reasons.push(`an open gap stands against it: ${gap.condition}`);
  }
  reasons.push(...generationAnomalies({ generation, kind: kind.kind }));
  if (freshness.verdict === "never-synced" || freshness.verdict === "indeterminate") {
    reasons.push(`its freshness is ${freshness.verdict}, so there is no instant to have measured a zero at`);
  }
  return reasons;
}

/**
 * Build one kind's boundary.
 *
 * @param kind the kind view being assessed
 * @param surface the caller's surface filter, or `undefined`
 * @param windowMs the atlas's own freshness window
 * @param nowMs the current instant, injected so this stays pure
 * @param generation the generation view, for the four manifest disagreements
 * @param descriptor the atlas's own declaration, which is where a surface's evidence role lives
 * @returns the boundary for this kind
 */
function kindBoundary({
  kind,
  surface,
  windowMs,
  nowMs,
  generation,
  descriptor,
}: {
  kind: AtlasKindView;
  surface: string | undefined;
  windowMs: number;
  nowMs: number;
  generation: AtlasGenerationView;
  descriptor: AtlasDescriptor;
}): AtlasReadKindBoundary {
  const cells = relevantCells({ kind, surface });
  const freshness = assessFreshness({
    lastSuccessAt: kind.lastSuccessAt,
    latestAttemptFailed: kind.latestAttemptFailed,
    nowMs,
    windowMs,
  });
  return {
    coverage: cells,
    emptyIsUnproven: unprovenReasons({ cells, freshness, generation, kind }),
    estateNotEstablished: estateNotEstablishedReason({ descriptor, kind }),
    freshness,
    gaps: kind.gaps,
    kind: kind.kind,
    lastSuccessAt: kind.lastSuccessAt,
    latestAttemptFailed: kind.latestAttemptFailed,
    permissionBlocked: kind.permissionBlocked,
    productAbsent: kind.productAbsent,
  };
}

/**
 * Judge a selected page against the evidence boundary of the kinds it was selected over.
 *
 * The kit's single home for the rule in this file's header. `selectEntities` still returns a bare PAGE and
 * is still exported — see {@link answerAtlasRead} on why that is safe — so what makes every generic read
 * go through this function is the other end: the two `atlas read` encoders take this function's `Result`
 * and nothing else.
 *
 * @param descriptor the atlas's own declaration — its surfaces, its exclusions and its freshness window
 * @param generation what the store said about the generation itself
 * @param kinds the kind views this selection ran over, already narrowed to the requested kinds
 * @param selection what the caller asked to see
 * @param page the selected page
 * @param nowMs the current instant in epoch milliseconds, injected so this stays pure
 * @returns the qualified answer, or the refusal that says which evidence is missing
 */
export function assessAtlasReadAnswer({
  descriptor,
  generation,
  kinds,
  selection,
  page,
  nowMs,
}: {
  descriptor: AtlasDescriptor;
  generation: AtlasGenerationView;
  kinds: readonly AtlasKindView[];
  selection: AtlasEntitySelection;
  page: AtlasEntityPage;
  nowMs: number;
}): Result<AtlasReadAnswer, AtlasReadAnswerError> {
  const known = descriptor.surfaces.map((surface) => surface.name);
  if (selection.surface !== undefined && !known.includes(selection.surface)) {
    return err(
      AtlasReadAnswerErrors.surfaceUnknown({ known, platform: descriptor.platform, surface: selection.surface }),
    );
  }
  const windowMs = atlasFreshnessWindowMs({ descriptor });
  const withheldBy = descriptor.excludes.filter((exclusion) => withholdsRecords({ exclusion }));
  const boundary: AtlasReadBoundary = {
    boundedByCount: descriptor.excludes.length - withheldBy.length,
    countScope: "stored-selection",
    fieldAbsence: "not-evidence-of-absence",
    kinds: kinds.map((kind) =>
      kindBoundary({ descriptor, generation, kind, nowMs, surface: selection.surface, windowMs }),
    ),
    providerCompleteness: "not-established",
    selection,
    surfaces: descriptor.surfaces,
    withheldBy,
  };
  // `matched`, never `entities.length`: a page exhausted by `--after` is the end of a cursor, not an atlas
  // with nothing in it, and refusing there would make pagination itself look like an absence.
  if (page.matched === 0 && boundary.kinds.some((kind) => kind.emptyIsUnproven.length > 0)) {
    return err(AtlasReadAnswerErrors.emptyUnproven({ boundary, generation, platform: descriptor.platform }));
  }
  return ok({ boundary, generation, page });
}

/**
 * Select a page and judge it in one act — the ONLY way a caller gets an atlas answer.
 *
 * `selectEntities` stays exported beside this, because the selection algebra (filters, the stable sort, the
 * `after` cursor) is worth pinning on its own and returns a PAGE rather than an answer. What makes that
 * safe is the other end: {@link atlasReadJson} and {@link renderAtlasRead} take this function's `Result` and
 * nothing else, so a bare page has nothing in the tree that will render it.
 *
 * @param snapshot the platform's whole atlas — its descriptor, its generation and its kinds
 * @param kinds the kind views this selection runs over, already narrowed to the requested kinds
 * @param selection what the caller asked to see
 * @param nowMs the current instant in epoch milliseconds, injected so this stays pure
 * @returns the qualified answer, or the refusal that says which evidence is missing
 */
export function answerAtlasRead({
  snapshot,
  kinds,
  selection,
  nowMs,
}: {
  snapshot: AtlasReadSnapshot;
  kinds: readonly AtlasKindView[];
  selection: AtlasEntitySelection;
  nowMs: number;
}): Result<AtlasReadAnswer, AtlasReadAnswerError> {
  return assessAtlasReadAnswer({
    descriptor: snapshot.descriptor,
    generation: snapshot.generation,
    kinds,
    nowMs,
    page: selectEntities({ kinds, selection }),
    selection,
  });
}
