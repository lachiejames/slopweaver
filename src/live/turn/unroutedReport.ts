/**
 * What `turn dispatch --sweep` SAYS about an ask nobody has routed — the loudest thing it prints, and the
 * only finding whose line is a command to run rather than a state to read.
 *
 * Pure, and its own module so every part of that report is composed in one place: the notice for an ask
 * still inside the routing window (`./undispatchedSweep.ts#unroutedSweepNotice`), the finalisation for one past it
 * (`./undispatchedSweep.ts#undispatchedSweepAction`), and the HOLD for one whose review is open
 * (`./inlineReviewHold.ts`). The first two are different findings with different consequences, and the thing
 * a reader must do about either is identical — route it, now, over the card that is already standing.
 *
 * The third is the opposite instruction, which is why it lives here rather than anywhere a reader might meet
 * it alone: an inline turn under review has a session inside it, and routing one posts a SECOND card over
 * the one the person in the thread is already watching. {@link inReviewLine} therefore deliberately carries
 * no command at all — it is the one line in this module whose whole content is "do not act".
 *
 * ## Why the line carries a command at all
 *
 * The owner's ask, after a tag sat carded and unanswered in a public channel for 88
 * minutes: make a never-dispatched line the loudest thing the sweep prints, and let a re-dispatch reuse the
 * existing card. A line a session has to assemble a command from is one it reads past; the two are the
 * same requirement. `--turn-id`/`--working-ts` are deliberately ABSENT from what this prints, because
 * `../../cli/commands/turn/briefCardFlags.ts#resolvedStarted` recovers the capture-time card from the ledger on its
 * own — printing them would suggest the card is something the operator supplies, and a session that
 * supplied the wrong pair would post a second card over the one the person is already watching.
 */
import type { AskIdentity } from "../ask/identity.js";

/** One ask the sweep is telling a session to route, and everything the command to do so needs. */
export interface UnroutedSubject {
  readonly ask: AskIdentity;
  readonly userId: string;
  readonly surface: "channel" | "dm";
  /** The question as the ledger recorded it, or `undefined` on an ask captured before that field existed. */
  readonly text: string | undefined;
}

/**
 * Single-quote one argument for a POSIX shell, so a command carrying a real Slack message is one a reader
 * can paste rather than one they have to repair.
 *
 * A Slack message routinely carries a backtick, a `$`, a newline and an apostrophe — every one of which
 * changes what a double-quoted shell word means. Single quotes take all of them literally, and the one
 * character they cannot contain is closed, escaped and reopened.
 *
 * @param value the raw argument
 * @returns the argument, single-quoted and safe to paste
 */
export function shellQuote({ value }: { value: string }): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * The `turn brief` command that starts this ask's routing over the card it already has.
 *
 * `--text` is emitted only when the ledger recorded the question. When it did not, the flag is named as one
 * the reader still has to supply, rather than silently dropped: a command missing a required flag that says
 * nothing about it is worse than no command, because it fails at the point the reader has stopped reading.
 *
 * @param subject the ask and what the ledger knows about it
 * @returns the command line, ready to paste
 */
export function reRouteCommand({ subject }: { subject: UnroutedSubject }): string {
  const base =
    `slopweaver turn brief --channel ${subject.ask.channel} --message-ts ${subject.ask.messageTs} ` +
    `--thread-ts ${subject.ask.threadTs} --user ${subject.userId} --surface ${subject.surface} ` +
    "--mode continuous-drain";
  if (subject.text === undefined) {
    return `${base} --text '<the message — this ask was captured before the ledger recorded it>'`;
  }
  return `${base} --text ${shellQuote({ value: subject.text })}`;
}

/**
 * The line for an ask captured and carded but not yet routed, still inside the window a session
 * legitimately takes to route one.
 *
 * It leads with `ROUTE IT NOW` and says what is standing in the channel, because this is the finding that
 * did not exist at all once and its absence is what made a 33-minute public stall invisible to
 * every sweep that ran during it.
 *
 * @param minutes how long it has been sitting
 * @param subject the ask and what the ledger knows about it
 * @returns the line to write
 */
export function unroutedLine({ minutes, subject }: { minutes: number; subject: UnroutedSubject }): string {
  return (
    `UNROUTED — ROUTE IT NOW: ${subject.ask.channel}/${subject.ask.messageTs} — captured ` +
    `${String(minutes)}m ago, a card is standing in the thread and no routing decision has ever been ` +
    "recorded for it. Run the three steps over it, starting with:\n" +
    `    ${reRouteCommand({ subject })}\n` +
    "    `turn brief` recovers the capture-time card from the ledger, so do NOT re-capture it."
  );
}

/**
 * The line for an ask with no recorded dispatch whose REVIEW is open — the sweep's eighth finding, and the
 * only one that tells a reader to leave something alone.
 *
 * It names the reviewer's spawn instant rather than an elapsed count, because the thing a reader decides
 * from it is whether a reviewer has been open unreasonably long, and an instant stays true in a log read an
 * hour later where a "20m ago" does not. It repeats `../../cli/commands/turn/dispatchSweep.ts`'s own
 * never-message-it wording rather than inventing a second register for the same instruction.
 *
 * @param because the hold's own reason, verbatim from `./inlineReviewHold.ts`
 * @param minutes how long the ask has been sitting since its last lifecycle event
 * @param spawnedAt when the reviewer holding it open was spawned, when the record states one
 * @param subject the ask and what the ledger knows about it
 * @returns the line to write
 */
export function inReviewLine({
  because,
  minutes,
  spawnedAt,
  subject,
}: {
  because: string;
  minutes: number;
  spawnedAt: string | undefined;
  subject: UnroutedSubject;
}): string {
  const reviewer =
    spawnedAt === undefined ? "a reviewer whose record states no spawn instant" : `reviewer spawned ${spawnedAt}`;
  return (
    `IN REVIEW — DO NOT ROUTE: ${subject.ask.channel}/${subject.ask.messageTs} — last event ` +
    `${String(minutes)}m ago and no dispatch was ever recorded, but ${because} (${reviewer}). A session is ` +
    "inside this turn; the never-dispatched bound is HELD and nothing was settled. Do not re-brief it — " +
    "that posts a second card over the one the person is watching — and never message the reviewer."
  );
}

/**
 * The line for an ask the sweep has just called over — the same instruction, plus what it did.
 *
 * @param reason the sweep's own finding, verbatim
 * @param subject the ask and what the ledger knows about it
 * @returns the line to write
 */
export function neverDispatchedLine({ reason, subject }: { reason: string; subject: UnroutedSubject }): string {
  return (
    `NEVER-DISPATCHED — ROUTE IT NOW: ${subject.ask.channel}/${subject.ask.messageTs} — ${reason}. The card ` +
    "is finalised and the ask is stranded, with one re-dispatch pending. Take it here rather than waiting " +
    "for a recovery pass, which would post a SECOND card:\n" +
    `    ${reRouteCommand({ subject })}\n` +
    "    `turn brief` recovers the capture-time card from the ledger, so do NOT re-capture it."
  );
}
