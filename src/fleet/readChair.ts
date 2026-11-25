/**
 * The chair's half of what `fleet health` judges, read offline: who the supervisor pin names, and the newest sweep
 * that workspace closed on the tick ledger. `./read.ts` reads the rest.
 */
import type { CodexThreadObserver } from "../measurement/codexSessions.js";
import { supervisorPinLabel } from "../sessions/supervisorPin.js";
import { readSupervisorPin } from "../sessions/supervisorPinStore.js";
import { readRecordedChair } from "../supervisor/recordedChairHost.js";
import { claudeSessionIdOf } from "../supervisor/session.js";
import { parseSupervisorTickRow } from "../supervisor/tickSchema.js";
import { supervisorTickLedgerPath } from "../supervisor/tickStore.js";
import { readTickTailRecords } from "../talk/steeredCardsTicks.js";
import type { FleetChairSweep, FleetEvidence } from "./evidence.js";

/**
 * The newest sweep the pinned chair's workspace closed, off the tick ledger's last 8 MB — about a day of ticks, so a
 * chair that closed one in that window is found and an older one reads as none.
 *
 * @param home the state home whose ledger is read
 * @param workspaceRef the workspace the pin names
 * @returns the sweep, none, or why the tail could not be read
 */
function chairSweepOf({ home, workspaceRef }: { home: string; workspaceRef: string }): FleetChairSweep {
  const records = readTickTailRecords({ path: supervisorTickLedgerPath({ home }) });
  if (records.isErr()) {
    return { kind: "unreadable", why: records.error.message };
  }
  let newest: FleetChairSweep = { kind: "none" };
  for (const record of records.value) {
    if (record["workspace"] !== workspaceRef) {
      continue;
    }
    // The ledger's own schema decides what a sweep is, so a row only shaped like one, or one finalised before it
    // started, is never the chair working. Its first reason is enough to
    // name: the rest are often the same defect seen from every source.
    const row = parseSupervisorTickRow({ value: record });
    if (row.isErr()) {
      return { kind: "unreadable", why: `a tick row of ${workspaceRef} is not a valid tick: ${row.error[0]!}` };
    }
    const { finalisedIso, startedIso, tickId } = row.value;
    // The ledger's finalisations are monotonic, so the last one this workspace wrote is its newest.
    newest = { finalisedIso, kind: "swept", startedIso, tickId };
  }
  return newest;
}

/**
 * Who the pin names as the chair, and its newest sweep; a sweep record that could not be read joins `problems`.
 *
 * @param home the state home whose pin and tick ledger are read
 * @param problems the pass's unreadable-input list, appended to
 * @param codexThread asked only when the records name a Codex chair, so a Claude chair never pays for the scan
 * @returns the chair's fields of the evidence
 */
export function chairEvidenceOf({
  home,
  problems,
  codexThread,
}: {
  home: string;
  problems: string[];
  codexThread: CodexThreadObserver;
}): Pick<
  FleetEvidence,
  "chairCodex" | "chairPinnedAtIso" | "chairSessionId" | "chairSweep" | "chairUnresolved" | "chairWorkspaceRef"
> {
  const pin = readSupervisorPin({ home });
  // The chair names its own seat on each tick (`supervisor tick-draft --workspace`): a cmux ref, or `app:<id>` for a
  // chair the desktop app hosts, so the pin's label is the key either way.
  const seatLabel = pin === undefined ? undefined : supervisorPinLabel({ pin });
  const chairSweep: FleetChairSweep =
    seatLabel === undefined ? { kind: "none" } : chairSweepOf({ home, workspaceRef: seatLabel });
  if (chairSweep.kind === "unreadable") {
    problems.push(`the supervisor's sweeps could not be read: ${chairSweep.why}`);
  }
  // A Codex chair's thread id is never matched against the Claude session registry: a Claude session sharing the
  // string would read as the chair. With no pin, the chain's newest link names it, so a
  // chain-only Codex chair reads unread rather than as "nothing records which session is the supervisor".
  // Records too damaged to name the host are said, never read as "no chair recorded".
  // A refused chain line beside a valid Claude pin names no Claude chair either: it could be a newer Codex link
  // so the seat reads unresolved rather than judging the pin's Claude session.
  const recorded = readRecordedChair({ home });
  if (recorded.kind === "unresolved") {
    problems.push(`which session holds the chair could not be read: ${recorded.why}`);
    return {
      chairPinnedAtIso: pin?.pinnedAtIso,
      chairSessionId: undefined,
      chairSweep,
      chairUnresolved: recorded.why,
      chairWorkspaceRef: seatLabel,
    };
  }
  // A Codex chair's liveness is the open-file observation, positive only: `not-observed` is carried as it is and
  // never becomes "down" (Codex 4d plan, work 2).
  let observed: Pick<FleetEvidence, "chairCodex"> = {};
  if (recorded.kind === "session" && recorded.session.host === "codex") {
    const threadId = recorded.session.id;
    observed = { chairCodex: { observation: codexThread({ threadId }), threadId } };
  }
  return {
    ...observed,
    chairPinnedAtIso: pin?.pinnedAtIso,
    chairSessionId: claudeSessionIdOf({ session: pin?.session }),
    chairSweep,
    chairWorkspaceRef: seatLabel,
  };
}
