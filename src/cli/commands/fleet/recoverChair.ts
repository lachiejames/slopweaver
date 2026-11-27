/**
 * The supervisor chair as `slopweaver fleet recover` reaches it: the pin record, the desktop app, cmux's strict
 * inventory for a chair cmux hosted, the predecessor's run, and `cmux spawn` run in-process. The decisions are pure
 * (`../../../fleet/recoveryChairReading.ts`, `../../../fleet/recoveryChair.ts`); this is the shell that reads and
 * writes for them, and every nested verb's output is collected so the verb's one JSON line stays the only stdout.
 *
 * **The predecessor is read the way `cmux takeover` will read it, before anything opens.** A chair that died
 * mid-run leaves its run open, and takeover refuses a predecessor whose run is not terminal, so its run is reaped
 * first — `handover reap`'s own decision, which writes `orphaned` only once the live-session registry proves the
 * writer gone — and then takeover's own predecessor gate runs. A refusal there means no successor could take the
 * pin, so none is opened and the press says why.
 *
 * **The successor is a visible app card.** `cmux spawn --harness app` opens it on the plan that just passed the
 * check, exactly as a chair's own hand-off seats one (`../../../supervisor/chairSuccessor.ts`'s
 * `successorSpawnLine`): Fable on a Claude plan, the fleet's Codex model on a Codex one. The spawn itself is
 * `../supervisor/chairSuccessorLaunch.ts`, shared with the control plane's chair hand-off.
 */

import type { RecoveryChairReading, RecoveryPinLook } from "../../../fleet/recoveryChair.js";
import {
  type CmuxChairPresence,
  type RecoveryChairVerdict,
  recoveryChairVerdictOf,
} from "../../../fleet/recoveryChairReading.js";
import { boundedReason, type RecoveryCandidate } from "../../../fleet/recoveryCheck.js";
import type { RecoveryChairDeps, RecoveryChairOpenFailure, RecoveryHost } from "../../../fleet/recoveryPassDeps.js";
import type { RecoveryPredecessor } from "../../../fleet/recoverySuccessor.js";
import { writeRecoverySuccessor } from "../../../fleet/recoverySuccessorStore.js";
import { planReap, reapCandidateOf } from "../../../handover/reap.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { collectOutput } from "../../../lib/outputCollect.js";
import { err, type Result } from "../../../lib/result.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import type { SupervisorPinTarget } from "../../../sessions/supervisorPin.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { gonePredecessorLabel, gonePredecessorLedgerRow } from "../../../supervisor/gonePredecessor.js";
import { gonePredecessorRunGate } from "../cmux/takeoverGone.js";
import { appPredecessorRunGate } from "../cmux/takeoverRow.js";
import { applyReap, reapLivenessSeams } from "../handover/reapRun.js";
import { launchChairSuccessor, realSuccessorSpawn } from "../supervisor/chairSuccessorLaunch.js";

export { spawnedChairOf } from "../supervisor/chairSuccessorLaunch.js";

/** What cmux's strict inventory says of the workspace a cmux record names. */
async function cmuxPresenceOf({
  target,
}: {
  target: Extract<SupervisorPinTarget, { kind: "cmux" }>;
}): Promise<CmuxChairPresence> {
  const inventory = await withCmuxSessionHost({ body: async ({ host }) => host.listWorkspacesStrict() });
  if (inventory.isErr()) {
    return { kind: "unreadable", why: inventory.error.message };
  }
  if (inventory.value.some((workspace) => workspace.workspaceId === target.workspaceId)) {
    return { kind: "listed" };
  }
  return { kind: "absent" };
}

/** The predecessor's handover slug, from the app's own record of it or its one open ledger row. */
function predecessorSlugOf({
  home,
  verdict,
  target,
}: {
  home: string;
  verdict: Extract<RecoveryChairVerdict, { kind: "down" }>;
  target: SupervisorPinTarget;
}): string | undefined {
  if (verdict.listed !== undefined) {
    return verdict.listed.ledgerKey;
  }
  const rows = foldSessions(parseSessionLog({ text: readSessionLogText({ home }) }));
  const row = gonePredecessorLedgerRow({ rows, target });
  if (row.isErr()) {
    return undefined;
  }
  return row.value.slug;
}

/** Reap the predecessor's open run when the registry proves its writer gone, as `handover reap` would. */
async function reapPredecessorRun({ home, slug }: { home: string; slug: string }): Promise<void> {
  const read = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug });
  if (read.isErr()) {
    return;
  }
  const candidate = reapCandidateOf({
    events: read.value.events,
    selfSessionIds: currentSessionIds({ env: process.env }),
    slug,
    unreadableLines: read.value.unreadable,
    ...reapLivenessSeams(),
  });
  if (candidate === undefined) {
    return;
  }
  await applyReap({ home, nowIso: new Date().toISOString(), plan: planReap({ candidates: [candidate] }) });
}

/** Takeover's own predecessor gate for this chair: its refusal, or the slug its run answers to. */
function takeoverGate({
  home,
  verdict,
  target,
}: {
  home: string;
  verdict: Extract<RecoveryChairVerdict, { kind: "down" }>;
  target: SupervisorPinTarget;
}): { readonly refusal: string } | { readonly slug: string } {
  if (target.kind === "app" && verdict.listed !== undefined) {
    return appPredecessorRunGate({ appSessionId: target.appSessionId, directory: verdict.listed.directory, home });
  }
  return gonePredecessorRunGate({ home, target });
}

/** A down chair with a predecessor, read as takeover will read it once its run is reaped. */
async function downOverPredecessor({
  home,
  verdict,
  target,
}: {
  home: string;
  verdict: Extract<RecoveryChairVerdict, { kind: "down" }>;
  target: SupervisorPinTarget;
}): Promise<RecoveryChairReading> {
  const label = gonePredecessorLabel({ target });
  const { value: gate } = await collectOutput({
    keepErrChars: 0,
    run: async () => {
      const slug = predecessorSlugOf({ home, target, verdict });
      if (slug !== undefined) {
        await reapPredecessorRun({ home, slug });
      }
      return takeoverGate({ home, target, verdict });
    },
  });
  if ("refusal" in gate) {
    return {
      kind: "unknown",
      why: boundedReason({ text: `${verdict.why}, but a new chair could not take over from it: ${gate.refusal}` }),
    };
  }
  return { kind: "down", predecessor: { label, slug: gate.slug }, why: verdict.why };
}

/**
 * What the supervisor is doing now, read before any card opens.
 *
 * @param home the state home the pin record, ledger and journals live under
 * @param host the desktop app, as the pass reaches it
 * @returns live, starting, down with the chair it replaces, or why it cannot be told
 */
async function readRecoveryChair({
  home,
  host,
}: {
  home: string;
  host: Pick<RecoveryHost, "list">;
}): Promise<RecoveryChairReading> {
  const listed = await host.list();
  if (listed.isErr()) {
    return {
      kind: "unknown",
      why: boundedReason({ text: `the desktop app could not be asked what it runs: ${listed.error}` }),
    };
  }
  const disposition = readSupervisorPinDisposition({ home });
  let cmux: CmuxChairPresence | undefined;
  if (disposition.kind === "pin" && !("appSessionId" in disposition.record)) {
    cmux = await cmuxPresenceOf({
      target: {
        kind: "cmux",
        workspaceId: disposition.record.workspaceId,
        workspaceRef: disposition.record.workspaceRef,
      },
    });
  }
  const verdict = recoveryChairVerdictOf({ cmux, disposition, sessions: listed.value });
  if (verdict.kind !== "down") {
    return verdict;
  }
  if (verdict.target === undefined) {
    return { kind: "down", why: verdict.why };
  }
  return downOverPredecessor({ home, target: verdict.target, verdict });
}

/**
 * Write a successor doc and seat a supervisor from it in a visible app card.
 *
 * @param home the state home the doc, ledger and spawn live under
 * @param candidate the plan that just passed the check
 * @param predecessor the chair it replaces, when one was pinned
 * @returns the doc's slug and the app's id for the new chair, or why it did not open
 */
async function openRecoveryChair({
  home,
  candidate,
  predecessor,
}: {
  home: string;
  candidate: RecoveryCandidate;
  predecessor: RecoveryPredecessor | undefined;
}): Promise<Result<{ readonly slug: string; readonly sessionId: string }, RecoveryChairOpenFailure>> {
  const repo = checkoutForRunningRepo({ home, verb: "fleet recover" });
  if (repo.isErr()) {
    return err({ reason: boundedReason({ text: `no main checkout to seat the chair in: ${repo.error.join("; ")}` }) });
  }
  const written = writeRecoverySuccessor({
    home,
    predecessor,
    repo: repo.value,
    writtenAtIso: new Date().toISOString(),
  });
  if (written.isErr()) {
    return err({ reason: boundedReason({ text: written.error.message }) });
  }
  return launchChairSuccessor({
    alias: candidate.alias,
    home,
    runSpawn: realSuccessorSpawn,
    slug: written.value.slug,
    vendor: candidate.vendor,
  });
}

/**
 * The supervisor pin as it reads now.
 *
 * @param home the state home the pin record lives under
 * @returns who holds it, or why it could not be read
 */
function recoveryPinLook({ home }: { home: string }): RecoveryPinLook {
  const disposition = readSupervisorPinDisposition({ home });
  if (disposition.kind === "absent") {
    return { kind: "none" };
  }
  if (disposition.kind === "unreadable") {
    return { kind: "unreadable", why: disposition.why };
  }
  if ("appSessionId" in disposition.record) {
    return { appSessionId: disposition.record.appSessionId, kind: "app" };
  }
  return { kind: "cmux", workspaceRef: disposition.record.workspaceRef };
}

/**
 * Close the board row of a doc whose chair never took the pin.
 *
 * @param home the state home the run journal lives under
 * @param slug the doc
 * @param why why its chair did not take the pin
 * @returns nothing, or why the row could not be closed
 */
function retireRecoveryChair({ home, slug, why }: { home: string; slug: string; why: string }): Result<void, string> {
  return applyRowEvent({
    event: {
      atIso: new Date().toISOString(),
      kind: "closed",
      residue: [],
      summary: boundedReason({
        text: `a Recovery press opened this chair and it did not take the supervisor pin: ${why}`,
      }),
    },
    runsDir: stateHomePaths({ home }).runs,
    slug,
  })
    .map(() => undefined)
    .mapErr((error) => error.message);
}

/**
 * The real chair, for one pass over one home.
 *
 * @param home the state home
 * @param host the desktop app, as the pass reaches it
 * @returns the chair deps
 */
export function realRecoveryChair({
  home,
  host,
}: {
  home: string;
  host: Pick<RecoveryHost, "list">;
}): RecoveryChairDeps {
  return {
    open: async ({ candidate, predecessor }) => openRecoveryChair({ candidate, home, predecessor }),
    pin: () => recoveryPinLook({ home }),
    read: async () => readRecoveryChair({ home, host }),
    retire: ({ slug, why }) => retireRecoveryChair({ home, slug, why }),
  };
}
