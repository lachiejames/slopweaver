/**
 * What a Recovery press reads of the supervisor before deciding whether to restart it, pure: the pin record, the
 * sessions the desktop app runs, and — for a chair cmux hosted — whether cmux's STRICT inventory still lists it.
 *
 * **Live is what the host says, never how recently the chair spoke.** A pinned app session the app still runs, or a
 * pinned workspace the strict inventory still lists, is live however quiet it is; the owner retires one by pressing
 * Stop on it, then Recovery. A cmux chair is called gone only on a strict inventory that read whole, the same test
 * `cmux takeover` holds it to (`../supervisor/gonePredecessor.ts`).
 *
 * **Starting is a successor already running.** An app session running on a `fresh-supervisor-handoff-<n>` doc that
 * does not hold the pin is a chair on its way to taking it, so a second press opens no second one beside it.
 */
import type { AppSessionSnapshot } from "../sessionHarness/appProtocol.js";
import { type SupervisorPinTarget, supervisorPinTarget } from "../sessions/supervisorPin.js";
import type { SupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import { gonePredecessorLabel } from "../supervisor/gonePredecessor.js";
import { appSessionEnded, type RecoveryChairReading } from "./recoveryChair.js";
import { boundedReason } from "./recoveryCheck.js";
import { successorNumberOf } from "./recoverySuccessor.js";

/** What cmux's strict inventory says of the workspace a cmux pin record names. */
export type CmuxChairPresence =
  { readonly kind: "listed" } | { readonly kind: "absent" } | { readonly kind: "unreadable"; readonly why: string };

/** The press's verdict before the predecessor's run is read: a down one carries the chair it would replace. */
export type RecoveryChairVerdict =
  | Exclude<RecoveryChairReading, { kind: "down" }>
  | {
      readonly kind: "down";
      readonly why: string;
      readonly target?: SupervisorPinTarget;
      /** The predecessor as the app still lists it, ended, when it was an app chair the app remembers. */
      readonly listed?: AppSessionSnapshot;
    };

/** The successor already running beside a down chair, when there is one. */
function bootingSuccessor({ sessions }: { sessions: readonly AppSessionSnapshot[] }): AppSessionSnapshot | undefined {
  return sessions.find(
    (session) =>
      !appSessionEnded({ state: session.state }) && successorNumberOf({ slug: session.ledgerKey }) !== undefined,
  );
}

/** A down chair, unless a successor is already starting. */
function downOrBooting({
  sessions,
  down,
}: {
  sessions: readonly AppSessionSnapshot[];
  down: Extract<RecoveryChairVerdict, { kind: "down" }>;
}): RecoveryChairVerdict {
  const booting = bootingSuccessor({ sessions });
  if (booting !== undefined) {
    return { kind: "booting", label: booting.handle, slug: booting.ledgerKey };
  }
  return down;
}

/** The verdict for an app pin record. */
function appVerdict({
  target,
  sessions,
}: {
  target: Extract<SupervisorPinTarget, { kind: "app" }>;
  sessions: readonly AppSessionSnapshot[];
}): RecoveryChairVerdict {
  const label = gonePredecessorLabel({ target });
  const listed = sessions.find((session) => session.sessionId === target.appSessionId);
  if (listed === undefined) {
    return downOrBooting({
      down: { kind: "down", target, why: `the desktop app no longer runs the supervisor on ${label}` },
      sessions,
    });
  }
  if (!appSessionEnded({ state: listed.state })) {
    return { kind: "live", label };
  }
  return downOrBooting({
    down: { kind: "down", listed, target, why: `the supervisor on ${label} was ${listed.state}` },
    sessions,
  });
}

/** The verdict for a cmux pin record. */
function cmuxVerdict({
  target,
  sessions,
  cmux,
}: {
  target: Extract<SupervisorPinTarget, { kind: "cmux" }>;
  sessions: readonly AppSessionSnapshot[];
  cmux: CmuxChairPresence;
}): RecoveryChairVerdict {
  const label = gonePredecessorLabel({ target });
  if (cmux.kind === "listed") {
    return { kind: "live", label };
  }
  if (cmux.kind === "unreadable") {
    return {
      kind: "unknown",
      why: boundedReason({
        text: `cmux could not confirm whether the supervisor's workspace ${label} still runs: ${cmux.why}`,
      }),
    };
  }
  return downOrBooting({
    down: { kind: "down", target, why: `cmux no longer lists the supervisor's workspace ${label}` },
    sessions,
  });
}

/**
 * Read the supervisor from the pin record and its hosts.
 *
 * @param disposition the supervisor pin record, read strictly
 * @param sessions every session the desktop app runs, ended ones included
 * @param cmux what cmux's strict inventory says of the workspace a cmux record names; read only for one
 * @returns live, starting, down with the chair it would replace, or why it cannot be told
 */
export function recoveryChairVerdictOf({
  disposition,
  sessions,
  cmux,
}: {
  disposition: SupervisorPinDisposition;
  sessions: readonly AppSessionSnapshot[];
  cmux: CmuxChairPresence | undefined;
}): RecoveryChairVerdict {
  if (disposition.kind === "unreadable") {
    return {
      kind: "unknown",
      why: boundedReason({ text: `the supervisor pin record could not be read: ${disposition.why}` }),
    };
  }
  if (disposition.kind === "absent") {
    return downOrBooting({ down: { kind: "down", why: "no supervisor is pinned" }, sessions });
  }
  const target = supervisorPinTarget({ pin: disposition.record });
  if (target.kind === "app") {
    return appVerdict({ sessions, target });
  }
  if (cmux === undefined) {
    return {
      kind: "unknown",
      why: `cmux was not asked whether the supervisor's workspace ${target.workspaceRef} still runs`,
    };
  }
  return cmuxVerdict({ cmux, sessions, target });
}
