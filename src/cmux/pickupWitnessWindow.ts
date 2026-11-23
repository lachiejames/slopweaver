/**
 * The pickup line's two witness windows — send it ONCE and watch, then submit the composer once more and watch
 * again — and the composer reads and early Enters inside them. `./pickupDelivery.ts`'s `deliverPickupCommand` calls
 * {@link sendPickupOnceThenWitness}; that module's header carries the witness chain and the delivery states
 * these windows end in.
 */

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import type { VisibleSessionHost } from "../supervisor/session.js";
import type { CmuxClient } from "./client.js";
import type { ComposerReading } from "./composer.js";
import { readPickupComposer, strandedPickupReason } from "./pickupComposerConfirm.js";
import {
  decidePickupPoll,
  foldComposerReading,
  MAX_PICKUP_ENTERS,
  type PickupSubmitState,
} from "./pickupComposerGate.js";
import type { PickupDelivery, SpawnDeps, SpawnFailureDetail, SpawnWorkspace } from "./spawn.js";
import { MAX_BOOT_POLLS, readScreenOrUndefined } from "./spawnPolling.js";
import { firstWitness, type Witness } from "./witness.js";

/** cmux's own record of what it last delivered to a workspace, or `undefined` when it has none. */
async function latestSubmitted({
  client,
  workspaceId,
}: {
  client: CmuxClient;
  workspaceId: string;
}): Promise<string | undefined> {
  if (workspaceId.length === 0) {
    return undefined;
  }
  const listed = await client.listWorkspaces();
  if (listed.isErr()) {
    return undefined;
  }
  return listed.value.find((workspace) => workspace.workspaceId === workspaceId)?.latestSubmittedMessage;
}

/**
 * The bound on ticks spent confirming the pickup command actually reached the surface.
 *
 * Measured live: the drop this doc's own bug produced was immediate and total — the prompt was
 * completely empty, not partially typed — which is why this bound was originally kept tight at 5 (`nothing
 * still arriving for a longer bound to catch`).
 *
 * A second live measurement (`recipe scheduler-tick`'s own gold-proof dispatch):
 * disproved that a short bound is always safe. The pickup DID land and the child DID progress to a real
 * `slot-started` lifecycle event, but delivery was reported failed anyway — under concurrent cmux load the
 * screen read threw on every one of the 5 allotted ticks, so the whole budget was spent on a transiently
 * unreadable surface. Matched to {@link MAX_BOOT_POLLS} rather than re-measured from one incident.
 *
 * DOUBLED when the re-send this bound used to hand off to was removed (see
 * {@link sendPickupOnceThenWitness}). This is deliberately NOT a new measurement and must not be read as one:
 * it is the SAME wall-clock the two-attempt loop already spent (`2 × MAX_BOOT_POLLS` ticks), moved out of
 * sending and into looking. Nothing waits longer than it already did, and nothing is delivered twice.
 * Reproduce the arithmetic with `grep -n 'MAX_SEND_VERIFY_POLLS\|MAX_BOOT_POLLS' src/cmux/*.ts`.
 */
export const MAX_SEND_VERIFY_POLLS = MAX_BOOT_POLLS * 2;

/**
 * The bound on ticks spent watching after the composer has been SUBMITTED a second time — see
 * {@link resubmitPickupThenWitness} for why a submit is not a send and why this window exists at all.
 *
 * MEASURED live, against Claude Code v2.1.258 on a real cmux workspace. A pickup line delivered
 * as `surface.send_text` with NO follow-up Enter sat in the composer unsent, exactly as the incident
 * describes; a single bare `surface.send_key enter` then submitted it, and cmux's own
 * `latest_submitted_message` first named it **20.0 s later** (Enter at 07:49:48.867Z, the delivery record
 * answering at 07:50:08.880Z). Thirty ticks covers that with headroom, and in a live spawn the event witness
 * answers far sooner — the 20 s is the worst of the three sources, not the expected one.
 *
 * Reproduce both halves with the shipped verbs: type a long line into a spawned session's composer by hand
 * (or watch a stranded one), confirm `slopweaver cmux list --json` carries no `latestSubmittedMessage` for
 * it, then `slopweaver cmux submit --workspace <ref>` and watch the field populate.
 */
export const MAX_RESUBMIT_VERIFY_POLLS = 30;

/** The hook firings that prove a pickup command was actually submitted to the agent inside a workspace. */
const PICKUP_EVENT_NAMES = ["agent.hook.UserPromptSubmit", "agent.hook.PreToolUse"] as const;

/** How one witness window ended: a witness, nothing (with where the Enters and the box stand), or a refused Enter. */
type PickupWatch =
  | { readonly kind: "witnessed"; readonly witness: Witness; readonly state: PickupSubmitState }
  | { readonly kind: "unwitnessed"; readonly state: PickupSubmitState; readonly composer: ComposerReading }
  | { readonly kind: "enter-refused"; readonly reason: string };

/** Where a witness window starts: the Enters already spent, and what the box was last seen holding. */
interface PickupWatchStart {
  readonly state: PickupSubmitState;
  readonly composer: ComposerReading;
}

/** What the box is taken to hold before anything has read it. */
const COMPOSER_NOT_READ: ComposerReading = { kind: "unreadable", reason: "the composer was not read" };

/**
 * Poll the full witness chain until something confirms the pickup command arrived, or give up after `ticks`
 * ticks — reading the composer on every tick the chain answers nothing, and pressing a bare Enter when the box
 * has held the line past `pickupEnterSpacing` (`./pickupComposerGate.ts`'s `decidePickupPoll`).
 *
 * An Enter cmux refuses on a box positively read `typed` ends the window at once: the line is stranded and a
 * cmux that will not take a keystroke will not take the next one either.
 *
 * @param deps the effects to poll through
 * @param workspace the workspace being watched
 * @param expected the exact pickup text whose arrival is being witnessed
 * @param ticks how many ticks this window is willing to spend — {@link MAX_SEND_VERIFY_POLLS} after the
 *   line is typed, {@link MAX_RESUBMIT_VERIFY_POLLS} after the composer is submitted again
 * @param start the Enters already spent and the box as last seen, carried in from the window before
 * @param host which model CLI the seat booted, so a running turn answers only on a host measured for one
 * @returns the first witness that confirmed, or where the Enters and the box stand once the bound is reached
 */
async function pollForPickupWitness({
  deps,
  workspace,
  expected,
  ticks,
  start,
  host,
}: {
  deps: SpawnDeps;
  workspace: SpawnWorkspace;
  expected: string;
  ticks: number;
  start: PickupWatchStart;
  host: VisibleSessionHost;
}): Promise<PickupWatch> {
  let { composer, state } = start;
  for (let tick = 0; tick < ticks; tick++) {
    await deps.wait();
    state = {
      entersSpent: state.entersSpent,
      pressedOnTyped: state.pressedOnTyped,
      ticksSinceEnter: state.ticksSinceEnter + 1,
    };
    const witness = firstWitness({
      eventNames: PICKUP_EVENT_NAMES,
      events: deps.observedEvents(),
      expected,
      host,
      screen: await readScreenOrUndefined({ client: deps.client, workspace }),
      submitted: await latestSubmitted({ client: deps.client, workspaceId: workspace.workspaceId }),
      workspaceId: workspace.workspaceId,
    });
    if (witness !== undefined) {
      return { kind: "witnessed", state, witness };
    }
    composer = foldComposerReading({
      next: await readPickupComposer({ client: deps.client, workspace }),
      previous: composer,
    });
    const decision = decidePickupPoll({ reading: composer, state });
    if (decision.kind === "left-composer") {
      return { kind: "witnessed", state, witness: { by: "composer", confirmed: true } };
    }
    if (decision.kind === "budget-spent") {
      return { composer, kind: "unwitnessed", state };
    }
    if (decision.kind === "submit") {
      const pressed = await pressEarlyEnter({ deps, state, text: decision.text, workspace });
      if (pressed.isErr()) {
        return { kind: "enter-refused", reason: pressed.error };
      }
      state = pressed.value;
    }
  }
  return { composer, kind: "unwitnessed", state };
}

/**
 * Press one bare Enter on a box the witness window read holding the line — nothing typed — and log it.
 *
 * @param deps the effects to submit through
 * @param state where the Enters stood before this one
 * @param text what the box holds, for the refusal a refused Enter ends in
 * @param workspace the workspace whose composer is submitted
 * @returns the Enters' state once this one is spent, or the stranded refusal when cmux refused it
 */
async function pressEarlyEnter({
  deps,
  state,
  text,
  workspace,
}: {
  deps: SpawnDeps;
  state: PickupSubmitState;
  text: string;
  workspace: SpawnWorkspace;
}): Promise<Result<PickupSubmitState, string>> {
  const entersSpent = state.entersSpent + 1;
  const ofBudget = `${String(entersSpent)} of ${String(MAX_PICKUP_ENTERS)}`;
  logger.error({
    msg:
      `cmux spawn: the pickup is still TYPED in ${workspace.workspaceRef}'s composer ${String(state.ticksSinceEnter)} ` +
      `ticks after the last Enter — pressing Enter ${ofBudget}, the line is NOT re-typed`,
  });
  const submitted = await deps.client.submitComposer({
    target: { surfaceId: workspace.surfaceId, workspaceId: workspace.workspaceId },
  });
  if (submitted.isErr()) {
    return err(
      strandedPickupReason({
        pressed: `Enter ${ofBudget} was refused (${submitted.error.message})`,
        text,
        workspaceRef: workspace.workspaceRef,
      }),
    );
  }
  return ok({ entersSpent, pressedOnTyped: true, ticksSinceEnter: 0 });
}

/**
 * Send the pickup line ONCE, then look for it until {@link MAX_SEND_VERIFY_POLLS} ticks are spent.
 *
 * **The send is never repeated, and that is the fix rather than an omission.** The previous shape retried the
 * SEND on a failed witness, reasoning that a genuinely dropped paste can only be helped by sending it again.
 * Measured on two live dispatches (a Slack ask into workspace:399, and `gmail-integration` phase
 * C into workspace:398), that reasoning is inverted by the actual failure: both sends landed and NEITHER was
 * witnessed, so the retry queued a SECOND copy of the pickup line in the child's input, which fired the
 * moment its first turn ended — a fresh session re-reading its doc and re-running `handover start` mid-run.
 * Phase C took three pickups this way. A duplicate pickup is not the harmless re-read the old comment here
 * claimed; it is a second, uninstructed run of the whole packet.
 *
 * The asymmetry that settles it: a queued-but-unconsumed prompt is invisible to every witness this module
 * has — no `UserPromptSubmit` hook until the session consumes it, a `latest_submitted_message` that may not
 * name it, and a screen showing an idle prompt — so "nothing witnessed it" and "it never arrived" are the
 * same observation with opposite truths. Sending again bets on the rarer one and pays the cost of the
 * commoner one. Looking longer, and then SAYING the delivery is unwitnessed rather than failed, costs
 * nothing either way.
 *
 * What that reasoning does NOT cover, and what {@link resubmitPickupThenWitness} handles once this window is
 * spent, is a THIRD truth behind the same observation: the line typed into the composer and never submitted.
 * Sending it again would append a second copy to a composer that already holds it; submitting the composer
 * costs nothing on either of the other two truths. Read the two headers together — this one bans re-typing,
 * that one presses one key.
 *
 * The delivery record is worth being precise about, because both directions were measured and
 * a flat claim either way is wrong: on workspace:398 a queued pickup left `latest_submitted_message` EMPTY,
 * while on workspace:410 a queued send populated it immediately (truncated at 240 chars, as
 * `sendEvidence.ts` records). Reproduce either with
 * `slopweaver cmux send --workspace <ref> "<text>"` then `slopweaver cmux list --json`. So its ABSENCE is
 * never evidence of non-delivery — only its presence is evidence of delivery.
 *
 * **This function does not retry `sendLine` itself, and that is a separate claim from the one above.** A
 * `SOCKET_UNAVAILABLE` write failure (`write EPIPE`) is CONFIRMED non-delivery — nothing reached cmux, so
 * there is no ambiguity to protect against — and `cmux/client.ts`'s `realCmuxClient` already retries exactly
 * that failure, transparently, via `socket.ts`'s `withSocketRetry`, before `sendLine` here ever returns `err`.
 * By the time `sent.isErr()` below is true, that budget is spent; sending again on the same dead path would
 * fail identically. `err` from `sendLine` is therefore returned as-is, not retried a second time — see
 * `./spawn.ts`'s header, "A control-socket write can EPIPE", for the point that reconnect is meant to close.
 *
 * **Its Enter is counted, and watched.** MEASURED under cmux 0.65.2, `sendLine`'s own Enter left
 * the box `typed` on 4 seats of 4, so this window reads the composer on every tick nothing else answers and
 * presses a bare Enter on a box positively seen holding the line — see `./pickupComposerGate.ts`'s
 * `decidePickupPoll`. Once it has pressed one, the blind resubmit below is not pressed at all: the box was read,
 * so there is nothing left for a blind keystroke to reach.
 *
 * @param deps the effects to send and poll through
 * @param workspace the workspace to send into
 * @param expected the exact pickup text
 * @param host which model CLI the seat booted
 * @returns how delivery ended with every Enter spent and the box as last seen, or why the line could not be
 *   sent at all, or the stranded refusal when cmux refused an Enter on a typed box
 */
export async function sendPickupOnceThenWitness({
  deps,
  workspace,
  expected,
  host,
}: {
  deps: SpawnDeps;
  workspace: SpawnWorkspace;
  expected: string;
  host: VisibleSessionHost;
}): Promise<Result<WatchedPickup, SpawnFailureDetail>> {
  const sent = await deps.client.sendLine({
    target: { surfaceId: workspace.surfaceId, workspaceId: workspace.workspaceId },
    text: expected,
    wait: deps.wait,
  });
  if (sent.isErr()) {
    return err({ reason: `the pickup command could not be sent: ${sent.error.message}` });
  }
  const watch = await pollForPickupWitness({
    deps,
    expected,
    host,
    start: { composer: COMPOSER_NOT_READ, state: { entersSpent: 1, pressedOnTyped: false, ticksSinceEnter: 0 } },
    ticks: MAX_SEND_VERIFY_POLLS,
    workspace,
  });
  if (watch.kind !== "unwitnessed" || watch.state.entersSpent > 1) {
    return watchedPickup({ watch });
  }
  return resubmitPickupThenWitness({ deps, expected, host, start: watch, workspace });
}

/** A pickup's delivery once its witness windows end, with every Enter it had and the box as last seen. */
interface WatchedPickup {
  readonly delivery: PickupDelivery;
  readonly entersSpent: number;
  /** What an unwitnessed window last read the box holding; never read after a witness answered. */
  readonly composer: ComposerReading;
  /** Whether a window pressed an Enter on a box it read typed — so a later read of it readable is the witness. */
  readonly pressedOnTyped: boolean;
}

/**
 * What one finished witness window comes to: a witness is `witnessed` when `sendLine`'s Enter was the only one
 * and `resubmitted` when a later Enter came first, nothing is `unwitnessed`, and a refused Enter is stranded.
 *
 * @param watch how the window ended
 * @returns the delivery, every Enter it had and the box as last seen, or the stranded refusal
 */
function watchedPickup({ watch }: { watch: PickupWatch }): Result<WatchedPickup, SpawnFailureDetail> {
  switch (watch.kind) {
    case "enter-refused":
      return err({ reason: watch.reason, strandedInComposer: true });
    case "unwitnessed": {
      const { entersSpent, pressedOnTyped } = watch.state;
      return ok({ composer: watch.composer, delivery: { kind: "unwitnessed" }, entersSpent, pressedOnTyped });
    }
    case "witnessed": {
      const { entersSpent, pressedOnTyped } = watch.state;
      const kind = entersSpent > 1 ? "resubmitted" : "witnessed";
      return ok({
        composer: COMPOSER_NOT_READ,
        delivery: { kind, witness: watch.witness },
        entersSpent,
        pressedOnTyped,
      });
    }
    default: {
      const exhaustive: never = watch;
      return exhaustive;
    }
  }
}

/**
 * Submit whatever the composer is already holding — a bare Enter, nothing typed — then watch for
 * {@link MAX_RESUBMIT_VERIFY_POLLS} more ticks.
 *
 * **A SUBMIT IS NOT A SEND, and the whole safety of this step is that distinction.**
 * {@link sendPickupOnceThenWitness}'s header records why re-SENDING an unwitnessed pickup is the damage
 * rather than the fix: `sendLine` types the text and then submits it, so a second call puts a second copy in
 * the child's input, which fires the moment its first turn ends. This types nothing at all. On a composer
 * holding a stranded line it submits that line; on an empty one there is nothing to submit.
 *
 * MEASURED live, both halves, against Claude Code v2.1.258:
 *
 * - **The strand reproduces exactly.** `surface.send_text` with the trailing newline and NO follow-up Enter
 *   left the full pickup line sitting at the `❯` composer for the whole observation, with cmux reporting no
 *   `latest_submitted_message` at all — the state the incident describes, and the state in which every
 *   witness this module has is honestly answering "no".
 * - **A bare Enter is a NO-OP on a busy session with an empty composer.** The same workspace, once it was
 *   running its first turn, was sent one `surface.send_key enter`: `latest_submitted_at` did not move across
 *   eight reads over 32 s, and no second turn started. So the earlier case this step must not make worse — a
 *   pickup that landed and simply was not seen — costs exactly nothing here, while the stranded case is
 *   rescued. That asymmetry is the reverse of the one that banned a second send.
 *
 * The Enter is therefore sent UNCONDITIONALLY at the window's end rather than only when the screen shows a
 * typed line. Conditioning it on the screen would disarm it in precisely the case that produced this
 * module's false negatives — a surface too loaded to read — and the measurement above says there is nothing
 * to be bought by that caution. It is pressed only when the first window pressed nothing of its own, which is
 * a box it could never read holding the line: a box it did read got its Enters there.
 *
 * @param deps the effects to submit and poll through
 * @param workspace the workspace whose composer is being submitted
 * @param expected the exact pickup text still being witnessed
 * @param start where the first window left the Enters and the box
 * @param host which model CLI the seat booted
 * @returns how the second window ended, with every Enter spent and the box as last seen
 */
async function resubmitPickupThenWitness({
  deps,
  workspace,
  expected,
  start,
  host,
}: {
  deps: SpawnDeps;
  workspace: SpawnWorkspace;
  expected: string;
  start: PickupWatchStart;
  host: VisibleSessionHost;
}): Promise<Result<WatchedPickup, SpawnFailureDetail>> {
  const submitted = await deps.client.submitComposer({
    target: { surfaceId: workspace.surfaceId, workspaceId: workspace.workspaceId },
  });
  // Counted whether or not cmux took it, as the composer gate counts one it refused.
  const entersSpent = start.state.entersSpent + 1;
  if (submitted.isErr()) {
    logger.error({
      msg:
        `cmux spawn: nothing witnessed the pickup command arriving in ${workspace.workspaceRef} within ` +
        `${String(MAX_SEND_VERIFY_POLLS)} ticks, and the composer could not be submitted again either ` +
        `(${submitted.error.message}) — the line was NOT re-typed; treat the workspace as holding a worker ` +
        `until something proves otherwise`,
    });
    return ok({
      composer: start.composer,
      delivery: { kind: "unwitnessed" },
      entersSpent,
      pressedOnTyped: start.state.pressedOnTyped,
    });
  }
  const watch = await pollForPickupWitness({
    deps,
    expected,
    host,
    start: { composer: start.composer, state: { ...start.state, entersSpent, ticksSinceEnter: 0 } },
    ticks: MAX_RESUBMIT_VERIFY_POLLS,
    workspace,
  });
  if (watch.kind === "witnessed") {
    logger.error({
      msg:
        `cmux spawn: the pickup command went unwitnessed for ${String(MAX_SEND_VERIFY_POLLS)} ticks in ` +
        `${workspace.workspaceRef}, so its composer was submitted again — the line was NOT re-typed — and ` +
        `${watch.witness.by} then confirmed it`,
    });
  }
  if (watch.kind === "unwitnessed") {
    logger.error({
      msg:
        `cmux spawn: the pickup command was sent into ${workspace.workspaceRef}, its composer was submitted ` +
        `again after ${String(MAX_SEND_VERIFY_POLLS)} ticks, and nothing witnessed it arriving in the ` +
        `${String(MAX_RESUBMIT_VERIFY_POLLS)} ticks after that — the line was NOT re-typed, because it may ` +
        `simply be queued in that session's input`,
    });
  }
  return watchedPickup({ watch });
}
