/**
 * WHETHER the next top-up generation may be raised at all — the merge-release gate.
 *
 * A row may set `--release-after-merged <percent>`: raise nothing until that share of the previous raised batch has
 * merged, so a schedule never piles fresh pull requests on a set nobody is landing. The threshold is the row's own;
 * omitted or `0` there is no merge hold and the gate reads no previous batch ({@link topupMergeGate}'s `disabled`).
 * `./vulnTopup.ts` decides WHICH alerts a batch comes from; this module decides whether there is a batch today, and
 * `./vulnTopupBatchRead.ts` reads the previous batch back off its brief. Pure: the caller read the board, the open
 * alerts and any closed alert's state, and hands them in.
 *
 * ## "Merged" is Dependabot's own `fixed`
 *
 * GitHub closes an alert `fixed` when the default branch stops carrying the vulnerable version — which is
 * what a merged bump does, and the one fact this verb already reads without a new query. `dismissed` (and
 * `auto_dismissed`) is NOT merged and is reported separately: counting a dismissal as progress would let a
 * batch nobody landed unlock the next one.
 *
 * ## `withdrawn` is neither merged nor raised
 *
 * GitHub can withdraw the advisory behind an alert, and then answers the single read with HTTP 410 rather than
 * the alert (MEASURED on acme-admin alert 1054: `slopweaver github vuln get --repo acme/acme-admin
 * --number 1054`). A withdrawn alert never becomes `fixed`, so holding the next batch on it, even behind an
 * open pull request still naming its package, would stop the recipe for good; counting it as merged would let
 * work nobody landed unlock the next batch. It is reported beside `dismissed` and kept out of both counts.
 *
 * ## The denominator is what was actually RAISED, and zero raised never blocks
 *
 * A member is raised when it merged, or when an open roster pull request still names its package. A member
 * with neither was never raised — its session died, or judged it unfixable — and holding the next batch on
 * it would stop the recipe for good, silently: the failure the owner dislikes most
 * about scheduled bots. So the rule is `merged >= ceil(raised * percent / 100)`, and a generation that raised
 * nothing lets the next one through and says so.
 *
 * A brief's BACKFILL lines are judged only in the slots a seat opened: one per batch member it skipped and ruled not a
 * bump ({@link topupBackfillSlots}), a line an open pull request names taking a slot first, so a backfill line
 * nobody raised counts nowhere unless a slot is left for it ({@link topupJudgedBackfill}).
 */
import { type NotABumpRuling, packageIsNotABump } from "../live/vuln/notABumpStore.js";
import type { TopupRowState } from "./vulnTopup.js";
import { type TopupBatchMember, topupAskRepo } from "./vulnTopupBatchRead.js";

/**
 * The stem every top-up generation's slug opens with: `<stem>-<owner>-<name>-<epoch ms>`. Here rather than in the
 * command, so the sweep's supersession reader names the same stem without importing the CLI layer.
 */
export const TOPUP_SLUG_STEM = "vulnerability-fix-topup";

/** Where one previous-batch member stands today. */
export interface TopupMemberReading extends TopupBatchMember {
  /** Dependabot's state for the member's alert, folded to the four the gate distinguishes. */
  readonly state: "open" | "fixed" | "dismissed" | "withdrawn";
  /** Whether an open roster pull request's title still names the package. */
  readonly hasOpenPr: boolean;
}

/** The gate's answer, carrying every count its one printed line needs. */
export type TopupGateVerdict =
  | { readonly kind: "disabled"; readonly releaseAfterMergedPercent: 0 }
  | { readonly kind: "first-batch" }
  | {
      readonly kind: "allow" | "idle";
      /** The row's threshold, so the printed line states the policy that decided rather than a fixed one. */
      readonly releaseAfterMergedPercent: number;
      readonly previousSlug: string;
      readonly raised: number;
      readonly merged: number;
      readonly dismissed: number;
      /** Members whose advisory GitHub withdrew — counted in neither `merged` nor `raised`. */
      readonly withdrawn: number;
      /** How many raised members have to merge before the next batch may go up. */
      readonly requiredMerged: number;
    };

/**
 * How many backfill slots a previous batch opened: one for each batch member the seat SKIPPED — ruled not a bump,
 * and neither fixed nor named by an open pull request.
 *
 * A seat raises a backfill line only in place of a member no bump fixes, and records that member with `vulnerability-fix
 * not-a-bump record`; the ruling is the only trace of which slots it filled. A ruled member the seat raised all the
 * same is no slot: one `@scope/*` ruling covers every batch member in the scope, and counting each would judge
 * backfill lines nobody reached. A skipped member already counts in neither `merged` nor
 * `raised`, so a slot only ever puts a line where the batch counted nothing.
 *
 * @param batch where each batch member stands today
 * @param repo `owner/name` the rulings must name
 * @param rulings every not-a-bump ruling the store holds now
 * @returns how many backfill lines the gate judges
 */
export function topupBackfillSlots({
  batch,
  repo,
  rulings,
}: {
  batch: readonly TopupMemberReading[];
  repo: string;
  rulings: readonly NotABumpRuling[];
}): number {
  return batch.filter(
    (reading) =>
      packageIsNotABump({ packageName: reading.packageName, repo, rulings }) &&
      reading.state !== "fixed" &&
      !reading.hasOpenPr,
  ).length;
}

/**
 * The backfill lines the gate judges in the slots {@link topupBackfillSlots} opened: the lines an open pull request
 * names first, then the rest in brief order, never one a ruling covers itself.
 *
 * Counting every backfill line would let one nobody raised, whose alert another change happened to fix, release the
 * gate; filling slots in brief order alone would judge an unraised line over one the seat
 * raised out of order. The residue: a raised line whose pull request already merged has no open one
 * to name it, so it is judged in brief order, and a line in a slot is judged as a batch member always is — `fixed`
 * counts as merged whoever fixed it.
 *
 * Pure over what the fleet read already shows, so only the lines it picks have their alerts read: a line the gate
 * does not judge never refuses it.
 *
 * @param backfill each backfill line and whether an open pull request names it, in brief order
 * @param slots how many lines to judge
 * @param repo `owner/name` the rulings must name
 * @param rulings every not-a-bump ruling the store holds now
 * @returns the lines to judge, at most `slots` of them
 */
export function topupJudgedBackfill<Line extends TopupBatchMember & { readonly hasOpenPr: boolean }>({
  backfill,
  repo,
  rulings,
  slots,
}: {
  backfill: readonly Line[];
  repo: string;
  rulings: readonly NotABumpRuling[];
  slots: number;
}): readonly Line[] {
  const eligible = backfill.filter(
    (reading) => !packageIsNotABump({ packageName: reading.packageName, repo, rulings }),
  );
  const named = eligible.filter((reading) => reading.hasOpenPr);
  const unnamed = eligible.filter((reading) => !reading.hasOpenPr);
  return [...named, ...unnamed].slice(0, slots);
}

/**
 * The newest top-up generation on the board, settled or not.
 *
 * Chosen by the epoch-millisecond suffix `runTopup` mints the slug with, never by the order the board was
 * read in — a directory listing's order is nobody's promise.
 *
 * A row whose brief names a DIFFERENT repository is skipped. The prefix joins owner and name with a hyphen,
 * so `acme-tools/api` and `acme/tools-api` share one, and judging the other repository's batch could
 * release this one's gate. A row whose brief names no repository is kept, so the
 * reader refuses it rather than this step hiding it.
 *
 * @param prefix the slug prefix every generation of one repository's top-up shares
 * @param repo `owner/name`, as the brief's opening sentence names it
 * @param rows every row on the board
 * @returns the newest generation, or `undefined` when this repository has never had one
 */
export function newestTopupRow({
  prefix,
  repo,
  rows,
}: {
  prefix: string;
  repo: string;
  rows: readonly TopupRowState[];
}): TopupRowState | undefined {
  const generation = new RegExp(`^${escapeRegExp({ text: prefix })}-(\\d+)$`);
  let newest: { row: TopupRowState; at: number } | undefined;
  for (const row of rows) {
    const match = generation.exec(row.slug);
    const named = row.summary === undefined ? undefined : topupAskRepo({ ask: row.summary });
    if (match === null || (named !== undefined && named !== repo)) {
      continue;
    }
    const at = Number(match[1]!);
    if (newest === undefined || at > newest.at) {
      newest = { at, row };
    }
  }
  return newest?.row;
}

/**
 * Every row carrying this repository's top-up prefix whose slug has no generation instant to order it by.
 *
 * `newestTopupRow` can only rank a slug ending `-<epoch>`, so it skips anything else — and a skipped row that
 * is really this repository's previous batch reads as no previous batch at all, which releases the gate. So such a row is named here to be refused, unless its brief names another
 * repository: `acme/tools-api` and `acme-tools/api` share a prefix, and the other one's rows are not ours.
 * A suffix past `Number.MAX_SAFE_INTEGER`, or not in the canonical form `String(Number(suffix))` gives back
 * (`-01` beside `-1`), counts too: two such instants read as one number, and scan order would then pick
 * which one ranks as the newest.
 *
 * @param prefix the slug prefix every generation of one repository's top-up shares
 * @param repo `owner/name`, as the brief's opening sentence names it
 * @param rows every row on the board
 * @returns the slug of every such row, empty when there is none
 */
export function malformedTopupRows({
  prefix,
  repo,
  rows,
}: {
  prefix: string;
  repo: string;
  rows: readonly TopupRowState[];
}): readonly string[] {
  const generation = new RegExp(`^${escapeRegExp({ text: prefix })}-(\\d+)$`);
  return rows
    .filter((row) => row.slug === prefix || row.slug.startsWith(`${prefix}-`))
    .filter((row) => {
      const suffix = generation.exec(row.slug)?.[1];
      return suffix === undefined || !Number.isSafeInteger(Number(suffix)) || String(Number(suffix)) !== suffix;
    })
    .filter((row) => {
      const named = row.summary === undefined ? undefined : topupAskRepo({ ask: row.summary });
      return named === undefined || named === repo;
    })
    .map((row) => row.slug);
}

/**
 * Judge the merge-release gate over the previous generation's members.
 *
 * @param previousSlug the generation the members came from, or `undefined` when there has never been one
 * @param readings where each of its members stands today
 * @param releaseAfterMergedPercent the row's threshold, 0 to 100; `0` is no merge hold, answered `disabled`
 * @returns `disabled`, `first-batch`, `allow` or `idle`, with the counts that decided it
 */
export function topupMergeGate({
  previousSlug,
  readings,
  releaseAfterMergedPercent,
}: {
  previousSlug: string | undefined;
  readings: readonly TopupMemberReading[];
  releaseAfterMergedPercent: number;
}): TopupGateVerdict {
  if (releaseAfterMergedPercent === 0) {
    return { kind: "disabled", releaseAfterMergedPercent: 0 };
  }
  if (previousSlug === undefined) {
    return { kind: "first-batch" };
  }
  const merged = readings.filter((reading) => reading.state === "fixed").length;
  const stillOpen = readings.filter((reading) => reading.state === "open" && reading.hasOpenPr).length;
  const dismissed = readings.filter((reading) => reading.state === "dismissed").length;
  const withdrawn = readings.filter((reading) => reading.state === "withdrawn").length;
  const raised = merged + stillOpen;
  const requiredMerged = Math.ceil((raised * releaseAfterMergedPercent) / 100);
  return {
    dismissed,
    kind: merged >= requiredMerged ? "allow" : "idle",
    merged,
    previousSlug,
    raised,
    releaseAfterMergedPercent,
    requiredMerged,
    withdrawn,
  };
}

/**
 * The one line the verb prints for a verdict — `idle — …` for a skip, so a reader of the scheduler's stdout
 * sees WHY a day raised nothing.
 *
 * @param verdict what {@link topupMergeGate} answered
 * @returns the line
 */
export function topupGateLine({ verdict }: { verdict: TopupGateVerdict }): string {
  if (verdict.kind === "disabled") {
    return "no merge hold configured — the merge-release gate reads no previous batch";
  }
  if (verdict.kind === "first-batch") {
    return "no previous top-up generation on the board — the merge-release gate has nothing to hold";
  }
  const policy = `${String(verdict.releaseAfterMergedPercent)}% must merge`;
  // Named only when there is one, so a day with no withdrawal prints exactly the line it always has.
  const withdrawn = verdict.withdrawn === 0 ? "" : `, ${String(verdict.withdrawn)} withdrawn`;
  const counts =
    `previous batch ${verdict.previousSlug}: ${String(verdict.merged)} of ${String(verdict.raised)} raised ` +
    `merged, ${String(verdict.dismissed)} dismissed${withdrawn}`;
  if (verdict.kind === "idle") {
    return `idle — ${counts}; ${policy}, so the next batch waits until ${String(verdict.requiredMerged)} have merged`;
  }
  if (verdict.raised === 0) {
    return `${counts} — it raised nothing, so it does not hold the next batch`;
  }
  return `${counts} — ${policy} (${String(verdict.requiredMerged)}), so the next batch goes up`;
}

/** A literal string as a regular-expression source. */
function escapeRegExp({ text }: { text: string }): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
