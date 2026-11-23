/**
 * The pure half of `slopweaver dev profile`: the flag spec, the argv split at `--`, and the rendering.
 *
 * The verb answers one question — where does this thing's time and memory actually go — for a gate, a test
 * lane or any `slopweaver` verb, so that a performance problem is measured on purpose rather than met as a
 * red build. The instruments are V8's own (`--cpu-prof`, `--heap-prof`) and this repo's own phase report
 * (`SLOPWEAVER_HEAP_PHASES`); none of it is hand-rolled, and none of it is a sampler that could be wrong.
 *
 * What a subject IS lives in `src/perf/subject.ts` beside `resolveSubject`, and so do the three flag readers
 * that build one — that directory owns the domain and its typed `ProfileSubjectError` union, and holding the
 * parsers here instead put five plain error shapes into `src/cli/commands/dev`, which is the count
 * `error-shape-threshold` refuses. The spawning and the file reads are {@link ./profile}; everything here is
 * pure and tested as such.
 */
import { type Result } from "#lib/result.js";
import type { PerfComparison } from "../../../perf/baseline.js";
import type { PhaseReading } from "../../../perf/phaseLines.js";
import type { SpawnPlan } from "../../../perf/subject.js";
import { type ModuleCost, splitIdle } from "../../../perf/v8Profile.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

export const DEV_PROFILE_USAGE =
  "usage: slopweaver dev profile (--gate <name> | --lane unit|subprocess|integration | --verb -- <argv...>)\n" +
  "                              [--cpu] [--heap-prof] [--record] [--check] [--top <n>] [--interval <us>] [--json]\n" +
  "  Spawn one subject under V8's own profilers and this repo's phase report, and say where its time and\n" +
  "  memory went. --gate takes the command from `dev lint`'s own registry, so it profiles what CI runs.\n" +
  "  --cpu        add --cpu-prof and fold self time by module (package, src directory, or V8 pseudo-frame)\n" +
  "  --heap-prof  add --heap-prof and fold sampled ALLOCATION by module — what was churned, not what is held\n" +
  "  --record     write this run into .baselines/perf-baseline.json\n" +
  "  --check      exit non-zero when post-GC live heap is past the recorded band; wall time never fails a\n" +
  "               run, because a shared runner's clock is not a measurement\n" +
  "  --top <n>    how many modules to print (default 10)\n" +
  "  --interval <us>  V8's CPU sampling interval in microseconds (default 1000, V8's own). Raise it for a\n" +
  "               long subject: a 40s run writes an 86 MB .cpuprofile at 1000, and a document past 100 MiB\n" +
  "               is skipped rather than parsed\n" +
  "  Post-GC live heap is the memory number throughout: it is deterministic to about a MiB and is what\n" +
  "  decides whether a process dies under a ceiling. Peak RSS is deliberately not reported.";

const FLAGS: FlagSpec = {
  boolean: ["cpu", "heap-prof", "record", "check", "json", "verb"],
  string: ["gate", "lane", "top", "interval"],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_PROFILE_FLAG_NAMES: readonly string[] = ((): readonly string[] => {
  const { boolean: booleans = [], string: strings = [] } = FLAGS;
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
})();

/**
 * Parse `dev profile` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb, already split at `--`
 * @returns the parsed flags, or the parse errors
 */
export function parseDevProfileArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/**
 * Split the tail at the first bare `--`, so a profiled verb's own flags never reach this verb's parser.
 *
 * Done here rather than left to `parseArgs`'s positional handling because the subject of `--verb` is an
 * argv, and an argv that has been through two parsers is not the one the user typed.
 *
 * @param rest the whole verb tail
 * @returns the flags before `--`, and the verb argv after it
 */
export function splitAtDoubleDash({ rest }: { rest: readonly string[] }): {
  readonly head: readonly string[];
  readonly tail: readonly string[];
} {
  const at = rest.indexOf("--");
  if (at < 0) {
    return { head: rest, tail: [] };
  }
  return { head: rest.slice(0, at), tail: rest.slice(at + 1) };
}

/** Everything one profiled run produced, before any comparison. */
export interface ProfileRun {
  readonly plan: SpawnPlan;
  readonly exitCode: number;
  readonly wallMs: number;
  readonly phases: readonly PhaseReading[];
  readonly peakHeapMib: number | undefined;
  /** Self CPU time by module, in microseconds. Empty unless `--cpu` was given. */
  readonly cpu: readonly ModuleCost[];
  /** Sampled allocation by module, in bytes. Empty unless `--heap-prof` was given. */
  readonly allocation: readonly ModuleCost[];
  /**
   * How many V8 documents the run wrote that the fold could NOT read — each one a subject process whose
   * time is missing from the tables below. Zero on an ordinary run.
   */
  readonly skippedDocuments: number;
}

/** A duration in whichever unit reads without arithmetic. */
function seconds({ ms }: { ms: number }): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** One `<share> <module> <value>` line of a module table. */
function costLine({ cost, unit }: { cost: ModuleCost; unit: "cpu" | "bytes" }): string {
  const share = `${(cost.share * 100).toFixed(1)}%`.padStart(6);
  const amount = unit === "cpu" ? seconds({ ms: cost.value / 1000 }) : `${Math.round(cost.value / 1024 / 1024)} MiB`;
  return `    ${share}  ${cost.module.padEnd(36)} ${amount}`;
}

/**
 * What a module table must say about itself when the fold behind it is incomplete.
 *
 * A skipped document is a whole subject PROCESS whose time is missing, and the shares below are re-shared
 * over what survived — so they sum to 100% of a denominator the run did not measure. The warning about the
 * skip goes to stderr and the table goes to stdout; a reader who sees only one of the two would read a
 * partial measurement as the whole run. So the table carries it.
 */
function partialSuffix({ run }: { run: ProfileRun }): string {
  if (run.skippedDocuments === 0) {
    return "";
  }
  const many = run.skippedDocuments === 1 ? "1 document" : `${String(run.skippedDocuments)} documents`;
  return ` — PARTIAL: ${many} too large to read, so these shares are of what was read, not of the run`;
}

/** The heap block: every measured phase, or one line saying the subject printed none. */
function heapLines({ run }: { run: ProfileRun }): readonly string[] {
  if (run.phases.length === 0) {
    return ["  heap     no phase marks — this subject carries no SLOPWEAVER_HEAP_PHASES instrument"];
  }
  const peak =
    run.peakHeapMib === undefined
      ? "unmeasured (no --expose-gc reached the subject)"
      : `peak ${String(run.peakHeapMib)} MiB`;
  return [
    `  heap     ${peak}`,
    ...run.phases.map((phase) => {
      const held = phase.liveMib === undefined ? "unmeasured" : `${String(phase.liveMib)} MiB`;
      return `    phase  ${phase.label.padEnd(36)} ${held}`;
    }),
  ];
}

/** The baseline block: what was recorded, and the verdict on this run's heap. */
function baselineLines({ comparison }: { comparison: PerfComparison }): readonly string[] {
  if (comparison.baseline === undefined) {
    return ["  baseline not recorded for this subject — `--record` writes one"];
  }
  const { heap, wall } = comparison;
  const allowed = heap.allowedMib === undefined ? "unknown" : String(Math.round(heap.allowedMib));
  const lines = [
    `  baseline recorded ${comparison.baseline.recordedAt}: ${String(heap.baselineMib)} MiB, ${seconds({ ms: wall.baselineMs })}`,
  ];
  if (heap.regressed) {
    lines.push(`  REGRESSED heap ${String(heap.measuredMib)} MiB is past the ${allowed} MiB the band allows`);
  }
  if (!heap.regressed && heap.measuredMib !== undefined && heap.baselineMib !== undefined) {
    lines.push(`  verdict  heap within band (${String(heap.measuredMib)} MiB, band tops out at ${allowed})`);
  }
  if (wall.drifted) {
    lines.push(
      `  noted    wall time moved to ${seconds({ ms: wall.measuredMs })}; advisory only, a shared runner's clock is not a measurement`,
    );
  }
  return lines;
}

/**
 * Why a run is not the subject's cost, when it is not: a subject that exited non-zero measured a failure —
 * a diff gate refusing for want of a base costs a fraction of its comparison — so
 * the run is printed but never recorded, and the verb fails rather than reporting success over it.
 *
 * @param run what the subject did
 * @returns the line saying so, or `undefined` for a run that completed
 */
export function failedSubjectLine({ run }: { run: Pick<ProfileRun, "exitCode" | "plan"> }): string | undefined {
  if (run.exitCode === 0) {
    return undefined;
  }
  return (
    `dev profile: ${run.plan.label} exited ${String(run.exitCode)}, so this measured a failure rather than the ` +
    "subject's work — not recorded; fix what it printed and re-run"
  );
}

/**
 * Render one profiled run for a reader.
 *
 * @param run what the subject cost
 * @param comparison how that reads against the recorded baseline
 * @param top how many modules to print in each table
 * @returns the lines to print
 */
export function renderProfile({
  run,
  comparison,
  top,
}: {
  run: ProfileRun;
  comparison: PerfComparison;
  top: number;
}): readonly string[] {
  const lines = [
    `dev profile ${run.plan.label}`,
    `  command  ${run.plan.cmd} ${run.plan.args.join(" ")}`,
    `  exit     ${String(run.exitCode)}`,
    `  wall     ${seconds({ ms: run.wallMs })}`,
    ...heapLines({ run }),
  ];
  if (run.cpu.length > 0) {
    const { busy, idleShare } = splitIdle({ costs: run.cpu });
    lines.push(
      `  cpu by module (self time; ${(idleShare * 100).toFixed(1)}% of samples were idle — waiting, not computing)${partialSuffix({ run })}`,
    );
    lines.push(...busy.slice(0, top).map((cost) => costLine({ cost, unit: "cpu" })));
  }
  if (run.allocation.length > 0) {
    lines.push(`  allocation by module (sampled, churn not live set)${partialSuffix({ run })}`);
    lines.push(...run.allocation.slice(0, top).map((cost) => costLine({ cost, unit: "bytes" })));
  }
  lines.push(...baselineLines({ comparison }));
  return lines;
}
