/**
 * The two things `PlanCall` writes into its Codex thread unasked — a look's frame, steered into a running turn or
 * starting one, and the call's spoken record, with the draft of the card the owner's newest words began over —
 * and what each request came to. Split from `./talkPlanCall.ts`, to keep it under its 300-line cap; the class
 * passes in the state these read, so nothing here holds any.
 */
import {
  PLAN_CALL_LIMITS,
  type PlanFrameOutcome,
  type PlanLookStartOutcome,
  type PlanSpokenRecordOutcome,
} from "./planCallContract";
import { fateOf, type RpcOutcome } from "./talkPlanProtocol";
import { startedTurnIdOf } from "./talkPlanProtocolTurns";
import { LOOK_FRAME_TEXT } from "./talkPlanWords";
import type { VoiceProvenanceLedger } from "./talkVoiceProvenance";
import { type SpokenRecord, spokenRecordText } from "./talkVoiceRecord";

/**
 * What a `turn/steer` into `turnId` came to. A timeout or a call ending after the line went out is `unsure`, never
 * delivered or lost: the line is already on the child's stdin and nothing takes it back, so a slow child may still
 * apply it.
 *
 * @param steered the request's fate
 * @param turnId the turn it named as `expectedTurnId`
 * @param what what was steered, as the reason names it
 * @returns the outcome the route reports
 */
export function steeredOutcome({
  steered,
  turnId,
  what,
}: {
  steered: RpcOutcome;
  turnId: string;
  what: "frame" | "record";
}): Exclude<PlanFrameOutcome, { kind: "started" }> {
  if (steered.kind === "timeout") {
    return { kind: "unsure", reason: `turn ${turnId} did not answer the ${what} in time, and may still take it` };
  }
  if (steered.kind === "ended") {
    return { kind: "unsure", reason: `the call ended before turn ${turnId} answered the ${what}: ${steered.reason}` };
  }
  if (steered.kind !== "result") {
    return { kind: "failed", reason: `the ${what} did not reach turn ${turnId}: ${fateOf({ outcome: steered })}` };
  }
  return { kind: "steered", turnId };
}

/**
 * What a look's frame goes in as, steered or started: the fixed {@link LOOK_FRAME_TEXT}, then the picture.
 *
 * @param imageUrl the frame, a `data:image/` URL the route has already bounded
 * @returns the `input` of the `turn/steer` or `turn/start` carrying it
 */
export function lookFrameInput({
  imageUrl,
}: {
  imageUrl: string;
}): readonly [
  { readonly text: string; readonly type: "text" },
  { readonly detail: "high"; readonly type: "image"; readonly url: string },
] {
  return [
    { text: LOOK_FRAME_TEXT, type: "text" },
    { detail: "high", type: "image", url: imageUrl },
  ];
}

/**
 * What a `turn/start` carrying a look's frame came to. As with a steer, a timeout or a call ending after the line went
 * out is `unsure`, and so is an answer naming no turn: the child may have taken it either way.
 *
 * @param started the request's fate
 * @returns the outcome the route reports
 */
export function startedFrameOutcome({ started }: { started: RpcOutcome }): PlanLookStartOutcome {
  if (started.kind === "timeout") {
    return {
      kind: "unsure",
      reason: "the turn carrying the frame did not answer its start in time, and may still run",
    };
  }
  if (started.kind === "ended") {
    return { kind: "unsure", reason: `the call ended before the turn carrying the frame answered: ${started.reason}` };
  }
  if (started.kind !== "result") {
    return { kind: "failed", reason: `the turn carrying the frame did not start: ${fateOf({ outcome: started })}` };
  }
  const turnId = startedTurnIdOf({ result: started.result });
  if (turnId === undefined) {
    return { kind: "unsure", reason: "the thread took the turn carrying the frame and named no turn" };
  }
  return { kind: "started", turnId };
}

/**
 * The frame the page took for the owner's look ask, into the thread answering them: steered into the turn `turnForFrame`
 * picks, else — none running past {@link PLAN_CALL_LIMITS.lookStartMs}, because the voice answered the look itself —
 * the input of a turn started here, whose answer the app-server forwards to the voice as it does a hand-off's. The
 * console never waits on the voice to hand a look over: asked to, it did 1 of 17 times (`look-handoff`
 * lines over `$SLOPWEAVER_HOME/talk/calls/*.jsonl` and the `frame` line after each). A turn that starts while the
 * start is in flight takes the frame as a steer: `turn/start` adds its input to an active turn (codex-cli 0.157.1
 * `TurnStartParams`). One start is in flight per call at a time: a frame whose wait ends while another frame's start
 * is unanswered steers into the turn that start names, so two frames POSTed together never write two starts.
 *
 * @param imageUrl the frame, a `data:image/` URL the route has already bounded
 * @param endedReason why the call ended, read again after the wait for a turn
 * @param threadId the call's thread, once it has one
 * @param turnForFrame the newest running turn, else the next to start within the window
 * @param lookStart the call's one start in flight, set and cleared here
 * @param request the call's own request to its child, which writes before it returns
 * @param onLookStart told once a `turn/start` carrying the frame has been written
 * @returns the turn it was steered into or started, or why neither
 */
export async function attachLookFrame({
  imageUrl,
  endedReason,
  threadId,
  turnForFrame,
  lookStart,
  request,
  onLookStart,
}: {
  imageUrl: string;
  endedReason: () => string | undefined;
  threadId: string | undefined;
  turnForFrame: () => Promise<string | undefined>;
  lookStart: { pending: Promise<PlanLookStartOutcome> | undefined };
  request: (input: { method: string; params: unknown; timeoutMs: number }) => Promise<RpcOutcome>;
  onLookStart: () => void;
}): Promise<PlanFrameOutcome> {
  if (!imageUrl.startsWith("data:image/")) {
    return { kind: "refused", reason: "the frame is not a data:image/ URL" };
  }
  const endedBefore = endedReason();
  if (endedBefore !== undefined) {
    return { kind: "refused", reason: `the call has ended: ${endedBefore}` };
  }
  if (threadId === undefined) {
    return { kind: "refused", reason: "the call has no thread yet" };
  }
  let turnId = await turnForFrame();
  if (turnId === undefined && lookStart.pending !== undefined) {
    const earlier = await lookStart.pending;
    if (earlier.kind === "started") {
      turnId = earlier.turnId;
    } else if (earlier.kind !== "failed") {
      return { kind: "unsure", reason: `another frame's turn did not confirm its start: ${earlier.reason}` };
    }
  }
  const endedWhileHeld = endedReason();
  if (endedWhileHeld !== undefined) {
    return { kind: "refused", reason: `the call has ended: ${endedWhileHeld}` };
  }
  const input = lookFrameInput({ imageUrl });
  // From here on the ended checks above ran with no await before `request` writes, so a call ending now ended AFTER
  // the line went out: the child may already have taken the frame before its answer was read.
  if (turnId === undefined) {
    const starting = request({
      method: "turn/start",
      params: { input, threadId },
      timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
    }).then((started) => startedFrameOutcome({ started }));
    // Set before any await, so a frame whose wait ends next finds it rather than writing a second start.
    lookStart.pending = starting;
    // Told after the write, so a subscriber hearing of it cannot race a turn in ahead of the start.
    onLookStart();
    try {
      return await starting;
    } finally {
      if (lookStart.pending === starting) {
        lookStart.pending = undefined;
      }
    }
  }
  const steered = await request({
    method: "turn/steer",
    params: { expectedTurnId: turnId, input, threadId },
    timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
  });
  return steeredOutcome({ steered, turnId, what: "frame" });
}

/**
 * Into the delegated THREAD, the second write unasked by the model: the call's completed speech a starting turn has
 * not had, both sides, as {@link spokenRecordText} — quoted JSON between two fixed delimiters — steered into that turn
 * by `expectedTurnId`, so the thread that answers "where did that line come from" reads what the voice said. Without
 * it, asked about its own "fourteen cards", the voice denied saying it. The same text carries the
 * draft of the card the owner's words began over, so a read-back needs no card tool, and the
 * console's own writes since the last record that took (`./talkVoiceProvenance.ts`), so the turn can say where a line
 * came from. One record per turn at a time, the next waiting for it; a turn that is no
 * longer running refuses it, and the page keeps the lines for the next, as the ledger keeps its entries until a steer
 * is answered taken.
 *
 * @param input the call's state, as {@link SteerState}, and the record: the turn the page saw start, its completed
 *   lines and its card's draft, already bounded by the route
 * @returns whether the turn took it, or why not
 */
export async function steerSpokenRecord(
  input: SteerState & { record: SpokenRecord },
): Promise<PlanSpokenRecordOutcome> {
  const { endedReason, threadId, running, recording, record, provenance, request } = input;
  const { lines, openCard, turnId } = record;
  // A count of entries that fell off is provenance too: a block carrying only it still says so.
  const owed = provenance.pending();
  const nothingToSteer =
    lines.length === 0 && openCard === undefined && owed.entries.length === 0 && owed.dropped === 0;
  const ended = endedReason();
  let refusal: string | undefined;
  if (ended !== undefined) {
    refusal = `the call has ended: ${ended}`;
  } else if (threadId === undefined) {
    refusal = "the call has no thread yet";
  } else if (nothingToSteer) {
    refusal = "the record has no lines, no card draft and no provenance";
  } else if (!running.has(turnId)) {
    refusal = `turn ${turnId} is not running`;
  }
  if (refusal !== undefined) {
    return { kind: "refused", reason: refusal };
  }
  // One record into a turn at a time: the next waits for it and is judged again, never refused, since the call's own
  // offer and the page's post can meet in one turn, and a line refused there would miss it.
  const ahead = recording.get(turnId);
  if (ahead !== undefined) {
    await ahead;
    return steerSpokenRecord(input);
  }
  let answered = (): void => undefined;
  recording.set(
    turnId,
    new Promise<void>((resolve) => {
      answered = resolve;
    }),
  );
  // Claimed after every refusal, with no await between: a refused steer holds nothing.
  const carried = provenance.claim();
  let taken = false;
  try {
    const steered = await request({
      method: "turn/steer",
      params: {
        expectedTurnId: turnId,
        input: [{ text: spokenRecordText({ lines, openCard, provenance: carried }), type: "text" }],
        threadId,
      },
      timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
    });
    const outcome = steeredOutcome({ steered, turnId, what: "record" });
    // Only a steer answered taken folds what it carried: an unsure one may not have landed, and sending an entry twice
    // costs a line, where losing one costs the owner an answer.
    if (outcome.kind === "steered") {
      provenance.delivered({ carried });
      taken = true;
    }
    return outcome;
  } finally {
    if (!taken) {
      provenance.released({ carried });
    }
    recording.delete(turnId);
    answered();
  }
}

/** What a spoken record's steer reads of its call, as {@link steerSpokenRecord}'s parameters name it. */
export interface SteerState {
  /** Why the call ended, read at each judgement, since a record waiting on another is judged again after it. */
  readonly endedReason: () => string | undefined;
  readonly threadId: string | undefined;
  readonly running: ReadonlySet<string>;
  /** The turns a record is being steered into now, each until it is answered, set and cleared here. */
  readonly recording: Map<string, Promise<void>>;
  readonly provenance: VoiceProvenanceLedger;
  readonly request: (input: { method: string; params: unknown; timeoutMs: number }) => Promise<RpcOutcome>;
  /** Whether the call's own offer found no turn to take it, so the next turn to start is offered it again. */
  readonly offer: { owed: boolean };
}

/**
 * The call's own provenance the thread has not had, steered by the call into the newest running turn as a record with
 * no line once a grounding is kept: the page cannot know when a post whose answer it lost was kept, and the call does.
 * A record already being steered into that turn claimed before this was kept, so this waits for it and
 * steers what is still owed; one owing nothing is refused as nothing to steer. With no turn running, or one that
 * completed or failed to take it, the offer is owed to the next turn to start, which no page post may carry.
 *
 * @param state what the call's steer reads, as {@link SteerState}
 */
export async function offerProvenance(state: SteerState): Promise<void> {
  const newest = Array.from(state.running).at(-1);
  state.offer.owed = newest === undefined;
  if (newest === undefined) {
    return;
  }
  const outcome = await steerSpokenRecord({ ...state, record: { lines: [], openCard: undefined, turnId: newest } });
  const left = state.provenance.pending();
  if (outcome.kind === "steered" || (left.entries.length === 0 && left.dropped === 0)) {
    return;
  }
  // A turn that started while this offer was out saw nothing owed, so it is offered now.
  if (Array.from(state.running).at(-1) !== newest) {
    await offerProvenance(state);
    return;
  }
  state.offer.owed = true;
}
