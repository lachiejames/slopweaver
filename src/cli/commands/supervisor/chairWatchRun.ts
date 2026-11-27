/**
 * `slopweaver supervisor chair-watch` — ONE read-only pass over the pinned chair's hand-off cadence, for the control
 * plane to call on its own timer. Never a loop, and never the chair model's judgement: this report decides whether
 * the chair hands off (`../../../supervisor/chairWatch.ts`), and `supervisor hand-off` acts only on one it re-read.
 * The pass itself is `./chairWatchPass.ts`, over injected reads; this verb wires the production ones.
 *
 * ## What it reads, and what it never does
 *
 * The chair the way the chair gate reads it — the records first (`./chairGateRecorded.ts`: the pin and the chain
 * journal), then the pinned chair (cmux's workspace list, `ps`, the transcript tail, the app's `session.origin`) and
 * the plan lanes — and NOTHING the gate does on refusal: it never types `/model fable` into a workspace, never records
 * a restore attempt and never asks telemetry the metered question. The cadence is the tick's own
 * (`./tickRecordCadence.ts` `judgeChairCadenceOn`) over the reads a tick makes — transcripts for auto-compactions,
 * `git log origin/main` against the last fetch for canon (never a fetch), `ps`/`lsof` for each session's boot plan,
 * `claude --version` for the installed Claude Code — but on a gauge built from RECORDED readings only
 * (`../../../supervisor/chairWatchGauge.ts`: each plan's last snapshot and the spend ledger), because each `claude
 * gauge` probe spends a token and this runs on a timer. The hold journal is read, never appended.
 *
 * **Two reads differ from the tick's, so the watch writes nothing.** The live Codex seat decision files sign-in
 * observations and the fleet-cap record and writes a temporary `read.tcl`, so the watch wires
 * `recordedCodexSeatRead` instead: a Codex pick stands as the successor's vendor, with no alias and a note saying its
 * live seat read happens in `supervisor hand-off`, whose own fresh pass uses {@link handOffChairWatchDeps}. And every
 * register read (the lanes, the boot plans, the Claude side — the register plus one file's existence — and the
 * successor's host) goes through `readOnlyPlanRegisterPort`: an ordinary read catches a `behind` store up and imports
 * a not-yet-imported register file, and this one refuses both, so such a store reads as an unread register.
 *
 * **The residue, stated.** Opening the store selects it (`../../../store/config.ts`'s `storeUrlSelection`), as every
 * store read does, and `claude --version` runs whatever `claude` is first on `PATH`.
 *
 * The usage watch reads the desktop app's `usage.read` over its socket, the same request `cmux usage --harness app`
 * makes, and an app that does not answer is a gap line, never a failure of the pass.
 *
 * ## Exit codes
 *
 * `0` on any completed pass, whatever its status — a HAND-OFF is a report, not a fault — and a register, snapshot,
 * hold or app that could not be read is a note or gap in the report. `EXIT_USAGE` only for argv it cannot parse.
 */
import { readClaudePlanUsageSnapshot } from "../../../claude/planUsageSnapshotStore.js";
import { readClaudePlanSpends } from "../../../claude/spendBudgets.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { readLaneShapes } from "../../../plans/laneShapeRead.js";
import { type PlanRegisterPort, planRegisterPort, readOnlyPlanRegisterPort } from "../../../plans/port.js";
import type { AppHarnessResponse } from "../../../sessionHarness/appProtocol.js";
import {
  APP_SOCKET_ROOT,
  type AppTransportFailure,
  socketAppTransport,
} from "../../../sessionHarness/appSocketTransport.js";
import {
  productionClaudeCodeVersionDeps,
  readChairAutoCompactions,
  readChairClaudeCodeVersions,
  readClaudeCodeVersions,
  readLiveChairCanon,
  readLiveChairCanonSince,
} from "../../../supervisor/chairCadenceRead.js";
import { readChairHandOffHold } from "../../../supervisor/chairHandOffHold.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { chairWatchLines } from "../../../supervisor/chairWatchLines.js";
import type { ChairWatchAppUsageRead } from "../../../supervisor/chairWatchUsageWatch.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { productionChairGateDeps } from "./chairGateRun.js";
import { liveChairBootPlanRead, liveChairClaudeSideRead, liveChairCodexSeatRead } from "./chairSuccessorReads.js";
import { type ChairWatchDeps, readChairWatch, recordedCodexSeatRead, thrownName } from "./chairWatchPass.js";
import { CHAIR_WATCH_USAGE } from "./chairWatchUsage.js";
import type { TickCadenceReads } from "./tickRecordCadence.js";

/**
 * How long the app's usage read may take. It is one in-memory fold in the app, and a watch on a timer must not sit
 * out the 30 s `cmux usage` allows a person typing it: an app this slow reads as a gap.
 */
const APP_USAGE_TIMEOUT_MS = 10_000;

/** The flags `chair-watch` takes, exported so the help-truth sweep derives its advertised list from them. */
export const CHAIR_WATCH_FLAG_SPEC = { boolean: ["json"], value: ["home"] } as const satisfies FlagTailSpec;

/** What one parsed invocation asks for. */
interface ChairWatchOptions {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `chair-watch`'s flag tail. No I/O.
 *
 * @param rest the flag tail after `supervisor chair-watch`
 * @returns the options, or every rejection
 */
export function parseChairWatchOptions({ rest }: { rest: readonly string[] }): Result<ChairWatchOptions> {
  return parseFlagTail({ rest, spec: CHAIR_WATCH_FLAG_SPEC }).map(({ flags, values }) => ({
    home: values["home"],
    json: flags.has("json"),
  }));
}

/**
 * The app's answer to `usage.read` as the watch reads it, naming a failure by its kind and code only.
 *
 * @param answered what the socket transport returned
 * @returns the report, or why there is none
 */
export function appUsageReadOf({
  answered,
}: {
  answered: Result<AppHarnessResponse, AppTransportFailure>;
}): ChairWatchAppUsageRead {
  if (answered.isErr()) {
    const failure = answered.error;
    if (failure.kind === "unreachable") {
      return { kind: "failed", why: `the desktop app did not answer (${failure.causeCode})` };
    }
    if (failure.kind === "refused" && failure.code === "BAD_REQUEST") {
      return { kind: "failed", why: "this desktop app predates usage; update it" };
    }
    if (failure.kind === "refused") {
      return { kind: "failed", why: `the desktop app refused the usage read (${failure.code})` };
    }
    return { kind: "failed", why: "the desktop app's usage answer was malformed" };
  }
  if (answered.value.kind !== "usage") {
    return { kind: "failed", why: `the desktop app answered ${answered.value.kind}, not usage` };
  }
  return { kind: "report", report: answered.value.report };
}

/** Who the production reads are for: the read-only timer pass, or the hand-off about to seat a successor. */
type ChairWatchReader = "watch" | "hand-off";

/**
 * The tick's own cadence reads: the same Claude Code, canon, auto-compaction, boot-plan, register and Claude-side
 * reads `supervisor tick-record` makes, over the register port the reader is given, and the Codex seat read it names —
 * {@link recordedCodexSeatRead} for the read-only watch, the live decision for `supervisor hand-off`, which may record.
 *
 * @param reader `watch` reads nothing for a Codex pick; `hand-off` asks the spawn's own seat decision
 * @param port the plan register every register read goes through
 * @returns the production cadence reads
 */
function productionCadenceReads({
  reader,
  port,
}: {
  reader: ChairWatchReader;
  port: PlanRegisterPort;
}): TickCadenceReads {
  let readCodexSeat = recordedCodexSeatRead;
  if (reader === "hand-off") {
    readCodexSeat = liveChairCodexSeatRead({ port });
  }
  return {
    readChairAutoCompactions: ({ chair }) => readChairAutoCompactions({ claudeHome: claudeHomeDir(), read: chair }),
    readChairCanon: readLiveChairCanon,
    readChairPlans: liveChairBootPlanRead({ port }),
    readClaudeCode: ({ chair }) => ({
      ...readClaudeCodeVersions({ deps: productionClaudeCodeVersionDeps() }),
      perSession: readChairClaudeCodeVersions({ claudeHome: claudeHomeDir(), read: chair }),
    }),
    readClaudeSide: liveChairClaudeSideRead({ port }),
    readCodexChairCanon: ({ bootedIso }) => readLiveChairCanonSince({ bootedIso, cwd: process.cwd() }),
    readCodexSeat,
    readPlanRegister: ({ home }) => port.read({ home }),
  };
}

/**
 * The production reads for one reader. The watch's every register read — the lanes, the boot plans, the Claude side,
 * the successor's host — goes through {@link readOnlyPlanRegisterPort}, which never imports, writes or catches the
 * store up; the hand-off's through the ordinary port.
 */
function chairWatchDepsFor({ reader }: { reader: ChairWatchReader }): ChairWatchDeps {
  let port = readOnlyPlanRegisterPort();
  if (reader === "hand-off") {
    port = planRegisterPort();
  }
  return {
    cadenceReads: productionCadenceReads({ port, reader }),
    chairReads: ({ home }) => ({
      ...productionChairGateDeps({ argv: ["--home", home] }),
      readLanes: async () => readLaneShapes({ home, nowIso: new Date().toISOString(), read: port.read }),
    }),
    nowIso: () => new Date().toISOString(),
    readAppUsage: async () => {
      try {
        return appUsageReadOf({
          answered: await socketAppTransport({ root: APP_SOCKET_ROOT })({
            request: { kind: "usage.read" },
            timeoutMs: APP_USAGE_TIMEOUT_MS,
          }),
        });
      } catch (error: unknown) {
        return { kind: "failed", why: `the desktop app's socket threw (${thrownName({ error })})` };
      }
    },
    readHold: ({ home }) => readChairHandOffHold({ home }),
    readSnapshot: ({ alias, home }) => readClaudePlanUsageSnapshot({ alias, home }).mapErr((error) => error.message),
    readSpends: ({ accounts, home, nowIso }) => readClaudePlanSpends({ accounts, home, nowIso }),
  };
}

/**
 * The real reads `supervisor chair-watch` makes, READ-ONLY: the gate's chair reads for the home, the tick's cadence
 * reads with {@link recordedCodexSeatRead} in place of the live Codex seat decision, the recorded snapshots and
 * spends, the hold journal and the app's socket.
 *
 * @returns the production dependencies for {@link readChairWatch} on the watch's own timer
 */
export function productionChairWatchDeps(): ChairWatchDeps {
  return chairWatchDepsFor({ reader: "watch" });
}

/**
 * The reads `supervisor hand-off` re-reads the watch through: the watch's own, but with the LIVE Codex seat decision,
 * because the hand-off is about to seat a successor and may record what that decision files.
 *
 * @returns the production dependencies for the hand-off's fresh watch pass
 */
export function handOffChairWatchDeps(): ChairWatchDeps {
  return chairWatchDepsFor({ reader: "hand-off" });
}

/** The watch's reads and its two output channels. */
export type ChairWatchRunDeps = ChairWatchDeps & {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
};

/**
 * `supervisor chair-watch`.
 *
 * @param rest the flag tail after `supervisor chair-watch`
 * @param deps every read the pass makes, and the two output channels
 * @returns `0` on any completed pass, `EXIT_USAGE` for argv it cannot parse
 */
export async function runSupervisorChairWatch({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChairWatchRunDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(CHAIR_WATCH_USAGE);
    return EXIT_OK;
  }
  const parsed = parseChairWatchOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      deps.writeDiagnostic(`supervisor chair-watch: ${message}`);
    });
    deps.writeDiagnostic(CHAIR_WATCH_USAGE);
    return EXIT_USAGE;
  }
  const report = await readChairWatch({ deps, home: resolveHome({ named: parsed.value.home }) });
  if (parsed.value.json) {
    deps.writeOut(JSON.stringify(report));
    return EXIT_OK;
  }
  for (const line of chairWatchLines({ report })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/** `slopweaver supervisor chair-watch`. */
export const supervisorChairWatchCommand = defineCommand({
  run: (argv) =>
    runSupervisorChairWatch({
      deps: {
        ...productionChairWatchDeps(),
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: verbTail({ argv, verbs: ["chair-watch"] }),
    }),
});
