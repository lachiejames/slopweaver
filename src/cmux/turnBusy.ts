/**
 * Whether a surface is mid-turn, and whether the line just sent to it was ACCEPTED or merely QUEUED behind
 * that turn.
 *
 * ## The measurement this module exists to encode
 *
 * `cmux send` used to answer `submitted` for every send the socket accepted. Measured live on a
 * scratch workspace (cmux 0.64.22, Claude Code 2.1.241) parked mid-turn on a foreground command, that answer
 * is wrong in exactly the case the supervisor cares about, and the two witnesses this repository already had
 * are both blind to it:
 *
 * - **`latest_submitted_message` fires on a QUEUED line.** The reach text appeared in the workspace row at
 *   `11:50:37.523Z`, the instant of the send, while the session did not process it until `11:52:57` — 140
 *   seconds later. `./sendEvidence.ts` therefore witnesses DELIVERY to the surface, never pickup by the
 *   agent; nothing it can say distinguishes the two.
 * - **`agent.hook.UserPromptSubmit` fires on a QUEUED line too**, at `11:50:37.545Z` (seq 430892) for the
 *   same send. So the event stream cannot tell them apart either, and neither can anything built on it.
 *
 * The SCREEN can. A Claude Code session running a turn renders `esc to interrupt` in its footer; a line
 * queued behind that turn additionally replaces the input placeholder with `Press up to edit queued
 * messages`, and that marker was visible **within 1 second** of the send on every poll of the measurement. An
 * idle session renders neither. So the honest disposition is read off the surface, once, after the send.
 *
 * ## Why the queued marker is the only sound signal, and the busy one is not
 *
 * A send that LANDS on an idle session makes it busy — so `esc to interrupt` appearing after a send is just
 * as consistent with success as with queueing, and reading it as "queued" would call every good send a bad
 * one. The queued marker has no such ambiguity: it renders only when a message is waiting. `esc to interrupt`
 * is still exported, because deciding whether to INTERRUPT is a different question from deciding what
 * happened, and that one is answered before the send rather than after it.
 *
 * ## What this module's screen read CANNOT see: the line that never left the composer
 *
 * The three verdicts below are read off the PLAIN screen, and a third truth is invisible to all of them: the
 * text typed into the composer while the Enter that should have submitted it did not take. Such a screen
 * shows no `esc to interrupt` and no queued marker, and it does carry the `❯` that `./bootSignal.ts`
 * recognises — so {@link classifySendDisposition} answers **`submitted`**, which is a lie.
 *
 * MEASURED, every one of the 20 live cmux workspaces read with
 * `slopweaver cmux read-screen --workspace workspace:N --scrollback 1 --json`: **2 of 20 composers held
 * `kind: "typed"` text**, one of them a peer message and one a supervisor brief, and the peer one held TWO
 * concatenated sends — a second `cmux send` had appended to a composer the first had already stranded. The
 * owner saw one of them in a screenshot before any verb did.
 *
 * `./composer.ts` CAN see it, because it reads the styled grid rather than plain text. So `stranded` and
 * `resubmitted` are decided there and in `./reach.ts`, never here — this module keeps its plain-text
 * criterion, and the type it owns carries all five answers so one exhaustive switch prints them.
 *
 * ## An unrecognised screen is `unknown`, never `submitted`
 *
 * A host whose queued marker has never been measured here cannot be read for one, and answering `submitted`
 * because no marker matched would rebuild the over-claim this module removes. So a verdict of `submitted`
 * requires POSITIVELY recognising a host this module has patterns for, which it does by reusing
 * `./bootSignal.ts`'s measured prompt chrome rather than inventing a second pattern for the same thing.
 * `codex` has its running and queued markers measured but no ready-prompt pattern there, so a
 * codex send reads `queued` when it is and `unknown` otherwise — never `submitted`.
 */
import type { VisibleSessionHost } from "../supervisor/session.js";
import { hasReadyPromptSignal } from "./bootSignal.js";

/**
 * What actually happened to a line handed to a surface.
 *
 * `stranded` and `resubmitted` are the fourth and fifth answers, and the screen text this module reads cannot
 * reach either of them — see the module header's third section. They are decided by `./composer.ts`'s STYLED
 * read, in `./reach.ts`, and they live in this type so the one switch every caller prints through stays
 * exhaustive.
 */
export type SendDisposition = "submitted" | "queued" | "unknown" | "stranded" | "resubmitted";

/**
 * Per-host text rendered only while a turn is running — `claude --plugin-dir …` measured live,
 * across a parked, an interrupted and an idle screen; `codex` v0.157.1 measured live across idle,
 * mid-turn, queued and after-interrupt screens (`../__tests__/fixtures/codexTui.ts` holds them verbatim).
 *
 * Codex draws its status line, `• Working (8s • esc to interrupt) · …`, at the start of a line directly above
 * its composer for the whole turn and never after it, so the pattern is anchored there: the same words inside
 * a line are text some session printed.
 */
const RUNNING_TURN_PATTERNS: Readonly<Record<VisibleSessionHost, RegExp | undefined>> = {
  "claude-code": /esc to interrupt/iu,
  codex: codexStatusLine({ phrase: "Working", whole: String.raw`Working \(` }),
};

/**
 * A Codex status line anchored at its `• `, matching it whole or CUT OFF by a narrow pane.
 *
 * Codex ends a line too long for its pane with `…` (`../__tests__/fixtures/codexTui.ts` holds one), so a queue
 * header can render `• Messages to be submitted after…`. A marker read whole only would then call a live turn
 * idle exactly when the pane is narrow, so ANY non-empty prefix of the phrase followed by
 * `…` is the same line — down to one letter, since a floor of four let `• Wor…` read idle,
 * matching the terminal count's own rule in `backgroundWork.ts` — and down to NO letter, `• …` or `•…`, the bare
 * bullet, and to the bullet alone with no `…` at all. Any Codex
 * bullet cut that far reads the same, and a false match only ever holds a seat.
 *
 * @param phrase the line's words after `• `, plain text with no regex syntax
 * @param whole the pattern for the uncut line, after `• `
 * @returns the line-anchored, multiline pattern
 */
function codexStatusLine({ phrase, whole }: { phrase: string; whole: string }): RegExp {
  const cuts = new Set<string>();
  for (let length = phrase.length; length >= 1; length -= 1) {
    cuts.add(phrase.slice(0, length).trimEnd());
  }
  return new RegExp(`^•(?: (?:${whole}|(?:${[...cuts].join("|")})\\s*…)|\\s*…|[ \\t]*$)`, "mu");
}

/**
 * Per-host input-box text rendered only while at least one message is waiting behind the running turn.
 *
 * Claude Code's is the placeholder it swaps in for the empty prompt (`Press up to edit queued messages`),
 * matched on the stable half so a reworded hint does not silently turn a `queued` verdict into `submitted`.
 * Codex's is the header it draws over the waiting lines — `• Messages to be submitted after next tool call
 * (press esc to interrupt and send immediately)`, measured within a second of the send, on both
 * rounds. Not the `Queued follow-up inputs` its upstream source suggests: v0.157.1 never drew that.
 */
const QUEUED_MESSAGE_PATTERNS: Readonly<Record<VisibleSessionHost, RegExp | undefined>> = {
  "claude-code": /queued message/iu,
  codex: codexStatusLine({
    phrase: "Messages to be submitted after next tool call",
    whole: "Messages to be submitted after next tool call",
  }),
};

/** Every host this module can read a queued line off, so `submitted` is only ever said about a known one. */
const READABLE_HOSTS: readonly VisibleSessionHost[] = ["claude-code", "codex"];

/**
 * Whether a disposition can be read for this host AT ALL, or whether every answer for it is `unknown`.
 *
 * Exported so a caller distinguishes "nothing is queued" from "this host cannot tell you" — collapsing them
 * is the over-claim this module removes.
 *
 * @param host which model CLI the surface booted
 * @returns whether {@link screenShowsQueuedMessage} can ever return true for it
 */
export function queuedMessageIsAssertable({ host }: { host: VisibleSessionHost }): boolean {
  return QUEUED_MESSAGE_PATTERNS[host] !== undefined;
}

/**
 * Whether a RUNNING turn can be read off this host's screen at all, or whether {@link screenShowsRunningTurn}
 * answers `false` for it no matter what it is doing.
 *
 * The same honesty {@link queuedMessageIsAssertable} keeps for the queued marker, and it exists for the same
 * reason: a host with no measured busy marker would have a caller that treats `false` as "this session is
 * idle" call a working session idle every time — `codex` was that host until its status line was measured. A caller deciding whether to act on an idle session must ask this FIRST —
 * `live/turn/reviewDelivery.ts`'s `reviewerStrandedness` is the one that does, and the act it is deciding
 * about is pressing Enter into somebody else's input box.
 *
 * @param host which model CLI the surface booted
 * @returns whether {@link screenShowsRunningTurn} can ever return true for it
 */
export function runningTurnIsAssertable({ host }: { host: VisibleSessionHost }): boolean {
  return RUNNING_TURN_PATTERNS[host] !== undefined;
}

/**
 * Whether a screen shows a turn RUNNING right now, for any host with a measured pattern.
 *
 * Deliberately host-agnostic, for a caller never told which CLI is in the workspace (`cmux send`, `session
 * close-done`). The union CAN collide: an idle Claude Code transcript that printed a line starting `• Working (`
 * reads busy here. That is the direction a guess may err in — a held seat, never a closed
 * one — so a caller that knows the host asks {@link hostShowsRunningTurn} instead, as park and review do. A
 * screen that could not be read is not a running turn — the caller that must not act on a guess checks
 * readability itself.
 *
 * @param screen the surface's rendered text, or `undefined` when it could not be read
 * @returns whether a turn is visibly running
 */
export function screenShowsRunningTurn({ screen }: { screen: string | undefined }): boolean {
  if (screen === undefined) {
    return false;
  }
  return READABLE_HOSTS.some((host) => RUNNING_TURN_PATTERNS[host]?.test(screen) === true);
}

/**
 * Whether a screen shows ONE host's running-turn marker — the host-aware read `./turnState.ts` classifies with,
 * so a codex seat is never judged by Claude Code's footer or the other way round.
 *
 * @param host which model CLI the surface booted
 * @param screen the surface's rendered text
 * @returns whether that host's measured running marker is on it; `false` for a host with none measured
 */
export function hostShowsRunningTurn({ host, screen }: { host: VisibleSessionHost; screen: string }): boolean {
  return RUNNING_TURN_PATTERNS[host]?.test(screen) === true;
}

/**
 * Whether a screen shows ONE host's queued-message marker — the host-aware twin of
 * {@link screenShowsQueuedMessage}.
 *
 * @param host which model CLI the surface booted
 * @param screen the surface's rendered text
 * @returns whether that host's measured queued marker is on it; `false` for a host with none measured
 */
export function hostShowsQueuedMessage({ host, screen }: { host: VisibleSessionHost; screen: string }): boolean {
  return QUEUED_MESSAGE_PATTERNS[host]?.test(screen) === true;
}

/**
 * Whether a screen shows at least one message waiting behind the running turn.
 *
 * @param screen the surface's rendered text, or `undefined` when it could not be read
 * @returns whether a queued message is visible
 */
export function screenShowsQueuedMessage({ screen }: { screen: string | undefined }): boolean {
  if (screen === undefined) {
    return false;
  }
  return READABLE_HOSTS.some((host) => QUEUED_MESSAGE_PATTERNS[host]?.test(screen) === true);
}

/**
 * Whether a screen is positively recognisable as a host whose queued marker this module knows.
 *
 * This reuses `./bootSignal.ts`'s measured prompt chrome rather than adding a second pattern for the same
 * fact — that module already owns "what a rendering host looks like", and the chrome it matches is present
 * mid-turn as well as at rest (measured on the same screens).
 *
 * @param screen the surface's rendered text
 * @returns whether a `submitted` verdict may be reached about this screen
 */
function screenIsReadableHost({ screen }: { screen: string }): boolean {
  return READABLE_HOSTS.some((host) => queuedMessageIsAssertable({ host }) && hasReadyPromptSignal({ host, screen }));
}

/**
 * What happened to the line just sent, read off the surface afterwards.
 *
 * @param screen the surface's rendered text after the send, or `undefined` when it could not be read
 * @returns `queued` when a message is visibly waiting, `submitted` when a recognised host shows none, and
 *   `unknown` when the screen was unreadable or belongs to a host with no measured queued marker
 */
export function classifySendDisposition({ screen }: { screen: string | undefined }): SendDisposition {
  if (screen === undefined) {
    return "unknown";
  }
  if (screenShowsQueuedMessage({ screen })) {
    return "queued";
  }
  return screenIsReadableHost({ screen }) ? "submitted" : "unknown";
}

/**
 * The one line `cmux send` prints for a disposition — the honest replacement for its old unconditional
 * `submitted`.
 *
 * The queued advice SPLITS on whether an interrupt already happened, because the obvious single wording is
 * wrong in the second case and was measured being wrong: told to park on a foreground command and then sent
 * two lines, the proof session queued the first, and `--interrupt` on the second released THAT first line
 * into a fresh turn — so the second line was correctly reported queued while "pass `--interrupt`" was
 * useless advice about a flag the caller had just passed. A queue is FIFO, and one Escape frees one turn.
 *
 * @param disposition what the surface said happened
 * @param workspaceRef the workspace the line went to, as the caller named it back
 * @param interrupted whether the send escalated to an interrupt before delivering
 * @returns the line to print
 */
export function describeSendDisposition({
  disposition,
  workspaceRef,
  interrupted,
}: {
  disposition: SendDisposition;
  workspaceRef: string;
  interrupted: boolean;
}): string {
  const prefix = interrupted ? "cmux send: interrupted the running turn and " : "cmux send: ";
  const queuedAdvice = interrupted
    ? "a turn that started after the interrupt — most likely an earlier queued line the interrupt released; send again to interrupt that one too"
    : "it lands only when that turn ends; pass --interrupt to stop the turn and deliver now";
  switch (disposition) {
    case "submitted":
      return `${prefix}submitted to ${workspaceRef}`;
    case "queued":
      return `${prefix}QUEUED behind a running turn on ${workspaceRef} — ${queuedAdvice}`;
    case "unknown":
      return `${prefix}delivered to ${workspaceRef}, but the screen could not say whether it was submitted or queued behind a running turn`;
    case "resubmitted":
      return (
        `${prefix}submitted to ${workspaceRef}, but only after a RESCUE — the Enter that follows the paste ` +
        `did not take and the line sat unsent in the composer, so one bare Enter was pressed (nothing was ` +
        `re-typed) and the box is clear now`
      );
    case "stranded":
      return (
        `${prefix}STRANDED in ${workspaceRef} — the line typed into the composer, the Enter did not take, ` +
        `and a bare Enter did not move it either, so it is STILL sitting there unsent. Read it with ` +
        `\`slopweaver cmux read-screen --workspace ${workspaceRef}\`; a composer this verb could not clear ` +
        `is usually a dialog or a menu holding the key, so LOOK at the session before sending again — a ` +
        `second send appends a second copy rather than replacing the first`
      );
    default: {
      const exhaustive: never = disposition;
      return exhaustive;
    }
  }
}
