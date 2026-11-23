/**
 * The pure half of `claude pause` and `claude resume`: take the DECODED accounts file, one alias and the
 * pause to apply, and answer with the list to write back — or with the reason nothing may be written.
 *
 * ## It rewrites ROWS, never the parsed accounts
 *
 * `parseClaudeAccounts` narrows each entry to the four fields this repository reads, so rebuilding the file
 * from its output would silently drop anything else the operator keeps there — the `pinned: null` every row
 * on this install carries is the live example. So the rewrite happens on the decoded JSON rows: one key is
 * added or removed on one row, and every other byte of every row survives.
 *
 * ## The validity check is `parseClaudeAccounts` itself, and that is the design
 *
 * A pause can make a config unusable in ways that have nothing to do with pausing — it may take out the pinned
 * plan the pages surface boots against. That is already stated, once, in the ONE validating reader. Re-stating
 * it here would make this file a second copy of the rule that drifts the first time it moves, so the would-be
 * file is handed back to that reader and its own refusal is what a caller prints. A rejected config is
 * therefore never written. Pausing the last live plan is NOT one: it is a deliberate stop, never a broken file.
 */
import { err, ok, type Result } from "../lib/result.js";
import { parseClaudeAccounts } from "./config.js";
import type { ClaudeAccount, ClaudePausedPlan } from "./contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";

/** Whether the row's `paused` key is being written or removed. */
export type ClaudePauseChange =
  { readonly kind: "pause"; readonly paused: ClaudePausedPlan } | { readonly kind: "resume" };

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowFor({ alias, rows }: { alias: string; rows: readonly Record<string, unknown>[] }): number {
  return rows.findIndex((row) => row["alias"] === alias);
}

function applied({
  change,
  row,
}: {
  change: ClaudePauseChange;
  row: Record<string, unknown>;
}): Record<string, unknown> {
  if (change.kind === "resume") {
    const { paused: _removed, ...rest } = row;
    return rest;
  }
  return { ...row, paused: { reason: change.paused.reason, sinceIso: change.paused.sinceIso } };
}

/**
 * Apply one pause or resume to the decoded accounts file.
 *
 * @param alias the plan to take out of the fleet, or put back
 * @param change what to do to that plan's row
 * @param value the decoded accounts file, exactly as `readJsonFile` handed it over
 * @returns the rows to write and the accounts they parse to, or the reason to write nothing
 */
export function applyPlanPause({
  alias,
  change,
  value,
}: {
  alias: string;
  change: ClaudePauseChange;
  value: unknown;
}): Result<
  { readonly rows: readonly Record<string, unknown>[]; readonly accounts: readonly ClaudeAccount[] },
  ClaudeRotationError
> {
  if (!Array.isArray(value) || !value.every(isRow)) {
    return err(ClaudeRotationErrors.accountConfigInvalid({ problems: ["the account list is not an array of rows"] }));
  }
  const rows: readonly Record<string, unknown>[] = value;
  // Read the CURRENT state off the file rather than off a parse, so that "already paused" is answered even
  // for a config the validator would refuse for some unrelated reason — a caller told to fix an unrelated
  // problem first has a next step; one told only that the file is unusable does not know it already won.
  const index = rowFor({ alias, rows });
  if (index < 0) {
    return err(ClaudeRotationErrors.unknownAccount({ alias }));
  }
  const row = rows[index]!;
  const standing = row["paused"];
  if (change.kind === "pause" && isRow(standing)) {
    const since = standing["sinceIso"];
    return err(
      ClaudeRotationErrors.planAlreadyPaused({
        alias,
        sinceIso: typeof since === "string" ? since : "an unrecorded date",
      }),
    );
  }
  if (change.kind === "resume" && !isRow(standing)) {
    return err(ClaudeRotationErrors.planNotPaused({ alias }));
  }
  const next = rows.map((each, at) => (at === index ? applied({ change, row: each }) : each));
  const parsed = parseClaudeAccounts({ value: next });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ accounts: parsed.value, rows: next });
}
