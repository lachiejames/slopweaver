/*
 * The page's floor for a rollover the server asked for: what holds it, as a sentence, at each of the three stages a
 * call's remaining lifetime puts it in (`rolloverUrgency`, `./callRollover.ts`). Pure: `QuietRollover` acts on the
 * answer and journals it, and `useVoiceActivity` supplies the meters and the fold.
 *
 * Calm, every hold below holds. Urgent — the lifetime's cut minutes away, or the thread's context nearly full — the
 * hold for a turn the voice owes stops holding, since across a steady conversation it renews after every statement
 * and leaves no pause free: a call was cut mid-word after every pause across eight minutes (15s, 28s, 11s) fell inside
 * a 90-second "the voice owes the next turn" hold or one of the owner's. A turn of the owner's still awaiting the voice
 * keeps holding, since the voice's next words clear it. Last — seconds away — the owner's turn stops holding too,
 * leaving the voice's own work and the meters: a successor opened in a breath of the owner's is a smaller cut than the
 * lifetime's, which lands wherever it falls, while an answer the voice is giving or a turn still running would lose to
 * the rollover what the lifetime would only take later. Repro:
 * `grep -n -e '"kind":"closed"' -e '"final":true' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl | tail -n 12`.
 */

import { ROLLOVER_METER_QUIET_MS, ROLLOVER_OWED_HOLD_MS, type RolloverUrgency } from "./callRollover";
import { PLAN_CALL_LIMITS } from "./planCallContract";
import type { TurnTaking } from "./voiceTurnTaking";

/**
 * How long before the lifetime's cut a last-stage timed hold must have ended: the page judges the floor only on its
 * 80 ms meter samples, and its count of the remainder starts when the server's ask ARRIVES, so a hold allowed to run to
 * the estimated cut itself leaves no sample on which to release before the server's timer closes the call. Twelve samples, and room for the localhost stream's delivery.
 */
export const ROLLOVER_CUT_SLACK_MS = 1_000;

/** What holds the floor while the current call's words are not on disk yet, as the call file journals it. */
export const UNWRITTEN_HOLD = "the call's last words are not written down yet";

/**
 * When the current call's words were first seen not on disk, carried across meter samples: the first unwritten sample
 * starts it, later ones keep it, so a sink that stays behind is bounded from when it fell behind rather than renewed by
 * every line; a sample that sees it caught up clears it.
 *
 * @param previousMs the instant carried from the last sample, `undefined` when it saw the sink caught up
 * @param unwritten whether the sink holds words of the current call not on disk now (`TranscriptSink.unwritten`)
 * @param nowMs this sample's instant, on `performance.now()`
 * @returns the instant to carry, or `undefined` while nothing is unwritten
 */
export function unwrittenSinceAt({
  previousMs,
  unwritten,
  nowMs,
}: {
  previousMs: number | undefined;
  unwritten: boolean;
  nowMs: number;
}): number | undefined {
  if (!unwritten) {
    return undefined;
  }
  if (previousMs !== undefined) {
    return previousMs;
  }
  return nowMs;
}

/**
 * When the voice's words of an answer it has not finished last arrived: words since its last final, which a pause for
 * emphasis inside one answer does not end, though its meter goes quiet. Which came last is the
 * fold's own order, never the two instants compared, since a final and the next answer's first words can share a
 * millisecond.
 *
 * @param lastSpokeMs when the voice's words last arrived, `undefined` when they never have
 * @param answerOpen whether its words have arrived since its last final (`VoiceActivity.voiceAnswerOpen`)
 * @returns `lastSpokeMs` while an answer is open, else `undefined`
 */
export function voiceMidAnswerAt({
  lastSpokeMs,
  answerOpen,
}: {
  lastSpokeMs: number | undefined;
  answerOpen: boolean;
}): number | undefined {
  if (!answerOpen) {
    return undefined;
  }
  return lastSpokeMs;
}

/**
 * What holds the page's floor for a rollover, or `undefined` once it is free: nothing in flight — a delegation, a tool
 * call, a Codex turn — nothing owed, and neither the owner nor the voice heard for {@link ROLLOVER_METER_QUIET_MS}.
 *
 * The server judged its own floor when it asked; a held ask goes ahead only on this, so work that began after the ask
 * holds it too. A resume or a nudge the page sent holds it for the server's own quiet,
 * `PLAN_CALL_LIMITS.rolloverQuietMs`: neither is a row, and the voice it woke may not be audible yet. So does a Codex
 * turn that just COMPLETED: its row is gone the instant it ends, while the voice it handed an
 * answer to is not audible for most of a second. A call rolled over 51ms after its turn
 * completed and 76ms after the server handed the voice that turn's answer, so the owner never heard it and sat 51s in a
 * silent successor; repro: the last six lines of a call's `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`. An answer
 * the server still holds for the owner to finish holds it whatever the clock says, since a turn that completed while
 * they talked can be handed over long after; that pending hold is bounded by {@link ROLLOVER_OWED_HOLD_MS} of quiet on
 * both meters after the event that raised it, since a flag still up that long after is one whose `pending:false` the
 * page never received. In the last stage it holds only for the server's own quiet after the flag or the voice's newest
 * sound, and the owner's sound no longer renews it: renewed by every word of a steady conversation, it would hold into
 * the cut. An answer the voice is part-way through — words since its last final — holds it for the server's own
 * quiet after its newest words: its words arrive as it generates, so a gap that long is a pause, and a turn whose
 * final never comes cannot hold the floor into the cut. These are the voice's work, and hold at every stage.
 *
 * The owner's turn holds it, until the last stage: any of their words for the server's own quiet, and a turn of theirs
 * still open for {@link ROLLOVER_OWED_HOLD_MS} after its newest segment. A held ask once went ahead on
 * 1s of meter quiet inside a 72s turn of the owner's, so their whole turn went unanswered. Repro: the last 60 lines of
 * a call's `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`. A turn of the owner's that ended holds it until the voice
 * speaks words again, for {@link ROLLOVER_OWED_HOLD_MS}, at calm and urgent: the voice's words clear it, so it never
 * renews across a steady conversation, and a successor opened on it leaves the owner's question with nobody. Only calm
 * waits on a turn the voice owes them, for the same bound: that debt follows nearly every statement of the voice's.
 * Muted, the owner is never loud, so only the voice holds the meters.
 *
 * The call's own words not yet on disk hold it at calm and urgent ({@link UNWRITTEN_HOLD}), for
 * {@link ROLLOVER_OWED_HOLD_MS} from the first sample that saw them unwritten: the successor's mint reads the call it
 * replaces from its file, so a successor minted ahead of the transcript sink is told an exchange that stops short. A
 * call rolled over 1.4s after the voice finished answering the owner, with that answer still in the sink's queue for
 * ten more seconds, and the successor's opener quoted the owner's question and the voice's "on it" as the last
 * exchange. Repro: `storedIso` against the successor's `open` line in the two call files. The old call still listens
 * while it waits, so the wait costs nothing; the bound keeps a dead route from pinning the floor.
 *
 * @param urgency how near the lifetime's cut is
 * @param turn both meters' last stretches of sound
 * @param resumedAtMs when the page last asked the voice to take its turn, `undefined` when it never has
 * @param nudgedAtMs when the owner last pressed a nudge, `undefined` when they never have
 * @param completedAtMs when a Codex turn last completed with an answer to speak, `undefined` when none has
 * @param answerPendingMs when the server's last held-answer event said a completed message is still owed or being
 *   handed over, `undefined` when it said none is
 * @param answerHandedAtMs when a hand-over to the voice last ended, landed or failed, `undefined` when none has
 * @param voiceMidAnswerMs when the voice's words of an answer it has not finished last arrived ({@link voiceMidAnswerAt})
 * @param owedFromMs when the voice's final began a turn it owes the owner, `undefined` when it owes none
 * @param heardAtMs when the owner's words last arrived as transcript, `undefined` when they never have on this call
 * @param ownerOpenAtMs when the newest segment of an owner turn still open arrived, `undefined` when none is
 * @param ownerAwaitingVoiceMs when the owner's newest ended turn the voice has not spoken words since ended, `undefined` when the
 *   voice has
 * @param unwrittenSinceMs when the page first saw the current call's words not on disk yet ({@link unwrittenSinceAt}),
 *   `undefined` while the transcript sink holds none
 * @param inFlight how many rows of work the page shows in flight (`activityRows`, `./voiceActivity.ts`)
 * @param progressingInFlight how much of that work could still finish (`progressingWork`, `./voiceActivityRows.ts`):
 *   the last stage waits on no stalled work, nor a Codex turn whose own progress has gone quiet
 * @param nowMs the instant of the sample being judged, on the clock `turn` was folded on
 * @param remainingMs how long until the lifetime cuts the call (`heldAskStage`), `undefined` while the server has not
 *   said: in the last stage a timed hold of the voice's work that would not end {@link ROLLOVER_CUT_SLACK_MS}
 *   before the cut holds nothing
 * @returns what holds the floor, in a sentence the call file journals, or `undefined` when it is free
 */
export function pageRolloverHold({
  urgency,
  turn,
  resumedAtMs,
  nudgedAtMs,
  completedAtMs,
  answerPendingMs,
  answerHandedAtMs,
  voiceMidAnswerMs,
  owedFromMs,
  heardAtMs,
  ownerOpenAtMs,
  ownerAwaitingVoiceMs,
  unwrittenSinceMs,
  inFlight,
  progressingInFlight,
  nowMs,
  remainingMs,
}: {
  urgency: RolloverUrgency;
  unwrittenSinceMs: number | undefined;
  remainingMs: number | undefined;
  progressingInFlight: number;
  turn: TurnTaking;
  resumedAtMs: number | undefined;
  nudgedAtMs: number | undefined;
  completedAtMs: number | undefined;
  answerPendingMs: number | undefined;
  answerHandedAtMs: number | undefined;
  voiceMidAnswerMs: number | undefined;
  owedFromMs: number | undefined;
  heardAtMs: number | undefined;
  ownerOpenAtMs: number | undefined;
  ownerAwaitingVoiceMs: number | undefined;
  inFlight: number;
  nowMs: number;
}): string | undefined {
  const within = ({ since, ms }: { since: number | undefined; ms: number }): boolean =>
    since !== undefined && nowMs - since < ms;
  const quietMs = PLAN_CALL_LIMITS.rolloverQuietMs;
  const calm = urgency === "calm";
  const notLast = urgency !== "last";
  // In the last stage the owner's sound no longer renews a pending answer, and the hold is the server's quiet, not the
  // owed hold: renewed by every sound for 90s, a pending answer would pin the floor through the cut.
  const renewing = notLast ? [turn.owner?.lastMs, turn.voice?.lastMs] : [turn.voice?.lastMs];
  const sounds = renewing.filter((atMs) => atMs !== undefined);
  const pendingSince = answerPendingMs === undefined ? undefined : Math.max(answerPendingMs, ...sounds);
  const pendingMs = notLast ? ROLLOVER_OWED_HOLD_MS : quietMs;
  // In the last stage a timed hold of the voice's work holds only if it ends {@link ROLLOVER_CUT_SLACK_MS} before the
  // cut: one that outlasts that can only hand the cut a word the voice began after a pause the page let pass.
  const releaseByMs = notLast || remainingMs === undefined ? undefined : nowMs + remainingMs - ROLLOVER_CUT_SLACK_MS;
  const timed = ({ since, ms }: { since: number | undefined; ms: number }): boolean =>
    within({ ms, since }) && (releaseByMs === undefined || since! + ms <= releaseByMs);
  const prompted = [resumedAtMs, nudgedAtMs, completedAtMs, answerHandedAtMs].some((since) =>
    timed({ ms: quietMs, since }),
  );
  // In the last stage work holds only while a row of it still progresses, and only while its answer could still be
  // spoken: once a completion's own hold could no longer end in time, the work can only end in a word the cut takes,
  // and the meters decide.
  const working = notLast
    ? inFlight > 0
    : progressingInFlight > 0 && (releaseByMs === undefined || releaseByMs - nowMs > quietMs);
  const checks: readonly (readonly [boolean, string])[] = [
    [working, "work is in flight"],
    [notLast && within({ ms: ROLLOVER_OWED_HOLD_MS, since: unwrittenSinceMs }), UNWRITTEN_HOLD],
    [notLast && within({ ms: quietMs, since: heardAtMs }), "the owner's words are inside the rollover quiet"],
    [notLast && within({ ms: ROLLOVER_OWED_HOLD_MS, since: ownerOpenAtMs }), "the owner's turn is still open"],
    [
      notLast && within({ ms: ROLLOVER_OWED_HOLD_MS, since: ownerAwaitingVoiceMs }),
      "the owner's turn still awaits the voice",
    ],
    [timed({ ms: pendingMs, since: pendingSince }), "a completed answer is still pending"],
    [timed({ ms: quietMs, since: voiceMidAnswerMs }), "the voice is part-way through an answer"],
    [calm && within({ ms: ROLLOVER_OWED_HOLD_MS, since: owedFromMs }), "the voice still owes its turn"],
    [prompted, "the voice was just prompted"],
    [within({ ms: ROLLOVER_METER_QUIET_MS, since: turn.owner?.lastMs }), "the owner's meter is not quiet"],
    [within({ ms: ROLLOVER_METER_QUIET_MS, since: turn.voice?.lastMs }), "the voice's meter is not quiet"],
  ];
  return checks.find(([holds]) => holds)?.[1];
}
