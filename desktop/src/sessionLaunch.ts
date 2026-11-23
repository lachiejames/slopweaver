/**
 * Launching a hosted session: `launch.prepare` and `launch.resume` open the card with its Stop control BEFORE the
 * worker that runs a model is started (`visibleSessionLease.ts`), as rule 2 requires, and answer with a launch token
 * that exactly one `launch.deliver` or `launch.abort` settles. `sessionControl.ts` dispatches the requests here.
 */
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import { recordLaunch, type WorkerSettled } from "./launchRecording";
import { launchTokensFor } from "./launchTokens";
import { sessionCardUrl } from "./sessionCard";
import type { AppHarnessResponse, AppLaunchSpec } from "./sessionControlProtocol";
import {
  applySessionEvent,
  holdWorker,
  hostedSessions,
  noteSession,
  recordRecovery,
  SessionRefusal,
  snapshotOf,
  stopSession,
  watchWorker,
} from "./sessionHosting";
import { readyToResume } from "./sessionResumeShell";
import { type CloseThroughVerb, stopFromCard } from "./sessionStopRequests";
import { openSessionCard } from "./sessionWindow";
import { launchSessionWorker } from "./sessionWorkerLaunch";
import { mintVisibleLease } from "./visibleSessionLease";
import { type SessionPaths, workerLaunchOf } from "./workerLaunchOf";

/** How long a new session has to report ready before its launch is refused. */
const READY_MS = 120_000;

/**
 * How long an issued launch token waits for its `launch.deliver` or `launch.abort` before the app ends the session
 * itself — so a spawning CLI that died, or an abort lost on the wire, never leaves a session nobody will settle.
 */
const UNSETTLED_LAUNCH_MS = 120_000;

/**
 * The launch tokens a `launch.prepare` has answered with. A token is issued only as its answer leaves, so one still
 * being prepared cannot be acted on, and settled by whichever of deliver or abort comes first.
 */
const tokens = launchTokensFor({
  expired: ({ sessionId }) => {
    noteSession({
      note: `No launch.deliver or launch.abort arrived within ${String(UNSETTLED_LAUNCH_MS / 1000)}s, so the app ended it`,
      sessionId,
    });
    void stopSession({ failed: true, sessionId }).catch(() => undefined);
  },
  mint: randomUUID,
  schedule: ({ afterMs, run }) => {
    const timer = setTimeout(run, afterMs);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
  unsettledMs: UNSETTLED_LAUNCH_MS,
});

/** What the control plane needs from the rest of the app. */
export interface SessionControlHost {
  readonly paths: SessionPaths;
  /** The environment a child of the app runs under, before the session's own policy is applied. */
  readonly childEnvironment: () => Readonly<Record<string, string | undefined>>;
  readonly titleFor: (options: { readonly page: string }) => string;
  /** Close a session through the `slopweaver` verb, so the ledger records the close the card's Stop made. */
  readonly closeThroughVerb: CloseThroughVerb;
}

/** This run of the app, named in every `pong` so a launch can say which run its browser door was judged against. */
export const instanceId = randomUUID();

async function untilSettled({
  sessionId,
  worker,
}: {
  sessionId: string;
  worker: ReturnType<typeof launchSessionWorker>;
}): Promise<WorkerSettled> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ kind: "failed", why: `the session did not report ready within ${String(READY_MS / 1000)}s` });
    }, READY_MS);
    watchWorker({
      sessionId,
      settled: (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      },
      worker,
    });
  });
}

/** A session the journal recorded, continued under its own id and on its own vendor transcript. */
interface Continuation {
  readonly sessionId: string;
  readonly vendorSessionId: string;
}

/**
 * Open a session's card, then start its worker, and answer with the token that settles the launch.
 *
 * @param spec what to launch, as the CLI sent it
 * @param host what the control plane reaches in the rest of the app
 * @param continuation a recorded session to continue under its own id, rather than a new one
 * @returns the prepared answer, issued only as it leaves
 */
export async function prepareSession({
  spec,
  host,
  continuation,
}: {
  spec: AppLaunchSpec;
  host: SessionControlHost;
  continuation?: Continuation;
}): Promise<AppHarnessResponse> {
  const sessionId = continuation === undefined ? randomUUID() : continuation.sessionId;
  const resumed = continuation === undefined ? {} : { resumeVendorSessionId: continuation.vendorSessionId };
  const worker = workerLaunchOf({
    claudeTranscriptId: randomUUID(),
    instanceId,
    paths: host.paths,
    sessionId,
    spec,
    ...resumed,
  });
  if (worker.kind === "refused") {
    throw new SessionRefusal("LAUNCH_FAILED", worker.why);
  }
  const directory = await stat(spec.directory).catch(() => undefined);
  if (directory?.isDirectory() !== true) {
    throw new SessionRefusal("LAUNCH_FAILED", `${spec.directory} is not a directory`);
  }
  // Asked in the same synchronous step as the session is registered, past every await above: a launch beside this
  // one may have registered the id since a resume's own check, and none may replace another's entry.
  if (hostedSessions().has(sessionId)) {
    throw new SessionRefusal("LAUNCH_FAILED", `session ${sessionId} is already hosted by this run of the app`);
  }
  const minted = tokens.fresh();
  if (minted.isErr()) {
    throw new SessionRefusal("LAUNCH_FAILED", minted.error);
  }
  const launchToken = minted.value;
  applySessionEvent({ event: { atIso: new Date().toISOString(), kind: "prepared", launchToken, sessionId, spec } });
  const refuse = (why: string): never => {
    applySessionEvent({ event: { atIso: new Date().toISOString(), failed: true, kind: "gone", sessionId } });
    throw new SessionRefusal("LAUNCH_FAILED", why);
  };
  const cardUrl = sessionCardUrl({ note: undefined, snapshot: snapshotOf({ sessionId }) });
  const card = await openSessionCard({
    host: {
      // Never rejects: a press waiting on it, or nobody, is handed a stop that has finished either way.
      stop: async ({ link }) =>
        stopFromCard({
          closeThroughVerb: host.closeThroughVerb,
          ledgerHome: spec.ledgerHome,
          sessionId: link.sessionId,
        }).catch((error: unknown) => {
          noteSession({ note: `Stop failed: ${error instanceof Error ? error.message : String(error)}`, sessionId });
        }),
      titleFor: host.titleFor,
    },
    sessionId,
    title: spec.title,
    url: cardUrl,
  });
  if (card.isErr()) {
    return refuse(card.error);
  }
  // A close answered while the card opened ended a session that held no group and journalled nothing, so starting
  // the worker now would run, and journal open, a session its owner already stopped.
  if (snapshotOf({ sessionId }).state !== "starting") {
    throw new SessionRefusal("LAUNCH_FAILED", "the session was closed while its card was opening");
  }
  const lease = mintVisibleLease({
    cardUrl,
    config: worker.config,
    window: card.value,
    workerEntry: worker.workerEntry,
  });
  if (lease.isErr()) {
    return refuse(lease.error);
  }
  const started = launchSessionWorker({ inherited: host.childEnvironment(), lease: lease.value });
  holdWorker({ sessionId, worker: started });
  // A throw is a failure too: it must reach the failed stop below, never leave the worker's group running.
  const failure = await recordLaunch({
    config: worker.config,
    pid: started.pid,
    seams: {
      execPath: process.execPath,
      now: () => new Date().toISOString(),
      record: recordRecovery,
      settle: async () => untilSettled({ sessionId, worker: started }),
    },
    sessionId,
    spec,
  }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  if (failure !== undefined) {
    noteSession({ note: failure, sessionId });
    // Failed, never an asked-for close: a worker that crashed before ready must not be journalled closed.
    await stopSession({ failed: true, sessionId });
    throw new SessionRefusal("LAUNCH_FAILED", failure);
  }
  // A Stop pressed while the worker started holds its group and closes it; a ready report already in flight still
  // records the launch, so the launch the owner stopped is refused here, never answered prepared.
  const afterReady = hostedSessions().get(sessionId)?.snapshot.state;
  if (afterReady !== "idle" && afterReady !== "running") {
    throw new SessionRefusal("LAUNCH_FAILED", "the session was stopped while it was starting");
  }
  const prepared: AppHarnessResponse = { kind: "prepared", launchToken, session: snapshotOf({ sessionId }) };
  tokens.issue({ launchToken, sessionId });
  return prepared;
}

/**
 * The recorded sessions a `launch.resume` is checking or starting now. Its checks await the journal and the process
 * table before the session is hosted, so a second resume of the same id inside that window would pass them too.
 */
const resuming = new Set<string>();

/**
 * Continue a recorded session, refusing a second resume of it while the first is still checking or starting.
 *
 * @param sessionId the recorded session to continue under its own id
 * @param spec what to launch, checked against the session's opened row
 * @param host what the control plane reaches in the rest of the app
 * @returns the prepared answer
 */
export async function resumeSessionOnce({
  sessionId,
  spec,
  host,
}: {
  sessionId: string;
  spec: AppLaunchSpec;
  host: SessionControlHost;
}): Promise<AppHarnessResponse> {
  if (resuming.has(sessionId)) {
    throw new SessionRefusal("LAUNCH_FAILED", `session ${sessionId} is already being resumed`);
  }
  resuming.add(sessionId);
  try {
    const ready = await readyToResume({ sessionId, spec });
    if (ready.isErr()) {
      throw new SessionRefusal("LAUNCH_FAILED", ready.error);
    }
    return await prepareSession({ continuation: { sessionId, vendorSessionId: ready.value }, host, spec });
  } finally {
    resuming.delete(sessionId);
  }
}

/**
 * Settle a launch token once, for the `launch.deliver` or `launch.abort` that names it.
 *
 * @param launchToken the token a prepared answer carried
 * @returns the session the token was issued for, still hosted under that very token
 */
export function sessionForToken({ launchToken }: { launchToken: string }): string {
  const settled = tokens.settle({ launchToken });
  if (settled.isErr()) {
    throw new SessionRefusal("SESSION_NOT_FOUND", settled.error);
  }
  // The session must still be hosted under this very token, exactly as the launch registered it.
  if (hostedSessions().get(settled.value)?.launchToken !== launchToken) {
    throw new SessionRefusal("SESSION_NOT_FOUND", "no launch is waiting on that token");
  }
  return settled.value;
}
