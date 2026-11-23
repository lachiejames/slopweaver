/**
 * Folding cmux's event stream into per-session state — the supervisor's second prong.
 *
 * The 20-minute sweep reads screens, and a screen read is a snapshot: anything that scrolled past between two
 * sweeps is simply gone, which is the owner's own complaint about it ("you can miss events higher up the
 * screen"). An event fold has the opposite failure mode — it sees every transition and none of the prose. The
 * two are complementary rather than competing, and this module is deliberately only the first half: it
 * answers *finished / waiting / churning / silent*, never *what did it decide*.
 *
 * Every function here is pure. The subscription that feeds it lives in `eventStream.ts`, and the cursor that
 * makes a restart resume rather than replay is committed with the fold, in one store row, by `eventState/`.
 */
import type { CmuxEvent } from "./events.js";

/** What one session's event history says about it, with no clock consulted. */
export interface SessionActivity {
  readonly workspaceId: string;
  /** The highest sequence number seen for this workspace, so a caller can order two folds. */
  readonly lastSeq: number;
  readonly lastEventAtIso: string;
  readonly lastEventName: string;
  /** When this session last ENDED a turn (`agent.hook.Stop`). */
  readonly lastTurnEndedAtIso: string | undefined;
  /** When this session last STARTED a turn (`agent.hook.UserPromptSubmit`). */
  readonly lastTurnStartedAtIso: string | undefined;
  /** When this session last booted (`agent.hook.SessionStart`). */
  readonly sessionStartedAtIso: string | undefined;
  /**
   * When this session last raised something needing a human — a `Notification` (permission request or an
   * idle prompt) or an `AskUserQuestion`. Cleared the moment the session demonstrably moves again.
   */
  readonly attentionSinceIso: string | undefined;
  /** Which of the two raised it, so a caller can say WHICH kind of attention without re-reading the stream. */
  readonly attentionKind: "notification" | "question" | undefined;
  /** Completed tool calls seen — `received` frames only, because every hook reports both phases. */
  readonly toolCalls: number;
  /** The session's working directory, the one field that ties a workspace to a worktree. */
  readonly cwd: string | undefined;
  /** The agent CLI's own session id, when its payloads named one. */
  readonly agentSessionId: string | undefined;
  /** Which agent CLI its hooks named (`claude`), when one did — the seat's host, never guessed from a title. */
  readonly agentSource: string | undefined;
}

/** The events that prove a session is moving again, so any pending attention flag is stale. */
const RESUMPTION_EVENTS = new Set(["agent.hook.UserPromptSubmit", "agent.hook.PreToolUse", "agent.hook.SessionStart"]);

/** An empty fold for one workspace, before its first event is applied. */
function empty({ workspaceId }: { workspaceId: string }): SessionActivity {
  return {
    agentSessionId: undefined,
    agentSource: undefined,
    attentionKind: undefined,
    attentionSinceIso: undefined,
    cwd: undefined,
    lastEventAtIso: "",
    lastEventName: "",
    lastSeq: 0,
    lastTurnEndedAtIso: undefined,
    lastTurnStartedAtIso: undefined,
    sessionStartedAtIso: undefined,
    toolCalls: 0,
    workspaceId,
  };
}

/** Which attention kind, if any, one event raises. */
function attentionKindOf({ event }: { event: CmuxEvent }): "notification" | "question" | undefined {
  if (event.name === "agent.hook.AskUserQuestion") {
    return "question";
  }
  return event.name === "agent.hook.Notification" ? "notification" : undefined;
}

/**
 * The agent session id after one `received` frame. A SessionStart begins another session, so it names its id or
 * leaves none, never carrying the one before it; any other frame naming none keeps the id. Only the `received` half
 * says so: a frame names no firing to pair its halves by, so a `completed` half cannot tell a lost `received` from a
 * late one, and a start whose `received` half never arrived keeps the old id.
 *
 * @returns the id the session now carries, or `undefined` when none is known
 */
function sessionIdAfter({ state, event }: { state: SessionActivity; event: CmuxEvent }): string | undefined {
  // An empty id names no session: the transcript reader refuses one as "no session id was given". A fold persisted
  // before this read could carry one, so the kept id is read the same way.
  const named = event.sessionId === "" ? undefined : event.sessionId;
  if (named !== undefined || event.name === "agent.hook.SessionStart") {
    return named;
  }
  return state.agentSessionId === "" ? undefined : state.agentSessionId;
}

/**
 * Apply one event to one session's state.
 *
 * Only the `received` phase of a two-phase hook is counted or recorded: cmux emits `received` and then
 * `completed` for the SAME firing, so folding both would double every count and move every timestamp twice.
 *
 * @param state the state so far
 * @param event the event to apply
 * @returns the new state
 */
function applyEvent({ state, event }: { state: SessionActivity; event: CmuxEvent }): SessionActivity {
  if (event.phase === "completed") {
    return { ...state, lastSeq: Math.max(state.lastSeq, event.seq) };
  }
  const raised = attentionKindOf({ event });
  const cleared = RESUMPTION_EVENTS.has(event.name);
  const { agentSource = state.agentSource, cwd = state.cwd } = event;
  const agentSessionId = sessionIdAfter({ event, state });
  let attentionKind: SessionActivity["attentionKind"];
  let attentionSinceIso: string | undefined;
  if (raised === undefined) {
    attentionKind = cleared ? undefined : state.attentionKind;
    attentionSinceIso = cleared ? undefined : state.attentionSinceIso;
  } else {
    attentionKind = raised;
    attentionSinceIso = event.occurredAtIso;
  }
  return {
    agentSessionId,
    agentSource,
    attentionKind,
    attentionSinceIso,
    cwd,
    lastEventAtIso: event.occurredAtIso,
    lastEventName: event.name,
    lastSeq: Math.max(state.lastSeq, event.seq),
    lastTurnEndedAtIso: event.name === "agent.hook.Stop" ? event.occurredAtIso : state.lastTurnEndedAtIso,
    lastTurnStartedAtIso:
      event.name === "agent.hook.UserPromptSubmit" ? event.occurredAtIso : state.lastTurnStartedAtIso,
    sessionStartedAtIso: event.name === "agent.hook.SessionStart" ? event.occurredAtIso : state.sessionStartedAtIso,
    toolCalls: state.toolCalls + (event.name === "agent.hook.PreToolUse" ? 1 : 0),
    workspaceId: state.workspaceId,
  };
}

/**
 * Fold a batch of events into per-workspace state, in stream order.
 *
 * An event with no `workspace_id` is skipped rather than pooled under a placeholder: the `notification.*` and
 * `sidebar.*` categories routinely carry none, and attributing them to a made-up session would put invented
 * activity in front of the supervisor — the one failure this whole prong exists to avoid.
 *
 * @param events the events to fold, in the order the stream delivered them
 * @param prior an existing fold to continue from, keyed by workspace id
 * @returns each workspace's state, keyed by workspace id
 */
export function foldSessionActivity({
  events,
  prior = {},
}: {
  events: readonly CmuxEvent[];
  prior?: Readonly<Record<string, SessionActivity>>;
}): Readonly<Record<string, SessionActivity>> {
  const byWorkspace = new Map<string, SessionActivity>(Object.entries(prior));
  for (const event of events) {
    const workspaceId = event.workspaceId;
    if (workspaceId === undefined) {
      continue;
    }
    byWorkspace.set(workspaceId, applyEvent({ event, state: activitySoFar({ byWorkspace, workspaceId }) }));
  }
  return Object.fromEntries(byWorkspace);
}

/** A workspace's activity folded so far, or a fresh empty one for a workspace the fold has not seen yet. */
function activitySoFar({
  byWorkspace,
  workspaceId,
}: {
  byWorkspace: ReadonlyMap<string, SessionActivity>;
  workspaceId: string;
}): SessionActivity {
  const known = byWorkspace.get(workspaceId);
  if (known === undefined) {
    return empty({ workspaceId });
  }
  return known;
}

/** What a supervisor should do about one session, right now. */
export type SessionSignal = "needs-input" | "working" | "idle" | "silent";

/**
 * Classify one session's folded state against a clock.
 *
 * `silent` and `idle` are deliberately different answers. `idle` means the session finished a turn and has
 * been quiet since — normal, and the opportunity cost the owner asked to minimise. `silent` means it has been
 * quiet WITHOUT ever finishing a turn, which is the shape a dead or wedged session takes.
 *
 * @param activity the folded state
 * @param nowIso the instant to judge against
 * @param idleAfterMs how long a quiet session must have been quiet to count as idle
 * @returns the signal
 */
export function classifySession({
  activity,
  nowIso,
  idleAfterMs,
}: {
  activity: SessionActivity;
  nowIso: string;
  idleAfterMs: number;
}): SessionSignal {
  if (activity.attentionSinceIso !== undefined) {
    return "needs-input";
  }
  const quietMs = Date.parse(nowIso) - Date.parse(activity.lastEventAtIso);
  if (Number.isNaN(quietMs) || quietMs < idleAfterMs) {
    return "working";
  }
  return activity.lastEventName === "agent.hook.Stop" ? "idle" : "silent";
}
