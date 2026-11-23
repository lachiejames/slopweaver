/**
 * The `tick close` gate that makes a tripped fleet health verdict impossible to leave unposted: a tick is refused
 * while `fleet-unhealthy` is firing and its card is not open in the hand register.
 *
 * Automations failing fleet-wide, resyncs dying mid-run and an unhealthy bot can all stand at once with none
 * reaching the owner, unless the chair's sweep runs the monitor that says so. The sweep runs it at tick open; this is what
 * makes skipping that run — or a run whose post failed — a refusal rather than a quiet gap.
 *
 * ## The read is a rehearsal, so the gate asks exactly the question the pass answers
 *
 * The shell runs `monitor check --only fleet-unhealthy` WITHOUT `--fire` over the live register: a card already
 * open answers nothing (the condition is posted), a card the pass WOULD post is the tripped verdict nobody posted.
 * No second criterion is invented here — the gate and the post agree by construction. A card the owner pressed Done on
 * while nothing has changed is HELD by the pass (`../monitor/fleetHealthDelta.ts`), a `held` row that is neither
 * posted nor refused, so their Done passes the gate; only news the pass would show is a card nobody posted.
 *
 * ## An open card is not a note on the owner's screen
 *
 * The pass raises a card's note once, on arrival, and an open card is never raised again. A raise that failed after
 * the append, a panel that died, or a restart leaves the card open and the owner's screen empty, so the gate also reads each
 * open card's note (a close would otherwise pass exactly that tick). A note the owner took down themselves is
 * `dismissed` and passes — Later is their answer, and re-raising over it is the flood this monitor must not be. No note
 * gives way to another: every note stacks, so an `absent` note the owner did not take down is
 * always owed again, whatever else is up.
 *
 * Each note is judged at the instant the shell READS it, never at the tick's: a live panel beats about once a second,
 * so against an instant taken before the close's slower reads its newest beat is in the future and every note on the owner's
 * screen read as gone — four refusals in a row, each straight after the fire that raised the note.
 *
 * ## One judge, two monitors
 *
 * `steer-at-risk` is held to the same question (`../cli/commands/supervisor/steerRiskRead.ts`): a steered deliverable at risk whose note is
 * not up is the same unposted escalation, so `judgeMonitorEscalation` takes the monitor it judges.
 *
 * Pure: the read is the shell's (`src/cli/commands/supervisor/fleetHealthRead.ts`), taken once.
 */
import type { NoteStanding } from "../hand/note/raise.js";
import type { PassOutcome } from "../monitor/pass.js";
import type { MonitorId } from "../monitor/types.js";

/** The monitor this gate reads. */
export const FLEET_HEALTH_MONITOR = "fleet-unhealthy";

/** What the shell read: one rehearsal pass of one escalating monitor and its open cards' notes, or why not. */
export type EscalationRead =
  | {
      readonly kind: "read";
      readonly outcome: PassOutcome;
      /** Where the note of each of the monitor's open cards stands. */
      readonly notes: readonly { readonly stepId: string; readonly standing: NoteStanding }[];
    }
  | { readonly kind: "unreadable"; readonly why: string };

/** The gate's verdict on one tick. */
export type EscalationVerdict =
  | { readonly kind: "clean" }
  | {
      readonly kind: "refused";
      /** What the verdict says is failing — the firing subject's own label. */
      readonly label: string;
      /** One line per card the pass would post, or per refusal that stopped one. */
      readonly unposted: readonly string[];
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Judge one tick of the fleet health monitor.
 *
 * @param read what the shell read
 * @returns the verdict
 */
export function judgeFleetHealthEscalation({ read }: { read: EscalationRead }): EscalationVerdict {
  return judgeMonitorEscalation({ monitorId: FLEET_HEALTH_MONITOR, read });
}

/**
 * Judge one tick of one escalating monitor: refused while it is firing and a card is not open, or open with no note
 * up that the owner did not take down; unreadable when the pass could not run or could not measure; clean otherwise.
 *
 * @param monitorId the escalating monitor the read was taken of
 * @param read what the shell read
 * @returns the verdict
 */
export function judgeMonitorEscalation({
  monitorId,
  read,
}: {
  monitorId: MonitorId;
  read: EscalationRead;
}): EscalationVerdict {
  if (read.kind === "unreadable") {
    return read;
  }
  const reading = read.outcome.readings.find((one) => one.monitorId === monitorId);
  if (reading === undefined) {
    return { kind: "unreadable", why: `the pass returned no ${monitorId} reading` };
  }
  if (reading.state === "unmeasurable") {
    return { kind: "unreadable", why: reading.because };
  }
  if (reading.state !== "firing") {
    return { kind: "clean" };
  }
  const unposted = read.outcome.actions
    .filter((action) => action.monitorId === monitorId)
    .filter((action) => action.kind === "posted" || action.kind === "refused")
    .map((action) => `${action.stepId} — ${action.detail}`);
  const unshown = read.notes
    .filter((note) => note.standing === "absent")
    .map(
      (note) =>
        `${note.stepId} — its card is open but its note is not on screen and the owner did not take it down; ` +
        `\`slopweaver hand show ${note.stepId}\` raises it`,
    );
  if (unposted.length === 0 && unshown.length === 0) {
    return { kind: "clean" };
  }
  return {
    kind: "refused",
    label: reading.subjects.map((subject) => subject.label).join("; "),
    unposted: [...unposted, ...unshown],
  };
}
