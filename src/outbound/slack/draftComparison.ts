/**
 * A Codex draft beside the Claude draft on a new as-me Queue card, shown straight away as an A-or-B the owner picks.
 *
 * Every NEW draft card carries both, never retroactively, and the owner gives feedback as they go. The measure is
 * which model writes what the owner would say, so a pick is recorded per row and counted by variant.
 *
 * Three facts ride the register, all appended and never rewritten:
 *
 * - the park says whether a comparison is owed (`pending`) or why not (`skipped`), so a record killed mid-pass leaves a
 *   row that SAYS it is waiting rather than one indistinguishable from a row parked before the feature;
 * - a `compared` event carries Codex's candidate, a refusal of it, or why there is none;
 * - a `picked` event records which one the owner chose, and a Codex pick makes the candidate the row's words — the
 *   original's are kept beside it, so the card still shows what was chosen between.
 *
 * Everything here is pure; the register fold in `./draftRegister.ts` calls it.
 */
import { receiptLinks } from "./draftReceipts.js";
import type {
  DraftApproval,
  ParkedMention,
  ParkedSlackDraft,
  SlackDraftEvent,
  SlackDraftItem,
} from "./draftRegister.js";
import type { ParkedDraftReceipts } from "./receiptsLine.js";
import type { SlackDripMessagePayload } from "./types.js";

/**
 * Which visible host composed a row's original words, read off the recording process's environment. `undetected` is a
 * recording with no host, or two leaked into one process.
 */
export const DRAFT_COMPOSERS = ["claude-code", "codex", "undetected"] as const;

/** One of {@link DRAFT_COMPOSERS}. */
export type DraftComposer = (typeof DRAFT_COMPOSERS)[number];

/** The two drafts a comparison card offers: the one the recording session wrote, and Codex's. */
export const DRAFT_VARIANTS = ["original", "codex"] as const;

/** One of {@link DRAFT_VARIANTS}. */
export type DraftVariant = (typeof DRAFT_VARIANTS)[number];

/**
 * Why a new as-me row carries no comparison. An approval at recording means the owner already chose these words; media is
 * something a candidate could not carry; and a row Codex composed has no second model to set beside it.
 */
export const COMPARISON_SKIP_REASONS = ["approved-at-record", "has-media", "composed-by-codex"] as const;

/** One of {@link COMPARISON_SKIP_REASONS}. */
type ComparisonSkipReason = (typeof COMPARISON_SKIP_REASONS)[number];

/** What a park says about its comparison: owed, or why not. A bot row, and every row before the feature, says nothing. */
export type ParkedComparison =
  { readonly state: "pending" } | { readonly state: "skipped"; readonly reason: ComparisonSkipReason };

/**
 * The words a row would post, as one unit — what a pick swaps and what the original keeps. Its receipts ride with
 * them, since the links a row brings are in its words.
 */
export type DraftWords = Pick<ParkedSlackDraft, "advisory" | "digest" | "form" | "mentions" | "payload" | "receipts">;

/** Codex's draft, prepared and admitted exactly as the original was, with its own digest over the same destination. */
export interface SlackDraftCandidate {
  /** The drip `--form` JSON Codex's answer converted to. */
  readonly form: string;
  readonly payload: SlackDripMessagePayload;
  readonly mentions: readonly ParkedMention[];
  readonly advisory: readonly string[];
  /** The digest an approval of this candidate binds, over the original's destination, identity and prior-ask proof. */
  readonly digest: string;
}

/**
 * Which gate refused a candidate: the owner's voice rules, or the admission the original passed — or `evidence`, when a retry
 * found the conversation the recording read edited or removed, so no pass blind to A can be run over what A saw.
 */
export type ComparisonRefusalStage = "voice-rules" | "admission" | "evidence";

/** What one comparison pass produced. */
export type ComparisonOutcome =
  | {
      readonly state: "ready";
      readonly candidate: SlackDraftCandidate;
      /** The model the pass asked for, as routed; the label the pick is counted under. */
      readonly requestedModel: string;
      readonly elapsedMs: number;
    }
  | { readonly state: "refused"; readonly stage: ComparisonRefusalStage; readonly reasons: readonly string[] }
  | { readonly state: "unavailable"; readonly reason: string };

/** A row's comparison as folded: the park's own word, or the latest pass outcome and when it was journalled. */
export type SlackDraftComparison = ParkedComparison | (ComparisonOutcome & { readonly atIso: string });

/** The owner's words choosing a variant, when the pick came off a voice call rather than a click. */
export type DraftPickVoice = Pick<DraftApproval, "anchor" | "atIso" | "heard">;

/** Which variant the owner chose, and when. */
export interface DraftPick {
  readonly variant: DraftVariant;
  readonly atIso: string;
  /** The model the Codex variant was asked of — what the pick is counted under. */
  readonly model: string;
  readonly voice?: DraftPickVoice | undefined;
}

/**
 * What a new row's park says about its comparison: nothing on a bot row, a skip with its reason on an ineligible as-me
 * row, else `pending`.
 *
 * @param draft the row about to be parked
 * @returns the comparison the park carries, or `undefined` when none is owed or explained
 */
export function comparisonAtPark({
  draft,
}: {
  draft: Pick<ParkedSlackDraft, "actor" | "approval" | "composer" | "media">;
}): ParkedComparison | undefined {
  if (draft.actor === "bot") {
    return undefined;
  }
  if (draft.approval !== undefined) {
    return { reason: "approved-at-record", state: "skipped" };
  }
  if (draft.media !== undefined && draft.media.length > 0) {
    return { reason: "has-media", state: "skipped" };
  }
  if (draft.composer === "codex") {
    return { reason: "composed-by-codex", state: "skipped" };
  }
  return { state: "pending" };
}

/**
 * Whether a comparison pass may still run on a row: held, unpicked, never revised by voice, and waiting on one —
 * `pending`, or an earlier pass that was `unavailable`. A ready or refused comparison is final, and a row that never
 * owed one never gets one.
 *
 * @param item the row as folded
 * @returns true when `slack draft compare` may run a pass
 */
export function comparisonRunnable({ item }: { item: SlackDraftItem }): boolean {
  const state = item.comparison?.state;
  const asMe = item.draft.actor !== "bot";
  // A row revised by voice is past a second opinion: Codex would be drafting beside words already steered.
  const unrevised = item.versions === undefined;
  const waiting = state === "pending" || state === "unavailable";
  return asMe && unrevised && item.state === "held" && item.pick === undefined && waiting;
}

/**
 * Whether a row waits on the owner's pick before it can be approved or released: neither draft is chosen, and Codex's
 * is ready or still owed. A `pending` row owes the pick too, so A is never sent before B was ever shown; a pass that
 * died leaves it retryable with `slack draft compare`, and one that ends `unavailable` or `refused`
 * frees A.
 *
 * @param item the row as folded
 * @returns true when a send must wait for, or name, a variant first
 */
export function pickOwed({ item }: { item: SlackDraftItem }): boolean {
  const state = item.comparison?.state;
  return item.state === "held" && item.pick === undefined && (state === "ready" || state === "pending");
}

/**
 * The refusal an approve or release prints on a row whose pick is owed: the commands that choose once Codex's draft is
 * ready, or the retry that finishes it while it is still pending.
 *
 * @param id the row
 * @param pending whether Codex's draft is still owed rather than ready
 * @returns the refusal line
 */
export function pickOwedRefusal({ id, pending }: { id: string; pending: boolean }): string {
  if (pending) {
    return (
      `draft ${id} is still waiting on Codex's draft beside it, which the owner sees before either is sent —` +
      `if no pass is running, finish it: slopweaver slack draft compare ${id}`
    );
  }
  return (
    `draft ${id} carries a Codex draft beside the original and neither is chosen yet — choose first: ` +
    `slopweaver slack draft approve ${id} --variant <original|codex> --anchor <anchor>, ` +
    `or slopweaver slack draft pick ${id} --variant <original|codex>`
  );
}

/**
 * Why Codex's draft cannot become the row's words: the original links to its receipt, and Codex's words link nowhere,
 * so picking it would leave the claim with none.
 *
 * @param id the row
 * @returns the refusal, naming both ways forward and the absent hatch
 */
export function codexDropsReceiptsRefusal({ id }: { id: string }): string {
  return (
    `${id}: Codex's draft drops the receipt the original brings — the original links to where the reader can see it, ` +
    `and Codex's words link nowhere — so it cannot become the words the owner sends. Choose the original ` +
    `(slopweaver slack draft pick ${id} --variant original), or re-cut the preferred wording with the link in it ` +
    `(slopweaver slack draft record … --supersedes ${id}). There is deliberately NO escape hatch: a card that makes a ` +
    `claim with no receipt is the defect this closes.`
  );
}

/**
 * The row's comparison on its park, carried onto the folded item.
 *
 * @param row the row {@link parkedRow} folded
 * @returns the row carrying its park's comparison, unchanged when the park carried none
 */
export function withParkedComparison({ row }: { row: SlackDraftItem }): SlackDraftItem {
  const parked = row.draft.comparison;
  return parked === undefined ? row : { ...row, comparison: parked };
}

/**
 * A row after a comparison pass journalled its outcome. Only a row a pass may still run on takes one, so a late pass
 * never overwrites a ready candidate, a pick, or a row already sent or dropped.
 *
 * @param standing the row as folded before the event
 * @param event the comparison outcome
 * @returns the row carrying the outcome, or `standing` unchanged
 */
export function comparedRow({
  standing,
  event,
}: {
  standing: SlackDraftItem;
  event: Extract<SlackDraftEvent, { kind: "compared" }>;
}): SlackDraftItem {
  if (!comparisonRunnable({ item: standing }) || standing.draft.approval !== undefined) {
    return standing;
  }
  return { ...standing, comparison: { ...event.outcome, atIso: event.tsIso } };
}

/**
 * A row after the owner's pick. A Codex pick makes the candidate the row's words, keeping the original's beside it; an
 * original pick keeps the row's words. A pick on a row with no ready candidate, or one already approved, changes
 * nothing: the words an approval bound are never swapped under it.
 *
 * @param standing the row as folded before the event
 * @param event the pick
 * @returns the row after the pick, or `standing` unchanged
 */
export function pickedRow({
  standing,
  event,
}: {
  standing: SlackDraftItem;
  event: Extract<SlackDraftEvent, { kind: "picked" }>;
}): SlackDraftItem {
  const comparison = standing.comparison;
  // A pick is recorded once per row, as `slack draft pick` holds it: a second line, written by hand, folds to nothing
  // rather than swap the words the first pick chose.
  const closed = standing.state !== "held" || standing.pick !== undefined || standing.draft.approval !== undefined;
  // A Codex draft that drops the receipt A brings never becomes the row's words: `slack draft pick` refuses it, and a
  // line written by hand folds to nothing.
  const dropsReceipts = event.variant === "codex" && candidateDropsReceipts({ item: standing });
  if (closed || comparison?.state !== "ready" || dropsReceipts) {
    return standing;
  }
  const original = originalWords({ item: standing });
  const pick: DraftPick = {
    atIso: event.tsIso,
    model: comparison.requestedModel,
    variant: event.variant,
    ...(event.voice === undefined ? {} : { voice: event.voice }),
  };
  if (event.variant === "original") {
    const { original: _swapped, ...rest } = standing;
    return { ...rest, draft: { ...standing.draft, ...original }, pick };
  }
  const { receipts: _originals, ...unreceipted } = standing.draft;
  const receipts = candidateReceipts({ original: original.receipts, payload: comparison.candidate.payload });
  return {
    ...standing,
    draft: { ...unreceipted, ...comparison.candidate, ...(receipts === undefined ? {} : { receipts }) },
    original,
    pick,
  };
}

/**
 * The original's words: kept beside the row once a Codex pick swapped them out, else the row's own.
 *
 * @param item the row as folded
 * @returns the words the recording session wrote
 */
export function originalWords({ item }: { item: SlackDraftItem }): DraftWords {
  if (item.original !== undefined) {
    return item.original;
  }
  const { advisory, digest, form, mentions, payload, receipts } = item.draft;
  return { advisory, digest, form, mentions, payload, ...(receipts === undefined ? {} : { receipts }) };
}

/**
 * The receipts Codex's words would carry as the row's: the links in its own message, keeping what the original said
 * it tried; else the original's `self-evident` or `tried`, which describe the investigation both drafts share rather
 * than one wording. A comparison runs only on a row with no files (`has-media` skips it), so a candidate carries none.
 *
 * @param original the original's receipts, absent on a row recorded before them
 * @param payload Codex's rendered message
 * @returns the receipts, or `undefined` when its words carry none and the original's were links of its own
 */
export function candidateReceipts({
  original,
  payload,
}: {
  original: ParkedDraftReceipts | undefined;
  payload: unknown;
}): ParkedDraftReceipts | undefined {
  const links = receiptLinks({ payload });
  if (links.length > 0) {
    const tried = triedOf({ receipts: original });
    return { kind: "attached", links, media: 0, ...(tried === undefined ? {} : { tried }) };
  }
  if (original?.kind === "attached") {
    return undefined;
  }
  return original;
}

/** What the recorder said it tried for a receipt the card lacks, in either shape that carries it. */
function triedOf({ receipts }: { receipts: ParkedDraftReceipts | undefined }): string | undefined {
  if (receipts?.kind === "tried") {
    return receipts.tried;
  }
  if (receipts?.kind === "attached") {
    return receipts.tried;
  }
  return undefined;
}

/**
 * Whether Codex's ready draft drops the receipt the original brings: the original links to where the reader can see
 * it, and Codex's words link nowhere. The card says so beside B, and B cannot be picked.
 *
 * @param item the row as folded
 * @returns true when a Codex pick would leave the row's claim with no receipt
 */
export function candidateDropsReceipts({ item }: { item: SlackDraftItem }): boolean {
  const comparison = item.comparison;
  if (comparison?.state !== "ready") {
    return false;
  }
  const original = originalWords({ item }).receipts;
  return (
    original?.kind === "attached" &&
    candidateReceipts({ original, payload: comparison.candidate.payload }) === undefined
  );
}

/**
 * The comparison fields a judgement carries across, since a judged row is rebuilt from its id and words.
 *
 * @param standing the row before the judgement
 * @returns the comparison, pick and original words it held
 */
export function comparisonCarried({
  standing,
}: {
  standing: SlackDraftItem;
}): Pick<SlackDraftItem, "comparison" | "original" | "pick"> {
  return {
    ...(standing.comparison === undefined ? {} : { comparison: standing.comparison }),
    ...(standing.original === undefined ? {} : { original: standing.original }),
    ...(standing.pick === undefined ? {} : { pick: standing.pick }),
  };
}

/** Picks counted by variant, and Codex's by the model asked — labelled preference, never a measured quality. */
export interface DraftPickCounts {
  readonly original: number;
  readonly codex: number;
  readonly byModel: Readonly<Record<string, { readonly original: number; readonly codex: number }>>;
}

/**
 * How the owner's picks fall across the rows that carried a comparison.
 *
 * @param items every folded row
 * @returns the counts, zero on a register with no pick
 */
export function draftPickCounts({ items }: { items: readonly SlackDraftItem[] }): DraftPickCounts {
  const byModel: Record<string, { original: number; codex: number }> = {};
  let original = 0;
  let codexPicks = 0;
  for (const { pick } of items) {
    if (pick === undefined) {
      continue;
    }
    let tally = byModel[pick.model];
    if (tally === undefined) {
      tally = { codex: 0, original: 0 };
      byModel[pick.model] = tally;
    }
    tally[pick.variant] += 1;
    if (pick.variant === "codex") {
      codexPicks += 1;
    } else {
      original += 1;
    }
  }
  return { byModel, codex: codexPicks, original };
}
