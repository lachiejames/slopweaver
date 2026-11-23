/**
 * `slopweaver machine capacity` — read the top memory footprints, swap, load, the VM compressor's segment
 * usage and the swapfile count off the real machine, classify each process as this checkout's own fleet or
 * foreign, and print a one-line verdict NAMING the subject it graded. When a foreign process or swap crosses
 * its threshold, publish a `capacity-alert` onto the supervisor stream; when the compressor, the swapfile
 * count or the 1-minute load crosses its HOLD threshold, publish a `capacity-hold` (a hold on boots in flight
 * alone holds a spawn and publishes nothing — `streamEvents`) — the §7 sweep contract
 * runs this every tick, so a briefing that never opens a screen still sees the mds case this verb was built
 * for, and the fill step reads `hold` before it spawns (the panic and the load reading,
 * `../../../live/machine/capacity.ts`'s threshold headers).
 *
 * `--wait` waits for a HOLD to clear on the one wait contract (`../../../live/machine/capacityWait.ts`).
 *
 * Effectful shell only; the parsing, classification and verdict are `../../../live/machine/capacity.ts`.
 */
import { buildCeilingsReading, type CeilingsReading, type PlanCeilingInputs } from "../../../capacity/ceilings.js";
import { ceilingLines } from "../../../capacity/ceilingsRender.js";
import { readPlanCeilings } from "../../../capacity/readCeilings.js";
import { slopweaverHome } from "../../../config.js";
import type { SupervisorEvent } from "../../../events/event.js";
import { publishSupervisorEvent } from "../../../events/store.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { DEFAULT_TOP_N, type MachineCapacityReport } from "../../../live/machine/capacity.js";
import { briefCapacityJson, renderBriefMachineCapacityLines } from "../../../live/machine/capacityBrief.js";
import { machineCapacityJson, renderMachineCapacityLines } from "../../../live/machine/capacityRender.js";
import { readMachineCapacity, waitForCapacityClear } from "../../../live/machine/capacityWait.js";
import { dispatchBlockFor } from "../../../live/machine/dispatchBlock.js";
import { type MachineCapacityDeps, productionMachineCapacityDeps } from "../../../live/machine/read.js";
import { machineHoldStands } from "../../../live/machine/recentBoots.js";
import { type SpawnBackoffReport, spawnBackoffLine, spawnBackoffStatus } from "../../../live/machine/spawnBackoff.js";
import { readSpawnBackoffState } from "../../../live/machine/spawnBackoffStore.js";
import { parseWaitOptions, WAIT_FLAG_SPEC, type WaitOptions } from "../../../wait/flags.js";
import { realWaitClock, type WaitClock } from "../../../wait/loop.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { MACHINE_CAPACITY_USAGE } from "./capacityUsage.js";

const FLAGS: FlagSpec = {
  boolean: ["brief", "full", "json", ...WAIT_FLAG_SPEC.boolean],
  string: ["home", "top", ...WAIT_FLAG_SPEC.string],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const MACHINE_CAPACITY_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FLAGS }),
  ...booleanFlagsOf({ spec: FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `machine capacity`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseMachineCapacityArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/**
 * The report as `machine` stream events: a `capacity-hold` when the compressor, the swapfile count or the
 * 1-minute load crossed its hold threshold, a `capacity-alert` when a foreign hog or swap crossed its alert
 * threshold, both when both did, and nothing when neither — the sweep reads the newest of each kind.
 *
 * `holdOn` carries which SUBJECT held, because a stream row whose `where` column always read `compressor`
 * would reproduce, one hop out, the exact defect the subject-naming verdict fixes.
 *
 * A hold on boots in flight or the disk floor ALONE publishes nothing: boots clear themselves inside their
 * window, the disk floor is cleared by `worktree prune`, and a sweep reacting to either would seat an
 * investigation that is one more boot on one more worktree (`../../../live/machine/recentBoots.ts`).
 */
function streamEvents({
  report,
  nowIso,
}: {
  report: MachineCapacityReport;
  nowIso: string;
}): readonly SupervisorEvent[] {
  const fleetChild = report.fleetChildAlert ? report.topFleetChild : undefined;
  // A root daemon's relief is the owner's hand step, never a command react-now offers a seat; `why` carries it.
  const seatKill = report.culprit?.endedBy === "seat" ? report.culprit.kill : undefined;
  const shared = {
    atIso: nowIso,
    culpritKill: seatKill,
    culpritSubject: report.culprit?.subject,
    fleetChildLabel: fleetChild?.label,
    fleetChildSessionId: fleetChild?.session?.sessionId,
    holdOn: report.holdSubjects.length === 0 ? undefined : report.holdSubjects.join(" and "),
    load1: report.load?.load1,
    segmentsPct: report.compressor?.segmentsPct,
    source: "machine",
    swapUsedGb: report.swap?.usedGb,
    swapfileCount: report.swapfileCount,
    topForeignGb: report.topForeign?.footprintGb,
    topForeignLabel: report.topForeign?.label,
    why: report.verdict,
  } as const;
  const events: SupervisorEvent[] = [];
  if (machineHoldStands({ hold: report.hold, holdSubjects: report.holdSubjects })) {
    events.push({ ...shared, kind: "capacity-hold" });
  }
  if (report.alert) {
    events.push({ ...shared, kind: "capacity-alert" });
  }
  return events;
}

/** `--home`/`--top`, resolved to their real defaults. */
function resolvedOptions({ values }: { values: ParsedFlags["values"] }): { home: string; topN: number } {
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const topRaw = typeof values["top"] === "string" ? Number(values["top"]) : DEFAULT_TOP_N;
  return { home, topN: Number.isSafeInteger(topRaw) && topRaw > 0 ? topRaw : DEFAULT_TOP_N };
}

/** Publish the report's stream events, when it has any. */
function publishEvents({
  report,
  home,
  nowIso,
  log,
}: {
  report: MachineCapacityReport;
  home: string;
  nowIso: string;
  log: Pick<Logger, "error" | "out">;
}): void {
  for (const event of streamEvents({ nowIso, report })) {
    const failure = publishSupervisorEvent({ event, home });
    if (failure !== undefined) {
      log.error({ msg: `machine capacity: could not publish its ${event.kind} to the supervisor stream: ${failure}` });
    }
  }
}

/**
 * Print the report, in the shape `--json` asked for.
 *
 * `--json` carries the DISPATCH REGISTER's standing beside the reading, read here in the shell. That is what
 * lets the supervisor gate judge a hold off the tick's EXISTING capacity capture instead of a thirteenth
 * source — see `../../../live/machine/dispatchBlock.ts`.
 */
function printReport({
  report,
  ceilings,
  json,
  brief,
  full,
  log,
  home,
  nowIso,
}: {
  report: MachineCapacityReport;
  ceilings: CeilingsReading;
  json: boolean;
  brief: boolean;
  full: boolean;
  log: Pick<Logger, "error" | "out">;
  home: string;
  nowIso: string;
}): void {
  const spawnBackoff = spawnBackoffReportFor({ home, nowIso });
  if (json) {
    const dispatch = dispatchBlockFor({ home, nowIso });
    const document = brief
      ? briefCapacityJson({ ceilings, dispatch, report, spawnBackoff })
      : machineCapacityJson({ ceilings, dispatch, report, spawnBackoff });
    log.out({ line: JSON.stringify(document) });
    return;
  }
  if (brief) {
    for (const line of renderBriefMachineCapacityLines({ ceilings, report, spawnBackoff })) {
      log.out({ line });
    }
    return;
  }
  // The ceilings first, so the machine's own verdict stays the last line a reader and a test both look at; the
  // spawn backoff between them, printed only while it is closing the door.
  const backoffLine = spawnBackoffLine({ report: spawnBackoff });
  const lines = [
    ...ceilingLines({ reading: ceilings }),
    ...(backoffLine === undefined ? [] : [backoffLine]),
    ...renderMachineCapacityLines({ full, report }),
  ];
  for (const line of lines) {
    log.out({ line });
  }
}

/** The fleet spawn backoff's phase at the reading, read off its state file — or why that file is unreadable. */
function spawnBackoffReportFor({ home, nowIso }: { home: string; nowIso: string }): SpawnBackoffReport {
  const state = readSpawnBackoffState({ home });
  if (state.isErr()) {
    return { message: state.error.message, phase: "unreadable" };
  }
  return spawnBackoffStatus({ nowIso, state: state.value });
}

/** Grade every plan's reading beside this machine report — the ONE ceilings reading. */
function ceilingsFor({
  report,
  plans,
  nowIso,
}: {
  report: MachineCapacityReport;
  plans: PlanCeilingInputs;
  nowIso: string;
}): CeilingsReading {
  let load1: number | null = null;
  if (report.load !== undefined) {
    load1 = report.load.load1;
  }
  let idlePct: number | null = null;
  if (report.hiddenCpu.idlePct !== undefined) {
    idlePct = report.hiddenCpu.idlePct;
  }
  return buildCeilingsReading({
    machine: { hold: report.hold, holdSubjects: report.holdSubjects, idlePct, load1, loadHold: report.loadHold },
    observedAtIso: nowIso,
    plans,
  });
}

/** How the shell reads every plan once — `readPlanCeilings`, or a test's fixed inputs. */
type PlanReader = (args: { home: string; nowIso: string }) => Promise<PlanCeilingInputs>;

/** A finding (alert or hold) exits 1 — this verb is `diagnostic` — and a clean reading exits 0. */
function findingExit({ report }: { report: MachineCapacityReport }): number {
  return report.alert || report.hold ? EXIT_ERROR : EXIT_OK;
}

/** One `--wait` status line: under --json stdout carries ONE document, so it goes to the diagnostic channel. */
function writeWaitStatus({
  json,
  line,
  log,
}: {
  json: boolean;
  line: string;
  log: Pick<Logger, "error" | "out">;
}): void {
  if (json) {
    log.error({ msg: line });
    return;
  }
  log.out({ line });
}

/**
 * The `--wait` path. The FIRST reading publishes its events exactly as a single read would; the final one
 * publishes too when the wait took more than one read, so the stream sees the state the wait ended on without
 * a row per re-read.
 */
async function runCapacityWait({
  read,
  readPlans,
  wait,
  home,
  json,
  brief,
  full,
  log,
  nowIso,
  clock,
}: {
  read: () => MachineCapacityReport;
  readPlans: PlanReader;
  wait: WaitOptions;
  home: string;
  json: boolean;
  brief: boolean;
  full: boolean;
  log: Pick<Logger, "error" | "out">;
  nowIso: () => string;
  clock: WaitClock;
}): Promise<number> {
  const status = ({ line }: { line: string }): void => {
    writeWaitStatus({ json, line, log });
  };
  let published = false;
  const outcome = await waitForCapacityClear({
    clock,
    emit: (line) => {
      status({ line });
    },
    read: () => {
      const report = read();
      if (!published) {
        publishEvents({ home, log, nowIso: nowIso(), report });
        published = true;
      }
      return report;
    },
    timeoutSeconds: wait.timeoutSeconds,
  });
  if (outcome.reads > 1) {
    publishEvents({ home, log, nowIso: nowIso(), report: outcome.reading });
  }
  // The plans are read ONCE, after the machine sample the wait ended on, never inside the poll: a plan read is
  // the slow half, and a ceiling taken at the start of a long wait would print stale beside a fresh machine.
  const finalIso = nowIso();
  const plans = await readPlans({ home, nowIso: finalIso });
  const ceilings = ceilingsFor({ nowIso: finalIso, plans, report: outcome.reading });
  printReport({ brief, ceilings, full, home, json, log, nowIso: finalIso, report: outcome.reading });
  if (outcome.kind === "timed-out") {
    status({
      line: `WAIT-TIMEOUT machine capacity HOLD on ${outcome.reading.holdSubjects.join(" and ")} still on after ${String(wait.timeoutSeconds)}s`,
    });
    return EXIT_DEFERRED;
  }
  return findingExit({ report: outcome.reading });
}

/**
 * Run the `machine capacity` verb over an injected logger and read seams — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `machine capacity <tail>`)
 * @param log the diagnostic + data sinks
 * @param nowIso the current time, for the published event
 * @param depsFor builds the read seams for a resolved `topN` and state home — defaults to the real
 *   `top`/`ps`/`sysctl`/`df`/`git` subprocesses; a test passes a fake that returns fixed text instead
 * @param clock the wait's time source — a test passes a fake so `--wait` never really sleeps
 * @param readPlans reads every Claude and Codex plan once — defaults to the real gauge reads; a test passes
 *   fixed inputs so no keychain, network or Codex app-server is touched
 * @returns `EXIT_OK` when nothing crossed an alert or hold threshold, `EXIT_ERROR` when one did (a finding,
 *   not a broken tool — this verb is `diagnostic`; `--json`'s `hold` field says which), `EXIT_USAGE` on a bad
 *   flag, and under `--wait` `EXIT_DEFERRED` when the timeout passed with the HOLD still on. A plan that could
 *   not be read never changes the exit: it is an unreadable ceiling in the report, not a machine finding.
 */
export async function runMachineCapacityWithDeps({
  argv,
  log,
  nowIso,
  depsFor = productionMachineCapacityDeps,
  clock = realWaitClock(),
  readPlans = readPlanCeilings,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
  nowIso: string;
  depsFor?: (args: { topN: number; home: string }) => MachineCapacityDeps;
  clock?: WaitClock;
  readPlans?: PlanReader;
}): Promise<number> {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: MACHINE_CAPACITY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMachineCapacityArgs({ rest }).andThen((flags) =>
    parseWaitOptions({ values: flags.values }).map((wait) => ({ values: flags.values, wait })),
  );
  if (parsed.isErr()) {
    [...parsed.error, MACHINE_CAPACITY_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return EXIT_USAGE;
  }
  const { values, wait } = parsed.value;
  const { home, topN } = resolvedOptions({ values });
  const deps = depsFor({ home, topN });
  const json = values["json"] === true;
  const brief = values["brief"] === true;
  const full = values["full"] === true;
  if (wait.wait) {
    const read = () => readMachineCapacity({ deps, topN });
    return runCapacityWait({ brief, clock, full, home, json, log, nowIso: () => nowIso, read, readPlans, wait });
  }
  // The plans are read to completion BEFORE the machine: the machine read is synchronous and would starve an
  // in-flight Claude probe past its timeout (`../../../capacity/readCeilings.ts`), and read second the machine
  // sample is the fresher of the two, which is the one a hold is judged on.
  const plans = await readPlans({ home, nowIso });
  const report = readMachineCapacity({ deps, topN });
  publishEvents({ home, log, nowIso, report });
  const ceilings = ceilingsFor({ nowIso, plans, report });
  printReport({ brief, ceilings, full, home, json, log, nowIso, report });
  return findingExit({ report });
}

/**
 * Run the `machine capacity` verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `machine capacity <tail>`)
 * @returns the process exit code — see {@link runMachineCapacityWithDeps}
 */
export async function runMachineCapacity(argv: readonly string[]): Promise<number> {
  return runMachineCapacityWithDeps({ argv, log: logger, nowIso: new Date().toISOString() });
}

export const machineCapacityCommand = defineCommand({ run: runMachineCapacity });
