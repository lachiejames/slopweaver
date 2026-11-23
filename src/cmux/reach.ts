/**
 * Reaching a session that is mid-turn — the supervisor's only channel into a workspace, made honest and,
 * when the caller asks for it, made to actually arrive.
 *
 * ## The failure this exists to end
 *
 * The supervisor's whole reach into a running session is typing into its input. A session parked on a long
 * wait is mid-turn, so the text is QUEUED rather than accepted, and `cmux send` answered `submitted` anyway.
 * Measured cost: an instruction to re-open the login browser sat queued
 * for about an hour while the session slept, and the supervisor eventually did the login itself — a job that
 * took thirty seconds once someone ran it.
 *
 * ## Two changes, and why the smaller one is the important one
 *
 * - **Every send now reports what actually happened.** `./turnBusy.ts` carries the measurement: neither
 *   `latest_submitted_message` nor `agent.hook.UserPromptSubmit` can see that a line queued, but the surface
 *   can, within a second. So a send that queued says so, and names the flag that would have delivered it.
 *   This half needs no new power at all and is what makes an hour-long stall visible in the first place.
 * - **`--interrupt` escalates.** One Escape stops the running turn and the line lands. This is deliberately
 *   NOT the default: an interrupt discards whatever mid-step work the session was doing, and most sends are
 *   not urgent enough to pay that. The caller decides, per send, which is the only place that judgement can
 *   sensibly live.
 * - **A line that never left the composer is now SEEN, and one bare Enter is pressed for it.** The submit
 *   half of `sendLine` was fire-and-forget: it types, waits `SEND_SUBMIT_DELAY_MS`, presses Enter, and
 *   nothing ever checked that the box emptied. A peer message typed into another
 *   session's composer and left unsent is not intended. See
 *   {@link rescueStrandedLine}.
 *
 * ## Why the strand is decided on the composer's ATTRIBUTE and never on its text
 *
 * The obvious criterion — does the box still hold the text I just sent — fails on exactly the messages that
 * strand most. MEASURED on the live `workspace:80` strand: Claude Code COLLAPSES a long paste, so the
 * composer read back as `…and one of them was alread[Pasted text #5 +6 lines]ph is still owed…`. No prefix,
 * `includes` or normalised comparison against the sent text can match that. `./composer.ts` decides on the
 * FAINT attribute instead and has no dependence on the text at all: a `typed` box after a send means the
 * Enter did not take, whatever is in it.
 *
 * ## What this borrows, rather than invents
 *
 * `./pickupWitnessWindow.ts` solved this exact class for PICKUP lines — witness, then one bare
 * `submitComposer`, then re-witness — and its `resubmitPickupThenWitness` header carries both live
 * measurements this step rests on: a bare Enter submits a stranded composer, and a bare Enter on an already
 * empty one is a no-op. `reachSession` simply never received that fix. What it adds is precision spawn could
 * not have: `./composer.ts` postdates that work, so where spawn must press Enter blind at the end of its
 * budget, this presses only on a positively-read `typed` box — and never on a `suggestion` or `placeholder`,
 * which is the rule that `cmux submit` already enforces.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { CmuxClient, CmuxTarget } from "./client.js";
import { type ComposerReading, readComposer } from "./composer.js";
import { type CmuxError, keystrokeMayHaveLanded } from "./errors.js";
import { classifySendDisposition, type SendDisposition, screenShowsRunningTurn } from "./turnBusy.js";

/**
 * How long to let the surface render before reading the disposition off it.
 *
 * Measured against Claude Code 2.1.241 — reproduce by parking a session on a foreground command
 * and running `slopweaver cmux send --workspace <ref> "probe"` against it: the queued-message marker was
 * present on the first poll at **+1 s** and on every poll after it, out to +31 s. One second is therefore
 * the whole signal, and this is that plus enough margin to survive a slow re-render.
 */
const SEND_SETTLE_MS = 1200;

/**
 * How many times to re-read the screen when the first read cannot decide.
 *
 * The one condition worth a retry is `surface.read_text` answering `TERMINAL_TEXT_UNREADABLE` on a surface
 * still settling under fleet load — a measured, transient cmux behaviour this repository has been bitten by
 * three times (`./spawn.ts`'s header). Two reads, not fifteen: raising a screen-read budget is the fix that
 * has already failed twice there, and here an undecidable answer is reported honestly rather than guessed.
 */
const SEND_DISPOSITION_READS = 2;

/**
 * How long to wait for an interrupt to take effect before delivering anyway.
 *
 * Measured: a single `escape` took a session from `esc to interrupt` to `Interrupted · What
 * should Claude do instead?` in **under three seconds**. Five one-second polls is that with margin, and the
 * line is sent at the end of it either way — a session that did not visibly stop still receives the text,
 * queued, exactly as it would have without the flag.
 */
const INTERRUPT_SETTLE_POLLS = 5;

/** The gap between interrupt-settled polls. */
const INTERRUPT_POLL_MS = 1000;

/** How much scrollback a disposition read needs — the footer and the input box, nothing above them. */
const DISPOSITION_SCROLLBACK_LINES = 12;

/**
 * What one reach did, beyond the socket having accepted the calls.
 *
 * @internal
 */
export interface ReachOutcome {
  /** What the surface said happened to the line. */
  readonly disposition: SendDisposition;
  /** Whether a running turn was found and interrupted before the line was delivered. */
  readonly interrupted: boolean;
  /**
   * What the composer held when the strand check last looked, or `undefined` when it was never consulted —
   * which is the case for a `queued` line, whose verdict the plain screen already settled.
   *
   * Carried out so a caller can PRINT the stuck text on a `stranded` disposition: the one-line disposition
   * message deliberately does not interpolate it, because a stranded composer can hold a thousand characters
   * of somebody else's message.
   */
  readonly composer?: ComposerReading;
}

/** The waits a reach performs, injected so a test drives the ORDER without a real clock. */
export interface ReachWaits {
  /** Wait out {@link SEND_SETTLE_MS} before reading the disposition. */
  readonly settle: () => Promise<void>;
  /** Wait out {@link INTERRUPT_POLL_MS} between two interrupt-settled polls. */
  readonly interruptPoll: () => Promise<void>;
}

/**
 * The production waits — real timers, the only place in a reach a clock is consulted.
 *
 * @returns waits that sleep for the real measured intervals
 */
export function realReachWaits(): ReachWaits {
  return {
    interruptPoll: async () => {
      await new Promise((resolve) => setTimeout(resolve, INTERRUPT_POLL_MS));
    },
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, SEND_SETTLE_MS));
    },
  };
}

/**
 * Read a surface's screen, collapsing an unreadable one to `undefined`.
 *
 * A screen that cannot be read and an empty one mean the same thing to every caller here — "nothing to
 * judge from" — so both become `undefined` rather than a failure the reach would have to decide about.
 */
async function screenOrUndefined({
  client,
  target,
}: {
  client: CmuxClient;
  target: CmuxTarget;
}): Promise<string | undefined> {
  const read = await client.readScreen({ scrollbackLines: DISPOSITION_SCROLLBACK_LINES, target });
  if (read.isErr()) {
    return undefined;
  }
  return read.value.trim().length === 0 ? undefined : read.value;
}

/**
 * Interrupt a running turn, if one is visibly running, and wait a bounded time for it to stop.
 *
 * A screen that cannot be read is NOT treated as a running turn: interrupting on a guess would discard real
 * work to deliver a line that may not even have needed it.
 *
 * @param client the connected cmux client
 * @param target the surface to interrupt
 * @param waits the injected waits
 * @returns whether a turn was found and interrupted, or the typed failure
 */
async function interruptRunningTurn({
  client,
  target,
  waits,
}: {
  client: CmuxClient;
  target: CmuxTarget;
  waits: ReachWaits;
}): Promise<Result<boolean, CmuxError>> {
  if (!screenShowsRunningTurn({ screen: await screenOrUndefined({ client, target }) })) {
    return ok(false);
  }
  const sent = await client.interruptTurn({ target });
  if (sent.isErr()) {
    return err(sent.error);
  }
  for (let poll = 0; poll < INTERRUPT_SETTLE_POLLS; poll += 1) {
    await waits.interruptPoll();
    if (!screenShowsRunningTurn({ screen: await screenOrUndefined({ client, target }) })) {
      return ok(true);
    }
  }
  return ok(true);
}

/**
 * Read the disposition of a line just sent, retrying only while the screen cannot decide.
 *
 * @param client the connected cmux client
 * @param target the surface the line went to
 * @param waits the injected waits
 * @returns what the surface says happened
 */
async function readDisposition({
  client,
  target,
  waits,
}: {
  client: CmuxClient;
  target: CmuxTarget;
  waits: ReachWaits;
}): Promise<SendDisposition> {
  let disposition: SendDisposition = "unknown";
  for (let read = 0; read < SEND_DISPOSITION_READS; read += 1) {
    await waits.settle();
    disposition = classifySendDisposition({ screen: await screenOrUndefined({ client, target }) });
    if (disposition !== "unknown") {
      return disposition;
    }
  }
  return disposition;
}

/**
 * Read the composer off the STYLED grid, collapsing an unreadable grid to an `unreadable` reading.
 *
 * A second socket call, and it is allowed to fail on its own terms: a grid that will not read is not evidence
 * the line stranded, and `unreadable` is what `./composer.ts` answers for every screen it cannot attribute.
 */
async function composerOrUnreadable({
  client,
  target,
}: {
  client: CmuxClient;
  target: CmuxTarget;
}): Promise<ComposerReading> {
  const grid = await client.readScreenGrid({ target });
  if (grid.isErr()) {
    return { kind: "unreadable", reason: `the styled grid could not be read: ${grid.error.message}` };
  }
  return readComposer({ grid: grid.value });
}

/**
 * Press ONE bare Enter on a composer that is still holding the line, and look once more.
 *
 * **One Enter, never a loop, and that is a decision rather than an omission.** `./spawn.ts`'s measurement
 * settles the success side: a second Enter on an already-empty composer is a no-op, so a retry buys nothing
 * where the first one worked. The failure side settles the rest — a composer that ignored one Enter is being
 * held by something this module cannot see (a permission dialog, a menu, a host with no measured chrome), and
 * a second keystroke does not move any of those. Raising a poll budget is the fix that has already failed
 * twice in `./spawn.ts`; saying `stranded` out loud is the one that has not been tried here at all.
 *
 * **An Enter whose reply was lost is `unknown`, never `stranded`.** cmux may have submitted the line before the
 * reply went missing ({@link keystrokeMayHaveLanded}), so calling it stranded would tell a caller the line is
 * unsent when it may be in the chat. Only an Enter cmux itself refused is `stranded` without a second look.
 *
 * @param client the connected cmux client
 * @param target the surface whose composer is holding the line
 * @param waits the injected waits
 * @returns the rescued, still-stranded or unknown outcome fields
 */
async function rescueStrandedLine({
  client,
  target,
  waits,
}: {
  client: CmuxClient;
  target: CmuxTarget;
  waits: ReachWaits;
}): Promise<{ disposition: SendDisposition; composer: ComposerReading }> {
  const submitted = await client.submitComposer({ target });
  if (submitted.isErr()) {
    const disposition: SendDisposition = keystrokeMayHaveLanded({ error: submitted.error }) ? "unknown" : "stranded";
    return {
      composer: { kind: "unreadable", reason: `the composer could not be submitted: ${submitted.error.message}` },
      disposition,
    };
  }
  await waits.settle();
  const after = await composerOrUnreadable({ client, target });
  return { composer: after, disposition: after.kind === "typed" ? "stranded" : "resubmitted" };
}

/**
 * Deliver one line to a surface and report what actually became of it.
 *
 * @param client the connected cmux client
 * @param target the surface to reach
 * @param text the line to deliver, without a trailing newline
 * @param interrupt whether to stop a running turn first, discarding its mid-step work
 * @param waits the injected waits
 * @returns what happened to the line, or the typed failure of the send itself
 */
export async function reachSession({
  client,
  target,
  text,
  interrupt,
  waits,
}: {
  client: CmuxClient;
  target: CmuxTarget;
  text: string;
  interrupt: boolean;
  waits: ReachWaits;
}): Promise<Result<ReachOutcome, CmuxError>> {
  let interrupted = false;
  if (interrupt) {
    const stopped = await interruptRunningTurn({ client, target, waits });
    if (stopped.isErr()) {
      return err(stopped.error);
    }
    interrupted = stopped.value;
  }
  const sent = await client.sendLine({ target, text });
  if (sent.isErr()) {
    return err(sent.error);
  }
  const disposition = await readDisposition({ client, target, waits });
  // A QUEUED line was submitted — Claude Code empties the box and swaps in its own waiting-message
  // placeholder, which `composer.ts` reads as a `suggestion` (its placeholder pattern matches only the
  // `Try "…"` hint). So the plain-screen verdict is asked FIRST and settles the case, and the composer is
  // never consulted for a line the screen has already accounted for.
  if (disposition === "queued") {
    return ok({ disposition, interrupted });
  }
  const composer = await composerOrUnreadable({ client, target });
  if (composer.kind !== "typed") {
    return ok({ composer, disposition, interrupted });
  }
  return ok({ ...(await rescueStrandedLine({ client, target, waits })), interrupted });
}
