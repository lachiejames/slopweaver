/**
 * `slopweaver machine watch` — THE BETWEEN-TICK WATCHER. Sample the machine, and when a reading is anomalous
 * write a finding row carrying the culprit tree and SEAT a visible investigation into it.
 *
 * ## Why this exists rather than the supervisor tick reading capacity harder
 *
 * The measurement behind it: `machine capacity` had already published a
 * `capacity-hold` naming a stalled hook, and nobody acted on it. The tick READS
 * capacity every sweep and nothing ever consumed a hold, so a louder reading would have changed nothing.
 * What was missing is a FEEDBACK LOOP — the alert has to cause work by itself, between ticks, and then
 * refuse to be forgotten (`../../../supervisor/loadDispatchGate.ts`).
 *
 * ## How this stays inside doctrine rule 2 — no headless model, anywhere
 *
 * Rule 2's property is VISIBILITY, not process count: a Slopweaver process may launch `claude` only into a
 * session the owner can see and interrupt AS IT RUNS. `cmux spawn` is named in `AGENTS.md` as tier-3
 * execution's intended shape, for exactly this reason. Three things keep this verb on the right side of it,
 * and each is built rather than promised:
 *
 * - **This process launches no model.** It opens a cmux workspace, which the owner sees in their sidebar and
 *   can interrupt; the seat's own session is the visible one.
 * - **It is bounded and foreground.** `--once` is the default. `--for-seconds` is capped HARD at
 *   {@link MAX_WATCH_SECONDS} — it cannot be asked to run longer, and the cap is below the sweep cadence, so
 *   a watch never STARTS a sample past the tick that started it. The deadline is checked between samples,
 *   so a sample that seats runs its `cmux spawn` to the end — minutes under load, which is why a caller
 *   must never wrap this verb in a short `timeout` (`./watchSeat.ts` carries the measurement).
 * - **There is no detach.** No `--detach` flag, no plist, no background fork. It dies with the tab that ran
 *   it, which is what makes it a foreground sample loop rather than a daemon by another name.
 *
 * ## What a seat actually is
 *
 * Resolve the checkout, then `slopweaver handover register --finding` (the row a SESSION registered from what
 * it observed, carrying its evidence), then `slopweaver cmux spawn <slug>`. The two verbs are real verbs
 * through the one door, and the `--finding` origin is what keeps a machine-found row from being mistaken for
 * something the owner asked for. Injected as a single seam, so a test drives the whole verb without opening a
 * workspace.
 *
 * `./watchSeat.ts` is that half, and it is its own module because it is the one with an invariant: the ORDER.
 * It also carries the measurement — the seat resolved no checkout and passed no `--repo`, so this verb
 * registered 17 board rows it could never open a session on.
 */
import { randomUUID } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";

import { slopweaverHome } from "../../../config.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { machineAnomaly } from "../../../live/machine/anomaly.js";
import { DEFAULT_TOP_N } from "../../../live/machine/capacity.js";
import { readMachineCapacity } from "../../../live/machine/capacityWait.js";
import { type DispatchRow, type DispatchSeat, dispatchLine } from "../../../live/machine/dispatchRow.js";
import {
  appendDispatchRow,
  dispatchRegisterPath,
  liveDispatchSignatures,
  readDispatchRows,
} from "../../../live/machine/dispatchStore.js";
import { type MachineCapacityDeps, productionMachineCapacityDeps } from "../../../live/machine/read.js";
import { watchDecision } from "../../../live/machine/watchDecision.js";
import { realWaitClock, type WaitClock } from "../../../wait/loop.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { productionSeat } from "./watchSeat.js";

/**
 * The longest a single `machine watch` may run, in seconds. A HARD cap rather than a default: it sits below
 * the sweep cadence so one watch never starts a sample past the tick that started it, which is the concrete thing
 * separating a bounded foreground sampler from a resident daemon (doctrine rule 2).
 */
export const MAX_WATCH_SECONDS = 900;

/** The shortest gap between samples. Each sample spends ~1.5s in `top -l 2 -s 1`; below this it is a spin. */
export const MIN_INTERVAL_SECONDS = 30;

/** The gap between samples when `--interval-seconds` does not say. */
export const DEFAULT_INTERVAL_SECONDS = 60;

export const MACHINE_WATCH_USAGE =
  "usage: slopweaver machine watch [--once] [--for-seconds <n>] [--interval-seconds <n>] [--home <dir>] [--json]\n" +
  "  Sample the machine between supervisor ticks and DISPATCH an investigation when a reading is anomalous:\n" +
  "  a capacity HOLD, one process sustaining 3 cores for 2 minutes, one session tree over 40 NON-HOOK\n" +
  "  processes, or fseventsd over 1 GB. Every anomalous reading writes a finding row carrying the culprit tree; only the SEAT is\n" +
  "  rate-limited, by a backoff that doubles on each consecutive unsettled dispatch of one signature.\n" +
  "  --once takes exactly one sample and is the default. --for-seconds runs a bounded FOREGROUND loop, " +
  `capped\n  hard at ${String(MAX_WATCH_SECONDS)}s: there is no detached mode, by doctrine rule 2.\n` +
  "  Exit 1 when a dispatch was written (a finding, not a broken tool), 0 when every sample read clear.";

const BOOLEAN_FLAGS = ["once", "json"] as const;
const STRING_FLAGS = ["home", "for-seconds", "interval-seconds"] as const;

const FLAGS: FlagSpec = { boolean: [...BOOLEAN_FLAGS], string: [...STRING_FLAGS] };

/** `--`-prefixed, for the help-truth ratchet. */
export const MACHINE_WATCH_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `machine watch`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseMachineWatchArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** Everything this verb touches outside itself, injected so a test drives it without a machine or a seat. */
export interface MachineWatchDeps {
  /** Builds the capacity read seams for a resolved `topN` and state home. */
  readonly depsFor: (args: { topN: number; home: string }) => MachineCapacityDeps;
  /**
   * Opens a VISIBLE investigation and reports what it opened, or why it could not — `./watchSeat.ts`. It MUST
   * call `recordRegistered` once the board row exists and before the spawn: that is what leaves the dispatch
   * id the board row cites in the register when a caller's timeout kills this process mid-spawn.
   */
  readonly seat: (args: {
    row: DispatchRow;
    recordRegistered: (args: { slug: string }) => void;
  }) => Promise<DispatchSeat>;
  /** The signatures an investigation is currently live on — a liveness fact, read off cmux. */
  readonly liveSignatures: () => ReadonlySet<string>;
  readonly now: () => string;
  readonly clock: WaitClock;
  readonly newId: () => string;
}

/** A positive integer flag value, or `undefined` when it was absent or not one. */
function positiveInt({ values, name }: { values: ParsedFlags["values"]; name: string }): number | undefined {
  const raw = values[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

/** How long this watch runs and how often it samples, with both bounds applied. */
function boundsOf({ values }: { values: ParsedFlags["values"] }): {
  forSeconds: number;
  intervalSeconds: number;
  capped: boolean;
} {
  const askedFor = positiveInt({ name: "for-seconds", values });
  const askedInterval = positiveInt({ name: "interval-seconds", values });
  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
  if (askedInterval !== undefined) {
    intervalSeconds = Math.max(MIN_INTERVAL_SECONDS, askedInterval);
  }
  if (askedFor === undefined) {
    // `--once` is the default shape, expressed as a zero-length window: exactly one sample, no sleep.
    return { capped: false, forSeconds: 0, intervalSeconds };
  }
  return { capped: askedFor > MAX_WATCH_SECONDS, forSeconds: Math.min(askedFor, MAX_WATCH_SECONDS), intervalSeconds };
}

/** The row one anomalous sample writes, seat and all. */
async function rowFor({
  decision,
  deps,
  load1,
  home,
  log,
}: {
  decision: ReturnType<typeof watchDecision> & { kind: "dispatch" };
  deps: MachineWatchDeps;
  load1: number | undefined;
  home: string;
  log: Pick<Logger, "error">;
}): Promise<DispatchRow> {
  const base: DispatchRow = {
    id: deps.newId(),
    load1,
    observedIso: deps.now(),
    seated: { kind: "none", why: "not yet decided" },
    settled: undefined,
    signature: decision.anomaly.signature,
    subject: decision.anomaly.subject,
    triggers: decision.anomaly.triggers,
  };
  if (decision.seat.kind === "skip") {
    return { ...base, seated: decision.seat.seated };
  }
  // The seat is opened against the row so the investigation can cite the id it is answering — and that id is
  // in the register from the moment the board row cites it, before the slow spawn — `./watchSeat.ts` — for
  // every reader that knows the `registered` arm (an older one drops the line: `DispatchSeat` says so).
  const recordRegistered = ({ slug }: { slug: string }): void => {
    const written = appendDispatchRow({
      home,
      row: { ...base, seated: { kind: "registered", sinceIso: deps.now(), slug } },
    });
    if (written.isErr()) {
      for (const line of written.error) {
        log.error({ msg: `machine watch: ${line} — the seat carries on; its final row is still appended` });
      }
    }
  };
  return { ...base, seated: await deps.seat({ recordRegistered, row: base }) };
}

/**
 * Re-state, AFTER the final append, a settlement that landed while the seat was spawning.
 *
 * The register's fold keeps a settlement sticky, but a reader built before the `registered` arm drops every
 * line carrying that arm — a mid-spawn settle's line included — and would read the final line as open. This
 * NARROWS that case for such a reader; it cannot close it. `machine dispatches settle` reads, then appends, with
 * no lock, so a settle that read the `registered` line and appends after this check still leaves an old reader
 * a settled row that reads open, as does a watch killed between its final append and this one. This binary's
 * reader is exact in every interleaving, because its fold keeps a settlement sticky; the old reader's residue
 * is the stale-seat class (`src/cli/staleSeat.ts`) and ends when that seat's checkout syncs.
 */
function restateLateSettlement({ home, row }: { home: string; row: DispatchRow }): Result<void> {
  if (row.settled !== undefined) {
    return ok(undefined);
  }
  const recorded = readDispatchRows({ home });
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  const settled = recorded.value.find((entry) => entry.id === row.id)?.settled;
  if (settled === undefined) {
    return ok(undefined);
  }
  return appendDispatchRow({ home, row: { ...row, settled } });
}

/** Take one sample, write what it found, and report whether it found anything. */
async function sampleOnce({
  deps,
  home,
  topN,
  log,
  json,
}: {
  deps: MachineWatchDeps;
  home: string;
  topN: number;
  log: Pick<Logger, "error" | "out">;
  json: boolean;
}): Promise<boolean> {
  const report = readMachineCapacity({ deps: deps.depsFor({ home, topN }), topN });
  const anomaly = machineAnomaly({ report });
  const existing = readDispatchRows({ home });
  if (existing.isErr()) {
    for (const line of existing.error) {
      log.error({ msg: `machine watch: ${line}` });
    }
  }
  let rows: readonly DispatchRow[] = [];
  if (existing.isOk()) {
    rows = existing.value;
  }
  const decision = watchDecision({
    anomaly,
    liveSignatures: deps.liveSignatures(),
    nowIso: deps.now(),
    rows,
  });
  if (decision.kind === "nothing") {
    if (!json) {
      log.out({ line: `machine watch: clear — ${report.verdict}` });
    }
    return false;
  }
  const row = await rowFor({ decision, deps, home, load1: report.load?.load1, log });
  const written = appendDispatchRow({ home, row }).andThen(() => restateLateSettlement({ home, row }));
  if (written.isErr()) {
    for (const line of written.error) {
      log.error({ msg: `machine watch: ${line}` });
    }
  }
  if (json) {
    log.out({ line: JSON.stringify(row) });
    return true;
  }
  log.out({ line: `machine watch: DISPATCH ${dispatchLine({ row })}` });
  log.out({ line: `  register: ${dispatchRegisterPath({ home })}` });
  for (const process of row.subject.tree) {
    log.out({
      line: `    ${String(process.cpuPct).padStart(6)}%  ${process.label} (pid ${String(process.pid)})`,
    });
  }
  return true;
}

/**
 * Run `machine watch` over injected seams — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `machine watch <tail>`)
 * @param log the diagnostic + data sinks
 * @param deps the capacity read, the seat, the liveness read and the clock
 * @returns `EXIT_OK` when every sample read clear, `EXIT_ERROR` when at least one dispatch was written (a
 *   finding, not a broken tool — this verb is `diagnostic`), `EXIT_USAGE` on a bad flag
 */
export async function runMachineWatchWithDeps({
  argv,
  log,
  deps,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
  deps: MachineWatchDeps;
}): Promise<number> {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: MACHINE_WATCH_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMachineWatchArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, MACHINE_WATCH_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const json = values["json"] === true;
  const { forSeconds, intervalSeconds, capped } = boundsOf({ values });
  if (capped) {
    log.error({
      msg:
        `machine watch: --for-seconds is capped at ${String(MAX_WATCH_SECONDS)}s and was clamped to it — ` +
        "a watch that could outlive the tick that started it would be a resident daemon (doctrine rule 2).",
    });
  }
  const deadlineMs = deps.clock.nowMs() + forSeconds * 1000;
  let dispatched = false;
  // Always at least one sample: `--once` is a zero-length window rather than a separate code path.
  for (;;) {
    if (await sampleOnce({ deps, home, json, log, topN: DEFAULT_TOP_N })) {
      dispatched = true;
    }
    if (deps.clock.nowMs() + intervalSeconds * 1000 > deadlineMs) {
      break;
    }
    await deps.clock.sleep({ ms: intervalSeconds * 1000 });
  }
  return dispatched ? EXIT_ERROR : EXIT_OK;
}

/**
 * The real seams: the machine, the board, and a visible cmux workspace.
 *
 * @param home the Slopweaver home the register and the board live under
 * @returns the production {@link MachineWatchDeps}
 */
export function productionMachineWatchDeps({ home }: { home: string }): MachineWatchDeps {
  return {
    clock: realWaitClock(),
    depsFor: productionMachineCapacityDeps,
    liveSignatures: () => {
      // The signature an open investigation is on is carried by its own register row, so liveness is read
      // from the register rather than from cmux titles — reading cmux would add a second notion of the same
      // fact. `liveDispatchSignatures` carries which rows count.
      const rows = readDispatchRows({ home });
      if (rows.isErr()) {
        return new Set<string>();
      }
      return liveDispatchSignatures({ nowMs: Date.now(), rows: rows.value });
    },
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    seat: productionSeat({ home }),
  };
}

/**
 * Run the `machine watch` verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `machine watch <tail>`)
 * @returns the process exit code — see {@link runMachineWatchWithDeps}
 */
export async function runMachineWatch(argv: readonly string[]): Promise<number> {
  const homeIndex = argv.indexOf("--home");
  let home = slopweaverHome();
  const supplied = argv[homeIndex + 1];
  if (homeIndex >= 0 && supplied !== undefined) {
    home = supplied;
  }
  return runMachineWatchWithDeps({ argv, deps: productionMachineWatchDeps({ home }), log: logger });
}

export const machineWatchCommand = defineCommand({ run: runMachineWatch });
