/**
 * Which completed speech of a voice call the thread has not had yet, and when to hand it over: a fold over the call's
 * FINAL lines, its Codex turns starting, and what each post came to. Pure, so the order a call can meet is a test.
 *
 * Every starting turn takes the lines the thread has not had (`../components/voice/voiceRecordWiring.ts` posts them,
 * `PlanCall.steerSpokenRecord` steers them in). A line leaves the queue only once a post carrying it was TAKEN; on any
 * other answer — refused, failed, lost, or written with no answer read — it stays for the next turn, so a line may
 * reach the thread twice and never zero times. A turn starting while an older post is out is handed everything at
 * once, and only the newest post's answer is read, known by its number rather than its turn, since a replayed start
 * can post to one turn twice. A voice line finished while a turn runs, with no post out, is
 * handed to that turn until it completes, a post to it lost or refused or not. One still waiting when the turn
 * completes waits for the next turn: a completed turn cannot be steered, and the owner's asking about it starts one. The queue keeps at most {@link KEPT_LINES}; older ones are
 * dropped, and the drop is said.
 */
import {
  MAX_RECORD_LINE_CHARS,
  MAX_RECORD_LINES,
  type OpenCardDraft,
  recordToPost,
  type SpokenRecord,
  type SpokenRecordLine,
} from "./talkVoiceRecord";

/** The most undelivered lines held between turns: a long stretch with no turn keeps its newest. */
export const KEPT_LINES = 3 * MAX_RECORD_LINES;

/** The fold's state. */
export interface SpokenRecordQueue {
  /** The completed lines no taken post carried yet, oldest first. */
  readonly undelivered: readonly SpokenRecordLine[];
  /** Every line id ever queued, so a FINAL repeated by a reconnect is queued once. */
  readonly seen: readonly string[];
  /** The newest turn's post: which turn, which lines, and whose card's draft. An older post's answer is not read. */
  readonly inFlight:
    | {
        /** Its number, which its answer names. */
        readonly post: number;
        readonly turnId: string;
        readonly ids: readonly string[];
        readonly card: string | undefined;
      }
    | undefined;
  /** How many posts the call has made, so each has its own number. */
  readonly posts: number;
  /**
   * Every turn started and not yet completed, oldest first: a voice line finished late is handed to the newest, and
   * one completing early leaves an older still running.
   */
  readonly running: readonly string[];
}

/** A call that has said nothing yet. */
export const NO_SPOKEN_RECORD: SpokenRecordQueue = {
  inFlight: undefined,
  posts: 0,
  running: [],
  seen: [],
  undelivered: [],
};

/** How many ids the queue remembers having seen. */
const SEEN_KEPT = 256;

/**
 * One step of the fold. A starting turn names the draft of the card the owner's words began over: it goes with that turn's
 * post whether or not a line does, and is never queued — the next turn derives its own from its own words.
 */
export type SpokenRecordInput =
  | { readonly kind: "final"; readonly line: SpokenRecordLine }
  | { readonly kind: "turn-started"; readonly turnId: string; readonly openCard: OpenCardDraft | undefined }
  | { readonly kind: "turn-completed"; readonly turnId: string }
  | {
      readonly kind: "posted";
      /** The number of the post this answers, as the step that made it set `inFlight.post`. */
      readonly post: number;
      readonly turnId: string;
      readonly taken: boolean;
      readonly why: string | undefined;
    };

/** What the page does after one step: post a record, and write a line on the call's log. */
export interface SpokenRecordStep {
  readonly state: SpokenRecordQueue;
  readonly post: SpokenRecord | undefined;
  readonly notes: readonly string[];
}

/**
 * Fold one event into the queue.
 *
 * @returns the next state, the post to make, and the lines to log
 */
export function foldSpokenRecord({
  state,
  input,
}: {
  state: SpokenRecordQueue;
  input: SpokenRecordInput;
}): SpokenRecordStep {
  switch (input.kind) {
    case "final": {
      const queued = queueLine({ line: input.line, state });
      return input.line.who === "voice" ? handLate({ step: queued }) : queued;
    }
    case "turn-started": {
      const running = [...state.running.filter((id) => id !== input.turnId), input.turnId];
      // Every starting turn is handed what the thread has not had at once, even with an older post still out: that
      // post's turn has moved on, so waiting for it would leave this one without the record.
      return postTo({ notes: [], openCard: input.openCard, state: { ...state, running }, turnId: input.turnId });
    }
    case "turn-completed": {
      const running = state.running.filter((id) => id !== input.turnId);
      return { notes: [], post: undefined, state: { ...state, running } };
    }
    case "posted": {
      const out = state.inFlight;
      if (out?.post !== input.post) {
        return { notes: [], post: undefined, state };
      }
      if (!input.taken) {
        const why = input.why === undefined ? "" : `: ${input.why}`;
        const notes = [`turn ${input.turnId} did not take the record${why}; its lines wait for the next turn`];
        // A post lost or answered late says nothing of whether the turn still runs: only its completion ends it, so a
        // voice line finishing next is still handed to it. One it refuses is kept for the next.
        const step = { notes, post: undefined, state: { ...state, inFlight: undefined } };
        // A voice line that finished while that post was out was never offered, so it is offered now.
        // Only such a line: re-offering what the turn just refused would ask it again for every answer.
        const unoffered = state.undelivered.some((line) => line.who === "voice" && !out.ids.includes(line.id));
        return unoffered ? handLate({ step }) : step;
      }
      const undelivered = state.undelivered.filter((line) => !out.ids.includes(line.id));
      const draft = out.card === undefined ? "" : ` and ${out.card}'s draft`;
      const notes = [`steered ${String(out.ids.length)} line(s) of what was said${draft} into turn ${input.turnId}`];
      return handLate({ step: { notes, post: undefined, state: { ...state, inFlight: undefined, undelivered } } });
    }
    default: {
      const never: never = input;
      return never;
    }
  }
}

/**
 * Hand one turn the lines the thread has not had and the draft of the card the owner's words began over, when there is either.
 *
 * @param notes what this step already logs
 * @param openCard the draft of the card the owner's words began over, or `undefined` when they began over no post card
 * @returns the next state, the post to make, and the lines to log
 */
function postTo({
  state,
  turnId,
  openCard,
  notes,
}: {
  state: SpokenRecordQueue;
  turnId: string;
  openCard: OpenCardDraft | undefined;
  notes: readonly string[];
}): SpokenRecordStep {
  if (state.undelivered.length === 0 && openCard === undefined) {
    return { notes, post: undefined, state };
  }
  const { cut, dropped, lines } = recordToPost({ lines: state.undelivered });
  const said = [...notes];
  if (dropped > 0) {
    said.push(`${String(dropped)} older line(s) were left out of turn ${turnId}'s record to fit`);
  }
  if (cut > 0) {
    said.push(
      `${String(cut)} line(s) were cut to ${String(MAX_RECORD_LINE_CHARS)} characters in turn ${turnId}'s record`,
    );
  }
  return {
    notes: said,
    post: { lines, openCard, turnId },
    state: {
      ...state,
      inFlight: { card: openCard?.key, ids: lines.map((line) => line.id), post: state.posts + 1, turnId },
      posts: state.posts + 1,
    },
  };
}

/**
 * Hand the turn still running a voice line that finished after it started, once no post is out: a line cut off as the owner
 * interrupts finishes after the turn answering their question began, and that turn is the one asked what it was.
 * The owner's own lines wait for the next turn, which their words start.
 *
 * @param step the step so far, its state the queue after this input
 * @returns the step, posting to the running turn when a voice line waits for it
 */
function handLate({ step }: { step: SpokenRecordStep }): SpokenRecordStep {
  const { state } = step;
  const owed = state.undelivered.some((line) => line.who === "voice");
  const newest = state.running.at(-1);
  if (step.post !== undefined || newest === undefined || state.inFlight !== undefined || !owed) {
    return step;
  }
  return postTo({ notes: step.notes, openCard: undefined, state, turnId: newest });
}

/**
 * Queue one completed line, once, keeping the newest {@link KEPT_LINES}.
 *
 * @returns the next state, and the drop said when one happened
 */
function queueLine({ state, line }: { state: SpokenRecordQueue; line: SpokenRecordLine }): SpokenRecordStep {
  if (state.seen.includes(line.id) || line.text.trim().length === 0) {
    return { notes: [], post: undefined, state };
  }
  const seen = [...state.seen.slice(-(SEEN_KEPT - 1)), line.id];
  const all = [...state.undelivered, line];
  const undelivered = all.slice(-KEPT_LINES);
  const notes: string[] = [];
  if (undelivered.length < all.length) {
    notes.push(`${String(all.length - undelivered.length)} older line(s) dropped from the record no turn took`);
  }
  return { notes, post: undefined, state: { ...state, seen, undelivered } };
}
