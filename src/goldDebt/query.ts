/**
 * Folding and filtering the gold-debt ledger. Pure — records in, records out, no I/O and no clock.
 *
 * The one operation that matters is {@link foldGoldDebts}: the file is a flat, time-ordered mix of debts and
 * the settlements that pay them, and every reader wants the same thing — each debt, oldest first, with its
 * settlement attached when it has one.
 *
 * ## OLDEST first, which is the opposite of the autonomy ledger
 *
 * `../autonomy/query.ts` folds newest-first because the owner steers what just happened. This register is
 * read to decide what to go and DO, and the debt that has been owed longest is the one most likely to have
 * had its blocking condition pass. A list that buried the oldest debt under every fresh one would hide
 * exactly the row the supervisor's sweep is looking for. The order lives here rather than in a renderer so
 * `slopweaver gold debts` and any later surface agree about which row is at the top.
 *
 * The sort is by `mergedIso` ascending, and a tie breaks on the derived debt id. A tie is real — two pull
 * requests merged in one second by the merge queue — and the id is the only other fact stable across two
 * reads of the same file.
 *
 * ## One pull request is one debt, and a repeat is not a defect
 *
 * A session that crashes between landing and recording retries its append with the same fields, so the
 * register can legitimately hold two identical lines for one debt. Those fold to one. Two rows for one pull
 * request that DISAGREE are a different thing — the register carrying two accounts of one merge, leaving a
 * settlement unable to say which it pays — and that is {@link ../errors.js GoldDebtErrors.debtConflict},
 * refused rather than silently resolved.
 */
import { err, ok, type Result } from "../lib/result.js";

import { isSettlementRecord } from "./decode.js";
import { type GoldDebtError, GoldDebtErrors } from "./errors.js";
import { goldDebtId, matchesPullRequest } from "./pull.js";
import type { GoldDebt, GoldDebtRecord, GoldDebtRow, GoldDebtSettlementRow } from "./types.js";

/** Every field two rows for one pull request must agree about, in the order a conflict names them. */
const IDENTITY_FIELDS: readonly (keyof GoldDebtRow)[] = [
  "grade",
  "mergedIso",
  "wouldBe",
  "blockedOn",
  "bySession",
  "title",
  "run",
];

/**
 * Whether two debts disagree about one identity field. `mergedIso` is compared by the INSTANT it denotes.
 *
 * Every other field is a string a caller chose, so its spelling IS its value. An instant is not:
 * a `Z` instant and the same instant written with a `+10:00` offset are the same moment, and comparing their text
 * would make an idempotent retry from a session in another zone read as the register contradicting itself.
 *
 * PRESENCE is compared before value, and under `exactOptionalPropertyTypes` that is the difference between
 * two real states: `title` and `run` are attached only when they carry something, so a debt with no title
 * and a debt whose title is `undefined` are different recordings. Asking `Object.hasOwn` rather than reading
 * the value also stops an inherited property standing in for an absent one.
 *
 * `recordedIso` is deliberately absent from {@link IDENTITY_FIELDS}: a retry happens at a later instant than
 * the append it repeats, so comparing it would call every legitimate retry a conflict.
 */
function fieldsDisagree({
  field,
  first,
  second,
}: {
  field: keyof GoldDebtRow;
  first: GoldDebtRow;
  second: GoldDebtRow;
}): boolean {
  if (Object.hasOwn(first, field) !== Object.hasOwn(second, field)) {
    return true;
  }
  if (field !== "mergedIso") {
    return first[field] !== second[field];
  }
  return Date.parse(first.mergedIso) !== Date.parse(second.mergedIso);
}

/**
 * The first field two debts for one pull request disagree about, or undefined when they are one recording.
 *
 * @param first the debt already in the register
 * @param second the debt claiming the same pull request
 * @returns the disagreeing field's name, or undefined when every field matches
 */
export function conflictingDebtField({
  first,
  second,
}: {
  first: GoldDebtRow;
  second: GoldDebtRow;
}): string | undefined {
  return IDENTITY_FIELDS.find((field) => fieldsDisagree({ field, first, second }));
}

/**
 * Every debt the register holds, oldest first, each carrying its settlement when it has one.
 *
 * A settlement naming a pull request the register holds no debt for is DROPPED rather than surfaced as a
 * defect: `slopweaver gold settle` already refuses an unknown debt before appending, so an orphan here means
 * a hand-edited file, and failing the whole read over one line nobody can see would cost more than it
 * protects. A CONFLICT is the opposite call — it means the register is lying about a merge — so the read
 * fails and says which debt and which field.
 *
 * A second settlement of one debt is folded to the LAST one in append order. The verb refuses one, so this
 * only ever arises from a hand-edited file, and the later line is the one a reader of the file would expect
 * to govern.
 *
 * @param records every record the register holds, in the order they were written
 * @returns one entry per debt, oldest first — or the first conflict
 */
export function foldGoldDebts({
  records,
}: {
  records: readonly GoldDebtRecord[];
}): Result<readonly GoldDebt[], GoldDebtError> {
  const debts = new Map<string, GoldDebtRow>();
  const settlements = new Map<string, GoldDebtSettlementRow>();
  for (const record of records) {
    const key = goldDebtId({ pullRequest: record.pullRequest });
    if (isSettlementRecord(record)) {
      settlements.set(key, record);
      continue;
    }
    const held = debts.get(key);
    if (held === undefined) {
      debts.set(key, record);
      continue;
    }
    const field = conflictingDebtField({ first: held, second: record });
    if (field !== undefined) {
      return err(GoldDebtErrors.debtConflict({ debtId: key, field }));
    }
  }
  const folded = [...debts.entries()].map(([key, debt]) => ({ debt, settlement: settlements.get(key) }));
  return ok(folded.toSorted((left, right) => compareDebts({ left, right })));
}

/** Oldest merge first; a tie inside one second breaks on the derived debt id, so the order is total. */
function compareDebts({ left, right }: { left: GoldDebt; right: GoldDebt }): number {
  const byInstant = Date.parse(left.debt.mergedIso) - Date.parse(right.debt.mergedIso);
  if (byInstant !== 0) {
    return byInstant;
  }
  const leftId = goldDebtId({ pullRequest: left.debt.pullRequest });
  const rightId = goldDebtId({ pullRequest: right.debt.pullRequest });
  return leftId.localeCompare(rightId);
}

/**
 * Whether a debt is still open — nothing has settled it either way.
 *
 * @param entry one folded debt
 * @returns true while no settlement names it
 */
export function isOpenDebt({ entry }: { entry: GoldDebt }): boolean {
  return entry.settlement === undefined;
}

/**
 * Narrow a folded list to what a caller asked for.
 *
 * `state` is the only filter that changes the DEFAULT view, and the default is `open`: this register is read
 * to decide what to go and do, so a caller that names nothing gets the work rather than the history.
 *
 * @param debts every folded debt, in the fold's order
 * @param state which debts to keep
 * @param repo keep only debts on this `<owner>/<repo>`
 * @returns the matching debts, in the order they were given
 */
export function filterGoldDebts({
  debts,
  state,
  repo,
}: {
  debts: readonly GoldDebt[];
  state: "open" | "settled" | "all";
  repo: string | undefined;
}): readonly GoldDebt[] {
  return debts.filter((entry) => {
    if (state === "open" && !isOpenDebt({ entry })) {
      return false;
    }
    if (state === "settled" && isOpenDebt({ entry })) {
      return false;
    }
    if (repo === undefined) {
      return true;
    }
    // Lowercased on both sides for the reason `./pull.ts` gives: GitHub resolves an owner and a
    // repository case-insensitively, so `--repo LachieJames/slopweaver` must not answer an empty list.
    return goldDebtId({ pullRequest: entry.debt.pullRequest }).startsWith(`${repo.toLowerCase()}#`);
  });
}

/**
 * The folded debt a caller named, by either its full URL or its `<owner>/<repo>#<number>` key.
 *
 * @param debts every folded debt
 * @param reference the URL or key the caller used
 * @returns the matching debt, or undefined when none does
 */
export function findGoldDebt({
  debts,
  reference,
}: {
  debts: readonly GoldDebt[];
  reference: string;
}): GoldDebt | undefined {
  return debts.find((entry) => matchesPullRequest({ pullRequest: entry.debt.pullRequest, reference }));
}
