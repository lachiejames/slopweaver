/**
 * `slopweaver dev profile` — spawn one gate, test lane or verb under V8's own profilers and say where its
 * time and memory went.
 *
 * This is the proactive half of the `NODE_OPTIONS` workstream. Raising a ceiling is what you do when a
 * process has already died; this is what you run to find out WHY it needed the ceiling, before it does.
 * The one measurement that found the 926 MiB the `named-object-params` gate was spending on a whole-repo
 * typecheck nobody read was a hand-written phase report bolted to that one gate — so the finding was
 * available only to whoever thought to look at that one file. This verb is that instrument, generalised.
 *
 * Effectful shell only: the spawn, the temp directory, the profile reads and the baseline file. The flag
 * parsing, the subject resolution, the folds and the rendering are pure and live beside it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRootFromDirectory } from "#lib/gitRepo.js";
import { type Logger, logger } from "#lib/logger.js";
import { JSON_REFUSE_BYTES, safeJsonParse } from "#lib/safeJson.js";
import { lintChecks } from "../../../devLint/devLint.js";
import { FLOOR_BASE_ENV } from "../../../devLint/gitAtCommit.js";
import { resolveSeatBase } from "../../../devLint/seatLint.js";
import {
  comparePerf,
  type PerfBaseline,
  type PerfRecord,
  perfBaselineSchema,
  withRecord,
} from "../../../perf/baseline.js";
import { parsePhaseLines, peakPhaseMib } from "../../../perf/phaseLines.js";
import { profileBase, profileEnv, profileRequest, resolveSubject, type SpawnPlan } from "../../../perf/subject.js";
import {
  cpuProfileSchema,
  cpuSelfTimeByModule,
  heapProfileSchema,
  heapSelfSizeByModule,
  type ModuleCost,
  mergeCosts,
  splitIdle,
} from "../../../perf/v8Profile.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  DEV_PROFILE_USAGE,
  failedSubjectLine,
  type ProfileRun,
  parseDevProfileArgs,
  renderProfile,
  splitAtDoubleDash,
} from "./profileCore.js";

/** Where the committed baseline lives, relative to the repository root. */
const BASELINE_RELATIVE = join(".baselines", "perf-baseline.json");

/** An empty baseline, for the first run and for an unreadable file. */
const EMPTY_BASELINE: PerfBaseline = { subjects: [] };

/**
 * Read the committed baseline, treating an absent or unparseable file as empty.
 *
 * Empty rather than a refusal on purpose: the document exists to say what a subject cost last time, and a
 * first run has no last time. A malformed one is reported by the caller and still does not stop the
 * measurement, which is the part the operator actually came for.
 */
function readBaseline({ path }: { path: string }): { readonly baseline: PerfBaseline; readonly warning?: string } {
  if (!existsSync(path)) {
    return { baseline: EMPTY_BASELINE };
  }
  const parsed = perfBaselineSchema.safeParse(
    safeJsonParse({ label: BASELINE_RELATIVE, text: readFileSync(path, "utf8") }),
  );
  if (!parsed.success) {
    return { baseline: EMPTY_BASELINE, warning: `${BASELINE_RELATIVE} did not parse; treating it as empty` };
  }
  return { baseline: parsed.data };
}

/**
 * A V8 document past this many bytes is SKIPPED rather than parsed, with a line saying so.
 *
 * `safeJsonParse` THROWS above `JSON_REFUSE_BYTES`, and here that would abort the whole run after the
 * subject had already been measured — losing the heap phases, which are the half that does not depend on
 * this file at all. MEASURED: `dev profile --gate named-object-params --cpu` wrote an 86.7 MB
 * `.cpuprofile` for a 39.7 s subject at V8's default 1000 µs interval, so a five-minute lane crosses the
 * refusal by construction. The answer for a long subject is `--interval`, and this is what says so.
 * Reproduce: `slopweaver dev profile --gate named-object-params --cpu`.
 */
const PROFILE_SKIP_BYTES = JSON_REFUSE_BYTES;

/**
 * Fold every V8 document the run left in the profile directory.
 *
 * Every file is folded, not just the first: `tsx` and `vitest` both spawn children, and each writes its own
 * document — so a profile that read one file would report a fraction of the work and call it the whole.
 */
function foldProfiles({ dir, warn }: { dir: string; warn: (line: string) => void }): {
  readonly cpu: readonly ModuleCost[];
  readonly allocation: readonly ModuleCost[];
  readonly skipped: number;
} {
  if (!existsSync(dir)) {
    return { allocation: [], cpu: [], skipped: 0 };
  }
  let skipped = 0;
  const cpuFolds: (readonly ModuleCost[])[] = [];
  const heapFolds: (readonly ModuleCost[])[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const bytes = statSync(path).size;
    if (bytes > PROFILE_SKIP_BYTES) {
      skipped += 1;
      warn(
        `${name} is ${String(Math.round(bytes / 1024 / 1024))} MiB, past what a single JS string may hold — ` +
          "skipped. Re-run with a coarser --interval; the heap phases below are unaffected.",
      );
      continue;
    }
    const document = safeJsonParse({ label: name, text: readFileSync(path, "utf8") });
    const cpu = cpuProfileSchema.safeParse(document);
    if (cpu.success) {
      cpuFolds.push(cpuSelfTimeByModule({ document: cpu.data }));
      continue;
    }
    const heap = heapProfileSchema.safeParse(document);
    if (heap.success) {
      heapFolds.push(heapSelfSizeByModule({ document: heap.data }));
    }
  }
  return { allocation: mergeCosts({ folds: heapFolds }), cpu: mergeCosts({ folds: cpuFolds }), skipped };
}

/** Spawn the subject under the instruments and collect everything it produced. */
function measure({
  baseEnv,
  plan,
  cwd,
  cpu,
  heapProfile,
  intervalMicros,
  warn,
}: {
  baseEnv: Readonly<Record<string, string>>;
  plan: SpawnPlan;
  cwd: string;
  cpu: boolean;
  heapProfile: boolean;
  intervalMicros: number | undefined;
  warn: (line: string) => void;
}): ProfileRun {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-profile-"));
  try {
    const startedAt = performance.now();
    const outcome = spawnSync(plan.cmd, [...plan.args], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        ...plan.env,
        ...baseEnv,
        ...profileEnv({ cpu, heapProfile, inherited: process.env["NODE_OPTIONS"], intervalMicros, profileDir: dir }),
      },
      maxBuffer: 256 * 1024 * 1024,
    });
    const wallMs = performance.now() - startedAt;
    const phases = parsePhaseLines({ text: `${outcome.stdout}\n${outcome.stderr}` });
    const folded = foldProfiles({ dir, warn });
    return {
      allocation: folded.allocation,
      cpu: folded.cpu,
      exitCode: exitCodeOf({ status: outcome.status }),
      peakHeapMib: peakPhaseMib({ readings: phases }),
      phases,
      plan,
      skippedDocuments: folded.skipped,
      wallMs,
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * A child that a signal killed reports a `null` status rather than a code, and that is this verb failing
 * rather than the subject exiting — it is named here instead of coalesced away.
 */
function exitCodeOf({ status }: { status: number | null }): number {
  if (status === null) {
    return EXIT_ERROR;
  }
  return status;
}

/** `undefined` is not JSON, so a reading the run never took is stored as an explicit `null`. */
function storedOrNull({ measured }: { measured: number | undefined }): number | null {
  if (measured === undefined) {
    return null;
  }
  return measured;
}

/**
 * This run, in the shape the baseline stores — module tables capped so the document stays a summary.
 *
 * The CPU table is the BUSY split, the same one the report prints: `(idle)` is where the process was
 * waiting rather than a module that cost anything, so storing it would make the top row of every
 * I/O-bound subject the same word and push a real module off the list. MEASURED on
 * `slopweaver dev profile --gate named-object-params --cpu --record`: idle was 67.0%, so the stored
 * table led with `(idle) 0.6704` and gave `node_modules/typescript` 0.1848 rather than its real 0.561
 * of the work.
 */
function asRecord({ run, nowIso }: { run: ProfileRun; nowIso: string }): PerfRecord {
  const { busy } = splitIdle({ costs: run.cpu });
  const heaviest = busy.length > 0 ? busy : run.allocation;
  return {
    label: run.plan.label,
    peakHeapMib: storedOrNull({ measured: run.peakHeapMib }),
    phases: run.phases.map((phase) => ({
      label: phase.label,
      liveMib: storedOrNull({ measured: phase.liveMib }),
    })),
    recordedAt: nowIso.slice(0, 10),
    topModules: heaviest.slice(0, 5).map((cost) => ({ module: cost.module, share: Number(cost.share.toFixed(4)) })),
    wallMs: Math.round(run.wallMs),
  };
}

/**
 * Compare the run to the committed baseline, print it, and write the baseline back under `--record`.
 *
 * Split from {@link runDevProfileWithDeps} because everything above it either refuses or measures, and
 * everything here reads one document and writes it — the body cap made the seam, and the seam was real.
 */
function report({
  run,
  root,
  values,
  top,
  log,
}: {
  run: ProfileRun;
  root: string;
  values: Readonly<Record<string, string | boolean>>;
  top: number;
  log: Pick<Logger, "error" | "out" | "warn">;
}): number {
  const baselinePath = join(root, BASELINE_RELATIVE);
  const { baseline, warning } = readBaseline({ path: baselinePath });
  if (warning !== undefined) {
    log.warn({ msg: warning });
  }
  const comparison = comparePerf({
    baseline,
    label: run.plan.label,
    peakHeapMib: run.peakHeapMib,
    wallMs: run.wallMs,
  });
  if (values["json"] === true) {
    log.out({ line: JSON.stringify({ comparison, run }) });
  } else {
    for (const line of renderProfile({ comparison, run, top })) {
      log.out({ line });
    }
  }
  const failure = failedSubjectLine({ run });
  if (failure !== undefined) {
    log.error({ msg: failure });
    return EXIT_ERROR;
  }
  if (values["record"] === true) {
    const next = withRecord({ baseline, record: asRecord({ nowIso: new Date().toISOString(), run }) });
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    log.out({ line: `recorded ${run.plan.label} into ${BASELINE_RELATIVE}` });
  }
  if (values["check"] === true && comparison.heap.regressed) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Print each reason and then the usage, as a caller mistake refused before anything is measured.
 *
 * @param log the sink the reasons go to
 * @param reasons what about the invocation was wrong
 * @returns EXIT_USAGE
 */
function refuseUsage({ log, reasons }: { log: Pick<Logger, "error">; reasons: readonly string[] }): number {
  [...reasons, DEV_PROFILE_USAGE].forEach((line) => {
    log.error({ msg: line });
  });
  return EXIT_USAGE;
}

/**
 * Run the profile verb over an injected logger — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev profile <tail>`)
 * @param log the diagnostic + data sinks
 * @returns EXIT_OK when the run completed and `--check` found no heap regression, EXIT_ERROR on a
 *   regression, a subject that could not be resolved or one that exited non-zero, EXIT_USAGE on a bad flag
 */
export async function runDevProfileWithDeps({
  argv,
  log,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "info" | "out" | "warn">;
}): Promise<number> {
  const whole = argv.slice(4);
  if (whole.includes("--help") || whole.includes("-h")) {
    log.out({ line: DEV_PROFILE_USAGE });
    return EXIT_OK;
  }
  const { head, tail } = splitAtDoubleDash({ rest: whole });
  const parsed = parseDevProfileArgs({ rest: head });
  if (parsed.isErr()) {
    return refuseUsage({ log, reasons: parsed.error });
  }
  const { values } = parsed.value;
  const request = profileRequest({ tail, values });
  if (request.isErr()) {
    return refuseUsage({ log, reasons: [request.error.message] });
  }
  const root = repoRootFromDirectory({ dir: process.cwd() });
  const plan = resolveSubject({
    binDir: join(root, "node_modules", ".bin"),
    checks: lintChecks({ cwd: root }),
    subject: request.value.subject,
  });
  if (plan.isErr()) {
    log.error({ msg: plan.error.message });
    return EXIT_ERROR;
  }
  const base = profileBase({
    inherited: process.env[FLOOR_BASE_ENV],
    resolve: () => resolveSeatBase({ cwd: root }),
    subject: request.value.subject,
  });
  if (base.isErr()) {
    log.error({ msg: base.error });
    return EXIT_ERROR;
  }
  log.info({ msg: base.value.line });
  const run = measure({
    baseEnv: base.value.env,
    cpu: values["cpu"] === true,
    cwd: root,
    heapProfile: values["heap-prof"] === true,
    intervalMicros: request.value.intervalMicros,
    plan: plan.value,
    warn: (line) => {
      log.warn({ msg: line });
    },
  });
  return report({ log, root, run, top: request.value.top, values });
}

/**
 * Run the profile verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev profile <tail>`)
 * @returns the process exit code — see {@link runDevProfileWithDeps}
 */
export async function runDevProfile(argv: readonly string[]): Promise<number> {
  return runDevProfileWithDeps({ argv, log: logger });
}

export const devProfileCommand = defineCommand({ run: runDevProfile });
