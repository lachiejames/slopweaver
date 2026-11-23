/**
 * Every row `github bump-drive` writes to the AUTONOMY ledger, and the id one of them is keyed by.
 *
 * Split out of `./bumpDriveCore.ts` to keep that file under the 300-code-line cap, along the
 * seam the module already has: the core parses flags, applies the caps and builds each child verb's argv,
 * while every row this verb records for the owner lives here. `AGENTS.md` rule 10's other half is what they are all
 * for — an act the fleet takes unasked is recorded where the owner sees it, not only in a transcript.
 *
 * Pure. No clock, no filesystem: each builder takes the instant and the session reference it stamps.
 */

import type { AutonomyActionRow } from "../../../autonomy/types.js";
import type { BumpPlan } from "../../../review/bumpSelection.js";
import type { LandingRow } from "../../../review/landing.js";
import type { SupersedeClose } from "./bumpDriveClose.js";
import { type PressLedgerRow, pressActionId } from "./landingPressRow.js";

/** How much of a head commit a ledger row's witness quotes — enough to identify it, short enough to read. */
const LEDGER_HEAD_CHARS = 7;

/** The ledger kind a description rewrite is recorded under, which the rewrite guard also matches on. */
const REWRITE_KIND = "rewrite-pull-request-body";

/**
 * The autonomy-ledger id ONE head's body rewrite is filed under — and this repository's whole idempotence
 * guard for the act.
 *
 * A rewrite is the only act here that can be correct and still leave its own precondition standing: if
 * `dev-gate` is red for a reason the description cannot fix, the plan reads `rewrite-body` again on the next
 * firing, and a four-hourly verb would rewrite the same body forever. The bound that stops it has to be a
 * FACT this machine wrote down, so it is the ledger row the act already owes the owner (rule 10) rather than a
 * second register invented for the purpose.
 *
 * Keyed by repository, number and the WHOLE head (`./landingPressRow.ts`'s `pressActionId`, word `rewrite`),
 * because renovate force-pushes its own rebases: a new head is a genuinely new body — {@link prFormOfBump}'s
 * evidence link quotes the head — and must be composable again, while the head that has already been
 * rewritten is finished with this verb and wants a session. A number alone, or a seven-character head, would
 * read the same-numbered bump in the other repository as already rewritten and seat it unrewritten.
 *
 * @param row the bump whose description is being rewritten
 * @returns the id, matching `../../../autonomy/types.ts`'s slug pattern
 */
export function bumpBodyActionId({ row }: { row: LandingRow }): string {
  return pressActionId({ row, word: "rewrite" });
}

/**
 * Whether the ledger already holds this head's description rewrite — the guard {@link bumpBodyActionId}
 * names.
 *
 * Kind and subject are matched as well as the id. Rows written before the id carried the repository spell
 * `<number>-bump-body-<seven hex>`, and six of them were on the ledger when the id changed; matching that
 * spelling ALONE would keep the cross-repository collision the full id removes, so it counts only on the
 * same pull request's URL.
 *
 * @param acts every act the ledger holds, steers excluded
 * @param row the bump about to be rewritten
 * @returns true when this head's description has already been rewritten
 */
export function bumpBodyWasRecorded({ acts, row }: { acts: readonly AutonomyActionRow[]; row: LandingRow }): boolean {
  const ids = new Set([
    bumpBodyActionId({ row }),
    `${String(row.number)}-bump-body-${row.headOid.toLowerCase().slice(0, LEDGER_HEAD_CHARS)}`,
  ]);
  const subject = row.url.toLowerCase();
  return acts.some(
    (act) => ids.has(act.actionId) && act.kind === REWRITE_KIND && act.subject.toLowerCase() === subject,
  );
}

/**
 * The autonomy-ledger row one description rewrite leaves behind.
 *
 * It is written for two reasons at once, and both are load-bearing. Rule 10 owes the owner a record of an act the
 * fleet took unasked — this one edits a pull request the organisation can see, so the row is the only place
 * outside a transcript where it appears. And {@link bumpBodyActionId} makes the row the guard: the id is what
 * the next firing reads to know this head is done.
 *
 * @param plan the performed rewrite
 * @param bySession what identifies this session
 * @param atIso when the description was replaced
 * @returns the ledger row `autonomy record` takes
 */
export function bumpRewriteLedgerRow({
  plan,
  bySession,
  atIso,
}: {
  plan: BumpPlan;
  bySession: string;
  atIso: string;
}): PressLedgerRow {
  const { row } = plan;
  return {
    actionId: bumpBodyActionId({ row }),
    bySession,
    doneIso: atIso,
    kind: REWRITE_KIND,
    subject: row.url,
    why:
      `it is a dependency bump selected by ${plan.signal}, and ${plan.why} — the origin rule requires the Problem cell ` +
      "to name an origin and renovate's template names none, so the description it opened with can never pass " +
      "this repository's own gate",
    witness: `slopweaver github bump-drive -> sent the typed bump form as ${row.repoSlug}#${String(row.number)}'s whole description at head ${row.headOid.slice(0, LEDGER_HEAD_CHARS)}, through github pr update --form`,
  };
}

/**
 * The autonomy-ledger row one bump's press leaves behind.
 *
 * `AGENTS.md` rule 10's other half: an act the fleet takes unasked is RECORDED where the owner sees it, not only in a
 * transcript. The row is written on the ENQUEUE rather than on the merge, because the enqueue is the act this
 * machine took — GitHub owns what happens after, and a row waiting for a merge a later push evicts would never
 * be written at all.
 *
 * Its id is the one `github landing --press` writes for the same act (`./landingPressRow.ts`'s
 * `pressActionId`): repository, number and the whole head. A bump is pressed again whenever renovate rebases
 * it or the queue lets it go, and a `<number>`-only id had the ledger refuse every press after the first.
 * The writer resolves a repeat at a held head to its occurrence ordinal.
 *
 * @param plan the performed act, whose `why` becomes the row's reason
 * @param bySession what identifies this session
 * @param atIso when the enqueue was made
 * @returns the ledger row `autonomy record` takes, under the first press's id at its head
 */
export function bumpLedgerRow({
  plan,
  bySession,
  atIso,
}: {
  plan: BumpPlan;
  bySession: string;
  atIso: string;
}): PressLedgerRow {
  const { row } = plan;
  const undrafted = plan.act === "undraft-and-enqueue" ? "undrafted it and " : "";
  return {
    actionId: pressActionId({ row }),
    bySession,
    doneIso: atIso,
    kind: "press-merge-when-ready",
    subject: row.url,
    why: `it is a dependency bump selected by ${plan.signal}, and ${plan.why}`,
    witness: `slopweaver github bump-drive -> ${undrafted}enqueued ${row.repoSlug}#${String(row.number)} at head ${row.headOid.slice(0, LEDGER_HEAD_CHARS)}`,
  };
}

/**
 * A repository's name as an action-id segment: lower-cased, every run of anything but a letter, digit or dot one
 * hyphen, because the ledger's id is a slug.
 *
 * @param repoSlug `owner/name`
 * @returns the name half, slugged
 */
export function repoActionSlug({ repoSlug }: { repoSlug: string }): string {
  const name = repoSlug.slice(repoSlug.indexOf("/") + 1);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * The autonomy-ledger row one superseded close leaves behind.
 *
 * Keyed by repository AND number, because the drive runs over two repositories whose numbers overlap; a closed
 * pull request is not closed twice, and `github close` refuses one already shut.
 *
 * @param close the pull request that was closed, and its evidence
 * @param why the one-line reason the report printed
 * @param bySession what identifies this session
 * @param atIso when it was closed
 * @returns the ledger row `autonomy record` takes
 */
export function bumpCloseLedgerRow({
  close,
  why,
  bySession,
  atIso,
}: {
  close: SupersedeClose;
  why: string;
  bySession: string;
  atIso: string;
}): PressLedgerRow {
  const { own } = close;
  return {
    actionId: `${repoActionSlug({ repoSlug: own.repoSlug })}-${String(own.number)}-bump-close`,
    bySession,
    doneIso: atIso,
    kind: "close-superseded-pull-request",
    subject: own.url,
    why: `it is the owner's dependency bump and ${why} — a superseded bump is closed within hours`,
    witness: `slopweaver github bump-drive -> closed ${own.repoSlug}#${String(own.number)} at head ${own.headOid.slice(0, LEDGER_HEAD_CHARS)} with a comment naming the evidence, through github close`,
  };
}

/**
 * The autonomy-ledger row an UNDRAFT leaves behind when the enqueue after it was refused.
 *
 * `undraft-and-enqueue` is two writes, and only the second one reaches the ledger without this row. A pass that marked a renovate bump ready and then had its press refused — a moved
 * head, a queue momentarily absent — had CHANGED what the repository shows, put the bump in front of the
 * codeowners check, and written nothing anywhere the owner looks. The verb runs unattended off a recipe row, so its
 * stdout is exactly the surface nobody reads.
 *
 * Not written on the happy path: {@link bumpLedgerRow}'s witness already says "undrafted it and enqueued it",
 * and two rows for one bump would report one act twice. Keyed like the press, under the word `undraft`, so a
 * second undraft at a new head is a row of its own rather than a refused one.
 *
 * @param plan the undraft that happened
 * @param bySession what identifies this session
 * @param atIso when the undraft was made
 * @param why what the enqueue refused with, carried so the row says what state the bump was left in
 * @returns the ledger row `autonomy record` takes
 */
export function bumpUndraftLedgerRow({
  plan,
  bySession,
  atIso,
  why,
}: {
  plan: BumpPlan;
  bySession: string;
  atIso: string;
  why: string;
}): PressLedgerRow {
  const { row } = plan;
  return {
    actionId: pressActionId({ row, word: "undraft" }),
    bySession,
    doneIso: atIso,
    kind: "undraft-pull-request",
    subject: row.url,
    why: `it is a dependency bump selected by ${plan.signal}, and ${plan.why} — then ${why}`,
    witness: `slopweaver github bump-drive -> marked ${row.repoSlug}#${String(row.number)} ready at head ${row.headOid.slice(0, LEDGER_HEAD_CHARS)}, and it did NOT queue`,
  };
}
