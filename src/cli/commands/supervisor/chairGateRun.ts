/**
 * The chair gate's shell — `supervisor tick-record` and `supervisor sweep-prompt` both pass through it before
 * they do anything, so a seat that is not on Fable can neither record a tick nor re-arm its sweep.
 *
 * Those two are the verbs every sweep runs LAST (`skills/supervisor/reference/sweep-contract.md`): a tick that
 * cannot be recorded or re-armed is a chair that stops, loudly, on the tick it was found — which is the moment
 * the owner needs, rather than three rulings lost before they notice by hand. The judgement is
 * `../../../supervisor/chairGate.ts`; the read is `../../../supervisor/chairRead.ts`; this file owns the hatch.
 *
 * ## The refusal fixes itself first
 *
 * The owner's hand is not needed to switch back. When the process running this IS the pinned chair, it types
 * `/model fable` into its own workspace on the way past, and the handoff is the fallback. The
 * decision is pure in `../../../supervisor/chairRestore.ts`; the SEND is the one effect this file adds, and
 * the tick still refuses either way, because a send is not a confirmation.
 *
 * A Codex-hosted chair has no Claude transcript to read and is not asked to be on Fable (AGENTS.md rule 5 makes
 * Codex a substitute host), so the gate says it did not apply and steps aside rather than refusing forever. That
 * holds whether the CALLER is a Codex thread or the PIN names one: the pinned workspace's Claude tabs are not the
 * chair then, and judging them would read a co-located Claude tab on Fable as a clean chair.
 *
 * ## The metered check
 *
 * Built off live telemetry: a chair session whose newest
 * `claude_code.api_request` resolves no claude.ai organisation is spending a metered Console organisation, and
 * the tick refuses under its own hatch, `metered-chair`. It runs AFTER a clean Fable verdict because a chair
 * can be on Fable while it spends — the Fable question cannot see this class. An unmeasured read (no `DD_*`,
 * a Datadog fault, a session with no telemetry yet) prints and passes; `../../../supervisor/chairMetered.ts`
 * says why a remote oracle must not refuse on its own silence.
 */
import { realReachWaits } from "../../../cmux/reach.js";
import { describeSendDisposition } from "../../../cmux/turnBusy.js";
import { slopweaverHome } from "../../../config.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import type { LaneShapeRead } from "../../../plans/laneShape.js";
import { readLaneShapes } from "../../../plans/laneShapeRead.js";
import { planRegisterPort } from "../../../plans/port.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { type CallerChairReading, type ChairRead, judgeChair } from "../../../supervisor/chairGate.js";
import {
  type ChairMeteredReading,
  judgeChairMetered,
  meteredChairRemedyLines,
} from "../../../supervisor/chairMetered.js";
import { readChairMeteredLive } from "../../../supervisor/chairMeteredRead.js";
import { type ChairRequirement, chairRequirement } from "../../../supervisor/chairPolicy.js";
import { claudeHomeDir, readCallerChairSession, readPinnedChair } from "../../../supervisor/chairRead.js";
import { type ChairRestoreOutcome, chairRestoreLines, planChairRestore } from "../../../supervisor/chairRestore.js";
import { countChairRestoreAttempts, recordChairRestoreAttempt } from "../../../supervisor/chairRestoreStore.js";
import { type RecordedChair, readRecordedChair } from "../../../supervisor/recordedChairHost.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { recordedChairDecision } from "./chairGateRecorded.js";

/** Everything the gate touches outside itself, injected so a test drives it over a frozen transcript. */
export interface ChairGateDeps {
  /** The process environment, read for the host and the caller's own workspace, and nothing else. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether the `off-fable-chair` hatch is open for this invocation. */
  readonly offFableHatchIsOpen: boolean;
  /** Whether the `metered-chair` hatch is open for this invocation. */
  readonly meteredHatchIsOpen: boolean;
  /** Reads the pinned chair. */
  readonly readChair: () => Promise<ChairRead>;
  /**
   * Reads the plan lanes once, which decide the model the chair must be on (`chairPolicy.ts`), from the home the
   * gated verb acts on ({@link gateHome}).
   */
  readonly readLanes: () => Promise<LaneShapeRead>;
  /**
   * Reads the session running this verb by its own id, with no cmux call — asked only when cmux did not answer
   * the chair read, with whether the supervisor-pin record names it. Undefined when this process carries no Claude
   * Code session id.
   */
  readonly readCaller: () => CallerChairReading | undefined;
  /** The strict recorded chair (`readRecordedChair`): its session and the instant it took the chair. */
  readonly readRecordedChair: () => RecordedChair;
  /** Reads what the telemetry says each chair session is spending. */
  readonly readMetered: (options: { read: ChairRead }) => Promise<ChairMeteredReading>;
  /** How many `/model fable` sends have already answered one restore key. */
  readonly attemptsFor: (options: { key: string }) => number;
  /** Types one line into a cmux workspace, and says what became of it. */
  readonly sendToWorkspace: (options: { workspaceId: string; text: string }) => Promise<ChairRestoreOutcome>;
  /** Records that a send was made, so the next tick can see it. */
  readonly recordAttempt: (options: { key: string; workspaceId: string }) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Attempt the restore the plan asked for, recording it before the reader is told anything.
 *
 * Recorded BEFORE the outcome is rendered rather than only on success: a send whose disposition could not be
 * read still typed the line, and an attempt that is not counted is an attempt that repeats forever.
 */
async function performRestore({
  deps,
  workspaceId,
  text,
  key,
}: {
  deps: ChairGateDeps;
  workspaceId: string;
  text: string;
  key: string;
}): Promise<ChairRestoreOutcome> {
  deps.recordAttempt({ key, workspaceId });
  return deps.sendToWorkspace({ text, workspaceId });
}

/**
 * What the gate read on its way past, handed to the verb so a later judgement never reads the chair twice.
 *
 * `not-read` is its own arm rather than an empty read: `--help` and a Codex-hosted chair read nothing, and a
 * consumer must say so rather than judge a chair nobody looked at.
 */
export type ChairGateEvidence =
  | { readonly kind: "read"; readonly chair: ChairRead; readonly lanes: LaneShapeRead }
  | {
      readonly kind: "codex";
      readonly threadId: string;
      readonly canonFloor:
        | { readonly kind: "measured"; readonly pinnedAtIso: string }
        | { readonly kind: "unmeasured"; readonly why: string };
    }
  | { readonly kind: "not-read"; readonly why: string };

/**
 * The plan lanes the gate read, when it read the chair at all.
 *
 * @param evidence what the gate read on its way past
 * @returns the lanes on a chair read; undefined for a usage read or a Codex chair, which read none
 */
export function evidenceLanes({ evidence }: { evidence: ChairGateEvidence }): LaneShapeRead | undefined {
  if (evidence.kind !== "read") {
    return undefined;
  }
  return evidence.lanes;
}

/** What the gated verb is called with once the gate passes. */
export interface ChairGatePass {
  readonly argv: readonly string[];
  readonly evidence: ChairGateEvidence;
}

/**
 * Run the chair gate, then the verb when it passes.
 *
 * `--help` is never gated: reading a verb's usage records nothing and arms nothing. The chair is read even when
 * the off-Fable hatch is open, because the chair's hand-off cadence (`../../../supervisor/chairCadence.ts`) has
 * no hatch and judges its sessions: a hatch releases a refusal, never the measurement. The telemetry is read only
 * to ask the metered question, so an open metered hatch skips it — the cadence reads each session's boot
 * credential, never telemetry.
 *
 * @param verb the verb name, as its refusal prints it
 * @param argv the full process argv
 * @param deps the injected seams
 * @param run the verb itself, called only when the gate passes, with what the gate read
 * @returns the verb's exit code, or `EXIT_ERROR` when the gate refused
 */
export async function gateChairThenRun({
  verb,
  argv,
  deps,
  run,
}: {
  verb: string;
  argv: readonly string[];
  deps: ChairGateDeps;
  run: (pass: ChairGatePass) => number | Promise<number>;
}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return run({ argv, evidence: { kind: "not-read", why: "a usage read is never gated" } });
  }
  const decision = recordedChairDecision({
    caller: detectSupervisorSession({ env: deps.env }),
    recorded: deps.readRecordedChair(),
  });
  if (decision.kind === "step-aside") {
    deps.writeDiagnostic(`supervisor ${verb}: chair gate not applied — ${decision.stderrLine}`);
    return run({ argv, evidence: decision.evidence });
  }
  const read = await deps.readChair();
  const lanes = await deps.readLanes();
  if (lanes.kind === "unreadable") {
    deps.writeDiagnostic(`supervisor ${verb}: plan lanes unread, so the chair is held to Fable — ${lanes.why}`);
  }
  if (!deps.offFableHatchIsOpen) {
    const refused = await refuseOffFable({ deps, read, requirement: chairRequirement({ lanes }), verb });
    if (refused !== undefined) {
      return refused;
    }
  }
  if (!deps.meteredHatchIsOpen) {
    const refused = refuseMetered({ deps, metered: await deps.readMetered({ read }), verb });
    if (refused !== undefined) {
      return refused;
    }
  }
  return run({ argv, evidence: { chair: read, kind: "read", lanes } });
}

/**
 * The model question: refuse, restoring on the way past, when a chair session is off the model its plans require
 * (Fable while more than one Claude plan stands, Opus on one).
 *
 * @param deps the injected seams
 * @param read the chair read
 * @param requirement what the chair must be on
 * @param verb the verb name, as its refusal prints it
 * @returns `EXIT_ERROR` when refused, undefined when the chair is on the required model
 */
async function refuseOffFable({
  deps,
  read,
  requirement,
  verb,
}: {
  deps: ChairGateDeps;
  read: ChairRead;
  requirement: ChairRequirement;
  verb: string;
}): Promise<number | undefined> {
  const caller = read.kind === "unresolved" && read.cause === "cmux-unanswered" ? deps.readCaller() : undefined;
  const verdict = judgeChair({ caller, read, requirement });
  if (verdict.kind === "clean") {
    return undefined;
  }
  if (verdict.kind === "caller-only") {
    deps.writeDiagnostic(`supervisor ${verb}: ${verdict.note}`);
    return undefined;
  }
  const plan = planChairRestore({
    attemptsFor: deps.attemptsFor,
    callerWorkspaceId: deps.env["CMUX_WORKSPACE_ID"],
    read,
    requirement,
  });
  let outcome: ChairRestoreOutcome | undefined;
  if (plan.kind === "attempt") {
    outcome = await performRestore({ deps, key: plan.key, text: plan.text, workspaceId: plan.workspaceId });
  }
  let remedy: readonly string[] = [];
  if (requirement.kind === "claude") {
    remedy = chairRestoreLines({ outcome, plan, required: requirement.model });
  }
  const lines = [
    ...hatchRefusalLines({ detail: verdict.detail, hatch: hatchFor({ id: "off-fable-chair" }) }),
    ...verdict.lines,
    ...remedy,
  ];
  for (const line of lines) {
    deps.writeDiagnostic(`supervisor ${verb}: ${line}`);
  }
  return EXIT_ERROR;
}

/**
 * The metered question: refuse when a chair session's newest telemetry resolves no claude.ai organisation,
 * and print — never refuse — what could not be measured.
 *
 * @param deps the injected seams
 * @param metered what the telemetry said for each chair session
 * @param verb the verb name, as its refusal prints it
 * @returns `EXIT_ERROR` when refused, undefined when the tick may go on
 */
function refuseMetered({
  deps,
  metered,
  verb,
}: {
  deps: ChairGateDeps;
  metered: ChairMeteredReading;
  verb: string;
}): number | undefined {
  const verdict = judgeChairMetered({ reading: metered });
  if (verdict.kind === "clean") {
    for (const note of verdict.notes) {
      deps.writeDiagnostic(`supervisor ${verb}: ${note}`);
    }
    return undefined;
  }
  const lines = [
    ...hatchRefusalLines({ detail: verdict.detail, hatch: hatchFor({ id: "metered-chair" }) }),
    ...verdict.lines,
    ...meteredChairRemedyLines(),
  ];
  for (const line of lines) {
    deps.writeDiagnostic(`supervisor ${verb}: ${line}`);
  }
  return EXIT_ERROR;
}

/**
 * Type one line into a cmux workspace — the same call `cmux send` makes, minus the pinned-supervisor refusal,
 * which by construction never applies here: the only workspace this ever addresses is the caller's own.
 *
 * @param workspaceId the cmux workspace to type into
 * @param text the line to type and submit
 * @returns whether it was sent, and what the send reported
 */
async function sendToWorkspaceLive({
  workspaceId,
  text,
}: {
  workspaceId: string;
  text: string;
}): Promise<ChairRestoreOutcome> {
  try {
    return await withCmuxSessionHost<ChairRestoreOutcome>({
      body: async ({ host }): Promise<ChairRestoreOutcome> => {
        const sent = await host.reachSession({ target: { workspaceId }, text, waits: realReachWaits() });
        if (sent.isErr()) {
          return { detail: sent.error.message, sent: false };
        }
        return {
          detail: describeSendDisposition({ ...sent.value, workspaceRef: workspaceId }),
          sent: true,
        };
      },
    });
  } catch (error: unknown) {
    return { detail: `cmux could not be reached (${String(error)})`, sent: false };
  }
}

/**
 * The home every chair-state read of the gate comes from: the gated verb's own `--home`, else the environment's.
 *
 * The gate runs before the verb parses its flags, so it reads the flag itself, both spellings, and takes the LAST
 * home named — the one a repeated flag leaves the verb acting on. Every token is read, never a fixed offset, because
 * one caller hands the whole process argv and `tick close` hands its parsed tail. Judging the environment's plan
 * register or recorded chair while the verb writes into another home is the mismatch this closes: a tick recorded
 * into a home standing on one Claude plan, under a Fable chair the default home's two plans allowed.
 *
 * @param argv the process argv, or the verb's own tail
 * @param home the state home the environment names
 * @returns the home the gate reads its plan lanes, recorded chair, pin and restore attempts from
 */
export function gateHome({ argv, home }: { argv: readonly string[]; home: string }): string {
  let chosen = home;
  for (const [index, token] of argv.entries()) {
    if (token.startsWith("--home=")) {
      chosen = token.slice("--home=".length);
    } else if (token === "--home") {
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith("--")) {
        chosen = value;
      }
    }
  }
  return chosen;
}

/**
 * The real seams: the environment, the hatch, cmux and the transcripts, the attempt ledger, and stderr.
 *
 * @param argv the gated verb's argv, whose `--home` every chair-state read follows ({@link gateHome})
 * @returns the production dependencies for {@link gateChairThenRun}
 */
export function productionChairGateDeps({ argv }: { argv: readonly string[] }): ChairGateDeps {
  const home = gateHome({ argv, home: slopweaverHome() });
  return {
    attemptsFor: ({ key }) => countChairRestoreAttempts({ home, key }),
    env: process.env,
    meteredHatchIsOpen: hatchOpen({
      env: process.env,
      id: "metered-chair",
      nowIso: new Date().toISOString(),
    }),
    offFableHatchIsOpen: hatchOpen({
      env: process.env,
      id: "off-fable-chair",
      nowIso: new Date().toISOString(),
    }),
    readCaller: () => {
      const host = detectSupervisorSession({ env: process.env });
      if (host.kind !== "active" || host.session.host !== "claude-code") {
        return undefined;
      }
      return readCallerChairSession({
        claudeHome: claudeHomeDir(),
        pin: readSupervisorPin({ home }),
        sessionId: host.session.id,
      });
    },
    readChair: () => readPinnedChair({ claudeHome: claudeHomeDir() }),
    readLanes: () => readLaneShapes({ home, nowIso: new Date().toISOString(), read: planRegisterPort().read }),
    readRecordedChair: () => readRecordedChair({ home }),
    readMetered: ({ read }) =>
      readChairMeteredLive({ claudeHome: claudeHomeDir(), env: process.env, nowMs: Date.now(), read }),
    recordAttempt: ({ key, workspaceId }) => {
      recordChairRestoreAttempt({ home, key, nowIso: new Date().toISOString(), workspaceId });
    },
    sendToWorkspace: sendToWorkspaceLive,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
  };
}
