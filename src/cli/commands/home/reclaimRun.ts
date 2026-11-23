/**
 * `slopweaver home reclaim` — the obviously-junk bytes out of the declared scratch roots under
 * `$SLOPWEAVER_HOME`, by the owner's word and with no retention policy anywhere in it.
 *
 * Report-first: without `--apply` it deletes nothing and prints what it would take and why. The root and
 * the one class it takes are `../../../home/reclaim/roots.ts`, whose header carries the finding that
 * retired the second class; the rule that decides a spent workspace is
 * `../../../home/reclaim/finishedScratch.ts`, pure and unit tested; the proof that a removal took nothing else is `../../../home/reclaim/run.ts`'s
 * witness, which runs after the delete and fails the verb rather than the reader's confidence.
 */
import { type HomeReclaimError, HomeReclaimErrors } from "../../../home/reclaim/errors.js";
import { appendReclaimRow, reclaimLedgerPath } from "../../../home/reclaim/journalStore.js";
import { declaredRootNames, findRoot, RECLAIM_ROOTS, type ReclaimRoot } from "../../../home/reclaim/roots.js";
import { type ReclaimDeps, type RootOutcome, reclaimFinishedScratch } from "../../../home/reclaim/run.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseHomeReclaimArgs, RECLAIM_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** Bytes per mebibyte, for the human column. */
const MIB = 1024 * 1024;

/** Everything `home reclaim` touches outside itself, injected so a test drives the whole verb. */
export interface HomeReclaimDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Who is running it, recorded on the ledger row so a wrong act has an author. */
  readonly session: string;
  /** The instant the run finished — injected, so a test asserts an exact row. */
  readonly nowIso: () => string;
}

/**
 * Run `home reclaim` against injected seams.
 *
 * @param rest the argv tail after `home reclaim`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runHomeReclaim({ rest, deps }: { rest: readonly string[]; deps: HomeReclaimDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECLAIM_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHomeReclaimArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(RECLAIM_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const namedRoot = values["root"];
  const selected = selectRoots({ named: typeof namedRoot === "string" ? namedRoot : undefined });
  if (selected.isErr()) {
    deps.writeDiagnostic(`home reclaim: ${selected.error.message}`);
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: typeof values["home"] === "string" ? values["home"] : undefined });
  const apply = values["apply"] === true;
  const reclaimDeps: ReclaimDeps = {
    home,
    progress: ({ line }) => {
      deps.writeDiagnostic(line);
    },
  };
  const outcomes: RootOutcome[] = [];
  for (const root of selected.value) {
    const outcome = reclaimFinishedScratch({ apply, deps: reclaimDeps, root });
    if (outcome.isErr()) {
      deps.writeDiagnostic(`home reclaim: ${outcome.error.message}`);
      return EXIT_ERROR;
    }
    outcomes.push(outcome.value);
    const journalled = journalWhenApplied({ apply, deps, home, outcome: outcome.value });
    if (journalled !== undefined) {
      deps.writeDiagnostic(`home reclaim: ${journalled}`);
      return EXIT_ERROR;
    }
  }
  emit({ apply, asJson: values["json"] === true, deps, outcomes });
  return EXIT_OK;
}

/**
 * Append the ledger row an applied run owes, and say what stopped it when one could not be written.
 *
 * @param apply whether this run actually removed anything — a report writes no row
 * @param outcome what the root's reclaim did
 * @param home the resolved state home the ledger lives under
 * @param deps the clock and the session name the row records
 * @returns the failure message, or undefined when there was nothing to write or the write succeeded
 */
function journalWhenApplied({
  apply,
  outcome,
  home,
  deps,
}: {
  apply: boolean;
  outcome: RootOutcome;
  home: string;
  deps: HomeReclaimDeps;
}): string | undefined {
  if (!apply) {
    return undefined;
  }
  const appended = appendReclaimRow({
    path: reclaimLedgerPath({ home }),
    row: {
      atIso: deps.nowIso(),
      freedBytes: outcome.freedBytes,
      removedEntries: outcome.entries.length,
      root: outcome.root,
      session: deps.session,
      takes: outcome.takes,
      witnessHeld: outcome.witnessHeld,
    },
  });
  if (appended.isErr()) {
    return appended.error.message;
  }
  return undefined;
}

/** Write the run's outcomes out, as JSON documents or as the lines a human reads. */
function emit({
  outcomes,
  apply,
  asJson,
  deps,
}: {
  outcomes: readonly RootOutcome[];
  apply: boolean;
  asJson: boolean;
  deps: HomeReclaimDeps;
}): void {
  if (asJson) {
    outcomes.forEach((outcome) => {
      deps.writeOut(safeJsonStringify({ label: "a home reclaim outcome", value: outcome }));
    });
    return;
  }
  reportLines({ apply, outcomes }).forEach((line) => {
    deps.writeOut(line);
  });
}

/**
 * Resolve `--root` to declared roots.
 *
 * @param named what the caller typed, or undefined for every declared root
 * @returns the roots to enter, or the refusal naming what could have been typed
 */
function selectRoots({ named }: { named: string | undefined }): Result<readonly ReclaimRoot[], HomeReclaimError> {
  if (named === undefined) {
    return ok(RECLAIM_ROOTS);
  }
  const found = findRoot({ name: named });
  if (found === undefined) {
    return err(HomeReclaimErrors.rootNotDeclared({ declared: declaredRootNames(), named }));
  }
  return ok([found]);
}

/** The lines a human reads. */
function reportLines({ outcomes, apply }: { outcomes: readonly RootOutcome[]; apply: boolean }): readonly string[] {
  const verb = apply ? "reclaimed" : "would reclaim";
  const total = outcomes.reduce((sum, outcome) => sum + outcome.freedBytes, 0);
  const lines: string[] = [
    `home reclaim: ${verb} ${(total / MIB).toFixed(1)} MiB across ${String(outcomes.length)} declared root(s)` +
      (apply ? "" : "\n  nothing was deleted — re-run with --apply"),
  ];
  for (const outcome of outcomes) {
    lines.push(
      `  ${outcome.root} (${outcome.takes}): ${verb} ${(outcome.freedBytes / MIB).toFixed(1)} MiB from ` +
        `${String(outcome.entries.length)} entr(ies), examining ${String(outcome.examined)} finished pass(es)`,
    );
    lines.push(`    why there is junk here: ${outcome.because}`);
  }
  return lines;
}

/**
 * The real seams: both output channels, this session's name and the clock.
 *
 * @returns the production dependencies for {@link runHomeReclaim}
 */
export function productionHomeReclaimDeps(): HomeReclaimDeps {
  return {
    nowIso: () => new Date().toISOString(),
    session: sessionName(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** This process's workspace name, or the plain fact that it has none. */
function sessionName(): string {
  const named = process.env["CMUX_WORKSPACE"];
  if (named === undefined || named.length === 0) {
    return "unnamed session";
  }
  return named;
}

/** `slopweaver home reclaim`. */
export const homeReclaimCommand = defineCommand({
  run: (argv) => runHomeReclaim({ deps: productionHomeReclaimDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
