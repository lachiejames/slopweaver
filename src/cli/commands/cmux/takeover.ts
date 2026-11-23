/**
 * `slopweaver cmux takeover` — `docs/cmux-client/verbs-and-events.md` § 3's successor handoff as one verb: verify this session
 * is genuinely sweeping (its own hook events, else its own transcript — `./takeoverTranscript.ts`), resolve the
 * predecessor from cmux's own pin, confirm its run has actually finished, then unpin/pin/title/close in that order. Refuses loudly (no `--force`) on any check failing — unpinning,
 * pinning and closing are the same destructive triad `docs/cmux-client/socket-and-measured-facts.md` § 2(e) already warns cmux enforces
 * no safety net over, and the whole point of this verb is that a successor stops skipping the last of those
 * steps (measured twice: `ws:402`, `ws:459`).
 *
 * ## Six steps, because closing the workspace was never the whole ending
 *
 * Step 6 records the predecessor's BOARD ROW closed. The five-step version retired the chair's workspace and
 * left its handover doc at `status: ready`, so every retired chair stayed in `RUN NOW` — 177 of them on the
 * live board — and a fill read one as available work and spawned a SECOND supervisor chair.
 * `../../../handover/supervisorSupersession.ts` carries that incident and the measurement. Step 6 sits AFTER
 * the destructive triad and can never fail the takeover: `./takeoverRow.ts` holds it, beside gate (c) that
 * reads the same row, and says why.
 *
 * Step 5 is `./takeoverClose.ts`: a retired chair always holds a live process, which cmux 0.65.2 refuses to close
 * unforced, so that file decides when force is safe. When it is not, the tab stays open with its ledger row for
 * `session close-done`, and step 6 still runs — the chair is retired either way.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { drainUntil, readCmuxEventAck } from "../../../cmux/eventStream.js";
import { SUPERVISOR_WORKSPACE_TITLE } from "../../../cmux/supervisorWorkspace.js";
import {
  type HookLeg,
  hookLegOfDrain,
  resolvePredecessor,
  retainedWindowCursor,
  sweepArmedInEvents,
  sweepGateOutcome,
} from "../../../cmux/takeover.js";
import { slopweaverHome } from "../../../config.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { readProcessTableWhole } from "../../../live/standing/inspect.js";
import { type CmuxHostSurface, withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import type { SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import type { SessionItem } from "../../../sessions/session.js";
import {
  detectSupervisorSession,
  supervisorSessionProblem,
  type VisibleSupervisorSession,
} from "../../../supervisor/session.js";
import { claudeProjectsDir } from "../../../transcripts/source.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { OWNER_TURN_WINDOW_DAYS, unreadOwnerTurns } from "../supervisor/ownerTurnsRun.js";
import { parseCmuxVerb, stringFlag } from "./core.js";
import { forgetUnpinnedSupervisor, recordSupervisorPin } from "./recordPin.js";
import { targetWorkspaceId } from "./run.js";
import { runTakeoverStep5 } from "./takeoverClose.js";
import { predecessorRunGate, recordPredecessorRowClosed } from "./takeoverRow.js";
import { readTranscriptLeg } from "./takeoverTranscript.js";

/** How long with no new frame before gate (a)'s drain decides nothing else is coming. */
const SWEEP_DRAIN_QUIET_MS = 750;

/**
 * The hard ceiling on gate (a)'s drain. Shorter than `cmux events`' own 30s: this is looking for ONE very
 * recent event (the sweep is armed on the successor's first turn), not draining a batch.
 */
const SWEEP_DRAIN_DEADLINE_MS = 15_000;

/** The filters both of gate (a)'s subscriptions use: the ack probe and the drain must describe the same window. */
const SWEEP_DRAIN_FILTERS = { categories: ["agent"], names: ["agent.hook.PreToolUse"] } as const;

/**
 * Gate (a)'s hook-event leg: learn cmux's retained window from a live-edge ack, then drain this workspace's own
 * PreToolUse events from inside it for the sweep arm (`retainedWindowCursor` says why never from `seq 0`).
 *
 * A POSITIVE result is unambiguous. A negative is a negative over the retained window only — named by its
 * oldest seq and earliest replayed instant so a reader can set it against when the session armed — and the
 * transcript leg is read after it either way.
 */
async function readHookLeg({ ownWorkspaceId }: { ownWorkspaceId: string }): Promise<HookLeg> {
  const probed = await readCmuxEventAck({ deadlineMs: SWEEP_DRAIN_DEADLINE_MS, subscription: SWEEP_DRAIN_FILTERS });
  if (probed.isErr()) {
    return { kind: "unreadable", why: probed.error.message };
  }
  const cursor = retainedWindowCursor({ oldestSeq: probed.value.oldestSeq });
  if ("unusable" in cursor) {
    return { kind: "unreadable", why: cursor.unusable };
  }
  const firstReplayedAt: string[] = [];
  const drained = await drainUntil({
    deadlineMs: SWEEP_DRAIN_DEADLINE_MS,
    quietMs: SWEEP_DRAIN_QUIET_MS,
    stopWhen: ({ event }) => {
      if (firstReplayedAt.length === 0) {
        firstReplayedAt.push(event.occurredAtIso);
      }
      return sweepArmedInEvents({ events: [event], workspaceId: ownWorkspaceId });
    },
    subscription: { ...SWEEP_DRAIN_FILTERS, afterSeq: cursor.afterSeq },
  });
  if (drained.isErr()) {
    return { kind: "unreadable", why: drained.error.message };
  }
  return hookLegOfDrain({
    matched: drained.value.match !== undefined,
    oldestSeq: drained.value.oldestSeq,
    windowStartIso: firstReplayedAt[0],
  });
}

/**
 * Gate (a): refuse unless one of the two witnesses proves the sweep has been armed — this workspace's own hook
 * events first, then this session's own transcript. The transcript is read after EVERY non-witnessing hook
 * disposition — a negative over the retained window and a failed drain alike — and never when the hook witnessed; the
 * second witness exists because Claude Code 2.1.296 runs no PreToolUse hook for `ScheduleWakeup`, see
 * `../../../cmux/takeover.ts`. A Codex session has no transcript leg yet, so it names why rather than reading one.
 */
async function ownSweepGate({
  harness,
  session,
}: {
  harness: Pick<SessionHarness, "resolve">;
  session: VisibleSupervisorSession;
}): Promise<{ readonly ownWorkspaceId: string } | number> {
  const ownTarget = await targetWorkspaceId({ env: process.env, harness, workspaceRef: undefined });
  if (ownTarget.isErr()) {
    logger.error({ msg: `cmux takeover: ${ownTarget.error.message}` });
    return EXIT_ERROR;
  }
  const ownWorkspaceId = ownTarget.value;
  const hook = await readHookLeg({ ownWorkspaceId });
  const outcome =
    hook.kind === "witnessed"
      ? sweepGateOutcome({ evidence: { hook } })
      : sweepGateOutcome({
          evidence: {
            hook,
            transcript: readTranscriptLeg({ env: process.env, session, projectsDir: claudeProjectsDir() }),
          },
        });
  if (!outcome.armed) {
    logger.error({ msg: `cmux takeover: refusing — ${outcome.refusal}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux takeover: step 1/6 — sweep armed: yes (${outcome.witness})` });
  return { ownWorkspaceId };
}

/**
 * Gate (a2): refuse unless this chair has READ every owner turn of the last seven days.
 *
 * A chair that fills the fleet off a five-row window, while ready rows under the owner's stated outcomes sit
 * untouched, has not read what the owner expects; reading everything the owner said over the last week is what
 * makes its judgement good. Taking the pin is the
 * moment a chair becomes the thing that decides what the fleet does, so it is the moment the read is owed.
 *
 * It costs one chain walk — measured 12–17 seconds over 119 chair transcripts on the owner's real install — paid
 * once per handover rather than once per tick.
 *
 * @param home the state home, or `undefined` for the resolved one
 * @param session the visible session taking the pin, whose receipts are counted
 * @returns the refusal's lines, or `undefined` when the chair may proceed
 */
function ownerTurnGate({
  home,
  session,
}: {
  home: string | undefined;
  session: VisibleSupervisorSession;
}): readonly string[] | undefined {
  const nowIso = new Date().toISOString();
  if (hatchOpen({ env: process.env, id: "unread-owner-turns", nowIso })) {
    return undefined;
  }
  const report = unreadOwnerTurns({
    days: OWNER_TURN_WINDOW_DAYS,
    home: resolvedHome({ home }),
    nowIso,
    session,
  });
  if (report.unreadable !== undefined) {
    return [`cmux takeover: refusing — the owner's turns could not be read: ${report.unreadable}`];
  }
  if (report.unread === 0) {
    logger.out({
      line: `cmux takeover: step 1b/6 — owner turns read: all ${String(report.total)} since ${report.sinceIso}`,
    });
    return undefined;
  }
  return [
    ...hatchRefusalLines({
      detail: `${String(report.unread)} of ${String(report.total)} turn(s) since ${report.sinceIso} carry no receipt for this session (${String(report.unreadBytes)} bytes)`,
      hatch: hatchFor({ id: "unread-owner-turns" }),
    }),
    "Run `slopweaver supervisor owner-turns` until it reports nothing left, then take the pin.",
  ];
}

/**
 * The state home this gate reads, named rather than substituted inline.
 *
 * An `if` rather than `??`: `no-silent-fallback` refuses an operator standing in for an absent value, and
 * the absent case here is real — no `--home` means the resolved one.
 *
 * @param home the flag's value, when one was typed
 * @returns the home to read
 */
function resolvedHome({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * Gate (b): resolve the predecessor from cmux's own pin, refusing on every ambiguous shape. The inventory comes
 * back beside it because gate (c) pairs the ledger against the same listing, never against a ref alone.
 */
async function predecessorGate({
  client,
  ownWorkspaceId,
}: {
  client: CmuxHostSurface;
  ownWorkspaceId: string;
}): Promise<
  { readonly predecessor: CmuxWorkspaceSummary; readonly workspaces: readonly CmuxWorkspaceSummary[] } | number
> {
  const workspaces = await client.listWorkspaces();
  if (workspaces.isErr()) {
    logger.error({ msg: `cmux takeover: ${workspaces.error.message}` });
    return EXIT_ERROR;
  }
  const resolved = resolvePredecessor({ ownWorkspaceId, workspaces: workspaces.value });
  if ("refusal" in resolved) {
    logger.error({ msg: `cmux takeover: refusing — ${resolved.refusal}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux takeover: step 2/6 — predecessor resolved: ${resolved.predecessor.workspaceRef}` });
  return { predecessor: resolved.predecessor, workspaces: workspaces.value };
}

/**
 * Step 4's second half: pin and title THIS session, then scope the supervisor depth guard to it.
 *
 * It answers with the workspace ref the successor is really known by, because two later steps need it — the
 * depth-guard record and step 6's witness — and `resolveWorkspace` failing is not a reason to stop a handoff
 * whose pin has already moved: the id is a usable name for the same workspace.
 *
 * @param client the connected cmux client
 * @param home the state home the pin record is written under
 * @param ownWorkspaceId this session's workspace
 * @param session the visible session the pin record names
 * @returns this session's resolved ref, or the message that stops the takeover
 */
async function seatThisSession({
  client,
  home,
  ownWorkspaceId,
  session,
}: {
  client: CmuxHostSurface;
  home: string | undefined;
  ownWorkspaceId: string;
  session: VisibleSupervisorSession;
}): Promise<{ readonly failure: string } | { readonly ownRef: string }> {
  const pinned = await client.pinWorkspace({ workspaceId: ownWorkspaceId });
  if (pinned.isErr()) {
    return { failure: pinned.error.message };
  }
  const renamed = await client.renameWorkspace({ title: SUPERVISOR_WORKSPACE_TITLE, workspaceId: ownWorkspaceId });
  if (renamed.isErr()) {
    return { failure: renamed.error.message };
  }
  logger.out({ line: `cmux takeover: step 4/6 — pinned and titled this session (${SUPERVISOR_WORKSPACE_TITLE})` });
  const resolved = await client.resolveWorkspace({ ref: ownWorkspaceId });
  const ownRef = resolved.isOk() ? resolved.value.workspaceRef : ownWorkspaceId;
  const recorded = recordSupervisorPin({
    detection: { kind: "active", session },
    nowIso: new Date().toISOString(),
    ownWorkspaceId,
    ...(home === undefined ? {} : { home }),
    pinnedWorkspaceId: ownWorkspaceId,
    workspaceRef: ownRef,
  });
  logger.out({
    line: `cmux takeover: step 4/6 — supervisor depth guard ${recorded ? "now scoped to this session" : "NOT recorded (the write failed, see above) — this session is unguarded"}`,
  });
  return { ownRef };
}

/**
 * Steps (d)-(f): unpin the predecessor, pin and title this session, close the predecessor, and record its
 * board row closed.
 */
async function performTakeover({
  client,
  home,
  ownWorkspaceId,
  predecessorId,
  predecessorRef,
  predecessorRow,
  predecessorSlug,
  session,
}: {
  client: CmuxHostSurface;
  home: string | undefined;
  ownWorkspaceId: string;
  predecessorId: string;
  predecessorRef: string;
  predecessorRow: SessionItem & { readonly workspaceRef: string };
  predecessorSlug: string;
  session: VisibleSupervisorSession;
}): Promise<number> {
  const unpinned = await client.unpinWorkspace({ workspaceId: predecessorId });
  if (unpinned.isErr()) {
    logger.error({ msg: `cmux takeover: ${unpinned.error.message}` });
    return EXIT_ERROR;
  }
  forgetUnpinnedSupervisor({ unpinnedWorkspaceId: predecessorId, ...(home === undefined ? {} : { home }) });
  logger.out({ line: `cmux takeover: step 4/6 — unpinned ${predecessorRef}` });
  const seated = await seatThisSession({ client, home, ownWorkspaceId, session });
  if ("failure" in seated) {
    logger.error({ msg: `cmux takeover: ${seated.failure}` });
    return EXIT_ERROR;
  }
  const closed = await runTakeoverStep5({
    client,
    home,
    predecessorId,
    predecessorRef,
    predecessorRow,
    processTable: readProcessTableWhole,
  });
  // Step 6 runs whatever step 5 did: the pin has moved and gate (c) read the run finished, so the chair is retired
  // whether or not its tab closed. Skipping it left every such chair's row in RUN NOW (`./takeoverRow.ts`).
  recordPredecessorRowClosed({ home, predecessorSlug, successorRef: seated.ownRef });
  return closed ? EXIT_OK : EXIT_ERROR;
}

/**
 * `cmux takeover` — the whole successor handoff, gated and ordered.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxTakeover(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "takeover" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const home = stringFlag({ name: "home", parsed });
  const dryRun = parsed.values["dry-run"] === true;
  // Detected ONCE: the sweep's transcript leg, the owner-turn receipts and the pin record all name this session,
  // and three reads of the environment could name three different ones.
  const detection = detectSupervisorSession({ env: process.env });
  if (detection.kind !== "active") {
    logger.error({ msg: `cmux takeover: refusing — ${supervisorSessionProblem({ detection })}` });
    return EXIT_ERROR;
  }
  return withCmuxSessionHost({
    body: async ({ harness, host: client }): Promise<number> => {
      const sweep = await ownSweepGate({ harness, session: detection.session });
      if (typeof sweep === "number") {
        return sweep;
      }
      const unread = ownerTurnGate({ home, session: detection.session });
      if (unread !== undefined) {
        for (const line of unread) {
          logger.error({ msg: line });
        }
        return EXIT_ERROR;
      }
      const resolved = await predecessorGate({ client, ownWorkspaceId: sweep.ownWorkspaceId });
      if (typeof resolved === "number") {
        return resolved;
      }
      const { predecessor, workspaces } = resolved;
      const run = predecessorRunGate({ home, predecessor, workspaces });
      if ("refusal" in run) {
        logger.error({ msg: `cmux takeover: refusing — ${run.refusal}` });
        return EXIT_ERROR;
      }
      if (dryRun) {
        logger.out({
          line:
            `cmux takeover: --dry-run — would unpin ${predecessor.workspaceRef}, pin+title this session, close ` +
            `${predecessor.workspaceRef} (forced only when its screen proves it idle, or its one background work is a ` +
            `keep-alive another watch covers), then close ${run.slug}'s board row either way`,
        });
        return EXIT_OK;
      }
      return performTakeover({
        client,
        home,
        ownWorkspaceId: sweep.ownWorkspaceId,
        predecessorId: predecessor.workspaceId,
        predecessorRef: predecessor.workspaceRef,
        predecessorRow: run.row,
        predecessorSlug: run.slug,
        session: detection.session,
      });
    },
  });
}

export const cmuxTakeoverCommand = defineCommand({ run: runCmuxTakeover });
