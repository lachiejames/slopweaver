/**
 * `ruling seed`: file the rulings already written in the supervisor state documents' `### RULINGS` sections, exactly
 * as written — `--plan` prints what each document holds, `--decisions <file> --apply` files every ruling under its
 * decision.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { RulingError } from "../../../ruling/errors.js";
import { planSeedApply, uniqueSeedCandidates } from "../../../ruling/seed.js";
import { type RulingSeedScan, scanRulingSource } from "../../../ruling/sourceRows.js";
import { appendRulings, readRulingSource, readSeedDecisions } from "../../../ruling/store.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue } from "../../optionParsers.js";
import { RULING_SEED_USAGE } from "./rulingUsage.js";
import { type RulingArgs, type RulingDeps, reportRefusal } from "./shared.js";

/** Read every named source document fresh. */
function scanSources({ files }: { files: readonly string[] }): Result<readonly RulingSeedScan[], RulingError> {
  const scans: RulingSeedScan[] = [];
  for (const file of files) {
    const text = readRulingSource({ file });
    if (text.isErr()) {
      return err(text.error);
    }
    scans.push(scanRulingSource({ file, text: text.value }));
  }
  return ok(scans);
}

/** Every unique candidate: its id and key, where it was read, and its words, indented. */
function printCandidates({ scans, deps }: { scans: readonly RulingSeedScan[]; deps: RulingDeps }): void {
  const { candidates, duplicates } = uniqueSeedCandidates({ scans });
  for (const candidate of candidates) {
    const anchor = candidate.anchor === undefined ? "" : ` · ${candidate.anchor}`;
    const context = candidate.context === undefined ? "" : ` · ${candidate.context}`;
    deps.logger.out({ line: `CANDIDATE ${candidate.id} ${candidate.seedKey}` });
    deps.logger.out({
      line: `  ${candidate.file}:${String(candidate.line)} · decided ${candidate.decidedOn}${anchor}${context}`,
    });
    for (const line of candidate.words.split("\n")) {
      deps.logger.out({ line: `    ${line}` });
    }
  }
  for (const duplicate of duplicates) {
    deps.logger.out({ line: `DUPLICATE ${duplicate.file}:${String(duplicate.line)} repeats ${duplicate.seedKey}` });
  }
}

/** `ruling seed --plan`: what each document holds and what each candidate would be filed as. */
function printSeedPlan({ scans, deps }: { scans: readonly RulingSeedScan[]; deps: RulingDeps }): number {
  for (const scan of scans) {
    deps.logger.out({
      line:
        `${scan.file}: ${String(scan.sections)} RULINGS section(s), ${String(scan.candidates.length)} ruling(s), ` +
        `${String(scan.skipped.length)} skipped, ${String(scan.blockers.length)} blocker(s)`,
    });
  }
  printCandidates({ deps, scans });
  for (const skip of scans.flatMap((scan) => scan.skipped)) {
    deps.logger.out({ line: `SKIPPED ${skip.file}:${String(skip.line)} (${skip.reason})` });
  }
  const blockers = scans.flatMap((scan) => scan.blockers);
  for (const blocker of blockers) {
    deps.logger.out({ line: `BLOCKER ${blocker.file}:${String(blocker.line)} — ${blocker.why}` });
  }
  return blockers.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/** `ruling seed --decisions <file> --apply`: file every candidate not already filed, under its decision. */
function applySeed({
  file,
  home,
  from,
  decisionsFile,
  deps,
}: {
  file: string;
  home: string;
  from: readonly string[];
  decisionsFile: string;
  deps: RulingDeps;
}): number {
  const decisions = readSeedDecisions({ file: decisionsFile });
  if (decisions.isErr()) {
    return reportRefusal({ deps, error: decisions.error });
  }
  // The sources are read BEFORE the lock: a slow source (a pipe, a network mount) must not hold the register's lock
  // past its lease, after which another writer may take it over. Only the register is read under the lock.
  const scans = scanSources({ files: from });
  if (scans.isErr()) {
    return reportRefusal({ deps, error: scans.error });
  }
  const recordedIso = deps.nowIso();
  let alreadyFiled = 0;
  const appended = appendRulings({
    file,
    home,
    nowIso: recordedIso,
    plan: ({ projection }) =>
      planSeedApply({ decisions: decisions.value, projection, recordedIso, scans: scans.value }).map((plan) => {
        alreadyFiled = plan.alreadyFiled;
        return plan.records;
      }),
  });
  if (appended.isErr()) {
    return reportRefusal({ deps, error: appended.error });
  }
  deps.logger.out({
    line: `ruling seed: filed ${String(appended.value.appended.length)}, ${String(alreadyFiled)} already filed (${file})`,
  });
  return EXIT_OK;
}

/**
 * `ruling seed`.
 *
 * @param file the register's path
 * @param home the state home whose operation lock an apply takes
 * @param args the parsed flags
 * @returns the exit code
 */
export function runSeed({
  file,
  home,
  args,
  deps,
}: {
  file: string;
  home: string;
  args: RulingArgs;
  deps: RulingDeps;
}): number {
  const planOnly = args.parsed.flags.has("plan");
  const apply = args.parsed.flags.has("apply");
  const decisionsFile = flagValue({ name: "decisions", parsed: args.parsed });
  if (args.from.length > 0 && planOnly && decisionsFile === null && !apply) {
    const scans = scanSources({ files: args.from });
    if (scans.isErr()) {
      return reportRefusal({ deps, error: scans.error });
    }
    return printSeedPlan({ deps, scans: scans.value });
  }
  if (args.from.length > 0 && !planOnly && decisionsFile !== null && apply) {
    return applySeed({ decisionsFile, deps, file, from: args.from, home });
  }
  deps.logger.error({ msg: `name each --from, then --plan alone or --decisions with --apply\n${RULING_SEED_USAGE}` });
  return EXIT_USAGE;
}
