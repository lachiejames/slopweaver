/**
 * `slopweaver supervisor tick-reseal` — reseal a tick ledger whose rows carry stale `stats`.
 *
 * The readers of `supervisor-ticks.jsonl` refuse the whole ledger at its first defect, and a home carried between
 * machines through a sanitiser keeps every row sound while every recorded byte count goes stale. This is the
 * explicit repair: a bare run PREVIEWS — streams the ledger, refuses any defect a reseal does not repair, counts the
 * rows it would rewrite and prints the digest an apply must name — and writes nothing. `--apply` takes that digest
 * and a reason, and `../../../supervisor/tickResealStore.ts` does the rest under the ledger's lock: a backup, a
 * staged rewrite read back through the ordinary reader, the install, and a receipt in `tick-reseals.jsonl`.
 *
 * The edge only — every check is in `../../../supervisor/tickReseal.ts` and the store.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { TickResealError } from "../../../supervisor/tickResealErrors.js";
import {
  applyTickReseal,
  previewTickReseal,
  type TickResealPlan,
  type TickResealReceipt,
} from "../../../supervisor/tickResealStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { SupervisorErrors, type SupervisorFlagsRefusedError } from "./errors.js";

/** The verb's usage line, as the manifest quotes it. */
export const SUPERVISOR_TICK_RESEAL_USAGE =
  'usage: slopweaver supervisor tick-reseal [--home <dir>] [--json] | tick-reseal --apply --source-sha256 <hex> --reason "<why>" [--now <iso>] [--home <dir>] [--json]';

/** `tick-reseal`'s flag tail — exported so `--help`'s advertised flags and the parser cannot drift. */
export const TICK_RESEAL_FLAG_SPEC = {
  boolean: ["apply", "json"],
  value: ["home", "source-sha256", "reason", "now"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** What `tick-reseal` resolves to: a preview, or an apply carrying its digest, reason and instant. */
export type TickResealOptions =
  | { readonly kind: "preview"; readonly home: string | undefined; readonly json: boolean }
  | {
      readonly kind: "apply";
      readonly home: string | undefined;
      readonly json: boolean;
      readonly sourceSha256: string;
      readonly reason: string;
      readonly nowIso: string | undefined;
    };

/**
 * Parse `tick-reseal`'s flag tail. No I/O.
 *
 * @param rest the flag tail after `supervisor tick-reseal`
 * @returns the options, or every rejection, as the directory's own flags refusal
 */
export function parseTickResealOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<TickResealOptions, SupervisorFlagsRefusedError> {
  const parsed = parseFlagTail({ rest, spec: TICK_RESEAL_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SupervisorErrors.flagsRefused({ reasons: parsed.error }));
  }
  // The raw record already reads an absent flag as `undefined`, the shape both options carry.
  const home = parsed.value.values["home"];
  const nowIso = parsed.value.values["now"];
  const json = parsed.value.flags.has("json");
  const digest = flagValue({ name: "source-sha256", parsed: parsed.value });
  const reason = flagValue({ name: "reason", parsed: parsed.value });
  const now = flagValue({ name: "now", parsed: parsed.value });
  if (!parsed.value.flags.has("apply")) {
    if (digest !== null || reason !== null || now !== null) {
      return err(
        SupervisorErrors.flagsRefused({
          reasons: [
            "--source-sha256, --reason and --now belong to --apply — a bare run is the preview and writes nothing",
          ],
        }),
      );
    }
    return ok({ home, json, kind: "preview" });
  }
  const problems: string[] = [];
  if (digest === null || !/^[0-9a-f]{64}$/u.test(digest)) {
    problems.push("--apply needs --source-sha256 <hex>: the 64-character digest the preview printed");
  }
  if (reason === null || reason.trim().length === 0) {
    problems.push('--apply needs --reason "<why>": it is journalled on the receipt');
  }
  if (now !== null && Number.isNaN(Date.parse(now))) {
    problems.push(`--now ${now} is not an ISO instant`);
  }
  if (problems.length > 0 || digest === null || reason === null) {
    return err(SupervisorErrors.flagsRefused({ reasons: problems }));
  }
  return ok({ home, json, kind: "apply", nowIso, reason, sourceSha256: digest });
}

/** Everything the verb touches outside itself. */
export interface TickResealDeps {
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The exit a refusal earns: a held lock is NOT YET, a ledger with nothing stale is an expected empty.
 *
 * @param error the refusal
 * @returns the exit code
 */
function exitFor({ error }: { error: TickResealError }): number {
  if (error.code === "BUSY") {
    return EXIT_DEFERRED;
  }
  if (error.code === "NOTHING_TO_RESEAL") {
    return EXIT_EXPECTED_EMPTY;
  }
  return EXIT_ERROR;
}

/**
 * Print a refusal, one line per reason where it carries several.
 *
 * @param error the refusal
 * @param deps the injected seams
 * @returns the exit code
 */
function refuse({ error, deps }: { error: TickResealError; deps: TickResealDeps }): number {
  if (error.code === "LEDGER_REFUSED" || error.code === "READ_BACK_FAILED") {
    deps.writeDiagnostic(`supervisor tick-reseal: refused (${error.code}) — nothing was written`);
    for (const reason of error.reasons) {
      deps.writeDiagnostic(`  ${reason}`);
    }
    return exitFor({ error });
  }
  deps.writeDiagnostic(`supervisor tick-reseal: ${error.message}`);
  return exitFor({ error });
}

/**
 * The exact command that applies a preview's plan.
 *
 * @param plan the preview's plan
 * @param home the `--home` the preview was given, if any
 * @returns the command line
 */
function applyCommand({ plan, home }: { plan: TickResealPlan; home: string | undefined }): string {
  const homePart = home === undefined ? "" : ` --home ${home}`;
  return `slopweaver supervisor tick-reseal --apply --source-sha256 ${plan.sourceSha256} --reason "<why>"${homePart}`;
}

/**
 * Report a preview.
 *
 * @param plan what the preview found
 * @param options the parsed invocation
 * @param deps the injected seams
 * @returns the exit code
 */
function reportPlan({
  plan,
  options,
  deps,
}: {
  plan: TickResealPlan;
  options: TickResealOptions;
  deps: TickResealDeps;
}): number {
  const command = applyCommand({ home: options.home, plan });
  if (options.json) {
    deps.writeOut(JSON.stringify({ ...plan, applyCommand: plan.rowsChanged > 0 ? command : null }));
  } else {
    deps.writeOut(`supervisor tick-reseal: preview of ${plan.path} — nothing was written`);
    deps.writeOut(`  rows read: ${String(plan.rowsRead)}; stale stats: ${String(plan.rowsChanged)}`);
    deps.writeOut(
      `  rows that re-render byte-identically with their recorded stats: ${String(plan.rowsRenderedAsRead)}`,
    );
    deps.writeOut(`  sourceSha256: ${plan.sourceSha256}`);
    if (plan.rowsChanged > 0) {
      deps.writeOut(`to apply: ${command}`);
    }
  }
  return plan.rowsChanged > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Report an apply.
 *
 * @param receipt what was journalled
 * @param journalPath where
 * @param json whether to print one JSON document
 * @param deps the injected seams
 */
function reportReceipt({
  receipt,
  journalPath,
  json,
  deps,
}: {
  receipt: TickResealReceipt;
  journalPath: string;
  json: boolean;
  deps: TickResealDeps;
}): void {
  if (json) {
    deps.writeOut(JSON.stringify({ ...receipt, journalPath }));
    return;
  }
  deps.writeOut(
    `supervisor tick-reseal: resealed ${String(receipt.rowsChanged)} of ${String(receipt.rowsRead)} rows in ` +
      `${receipt.ledgerPath}; it reads back clean`,
  );
  deps.writeOut(`  backup: ${receipt.backupPath}`);
  deps.writeOut(`  sha256: ${receipt.sourceSha256} -> ${receipt.resultSha256}`);
  deps.writeOut(`  receipt: ${journalPath}`);
}

/**
 * The instant an apply runs at: the one `--now` pinned for a replay, else the clock's.
 *
 * @param pinned what `--now` named, if anything
 * @param deps the seams the clock is read through
 * @returns the instant
 */
function applyInstant({ pinned, deps }: { pinned: string | undefined; deps: TickResealDeps }): string {
  if (pinned !== undefined) {
    return pinned;
  }
  return deps.now();
}

/**
 * Run `supervisor tick-reseal` against injected seams.
 *
 * @param rest the argv tail after `supervisor tick-reseal`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runSupervisorTickReseal({ rest, deps }: { rest: readonly string[]; deps: TickResealDeps }): number {
  const parsed = parseTickResealOptions({ rest });
  if (parsed.isErr()) {
    for (const line of parsed.error.reasons) {
      deps.writeDiagnostic(`supervisor tick-reseal: ${line}`);
    }
    deps.writeDiagnostic(SUPERVISOR_TICK_RESEAL_USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  if (options.kind === "preview") {
    const plan = previewTickReseal({ home });
    if (plan.isErr()) {
      return refuse({ deps, error: plan.error });
    }
    return reportPlan({ deps, options, plan: plan.value });
  }
  const nowIso = applyInstant({ deps, pinned: options.nowIso });
  const applied = applyTickReseal({ home, nowIso, reason: options.reason, sourceSha256: options.sourceSha256 });
  if (applied.isErr()) {
    return refuse({ deps, error: applied.error });
  }
  reportReceipt({ deps, journalPath: applied.value.journalPath, json: options.json, receipt: applied.value.receipt });
  return EXIT_OK;
}

/** `slopweaver supervisor tick-reseal`. */
export const supervisorTickResealCommand = defineCommand({
  run: (argv) =>
    runSupervisorTickReseal({
      deps: {
        now: () => new Date().toISOString(),
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: verbTail({ argv, verbs: ["tick-reseal"] }),
    }),
});
