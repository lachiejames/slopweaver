/**
 * The gate `hand post` puts in front of a seat: only the pinned supervisor posts a floating note.
 *
 * ## Why this exists
 *
 * One floating note at most, and only the supervisor posts it — a seat carries what needs the owner as a line to the
 * supervisor or a board row, because a seat cannot see what else is on the owner's screen. A seat that posted a
 * note anyway left the owner to dismiss it themselves. The rule lived in a memory; nothing in the verb asked it.
 *
 * ## The criterion
 *
 * Identity is the caller's ENVIRONMENT, never `--by-session`, which is free text (the register holds "workspace:374",
 * "supervisor" and "unnamed-session" for the same chair). The pin record (`../sessions/supervisorPin.ts`) names the
 * chair's session, by host and id, and its cmux workspace; a caller carrying either identity, matching neither, is a seat. An
 * Agent-tool child inherits both from its parent, so a chair's subagent posts as the chair and a seat's as the seat.
 *
 * - **Inert with no pin recorded**, as every guard on that record is: being unregistered only ever makes it inert.
 * - **Inert with no session identity**: a caller carrying neither variable is not a seat.
 * - **The monitor lane is outside it**: `monitor check --fire` appends through the store, not this verb.
 *
 * The residue, stated: a tripwire, not a boundary (rule 3) — clearing both variables, or `--home` at another home,
 * walks past it. A chair pinned by hand in cmux is not in the record and is refused until `slopweaver cmux pin`
 * records it, a Codex chair's thread included; the hatch covers the gap.
 *
 * Pure: no filesystem. The caller supplies the pin record and the environment.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import {
  cmuxHeldPin,
  isRegisteredSupervisor,
  type SupervisorPinRecord,
  supervisorPinLabel,
} from "../sessions/supervisorPin.js";
import { detectSupervisorSession } from "../supervisor/session.js";

/**
 * The environment variable that lets a session outside the pin record post a step.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named reader
 * mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const SEAT_HAND_POST_HATCH = "SLOPWEAVER_ALLOW_SEAT_HAND_POST";

/** The cmux workspace a process runs in, as cmux sets it. */
const CMUX_WORKSPACE_ID_ENV = "CMUX_WORKSPACE_ID";

/** What `hand post` should do for the session asking. */
export type SeatPostVerdict =
  | { readonly kind: "ok" }
  /** Recordable past the hatch, but not silently. */
  | { readonly kind: "hatched"; readonly lines: readonly string[] }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * An environment value with surrounding space removed, or `undefined` when it is absent or blank.
 *
 * @param value the raw variable
 * @returns the trimmed value, or `undefined`
 */
function present({ value }: { value: string | undefined }): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

/**
 * The verdict on a session asking to post a hand step, with the hatch applied.
 *
 * @param pin the recorded supervisor pin, or `undefined` when none is recorded
 * @param env the process environment — the caller's identity and the hatch
 * @param command the door being refused, as the owner would type it
 * @returns `ok`, `hatched` with the line saying so, or the whole refusal to print
 */
export function seatPostVerdict({
  pin,
  env,
  command,
}: {
  pin: SupervisorPinRecord | undefined;
  env: Readonly<Record<string, string | undefined>>;
  command: string;
}): SeatPostVerdict {
  if (pin === undefined) {
    return { kind: "ok" };
  }
  const detection = detectSupervisorSession({ env });
  const workspace = present({ value: env[CMUX_WORKSPACE_ID_ENV] });
  if (detection.kind === "missing" && workspace === undefined) {
    return { kind: "ok" };
  }
  const holdsPin = detection.kind === "active" && isRegisteredSupervisor({ record: pin, session: detection.session });
  // Only a cmux pin names a workspace to match the caller's; an app-hosted chair is admitted by its session alone.
  const pinnedWorkspace = cmuxHeldPin({ pin })?.workspaceId;
  if (holdsPin || (pinnedWorkspace !== undefined && workspace === pinnedWorkspace)) {
    return { kind: "ok" };
  }
  const label = supervisorPinLabel({ pin });
  if (env[SEAT_HAND_POST_HATCH] === "1") {
    return {
      kind: "hatched",
      lines: [`admitted past ${SEAT_HAND_POST_HATCH}=1: this session is not the pinned supervisor ${label}`],
    };
  }
  const hatch = { ...hatchFor({ id: "seat-hand-post" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ detail: `the pinned supervisor is ${label}`, hatch }),
      "NOTHING was recorded: send the supervisor one line naming the step with SendMessage (ListAgents resolves its " +
        "name), never cmux send, or record it as a board row with `slopweaver handover ask`. If THIS session is " +
        "the chair, `slopweaver cmux pin` records it and the same command then posts.",
    ],
  };
}
