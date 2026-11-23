/**
 * `slopweaver handover hook` — the one verb all three run hooks invoke.
 *
 * Which event fired is read from the PAYLOAD, not from a flag, exactly as `memory hook` does. One verb serves
 * every wiring, and it cannot be configured with an event it is not actually receiving.
 *
 * ## It ALWAYS exits 0
 *
 * A non-zero exit from a hook reads as a hook error worth surfacing, and for a `Stop` hook a non-zero exit is
 * itself a way to block. Refusing is expressed in the JSON instead, so the exit code carries exactly one
 * meaning: the hook ran. Every statement below is inside a handler that allows the stop on any failure — a
 * crashing gate that blocked would be the worst object in this design.
 */

import { slopweaverHome } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { repoProbeSeams } from "../../../handover/evaluate.js";
import {
  HOOK_KILL_SWITCH,
  HOOK_KILL_SWITCH_PRIOR_SPELLING,
  type OpenRun,
  observableRuns,
  runBriefLines,
  stopGateDecision,
  stopHookActive,
} from "../../../handover/hookGate.js";
import { journalSkipLines } from "../../../handover/hookJournalRank.js";
import {
  blockOutput,
  branchHeadSha,
  contextOutput,
  type HookRunScan,
  type RunScanSeams,
  recordGateObservation,
  runsOnDisk,
} from "../../../handover/hookShell.js";
import { evaluateProbes, type ProbeResult } from "../../../handover/probe.js";
import { currentSessionId, currentSessionIds, sessionIdFromPayload } from "../../../handover/runOwner.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { codexThreadObserver } from "../../../measurement/codexOpenFiles.js";
import { isAlive } from "../../../measurement/measure.js";
import { defaultSessionsDir, discoverSessions, sessionLiveness } from "../../../measurement/sessions.js";
import { hookEventName } from "../../../memory/hookPayload.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";
import { type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import {
  lastAssistantMessageOf,
  type NoWorkClaimStopSeams,
  noWorkClaimStopLines,
  productionNoWorkClaimStopSeams,
} from "./hookNoWorkClaim.js";
import { routedValue } from "./lifecycleRun.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover hook` accepts. */
const HOOK_FLAGS: FlagSpec = { string: ["dir"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_HOOK_FLAG_NAMES: readonly string[] = stringFlagsOf({ spec: HOOK_FLAGS })
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover hook` flags through the SHARED parser rather than by scanning argv.
 *
 * Hand-rolled argv scanning is the exact residual the help-truth ratchet cannot see: nothing can enumerate what
 * an ad-hoc scan accepts. Going through `parseFlags` means the ratchet can guard this verb like any other.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseHandoverHookArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: HOOK_FLAGS });
}

/** The events this verb answers. Anything else is silence, not an error. */
const CONTEXT_EVENTS: ReadonlySet<string> = new Set(["SessionStart", "PostCompact"]);

/** Parse the payload, tolerating anything — a wiring fault must not become a refusal. */
function parsePayload({ raw }: { raw: string }): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Evaluate a doc's probes for real, declining every `command:` probe.
 *
 * A hook must never run a doc's shell: `doneWhen: - command: …` is arbitrary text from a file, and fanning it out
 * on every stop would make the gate an execution surface. Declining yields `not-evaluated`, which the gate counts
 * as unmet rather than passed — see {@link ../../../handover/gateReport}.
 */
function hookProbeSeams(): (args: { doc: HandoverDoc }) => readonly ProbeResult[] {
  return ({ doc }) => {
    if (doc.repo === undefined) {
      return [];
    }
    return evaluateProbes({ probes: doc.doneWhen, seams: repoProbeSeams({ repo: doc.repo, runCommand: undefined }) });
  };
}

/** What the hook decided to print, plus the runs it may record an observation against. */
interface HookResult {
  readonly line: string | null;
  readonly observed: readonly OpenRun[];
  readonly runsDir: string;
  readonly sessionId: string | undefined;
}

/** One bounded scan of the runs directory against one board read, with the session registry read once. */
function scanRuns({
  handoverDir,
  runsDir,
  sessionId,
}: {
  handoverDir: string;
  runsDir: string;
  sessionId: string | undefined;
}): HookRunScan {
  const scan = scanBoard({ handoverDir });
  // Read ONCE for the whole scan. Every run is asked about the same instant's registry, so two rows can never
  // disagree about which sessions were running, and the hook pays one small directory read rather than N.
  const roster = discoverSessions({ sessionsDir: defaultSessionsDir() });
  const seams: RunScanSeams = {
    branchHead: branchHeadSha,
    codexThread: codexThreadObserver(),
    // What `handover reap` would call ITSELF — every id, since an ambiguous environment names two and the
    // payload's id can differ from all of them. See the field's docs.
    commandSessionIds: currentSessionIds({ env: process.env }),
    evaluate: hookProbeSeams(),
    nowMs: Date.now(),
    processAlive: isAlive,
    sessionId,
    sessionLive: (args) => sessionLiveness({ roster, sessionId: args.sessionId }),
  };
  // A failed or partial board scan poisons "no doc claims this slug" conclusions, so it is carried as a fact
  // rather than silently flattened into an empty doc list.
  const boardPartial = !scan.isOk() || scan.value.unreadable.length > 0;
  return runsOnDisk({ boardPartial, docs: scan.isOk() ? scan.value.docs : [], runsDir, seams });
}

/** Nothing to print and nothing to record — the resting state, and every short-circuit above. */
const SILENT: HookResult = { line: null, observed: [], runsDir: "", sessionId: undefined };

/**
 * The session being hooked. The payload's `session_id` is the harness's own statement about it, so it outranks
 * the environment — which is only whatever the wrapper process happened to inherit. When neither names one,
 * the brief says its reader is unidentified rather than failing.
 */
function hookedSessionId({ payload }: { payload: unknown }): string | undefined {
  const fromPayload = sessionIdFromPayload({ payload });
  if (fromPayload === undefined) {
    return currentSessionId({ env: process.env });
  }
  return fromPayload;
}

/**
 * The no-work-claim lines for one Stop, isolated so a failure in its reads can never take the run gate down with
 * it: anything it throws allows the stop, exactly as the hook as a whole does.
 */
function noWorkLinesOf({
  payload,
  seams,
  sessionId,
}: {
  payload: unknown;
  seams: NoWorkClaimStopSeams;
  sessionId: string | undefined;
}): readonly string[] {
  try {
    return noWorkClaimStopLines({ lastMessage: lastAssistantMessageOf({ payload }), seams, sessionId });
  } catch {
    return [];
  }
}

/** Whether the run gate's kill switch is set, under either spelling. */
function runGateKilled(): boolean {
  return process.env[HOOK_KILL_SWITCH] === "1" || process.env[HOOK_KILL_SWITCH_PRIOR_SPELLING] === "1";
}

/** A Stop that prints only `lines` and journals nothing — the no-work check under the run gate's kill switch. */
function linesOnlyStop({ lines, sessionId }: { lines: readonly string[]; sessionId: string | undefined }): HookResult {
  return { line: lines.length > 0 ? blockOutput({ lines }) : null, observed: [], runsDir: "", sessionId };
}

/** A Stop the run gate judged: its block lines, then the no-work lines, and the runs it observed to journal. */
function gatedStop({
  noWork,
  payload,
  runsDir,
  scan,
  sessionId,
}: {
  noWork: readonly string[];
  payload: unknown;
  scan: HookRunScan;
  runsDir: string;
  sessionId: string | undefined;
}): HookResult {
  const decision = stopGateDecision({ env: process.env, payload, runs: scan.runs });
  // A refusal says what it did NOT check, so its silence about a run is not read as a verdict. An allowed stop
  // prints nothing at all, and a skipped count is never a reason to refuse one.
  const lines =
    decision.kind === "block"
      ? [...decision.lines, ...journalSkipLines({ summary: scan.journals }), ...noWork]
      : noWork;
  return {
    line: lines.length > 0 ? blockOutput({ lines }) : null,
    observed: observableRuns({ runs: scan.runs }),
    runsDir,
    sessionId,
  };
}

/** The line to print, plus what to journal afterwards. */
async function hookOutput({
  argv,
  readInput,
  noWorkClaimSeams,
}: {
  argv: readonly string[];
  readInput: () => Promise<string>;
  noWorkClaimSeams: (args: { home: string }) => NoWorkClaimStopSeams;
}): Promise<HookResult> {
  const payload = parsePayload({ raw: await readInput() });
  const event = hookEventName({ payload });
  if (event === null) {
    return SILENT;
  }
  // Decided BEFORE any filesystem work. The hook's deadline is enforced above the wrapper script, so an outer
  // cancellation skips the wrapper's guaranteed-zero exit — which means slow I/O can make this fail CLOSED.
  // The re-entry escape therefore short-circuits ahead of every read. Found by an adversarial pass.
  if (event === "Stop" && stopHookActive({ payload })) {
    return SILENT;
  }
  const home = slopweaverHome();
  const sessionId = hookedSessionId({ payload });
  // The run gate's kill switch silences the run gate only. The no-work check is its own policy with its own
  // hatch, and costs two small file reads — the pin, and only for the pinned chair the newest reading.
  const noWork = event === "Stop" ? noWorkLinesOf({ payload, seams: noWorkClaimSeams({ home }), sessionId }) : [];
  const killed = runGateKilled();
  if (event === "Stop" && killed) {
    return linesOnlyStop({ lines: noWork, sessionId });
  }
  const paths = stateHomePaths({ home });
  const parsed = parseHandoverHookArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  const dir = parsed.isOk() ? parsed.value.values["dir"] : undefined;
  // Embedded in recommended invocations, so a pasted command reads the same board this hook did.
  // Resolved lexically — matching the verbs' own path.join content reads; empty stays literal.
  const flagSuffix = typeof dir === "string" ? ` --dir ${routedValue({ emptyResolvesToCwd: false, value: dir })}` : "";
  const scan = scanRuns({
    handoverDir: typeof dir === "string" ? dir : paths.handovers,
    runsDir: paths.runs,
    sessionId,
  });
  if (CONTEXT_EVENTS.has(event)) {
    return contextBrief({ event, flagSuffix, scan, sessionId });
  }
  if (event !== "Stop") {
    return SILENT;
  }
  return gatedStop({ noWork, payload, runsDir: paths.runs, scan, sessionId });
}

/**
 * A SessionStart or PostCompact brief. Read-only by contract: the brief injects context and records nothing, so
 * `SessionStart` cannot move a delta baseline that only the stop gate is entitled to move.
 */
function contextBrief({
  event,
  flagSuffix,
  scan,
  sessionId,
}: {
  event: string;
  flagSuffix: string;
  scan: HookRunScan;
  sessionId: string | undefined;
}): HookResult {
  return {
    line: contextOutput({
      event,
      // Said even when nothing examined is open: "no run here" over a partial scan is exactly the silence that
      // hid most runs from this brief.
      lines: [
        ...runBriefLines({ flagSuffix, readerIdentified: sessionId !== undefined, runs: scan.runs }),
        ...journalSkipLines({ summary: scan.journals }),
      ],
    }),
    observed: [],
    runsDir: "",
    sessionId,
  };
}

/**
 * Run the hook with an injected input reader. ALWAYS returns 0.
 *
 * The reader is a seam rather than a direct `readStdin()` call so the fail-open property can actually be
 * TESTED: a reader that throws stands in for every internal failure, and the assertion is that the stop is
 * still allowed. A gate that has only ever been observed blocking has not been tested.
 *
 * @param argv the full process argv
 * @param readInput supplies the hook payload
 * @param noWorkClaimSeams the pin, reading and hatch the pinned chair's no-work check reads, built for a home
 * @param writeLine where the printed decision goes
 * @returns always `EXIT_OK`
 */
export async function runHookWith({
  argv,
  readInput,
  noWorkClaimSeams,
  writeLine,
}: {
  argv: readonly string[];
  readInput: () => Promise<string>;
  noWorkClaimSeams: (args: { home: string }) => NoWorkClaimStopSeams;
  writeLine: (line: string) => void;
}): Promise<number> {
  try {
    const result = await hookOutput({ argv, noWorkClaimSeams, readInput });
    if (result.line !== null) {
      writeLine(result.line);
    }
    // AFTER the decision is printed, never before. The record exists to make the NEXT firing say what changed,
    // so a failure to write it is a worse delta later rather than a reason to hold up this turn.
    for (const run of result.observed) {
      recordGateObservation({
        nowIso: new Date().toISOString(),
        run,
        runsDir: result.runsDir,
        sessionId: result.sessionId,
      });
    }
  } catch {
    // FAIL OPEN, unconditionally. No diagnostic on stderr either: for a Stop hook, stderr plus a non-zero exit
    // is a blocking channel, and a validator must never occupy it by accident.
  }
  return EXIT_OK;
}

/**
 * Run the hook. ALWAYS returns 0.
 *
 * @param argv the full process argv
 * @returns always `EXIT_OK`
 */
export async function runHandoverHook(argv: readonly string[]): Promise<number> {
  return runHookWith({
    argv,
    noWorkClaimSeams: productionNoWorkClaimStopSeams,
    readInput: readStdin,
    writeLine: (line) => {
      logger.out({ line });
    },
  });
}

export const handoverHookCommand = defineCommand({ run: runHandoverHook });
