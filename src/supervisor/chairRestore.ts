/**
 * THE RESTORE — a chair a safeguard fallback knocked off Fable puts ITSELF back, and the owner's hand is not
 * needed.
 *
 * ## The ruling this exists for
 *
 * The gate catches every trip and would still cost the owner something every time. The rule is the option that
 * costs the least effort from the owner, ideally none: the chair switches back itself, because the owner's hand
 * is not needed when the trips seen have only ever been false positives.
 *
 * Without this the gate's only remedy is the expensive one — write a handoff, spawn a fresh chair. That runs
 * cleanly and costs a chair, and the owner can fix it with one `/model`, which is the keystroke this module
 * removes.
 *
 * ## It is possible, and it was measured rather than assumed
 *
 * MEASURED in a running session's own transcript: a
 * `slopweaver cmux send --workspace <its own> "/model sonnet"` flipped that RUNNING session mid-turn — five
 * assistant records carry `claude-sonnet-5` — and `/model opus` flipped it back. No keystroke from the owner,
 * no `--interrupt`, and NO transcript record at all, because Claude Code consumes `/model` as a local command.
 * That last part is why this is not the thing `cmux/supervisorWorkspace.ts` refuses: nothing lands in the owner's box
 * that could be read as the owner's own words. Repro:
 *
 * ```bash
 * grep -o '"model":"claude-[a-z0-9.-]*"' <transcript> | sort | uniq -c
 * ```
 *
 * Both doors were already open for this. `cmux/supervisorWorkspace.ts`'s `supervisorSendRefusal` and
 * `admit/cmuxSendSupervisorGuard.ts` each refuse a reach at the pinned supervisor only when the CALLER is
 * somebody else; a session reaching its own workspace was never the reach they guard.
 *
 * ## Three things it deliberately does not do
 *
 * - **It does not let the tick pass.** The new model lands at the next turn boundary, so a gate that recorded
 *   a tick on the strength of a send it cannot yet verify would be the exact untruth the gate was built to stop.
 *   The tick still refuses; the NEXT one passes on its own.
 * - **It does not claim the chair is back on Fable.** It says a restore was SENT. `chairModel.ts` reading a
 *   later Fable turn is the only thing that ever says it worked.
 * - **It does not retry forever.** A send that never takes — Fable unavailable, the alias unresolved, the
 *   wrong tab focused — would otherwise re-send every tick and never escalate. Past
 *   {@link MAX_RESTORE_ATTEMPTS} for one fallback instant the plan is `exhausted` and the handoff leads again.
 *
 * Pure: a read and a count in, a decision and lines out. The send is `cli/commands/supervisor/chairGateRun.ts`.
 */
import { type ChairLocation, type ChairRead, chairHandoffRemedyLines } from "./chairGate.js";
import {
  type ChairModelFamily,
  type ChairRequirement,
  chairModelLabel,
  restoreCommandFor,
  verdictAgainst,
} from "./chairPolicy.js";

/**
 * How many times one fallback instant may be answered with a `/model fable` send before the chair stops
 * trying and the handoff leads again.
 *
 * TWO, and the two are different attempts rather than a round number. cmux addresses a WORKSPACE and nothing
 * maps a Claude session id to a SURFACE, so the first send can legitimately land on the wrong tab of a
 * two-tab workspace; a second is a real retry. A third would be evidence the send does not reach at all, and
 * at that point the honest answer is the expensive one, not another line typed into a box nobody is reading.
 */
export const MAX_RESTORE_ATTEMPTS = 2;

/** What the chair should do about its own model this tick. */
export type ChairRestorePlan =
  /** Send `/model <target>` into `workspaceId` — the process running this IS inside the pinned workspace. */
  | {
      readonly kind: "attempt";
      readonly workspaceId: string;
      /** The family the send moves the seat onto: the requirement's, and never another. */
      readonly target: ChairModelFamily;
      readonly text: string;
      /** The key {@link chairRestoreKey} produced, so the caller records the attempt against the same one. */
      readonly key: string;
      /** Every off-Fable session this is meant to move, for the line the reader gets. */
      readonly sessionIds: readonly string[];
    }
  /** This process is not running inside the pinned workspace, so it has no tab of its own to type into. */
  | { readonly kind: "not-self"; readonly why: string }
  /** Nothing is off Fable — the gate refused over an unread or unresolved chair, which a send cannot fix. */
  | { readonly kind: "nothing-to-restore"; readonly why: string }
  /** {@link MAX_RESTORE_ATTEMPTS} sends have already answered this same fallback instant. */
  | { readonly kind: "exhausted"; readonly why: string; readonly key: string };

/** What happened when the caller performed an `attempt`. */
export interface ChairRestoreOutcome {
  readonly sent: boolean;
  /** What the send reported — its disposition when it worked, the failure message when it did not. */
  readonly detail: string;
}

/**
 * The key one fallback instant is counted under.
 *
 * The INSTANT rather than the session alone, so a second trip in the same chair gets its own fresh budget
 * instead of inheriting an exhausted one. A verdict carrying no fallback record still gets a key — somebody
 * may have typed `/model opus` by hand — and its own newest-turn instant is the stable thing to use.
 *
 * A send toward Opus (the lean shape, `./chairPolicy.ts`) carries its target in the key, so a seat restored onto
 * Fable at one instant and then asked onto Opus at the same instant gets its own budget. A Fable key keeps the
 * shape the attempt ledger already holds, so no past attempt is re-counted.
 *
 * @param sessionId the off-model session
 * @param atIso the fallback's instant, or the session's newest turn when no fallback record was read
 * @param target the family the send moves the seat onto
 * @returns the counting key
 */
export function chairRestoreKey({
  sessionId,
  atIso,
  target,
}: {
  sessionId: string;
  atIso: string;
  target: ChairModelFamily;
}): string {
  if (target === "fable") {
    return `${sessionId}@${atIso}`;
  }
  return `${sessionId}@${atIso}>${target}`;
}

/**
 * Whether this process may type into the chair: a chair restores only its own cmux seat, and an app-hosted chair has
 * no way to take a typed model switch at all.
 *
 * @param callerWorkspaceId this process's own `CMUX_WORKSPACE_ID`, or `undefined` outside cmux
 * @param location where the chair read resolved the chair
 * @returns the workspace to type into when this process IS the chair's, else why not
 */
function restoreSeat({
  callerWorkspaceId,
  location,
}: {
  callerWorkspaceId: string | undefined;
  location: ChairLocation;
}): { readonly kind: "self"; readonly workspaceId: string } | { readonly kind: "not-self"; readonly why: string } {
  if (location.kind === "app") {
    return {
      kind: "not-self",
      why: "the chair is a session the desktop app hosts, and the app has no way to type a model switch into it — the handoff below is the remedy",
    };
  }
  const { workspaceId } = location;
  const caller = callerWorkspaceId === undefined ? "" : callerWorkspaceId.trim();
  if (caller.length === 0) {
    return {
      kind: "not-self",
      why: "this process is not running inside a cmux workspace (no CMUX_WORKSPACE_ID), so it has no surface of its own to type into",
    };
  }
  if (caller !== workspaceId) {
    return {
      kind: "not-self",
      why: `this process runs in workspace ${caller}, not the pinned supervisor workspace ${workspaceId} — typing into somebody else's chair is the reach cmux/supervisorWorkspace.ts refuses`,
    };
  }
  return { kind: "self", workspaceId };
}

/**
 * Decide whether the chair should type its own model back this tick.
 *
 * @param read what the chair gate read
 * @param callerWorkspaceId this process's own `CMUX_WORKSPACE_ID`, or `undefined` outside cmux
 * @param attemptsFor how many sends have already answered a given key — the store, injected
 * @param requirement what the chair must be on; the restore only ever types THAT model, never another
 * @returns the decision, and the key the caller must record an attempt against when it is `attempt`
 */
export function planChairRestore({
  read,
  callerWorkspaceId,
  attemptsFor,
  requirement,
}: {
  read: ChairRead;
  callerWorkspaceId: string | undefined;
  attemptsFor: (options: { key: string }) => number;
  requirement: ChairRequirement;
}): ChairRestorePlan {
  if (requirement.kind === "claude-unavailable") {
    return { kind: "nothing-to-restore", why: `${requirement.why}, so there is no model to switch to` };
  }
  const target = requirement.model;
  const label = chairModelLabel({ model: target });
  if (read.kind === "unresolved") {
    return {
      kind: "nothing-to-restore",
      why: `the chair could not be read at all (${read.why}), so there is no session to type into`,
    };
  }
  const offModel = read.sessions.filter(
    (reading) => verdictAgainst({ model: target, verdict: reading.verdict }) === "violates",
  );
  const [first] = offModel;
  if (first === undefined || first.verdict.kind === "unreadable") {
    return {
      kind: "nothing-to-restore",
      why: `no session in the pinned workspace is off ${label} — the gate refused over an unread transcript, which a model switch cannot repair`,
    };
  }
  const seat = restoreSeat({ callerWorkspaceId, location: read.location });
  if (seat.kind === "not-self") {
    return seat;
  }
  const { workspaceId } = seat;
  let instant = first.verdict.atIso;
  if (first.verdict.kind === "off-fable" && first.verdict.fallback !== undefined) {
    instant = first.verdict.fallback.atIso;
  }
  const key = chairRestoreKey({ atIso: instant, sessionId: first.sessionId, target });
  const already = attemptsFor({ key });
  if (already >= MAX_RESTORE_ATTEMPTS) {
    return {
      key,
      kind: "exhausted",
      why: `${String(already)} restore send(s) have already answered this same fallback (${instant}) and the chair is still off ${label}, so the send is not reaching it`,
    };
  }
  return {
    key,
    kind: "attempt",
    sessionIds: offModel.map((reading) => reading.sessionId),
    target,
    text: restoreCommandFor({ model: target }),
    workspaceId,
  };
}

/** The line that says a restore was sent, never that it worked. */
function sentLines({ plan, outcome }: { plan: ChairRestorePlan; outcome: ChairRestoreOutcome }): readonly string[] {
  if (plan.kind !== "attempt") {
    return [];
  }
  if (!outcome.sent) {
    return [
      `RESTORE FAILED: \`${plan.text}\` could not be sent to this workspace (${outcome.detail}) — the handoff below is the remedy.`,
    ];
  }
  const label = chairModelLabel({ model: plan.target });
  // "a Fable turn" is the wording the fill shape has always printed, kept byte for byte; Opus takes "an".
  let article = "a";
  if (/^[AEIOU]/iu.test(label)) {
    article = "an";
  }
  return [
    `RESTORE SENT: \`${plan.text}\` has been typed into this workspace (${outcome.detail}). That is a send, NOT a ` +
      "confirmation — Claude Code applies it at the next turn boundary, so THIS tick still refuses and the next " +
      `one passes on its own once ${article} ${label} turn lands. Nothing is owed to the owner.`,
    `If the next tick still reads off ${label}, the send is not reaching the right tab (${String(
      plan.sessionIds.length,
    )} session(s) live in this workspace, and cmux addresses a workspace rather than a session) — take the handoff below.`,
  ];
}

/**
 * The remedy a refused chair reads, restore first and the handoff behind it.
 *
 * @param plan what {@link planChairRestore} decided
 * @param outcome what the send reported, when one was made
 * @param required the family the chair must be on, which the handoff's fresh chair is spawned with
 * @returns the remedy lines, in the order the chair should act on them
 */
export function chairRestoreLines({
  plan,
  outcome,
  required,
}: {
  plan: ChairRestorePlan;
  outcome: ChairRestoreOutcome | undefined;
  required: ChairModelFamily;
}): readonly string[] {
  const handoff = chairHandoffRemedyLines({ required });
  if (plan.kind === "attempt" && outcome !== undefined) {
    return [...sentLines({ outcome, plan }), ...handoff];
  }
  if (plan.kind === "exhausted") {
    return [`NO RESTORE: ${plan.why}.`, ...handoff];
  }
  if (plan.kind === "not-self") {
    return [
      `NO RESTORE: ${plan.why}. A chair restores only its OWN seat; report this to the supervisor instead of typing into it.`,
      ...handoff,
    ];
  }
  if (plan.kind === "nothing-to-restore") {
    return [`NO RESTORE: ${plan.why}.`, ...handoff];
  }
  return handoff;
}
