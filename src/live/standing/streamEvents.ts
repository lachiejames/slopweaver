/**
 * What a standing-session freshness check publishes onto the supervisor stream — pure.
 *
 * ## It publishes on a TRANSITION, never on every check
 *
 * `session standing` is called by the supervisor's twenty-minute sweep and by the loop's own maintenance
 * tick, so a check that published unconditionally would put an `alert` on the stream every few minutes for
 * as long as a session stayed stale. That is the wall rule 7 forbids in a different costume: a
 * reader who has scrolled past forty identical alerts is a reader who has stopped reading the severity column,
 * and the column has to keep working for a listener death. So the caller hands in the newest kind already on
 * the stream FOR THIS SESSION and nothing is published unless the answer has changed.
 *
 * ## `unmeasured` publishes nothing, deliberately
 *
 * The three kinds are a claim about drift, and an unmeasurable tree supports neither claim: publishing
 * `current` would be a false all-clear, and publishing `stale` would cry wolf over a git call that timed out.
 * The verb still refuses to exit 0 on it and still prints the problem, so it is loud where it is accurate —
 * see `cli/commands/session/standing.ts`. This is stated rather than left to be discovered, because a silent
 * kind is exactly the shape this whole source exists to remove.
 */

import { absentAsEmpty } from "#lib/absent.js";
import { KEEP_ALIVE_SESSION } from "../../claude/watchSession.js";
import type { StandingEventKind, StandingStreamEvent } from "../../events/event.js";
import { type StandingSessionFreshness, type StandingTreeRole, standingGradeIsAlerting } from "./freshness.js";
import { SUPERVISOR_SESSION } from "./supervisor.js";

/** How many sensitive paths one sentence names before it stops listing — rule 7's cap, same as the line form. */
const MAX_TOUCHED_NAMED = 3;

/**
 * Which standing sessions `session respawn` actually accepts.
 *
 * ## Why this is a list rather than "everything except the supervisor"
 *
 * The earlier shape said exactly that, and it was a default that lies by growing. `session respawn` is ONE
 * target-specific implementation behind a verb — the loop's two-phase boot-then-`--confirm` — not a generic
 * extension point, so a session added to this file inherited a sentence prescribing a verb that would refuse
 * it. It held two until the standing recipe-scheduler was retired, and dropping `scheduler`
 * here is the same rule applied in the other direction: a name the verb no longer takes would print exactly
 * that lying sentence. This module's own contract is that the
 * `why` is "the one sentence a reader is meant to run verbatim", which makes that the most expensive kind
 * of wrong: a supervisor runs it, gets a usage error, and learns nothing about what to do instead.
 *
 * So a session is named here only once the verb genuinely takes it. A session absent from this list gets
 * {@link remedyFor}'s explicit fallback, which says what to do and says plainly that respawn is not it.
 */
const RESPAWNABLE_SESSIONS: ReadonlySet<string> = new Set(["loop"]);

/**
 * The loop's respawn is the one that takes a REQUIRED argument, so its sentence carries it.
 *
 * Found by a review pass on the keep-alive change, in code it did not touch. `session respawn
 * loop` refuses with `EXIT_USAGE` unless `--successor <slug>` names today's dated handover doc
 * (`cli/commands/session/respawn.ts`), and this module emitted the bare verb — so the one sentence a
 * supervisor is meant to run verbatim has always been a usage error for the loop. The two halves were
 * each tested and their COMPOSITION was not: one test accepted the bare sentence, another separately
 * proved the invocation refused.
 */
const LOOP_RESPAWN_ARGUMENT = " --successor <today's dated loop doc>";

/**
 * The loop's sentence says the slug is yours to supply, rather than pretending the command is complete.
 *
 * The second half of the same finding: a placeholder in a sentence this module documents as runnable
 * VERBATIM is still not runnable, because `cmux spawn` needs a board row that `<today's dated loop doc>`
 * does not name. Nothing pure here can resolve today's slug, and inventing one would be worse than a
 * placeholder, so the sentence stops claiming to be complete instead. That matches the verb's own
 * refusal, which says the replacement is a dated handover doc and that it will not invent one.
 */
const LOOP_RESPAWN_CAVEAT = " Write today's doc first, then name its slug in place of the placeholder.";

/*
 * One thing this sentence still cannot promise, found by the same pass and NOT fixed here.
 *
 * `session standing` measures the loop's plugin-dir from the cmux workspace's own pids
 * (`cli/commands/session/standing.ts` passes `workspaces.loopPids`), and `session respawn` does not
 * (`cli/commands/session/respawn.ts` calls `loopFreshness` with no `pluginDirPids`). So a loop stale ONLY
 * through its plugin-dir publishes this remedy and the verb then re-measures without that tree, grades
 * itself `current`, and answers `not-owed`. Reproduced through the seams: standing `stale`, respawn
 * `current`, verdict `not-owed`.
 *
 * That defect predates this change and is identical on either side of it — it is a missing argument in
 * the respawn verb, not a wrong sentence here, and closing it means threading a cmux read into that verb.
 * It is recorded rather than absorbed, because a keep-alive change is the wrong place to quietly alter
 * how the Slack loop respawns.
 */

/**
 * The command that actually clears a stale tree.
 *
 * `session respawn` accepts only {@link RESPAWNABLE_SESSIONS}, so naming it for anything else would be a
 * confident lie in the one sentence a reader is meant to run verbatim. The supervisor's two trees also
 * have two different remedies: its `bin` is a main checkout, fast-forwarded mechanically by
 * `checkout sync` (which is why that verb exists), while its `plugin-dir` is the prose a live chat is
 * following and only reopening that chat on a current worktree replaces it. The keep-alive loop's is a
 * third shape again: it is one foreground CLI process in a visible session, so the fix is to interrupt it
 * and start it again from a current checkout — there is no state to retire and nothing to confirm.
 *
 * @param role the role of the tree that drove the grade
 * @param session which standing session this is
 * @returns the sentence naming the fix
 */
function remedyFor({
  role,
  session,
}: {
  readonly role: StandingTreeRole | undefined;
  readonly session: string;
}): string {
  if (RESPAWNABLE_SESSIONS.has(session)) {
    if (session === "loop") {
      return `Respawn it: \`slopweaver session respawn loop${LOOP_RESPAWN_ARGUMENT}\`.${LOOP_RESPAWN_CAVEAT}`;
    }
    return `Respawn it: \`slopweaver session respawn ${session}\`.`;
  }
  if (session === KEEP_ALIVE_SESSION) {
    return (
      "Interrupt it and start it again from a current checkout — `session respawn` does not accept " +
      `\`${KEEP_ALIVE_SESSION}\`, and this loop holds no state to retire.`
    );
  }
  if (session !== SUPERVISOR_SESSION) {
    return `Restart it from a current checkout — \`session respawn\` does not accept \`${session}\`.`;
  }
  if (role === "bin") {
    return "Fast-forward it: `slopweaver checkout sync`.";
  }
  return "Reopen the supervisor chat on a current worktree — `session respawn` does not accept `supervisor`.";
}

/**
 * The sentence a supervisor prints verbatim for one graded session.
 *
 * @param freshness the graded session
 * @returns the sentence — what is wrong, on which tree, and which verb clears it
 */
function whyOf({ freshness }: { readonly freshness: StandingSessionFreshness }): string {
  const worst = freshness.trees.find((tree) => tree.grade === freshness.grade);
  if (!standingGradeIsAlerting({ grade: freshness.grade })) {
    const behind = worst?.behind ?? 0;
    return behind === 0
      ? `the ${freshness.session} standing session is current with origin/main.`
      : `the ${freshness.session} standing session is ${String(behind)} commit(s) behind origin/main, none of it ` +
          "under a path that session runs — no respawn is owed.";
  }
  const touched = absentAsEmpty({ value: worst?.touched }).slice(0, MAX_TOUCHED_NAMED).join(", ");
  return (
    `the ${freshness.session} standing session is STALE: its ${worst?.role ?? "tree"} is ` +
    `${String(worst?.behind ?? 0)} commit(s) behind origin/main and those commits changed ${touched} — ` +
    "it is running code or prose the fleet has already replaced, and every worker it dispatches inherits that. " +
    remedyFor({ role: worst?.role, session: freshness.session })
  );
}

/**
 * The event kind one grade would publish, or `undefined` when the grade supports no honest claim.
 *
 * @param freshness the graded session
 * @returns `stale`, `current`, or `undefined` for an unmeasurable session
 */
export function standingEventKindFor({
  freshness,
}: {
  readonly freshness: StandingSessionFreshness;
}): StandingEventKind | undefined {
  if (freshness.grade === "unmeasured") {
    return undefined;
  }
  return standingGradeIsAlerting({ grade: freshness.grade }) ? "stale" : "current";
}

/**
 * The event to publish for one freshness check, or `undefined` when nothing has changed.
 *
 * @param atIso the instant of the check
 * @param freshness the graded session
 * @param previousKind the newest kind already on the stream for THIS session, or `undefined` when it has never
 *   published — a first-ever `current` is published, so a briefing has a baseline rather than silence
 * @returns the event, or `undefined` when this check is a repeat
 */
export function standingStreamEvent({
  atIso,
  freshness,
  previousKind,
}: {
  readonly atIso: string;
  readonly freshness: StandingSessionFreshness;
  readonly previousKind: StandingEventKind | undefined;
}): StandingStreamEvent | undefined {
  const kind = standingEventKindFor({ freshness });
  if (kind === undefined || kind === previousKind) {
    return undefined;
  }
  const worst = freshness.trees.find((tree) => tree.grade === freshness.grade);
  return {
    atIso,
    head: worst?.head,
    kind,
    session: freshness.session,
    source: "standing-session",
    why: whyOf({ freshness }),
  };
}

/** The successor's HEAD as the respawn sentence names it: `head` is `undefined` exactly when it could not be read. */
function successorHead({ head }: { readonly head: string | undefined }): string {
  if (head == null) {
    return "an unread HEAD";
  }
  return head;
}

/**
 * The event a completed respawn publishes.
 *
 * Separate from {@link standingStreamEvent} because it is not a reading of anything — it is a record that a
 * session was retired and replaced, and it must publish even when the successor's own grade is identical to
 * what the stream last said.
 *
 * @param atIso the instant of the respawn
 * @param session which standing session was replaced
 * @param head the successor's own HEAD, or `undefined` when it could not be read
 * @param detail one clause naming what was actually done, appended to the sentence
 * @returns the event
 */
export function standingRespawnedEvent({
  atIso,
  session,
  head,
  detail,
}: {
  readonly atIso: string;
  readonly session: string;
  readonly head: string | undefined;
  readonly detail: string;
}): StandingStreamEvent {
  return {
    atIso,
    head,
    kind: "respawned",
    session,
    source: "standing-session",
    why: `the ${session} standing session was retired and respawned on ${successorHead({ head })} — ${detail}`,
  };
}

/**
 * The newest standing-session kind on the stream for one session.
 *
 * @param events the stream tail, oldest first
 * @param session which standing session to look for
 * @returns the newest kind, or `undefined` when this session has never published
 */
export function newestStandingKind({
  events,
  session,
}: {
  readonly events: readonly { readonly source: string; readonly kind: string; readonly session?: string }[];
  readonly session: string;
}): StandingEventKind | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.source !== "standing-session" || event.session !== session) {
      continue;
    }
    // `respawned` is a record of an ACTION, not a reading, so it never becomes the baseline a later reading
    // dedupes against — otherwise the first `stale` after a respawn would be swallowed as "no change".
    if (event.kind === "stale" || event.kind === "current") {
      return event.kind;
    }
  }
  return undefined;
}
