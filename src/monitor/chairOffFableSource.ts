/**
 * The source half of `chair-off-fable`: the supervisor pin and the session ledger, read and projected onto the
 * boot model the evaluator (`./evaluate.ts`) judges.
 *
 * A leaf of `./sources.ts` for the reason `./fleetHealthSource.ts` and the other `*Source.ts` modules are: the
 * registry file lists every monitor's read, and this one carries a ledger scan of its own. A failed read is
 * `unmeasurable`, never `clear`, as everywhere in that file.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";

import { readSessionLogText } from "../sessions/sessionStore.js";
import { cmuxHeldPin, supervisorPinLabel } from "../sessions/supervisorPin.js";
import { readSupervisorPin } from "../sessions/supervisorPinStore.js";
import { readRecordedChair } from "../supervisor/recordedChairHost.js";

import { type ChairInput, evaluateChairOffFable } from "./evaluate.js";
import type { MonitorReading } from "./types.js";

/**
 * The boot model the session ledger recorded for one workspace, when a row named it.
 *
 * The ledger is scanned for the LAST `spawned` row naming the ref, because a workspace can be re-seated: an
 * earlier row would report the predecessor's model, which is exactly the stale answer `cmux takeover` makes
 * possible.
 *
 * @param logText the session ledger's whole text, as `readSessionLogText` gives it
 * @param workspaceRef the pinned workspace's addressable ref
 * @returns what booted it, or `undefined` when no row named it
 */
export function bootModelForWorkspace({
  logText,
  workspaceRef,
}: {
  logText: string;
  workspaceRef: string;
}): ChairInput["bootModel"] {
  let found: ChairInput["bootModel"];
  for (const line of logText.split("\n")) {
    const booted = bootModelInLine({ line, workspaceRef });
    if (booted !== undefined) {
      found = booted;
    }
  }
  return found;
}

/**
 * The boot model ONE ledger line records for a workspace, when that line is a `spawned` row naming it.
 *
 * Every other line — blank, unparseable, another workspace's, another kind's, or a `spawned` row whose
 * `bootModel` is a shape this does not know — answers `undefined`, which the caller reads as "this line says
 * nothing" and NOT as "this workspace has no boot model". That distinction is why the scan keeps the last
 * answer rather than the last line.
 *
 * @param line one raw line of the session ledger
 * @param workspaceRef the pinned workspace's addressable ref
 * @returns what this line says booted it, or `undefined` when it says nothing
 */
function bootModelInLine({ line, workspaceRef }: { line: string; workspaceRef: string }): ChairInput["bootModel"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["kind"] !== "spawned" || parsed["workspaceRef"] !== workspaceRef) {
    return undefined;
  }
  const bootModel = parsed["bootModel"];
  if (!isRecord(bootModel)) {
    return undefined;
  }
  if (bootModel["kind"] === "inherited") {
    return { kind: "inherited" };
  }
  const model = bootModel["model"];
  if (bootModel["kind"] === "pinned" && typeof model === "string") {
    return { kind: "pinned", model };
  }
  return undefined;
}

/**
 * Read and evaluate `chair-off-fable` off the supervisor pin and the session ledger.
 *
 * A pin naming a Codex thread is `unmeasurable`, never judged off the ledger: a `spawned` row for that workspace
 * describes a Claude session booted there, not the Codex chair, so a Fable row would read the chair clear. With no
 * pin, a Codex thread the chain's newest link names is `unmeasurable` the same way, never read as
 * an unpinned chair. Records too damaged to name the host are `unmeasurable` too. Fable is not asked of a Codex chair
 * at all (AGENTS.md rule 5).
 *
 * @param home the state home the pin and the ledger live under
 * @returns the monitor's reading
 */
export function readChairOffFable({ home }: { home: string }): MonitorReading {
  const recorded = readRecordedChair({ home });
  if (recorded.kind === "unresolved") {
    return { because: recorded.why, monitorId: "chair-off-fable", state: "unmeasurable" };
  }
  const pin = readSupervisorPin({ home });
  if (pin === undefined) {
    if (recorded.kind === "session" && recorded.session.host === "codex") {
      return {
        because: `no supervisor pin is recorded, and the chain's newest link names Codex thread ${recorded.session.id.slice(0, 8)}, which has no Fable requirement and no Claude boot model to read`,
        monitorId: "chair-off-fable",
        state: "unmeasurable",
      };
    }
    return evaluateChairOffFable({ chair: { bootModel: undefined, workspaceRef: undefined } });
  }
  if (pin.session.host === "codex") {
    return {
      because: `the supervisor pin names a Codex thread in ${supervisorPinLabel({ pin })}, which has no Fable requirement and no Claude boot model to read`,
      monitorId: "chair-off-fable",
      state: "unmeasurable",
    };
  }
  // The session ledger's boot rows are keyed by cmux workspace; an app-hosted chair was never booted into one.
  const cmux = cmuxHeldPin({ pin });
  if (cmux === undefined) {
    return {
      because: `the supervisor pin names ${supervisorPinLabel({ pin })}, a session the desktop app hosts, and the session ledger records boot models only for cmux workspaces`,
      monitorId: "chair-off-fable",
      state: "unmeasurable",
    };
  }
  let logText: string;
  try {
    logText = readSessionLogText({ home });
  } catch (cause) {
    return {
      because: `the session ledger could not be read: ${errorMessage({ error: cause })}`,
      monitorId: "chair-off-fable",
      state: "unmeasurable",
    };
  }
  return evaluateChairOffFable({
    chair: {
      bootModel: bootModelForWorkspace({ logText, workspaceRef: cmux.workspaceRef }),
      workspaceRef: cmux.workspaceRef,
    },
  });
}
