/**
 * The PURE half of `slopweaver store recover` — the parser and the closing report. No process, socket, clock
 * or filesystem; the sequence is `src/store/backup/recover.ts` and the shell `./recoverRun.ts`.
 */
import { err, ok } from "#lib/result.js";

import { backupErrorLines } from "../../../store/backup/errors.js";
import { validateDatabaseName } from "../../../store/backup/plan.js";
import type { RecoverReport } from "../../../store/backup/recover.js";
import { NOT_IN_ANY_BACKUP } from "../../../store/backup/recoverPlan.js";
import { parseFlags } from "../../parseFlags.js";

import { type Parsed, StoreCommandErrors } from "./errors.js";

/** The flags `store recover` accepts. */
const RECOVER_FLAGS = {
  boolean: ["dry-run"],
  string: ["destination", "from", "home", "into"],
} as const;

/** The flags `store recover` advertises, for the help-truth ratchet. */
export const STORE_RECOVER_FLAG_NAMES: readonly string[] = [
  ...RECOVER_FLAGS.string.map((name) => `--${name}`),
  ...RECOVER_FLAGS.boolean.map((name) => `--${name}`),
];

/** The database a recovery restores into unless `--into` names another — the name the runbook has always used. */
export const DEFAULT_RECOVER_DATABASE = "store_recovered";

/** A backup prefix as the destination spells one: `<project>/<instant>/`. */
const BACKUP_PREFIX = /^[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\/?$/;

/** What a `store recover` invocation asked for. */
export interface StoreRecoverArgs {
  readonly home?: string;
  /** The destination directory named on the command line, or `null` for the environment's or the home's remembered one. */
  readonly destination: string | null;
  /** A `<project>/<instant>/` prefix to recover instead of the newest, or `null`. */
  readonly from: string | null;
  readonly database: string;
  readonly dryRun: boolean;
}

/**
 * Parse a `store recover` invocation.
 *
 * @param rest the argv tail
 * @returns the arguments, or every reason the invocation was refused
 */
export function parseStoreRecoverArgs({ rest }: { rest: readonly string[] }): Parsed<StoreRecoverArgs> {
  const parsed = parseFlags({ args: rest, spec: RECOVER_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const intoRaw = values["into"];
  const database = validateDatabaseName({ name: typeof intoRaw === "string" ? intoRaw : DEFAULT_RECOVER_DATABASE });
  const fromRaw = values["from"];
  const destinationRaw = values["destination"];
  const errors = [
    ...(database.isErr() ? backupErrorLines({ error: database.error }) : []),
    ...(typeof fromRaw === "string" && !BACKUP_PREFIX.test(fromRaw)
      ? [StoreCommandErrors.fromPrefixInvalid({ got: fromRaw }).message]
      : []),
  ];
  if (errors.length > 0 || database.isErr()) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: errors }));
  }
  const home = values["home"];
  return ok({
    database: database.value,
    destination: typeof destinationRaw === "string" ? destinationRaw : null,
    dryRun: values["dry-run"] === true,
    from: typeof fromRaw === "string" ? fromRaw : null,
    ...(typeof home === "string" ? { home } : {}),
  });
}

/**
 * The closing report: whether the home came back whole, the `store-url` repointed at the recovered database
 * (by database name only), what was left in staging, and what never rides a backup at all.
 *
 * @param report what the recovery did
 * @param home the home it recovered
 * @returns the lines
 */
export function recoverReportLines({ report, home }: { report: RecoverReport; home: string }): readonly string[] {
  if (report.dryRun) {
    return ["store recover: dry run — nothing was downloaded or written. Run it again without --dry-run to recover."];
  }
  const credentials = credentialLines({ carried: report.credentialsCarried });
  const replaced = (report.secrets === null ? [] : report.secrets.replaced).map(
    (replacement) =>
      `store recover: replaced ${replacement.path} database ${replacement.oldDatabase} → ${replacement.newDatabase}; every other connection field was identical.`,
  );
  const conflicts =
    report.conflicts.length === 0
      ? []
      : [
          `store recover: ${String(report.conflicts.length)} path(s) LEFT IN STAGING — the home already holds different bytes, and a recovery never overwrites:`,
          ...report.conflicts.map((path) => `  ${path}`),
        ];
  const verdict = report.complete
    ? `store recover: ${home} recovered from ${report.prefix} into ${report.database}. Next: \`slopweaver handover list\`, then open the supervisor.`
    : `store recover: ${home} is NOT whole — resolve the paths above, then run store recover again to finish.`;
  return [
    ...replaced,
    ...conflicts,
    ...credentials,
    "store recover: what no backup carries, so it is still yours to do:",
    ...NOT_IN_ANY_BACKUP.map((line) => `  - ${line}`),
    verdict,
  ];
}

/**
 * What the report says about credentials, which is the one leg that can be absent from a complete backup.
 *
 * @param carried whether the backup carried a bundle, `null` when this run never needed to read it
 * @returns the lines
 */
function credentialLines({ carried }: { carried: boolean | null }): readonly string[] {
  if (carried === false) {
    return [
      "store recover: this backup carried NO credentials — `backup-passphrase` was never set on the machine that took it,",
      "  so every token has to be minted again: `slopweaver secrets status --all` lists each and where it is minted.",
      "  Then `slopweaver secrets set backup-passphrase` (the one in your password manager) so the next nightly carries them.",
    ];
  }
  return [];
}
