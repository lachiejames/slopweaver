/**
 * The pure half of the lifecycle verbs: what each accepts, and how each reports.
 *
 * Kept apart from the shell so a unit test can hold the parsers and the renderers to exact strings with
 * no database anywhere near them.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { BaselineReport, PushReport, ResetReport } from "../../../store/lifecycle.js";
import { verifyLines } from "../../../store/lifecycleVerify.js";
import { parseFlags } from "../../parseFlags.js";
import { type StoreCommandError, StoreCommandErrors } from "./errors.js";

/** What `store push` was asked for. */
export interface PushArgs {
  readonly generate: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** What `store reset` was asked for. */
export interface ResetArgs {
  readonly acknowledge: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** What `store baseline` was asked for. */
export interface BaselineArgs {
  readonly through: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** What `store verify` was asked for. */
export interface VerifyArgs {
  readonly json: boolean;
  readonly home: string | undefined;
  /** A checkout whose `supabase/config.toml` names the stack the lock is measured on — this one when absent. */
  readonly workdir: string | undefined;
}

/**
 * The optional `--home`, as the shells thread it.
 *
 * @param values the parsed flag values
 * @returns the directory, or undefined
 */
function homeOf({ values }: { values: Readonly<Record<string, string | boolean>> }): string | undefined {
  return typeof values["home"] === "string" ? values["home"] : undefined;
}

/**
 * Parse `store push`.
 *
 * @param rest the verb's own argv tail
 * @returns the args, or every reason the invocation was refused
 */
export function parsePushArgs({ rest }: { rest: readonly string[] }): Result<PushArgs> {
  const flags = parseFlags({ args: rest, spec: { boolean: ["json", "no-generate"], string: ["home"] } });
  if (flags.isErr()) {
    return err(flags.error);
  }
  const { values } = flags.value;
  return ok({ generate: values["no-generate"] !== true, home: homeOf({ values }), json: values["json"] === true });
}

/**
 * Parse `store reset`. The acknowledgement is checked against the URL later, by the store itself.
 *
 * @param rest the verb's own argv tail
 * @returns the args, or every reason the invocation was refused
 */
export function parseResetArgs({ rest }: { rest: readonly string[] }): Result<ResetArgs> {
  const flags = parseFlags({ args: rest, spec: { boolean: ["json"], string: ["acknowledge", "home"] } });
  if (flags.isErr()) {
    return err(flags.error);
  }
  const { values } = flags.value;
  const acknowledge = typeof values["acknowledge"] === "string" ? values["acknowledge"] : undefined;
  return ok({ acknowledge, home: homeOf({ values }), json: values["json"] === true });
}

/**
 * Parse `store baseline`.
 *
 * @param rest the verb's own argv tail
 * @returns the args, or every reason the invocation was refused
 */
export function parseBaselineArgs({ rest }: { rest: readonly string[] }): Result<BaselineArgs, StoreCommandError> {
  const flags = parseFlags({ args: rest, spec: { boolean: ["json"], string: ["home", "through"] } });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const through = values["through"];
  if (typeof through !== "string" || through.length === 0) {
    return err(StoreCommandErrors.throughMissing());
  }
  return ok({ home: homeOf({ values }), json: values["json"] === true, through });
}

/**
 * Parse `store verify`.
 *
 * @param rest the verb's own argv tail
 * @returns the args, or every reason the invocation was refused
 */
export function parseVerifyArgs({ rest }: { rest: readonly string[] }): Result<VerifyArgs> {
  const flags = parseFlags({ args: rest, spec: { boolean: ["json"], string: ["home", "workdir"] } });
  if (flags.isErr()) {
    return err(flags.error);
  }
  const workdir = flags.value.values["workdir"];
  return ok({
    home: homeOf({ values: flags.value.values }),
    json: flags.value.values["json"] === true,
    workdir: typeof workdir === "string" ? workdir : undefined,
  });
}

/**
 * The human report of a push.
 *
 * @param report what the push did
 * @returns the lines
 */
export function pushLines({ report }: { report: PushReport }): readonly string[] {
  const generated =
    report.generated.length === 0
      ? "store push: the schema and the committed migrations already agree — nothing generated"
      : `store push: generated ${report.generated.join(", ")} — COMMIT IT with the schema change it carries`;
  return [
    generated,
    `store push: ${String(report.applied.roles)} role/extension statement(s), migrations from ${report.applied.migrationsDir}, ${String(report.applied.guards)} guard statement(s)`,
    ...verifyLines({
      declaredTables: report.verify.declaredTables,
      findings: report.verify.findings,
      state: report.verify.state,
    }),
  ];
}

/**
 * The human report of a reset.
 *
 * @param report what the reset destroyed and rebuilt
 * @returns the lines
 */
export function resetLines({ report }: { report: ResetReport }): readonly string[] {
  const rows = report.destroyed.reduce((sum, entry) => sum + entry.rows, 0);
  return [
    `store reset: dropped "${report.database}" — ${String(report.destroyed.length)} table(s), ${String(rows)} row(s) destroyed`,
    ...report.destroyed.filter((entry) => entry.rows > 0).map((entry) => `  ${entry.table}: ${String(entry.rows)}`),
    ...pushLines({ report: report.push }),
  ];
}

/**
 * The human report of a baseline.
 *
 * @param report what was recorded
 * @returns the lines
 */
export function baselineLines({ report }: { report: BaselineReport }): readonly string[] {
  const pending =
    report.pending.length === 0
      ? "nothing pending — the database is current"
      : `pending: ${report.pending.join(", ")} — run \`slopweaver store push\``;
  return [`store baseline: recorded ${report.recorded.join(", ")} as already applied`, `store baseline: ${pending}`];
}

export { verifyLines };
