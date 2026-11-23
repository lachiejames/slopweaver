/**
 * What a dispatched cmux workspace and session are CALLED — the naming half of `./plan.ts`.
 *
 * Its own file because naming is a separate decision from spawning: `../sessions/closeDone.ts`,
 * `../live/turn/sessionLedger.ts` and two `turn` verbs derive a name to MATCH a session they did not plan,
 * and none of them wants the worktree search, the pickup-command builder or the plan factories that
 * `./plan.ts` carries. The bounds below are measured against the live harness registry and a real Slack ts,
 * and each carries that measurement on its own declaration.
 */

/** How long {@link deriveWorkspaceTitle} lets a title run before truncating it with an ellipsis. */
export const WORKSPACE_TITLE_MAX_LENGTH = 60;

/**
 * How long a `VisibleSessionPlan.sessionName` (`./plan.ts`) may run.
 *
 * Measured against the live harness registry (`~/.claude/sessions/<pid>.json`): a name longer
 * than this is TRUNCATED to 40 before it is shown — `alerts-channel-convention-thread-with-jasper` was
 * registered as `alerts-channel-convention-thread-with-ja`. A name that gets truncated by someone else is a
 * name whose distinguishing tail can be cut off, which is the whole ambiguity this field exists to remove,
 * so the bound is enforced HERE where the distinguishing part can be chosen deliberately.
 */
export const SESSION_NAME_MAX_LENGTH = 40;

/**
 * How many trailing characters of the ask's message ts a session name keeps.
 *
 * A real Slack ts is exactly 17 characters (`1787720788.183959`), so for every genuine dispatch this keeps
 * all of it. A longer one means a corrupted or hand-edited record, and only the TAIL of a ts carries the
 * digits that tell two asks in the same channel apart — so the tail is what survives, never the head.
 */
const SESSION_NAME_TS_LENGTH = 17;

/**
 * Everything outside this set is collapsed to a single `-`. The session name is interpolated into a boot LINE
 * that is typed into a real terminal (`spawn.ts`'s `bootLine`), so a channel or ts carrying a space, a quote
 * or a control operator would be shell syntax rather than a name. `workspaceName` carries the same
 * coordinates safely only because it travels as a cmux API field, never as command text.
 *
 * `-` is outside the set deliberately, even though it is a perfectly safe character: it is the SEPARATOR this
 * name is built from, so letting a segment contribute its own would make `ask-a-b-<ts>` ambiguous about where
 * the channel ended.
 */
const SESSION_NAME_UNSAFE = /[^A-Za-z0-9._]+/g;

/** A leading or trailing separator left behind by {@link SESSION_NAME_UNSAFE}'s collapse — never part of a name. */
const SESSION_NAME_EDGE_SEPARATORS = /^-+|-+$/g;

/**
 * One segment of a session name, reduced to characters a boot line can carry.
 *
 * @param value the raw segment
 * @returns the segment with every unsafe run collapsed to `-` and no leading or trailing separator
 */
export function safeNameSegment({ value }: { value: string }): string {
  return value.replace(SESSION_NAME_UNSAFE, "-").replace(SESSION_NAME_EDGE_SEPARATORS, "");
}

/**
 * Which side of one ASK a dispatched session is — the worker that owns it, or the reviewer of its answer.
 *
 * Narrower than {@link DispatchSessionRole} on purpose: `../sessions/dispatchChildren.ts` derives both of
 * these names for every ask in the ask-lifecycle log, and a witness session belongs to no ask, so it must
 * never be derived there as though it were one.
 */
export type AskDispatchRole = "ask" | "review";

/**
 * Which kind of dispatched session this is — one side of an ask ({@link AskDispatchRole}), or the `witness`
 * worker that checks one claim in a thread another bot was tagged in (`../live/witness/`).
 *
 * Named rather than spelled inline because several modules branch on it: the plan factories in `./plan.ts`,
 * and `../sessions/closeDone.ts`, which derives the ask names for every known ask so a slug-less ledger row
 * can be matched back to the turn it belongs to.
 */
export type DispatchSessionRole = AskDispatchRole | "witness";

/**
 * The cmux WORKSPACE name for one ask-driven session — the dispatch's full, unsanitised coordinates.
 *
 * Distinct from {@link dispatchSessionName} on purpose, and the difference is load-bearing. That one travels
 * as command text and is therefore sanitised and truncated to 40 characters, so two asks in the same long
 * channel can share one; this one travels as a cmux API field, so it carries the channel and the ts whole
 * and identifies exactly one dispatch. `spawn.ts` puts it in the workspace's own description, which is what
 * lets `../sessions/closeDone.ts` confirm that a live workspace really is the child a stale ledger ref
 * claims — a `workspace:N` ref is re-issued when cmux restarts, and the workspace name is not.
 *
 * @param askChannel the ask's channel id
 * @param askMessageTs the ask's addressing message ts
 * @param role which side of one ask this session is
 * @returns the workspace name
 */
export function dispatchWorkspaceName({
  askChannel,
  askMessageTs,
  role,
}: {
  askChannel: string;
  askMessageTs: string;
  role: DispatchSessionRole;
}): string {
  return `${role}-${askChannel}-${askMessageTs}`;
}

/**
 * The harness display name for one ask-driven session — the dispatch's own coordinates, sanitised for a
 * shell-visible flag and bounded by {@link SESSION_NAME_MAX_LENGTH}.
 *
 * The role prefix and the message ts are the two halves that must survive: the role is what tells a WORKER
 * from the REVIEWER of the same ask (the one recipient nobody may write a word to mid-verdict), and the ts is
 * what tells two asks apart. So the channel is the segment that gives way when the budget is tight, never
 * either of those.
 *
 * @param askChannel the ask's channel id
 * @param askMessageTs the ask's addressing message ts
 * @param role which side of one ask this session is — the worker that owns it, or the reviewer of its answer
 * @returns the display name, at most {@link SESSION_NAME_MAX_LENGTH} characters of `[A-Za-z0-9._-]`
 */
export function dispatchSessionName({
  askChannel,
  askMessageTs,
  role,
}: {
  askChannel: string;
  askMessageTs: string;
  role: DispatchSessionRole;
}): string {
  const ts = safeNameSegment({ value: askMessageTs }).slice(-SESSION_NAME_TS_LENGTH);
  const room = SESSION_NAME_MAX_LENGTH - role.length - ts.length - 2;
  const channel = safeNameSegment({ value: askChannel }).slice(0, Math.max(room, 0));
  return `${role}-${channel}-${ts}`;
}

/**
 * A short, human-readable workspace title derived from an ask's question text — whitespace collapsed and
 * truncated to {@link WORKSPACE_TITLE_MAX_LENGTH} characters, so the cmux sidebar shows what the ask is
 * actually about instead of a bare channel/messageTs tuple. Falls back to a fixed placeholder for an empty
 * question, since a blank title would be worse than the raw id it replaces.
 *
 * @param askQuestion the ask's raw question text
 * @returns the derived title
 */
export function deriveWorkspaceTitle({ askQuestion }: { askQuestion: string }): string {
  const collapsed = askQuestion.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return "(no question text)";
  }
  if (collapsed.length <= WORKSPACE_TITLE_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, WORKSPACE_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}
