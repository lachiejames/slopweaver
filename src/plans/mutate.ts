/**
 * Apply ONE change to the plan register. Pure — the caller reads the store row and compare-and-sets it, this
 * decides what the register becomes.
 *
 * ## One row is one change
 *
 * Every mutation here is a single, exact edit to a single row — or, for `set-thresholds`, to the install's own
 * threshold object (`./thresholdMutation.ts`) — and the only standing thing the register carries is the state a
 * row or that object already declares. There is deliberately no shape for "pause everything" or
 * "let this session change the fleet for the next hour": a change that cannot be named exactly cannot be
 * checked afterwards, and the whole value of writing the register down is that a wrong change is visible.
 *
 * ## It edits the RAW row, and re-validates the whole register
 *
 * A change copies the stored row and touches one key, so a field this version does not read — a newer
 * writer's, or the `pinned: null` the legacy Claude file already carries — survives it. Then
 * {@link republishRows} re-parses the result, which is what makes it impossible to publish a register that
 * a read of the same file would refuse.
 */
import { err, ok, type Result } from "#lib/result.js";

import { parseClaudeAccounts } from "../claude/config.js";

import { type PlanRegisterError, PlanRegisterErrors } from "./errors.js";
import { projectClaudeRows } from "./projection.js";
import { findRegisteredPlan, republishRows } from "./register.js";
import { applyRowEdit, documentForAdd, isRowEdit, rowMatches, withoutKey } from "./rowEdits.js";
import { applyThresholdMutation } from "./thresholdMutation.js";
import type { PlanMutation, PlanRegisterSnapshot, RegisteredPlan } from "./types.js";

/**
 * Why a Codex row is never pinned: Codex has no pinned seat, and every Codex destination is drawn down in one
 * pool (all plans at an equal rate).
 */
const CODEX_PIN_CONFLICT =
  "Codex has no pinned seat: every Codex destination is ranked in one pool and drawn down alike, so a Codex row is never pinned";

/** One stored row, before this version has narrowed anything out of it. */
type RawRow = Readonly<Record<string, unknown>>;

/**
 * The raw row a `plans add` publishes, carrying only the fields the caller actually set.
 *
 * @param row the typed plan being registered
 * @returns the raw row to append
 */
function rawRowFor({ row }: { row: RegisteredPlan }): RawRow {
  return {
    alias: row.alias,
    allowance: { kind: row.allowance.kind },
    provider: row.provider,
    storeDir: row.storeDir,
    usageLimitPercent: row.usageLimitPercent,
    ...(row.email === undefined ? {} : { email: row.email }),
    ...(row.paused === undefined ? {} : { paused: row.paused }),
    ...(row.pinned === true ? { pinned: true } : {}),
    ...(row.lapsesAtIso === undefined ? {} : { lapsesAtIso: row.lapsesAtIso }),
  };
}

/**
 * Write the derived picture down as it stands, refusing to overwrite a register that already exists.
 *
 * @param snapshot the register as it currently stands
 * @returns the adopted snapshot, or why there was nothing to adopt
 */
function applyAdopt({ snapshot }: { snapshot: PlanRegisterSnapshot }): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (snapshot.source === "registered") {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict:
          "a plan register is already adopted, and adopting again would overwrite it; to refresh a cached Codex address, run slopweaver plans sync-accounts",
      }),
    );
  }
  return republishRows({ document: snapshot.document, rows: snapshot.document.rows });
}

/**
 * Append one destination, refusing an alias that provider already uses.
 *
 * A duplicate STORE PATH is refused too, by {@link republishRows}: two rows naming one directory are two
 * names for one credential, and routing between them would report capacity that does not exist.
 *
 * @param row the destination being registered
 * @param snapshot the register as it currently stands
 * @returns the register with the row appended, or the clash that stopped it
 */
function applyAdd({
  row,
  snapshot,
}: {
  row: RegisteredPlan;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (row.provider === "codex" && row.pinned === true) {
    return err(PlanRegisterErrors.mutationConflict({ conflict: CODEX_PIN_CONFLICT }));
  }
  const clash = findRegisteredPlan({ alias: row.alias, plans: snapshot.plans, provider: row.provider });
  if (clash !== undefined) {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict: `a ${row.provider} plan called \`${row.alias}\` is already registered`,
      }),
    );
  }
  const document = documentForAdd({ row, snapshot });
  if (document.isErr()) {
    return err(document.error);
  }
  return republishRows({ document: document.value, rows: [...document.value.rows, rawRowFor({ row })] });
}

/**
 * Take one destination out of the fleet, or put it back.
 *
 * A second pause names the date the standing one was recorded rather than the word "already": a pause
 * nobody can date is the forgotten-pause failure the row exists to make visible.
 *
 * @param mutation the pause or resume being applied
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names, already resolved
 * @returns the changed register, or why the change does not apply
 */
function applyPauseOrResume({
  mutation,
  snapshot,
  target,
}: {
  mutation: Extract<PlanMutation, { kind: "pause" } | { kind: "resume" }>;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (mutation.kind === "pause" && target.paused !== undefined) {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict: `\`${target.alias}\` has been paused since ${target.paused.sinceIso}`,
      }),
    );
  }
  if (mutation.kind === "resume" && target.paused === undefined) {
    return err(
      PlanRegisterErrors.mutationConflict({ conflict: `\`${target.alias}\` is not paused, so nothing resumes` }),
    );
  }
  return republishRows({
    document: snapshot.document,
    rows: snapshot.document.rows.map((row) => {
      if (!rowMatches({ alias: mutation.alias, provider: mutation.provider, row })) {
        return row;
      }
      if (mutation.kind === "resume") {
        return withoutKey({ key: "paused", row });
      }
      return { ...row, paused: mutation.paused };
    }),
  });
}

/**
 * Move one provider's pin, leaving every other provider's untouched.
 *
 * @param mutation the pin being applied
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names, already resolved
 * @returns the changed register, or why the pin does not apply
 */
function applyPin({
  mutation,
  snapshot,
  target,
}: {
  mutation: Extract<PlanMutation, { kind: "pin" }>;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (mutation.provider === "codex") {
    return err(PlanRegisterErrors.mutationConflict({ conflict: CODEX_PIN_CONFLICT }));
  }
  if (target.paused !== undefined) {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict: `\`${target.alias}\` is paused, and a pinned seat has nowhere to boot; resume it first`,
      }),
    );
  }
  return republishRows({
    document: snapshot.document,
    rows: snapshot.document.rows.map((row) => {
      if (row["provider"] !== mutation.provider) {
        return row;
      }
      if (rowMatches({ alias: mutation.alias, provider: mutation.provider, row })) {
        return { ...row, pinned: true };
      }
      return withoutKey({ key: "pinned", row });
    }),
  });
}

/**
 * Record the address a row's store reported live, refusing a row whose store moved since that read.
 *
 * @param mutation the address being recorded, with the store it was read from
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names, already resolved
 * @returns the changed register, or why the address no longer describes that row
 */
function applyRecordEmail({
  mutation,
  snapshot,
  target,
}: {
  mutation: Extract<PlanMutation, { kind: "record-email" }>;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (target.storeDir !== mutation.storeDir) {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict: `\`${target.alias}\` now names ${target.storeDir}, not the ${mutation.storeDir} that was read`,
      }),
    );
  }
  return republishRows({
    document: snapshot.document,
    rows: snapshot.document.rows.map((row) =>
      rowMatches({ alias: mutation.alias, provider: mutation.provider, row }) ? { ...row, email: mutation.email } : row,
    ),
  });
}

/**
 * Record the usage limit the owner chose for one row, and the allowance it is a share of — touching those two
 * keys of that one raw row and nothing else.
 *
 * Setting the value a row already holds is refused rather than written: a change that changes nothing would
 * still bump the revision, and a journal of usage-limit changes should only ever show real ones. A change naming the
 * limit it moves FROM is refused when the row no longer carries that limit, before anything else is judged.
 *
 * @param mutation the limit being recorded
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names, already resolved
 * @returns the changed register, or why the change does not apply
 */
function applySetUsageLimit({
  mutation,
  snapshot,
  target,
}: {
  mutation: Extract<PlanMutation, { kind: "set-usage-limit" }>;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const from = mutation.fromUsageLimitPercent;
  if (from !== undefined && target.usageLimitPercent !== from) {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict:
          `\`${target.alias}\`'s usage limit is now ${String(target.usageLimitPercent)}%, not the ` +
          `${String(from)}% this change was read as moving from — read the plan again before changing it`,
      }),
    );
  }
  // A raise read off a weekly row must not turn a row someone has since moved to another allowance back into a
  // weekly one: `--from` reads the whole row, so the allowance it was read on has to still be the row's.
  if (from !== undefined && target.allowance.kind !== mutation.allowance.kind) {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict:
          `\`${target.alias}\`'s usage limit is now of its ${target.allowance.kind} allowance, not the ` +
          `${mutation.allowance.kind} one this change was read from — read the plan again before changing it`,
      }),
    );
  }
  if (target.usageLimitPercent === mutation.usageLimitPercent && target.allowance.kind === mutation.allowance.kind) {
    return err(
      PlanRegisterErrors.mutationConflict({
        conflict: `\`${target.alias}\` already has a usage limit of ${String(target.usageLimitPercent)}% of its ${target.allowance.kind} allowance`,
      }),
    );
  }
  return republishRows({
    document: snapshot.document,
    rows: snapshot.document.rows.map((row) =>
      rowMatches({ alias: mutation.alias, provider: mutation.provider, row })
        ? { ...row, allowance: { kind: mutation.allowance.kind }, usageLimitPercent: mutation.usageLimitPercent }
        : row,
    ),
  });
}

/**
 * Record when one row's paid subscription ends, on that row alone, every other key it carries kept.
 *
 * A REPLACEMENT rather than a conflict when a date is already there: a renewal moves the date, and a verb that
 * refused the second recording would leave the stale one standing. A paused row takes it too — a lapse is
 * exactly what a pause is usually recorded for.
 *
 * @param mutation the lapse being recorded
 * @param snapshot the register as it currently stands
 * @returns the changed register
 */
function applySetLapse({
  mutation,
  snapshot,
}: {
  mutation: Extract<PlanMutation, { kind: "set-lapse" }>;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  return republishRows({
    document: snapshot.document,
    rows: snapshot.document.rows.map((row) =>
      rowMatches({ alias: mutation.alias, provider: mutation.provider, row })
        ? { ...row, lapsesAtIso: mutation.lapsesAtIso }
        : row,
    ),
  });
}

/**
 * Apply one change to a snapshot, re-validating the whole register afterwards.
 *
 * @param mutation the single change to apply
 * @param snapshot the register as it currently stands
 * @returns the changed snapshot, or why the change does not apply
 */
export function applyPlanMutation({
  mutation,
  snapshot,
}: {
  mutation: PlanMutation;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (mutation.kind === "repair-projection") {
    return ok(snapshot);
  }
  if (mutation.kind === "adopt") {
    return applyAdopt({ snapshot });
  }
  if (mutation.kind === "add") {
    return applyAdd({ row: mutation.row, snapshot });
  }
  if (mutation.kind === "set-thresholds") {
    return applyThresholdMutation({ change: mutation.change, snapshot });
  }
  const target = findRegisteredPlan({ alias: mutation.alias, plans: snapshot.plans, provider: mutation.provider });
  if (target === undefined) {
    return err(PlanRegisterErrors.unknownDestination({ alias: mutation.alias, provider: mutation.provider }));
  }
  if (mutation.kind === "pin") {
    return applyPin({ mutation, snapshot, target });
  }
  if (mutation.kind === "record-email") {
    return applyRecordEmail({ mutation, snapshot, target });
  }
  if (mutation.kind === "set-usage-limit") {
    return applySetUsageLimit({ mutation, snapshot, target });
  }
  if (mutation.kind === "set-lapse") {
    return applySetLapse({ mutation, snapshot });
  }
  if (isRowEdit(mutation)) {
    return applyRowEdit({ mutation, snapshot, target });
  }
  return applyPauseOrResume({ mutation, snapshot, target });
}

/**
 * Whether this change needs an adoption first, so nothing adopts the register as a side effect.
 *
 * Loading new code must never adopt state: a mutation other than `adopt` on an install that has adopted
 * nothing is REFUSED rather than quietly writing the register.
 *
 * @param mutation the change being applied
 * @param snapshot the register as it was just read
 * @returns the refusal, or undefined when the change may proceed
 */
function adoptionRequired({
  mutation,
  snapshot,
}: {
  mutation: PlanMutation;
  snapshot: PlanRegisterSnapshot;
}): PlanRegisterError | undefined {
  if (snapshot.source === "registered" || mutation.kind === "adopt") {
    return undefined;
  }
  return PlanRegisterErrors.mutationConflict({
    conflict:
      "this install has adopted no plan register, so there is nothing to change — write the derived picture " +
      "down first with `slopweaver plans adopt`",
  });
}

/**
 * Check the Claude half of a register against the rules `parseClaudeAccounts` already owns.
 *
 * No count rule: a Codex-only register is valid, one Claude row is a whole fleet, and pausing every Claude
 * plan is a deliberate stop the spawn gate names rather than a broken register.
 *
 * @param rows the Claude rows this change would publish
 * @returns nothing, or the Claude rules the change would break
 */
function claudeProjectionUsable({
  rows,
}: {
  rows: readonly Readonly<Record<string, unknown>>[];
}): Result<undefined, PlanRegisterError> {
  const parsed = parseClaudeAccounts({ value: rows });
  if (parsed.isErr()) {
    return err(PlanRegisterErrors.registerInvalid({ problems: [parsed.error.message] }));
  }
  return ok(undefined);
}

/**
 * Everything a writer decides before it touches storage: the adoption rule, the change itself, and the Claude
 * rules the generated projection must still satisfy.
 *
 * Pure, so the store writer's compare-and-set wraps exactly one judgement and a unit test can drive every
 * refusal without a database.
 *
 * @param mutation the single change to apply
 * @param snapshot the register as the writer just read it
 * @returns the register the change produces, or why it may not be published
 */
export function prepareRegisterChange({
  mutation,
  snapshot,
}: {
  mutation: PlanMutation;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const unadopted = adoptionRequired({ mutation, snapshot });
  if (unadopted !== undefined) {
    return err(unadopted);
  }
  const changed = applyPlanMutation({ mutation, snapshot });
  if (changed.isErr()) {
    return err(changed.error);
  }
  const usable = claudeProjectionUsable({ rows: projectClaudeRows({ document: changed.value.document }) });
  if (usable.isErr()) {
    return err(usable.error);
  }
  return ok(changed.value);
}
