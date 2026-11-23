/**
 * What one release of the thinking model's held messages hands the voice, and whose words that text carries: pure, so
 * every rule over nods, blanks, split sign-offs, superseded commentary and the console's running-list line is a test
 * over plain values. `HeldAnswers` (`./talkPlanHeldAnswers.ts`) holds the messages and decides WHEN a release goes;
 * this file decides WHAT it says, and declares what `HeldAnswers` reads of the call it speaks on.
 */
import type { PlanCallEvent } from "./planCallContract";
import type { RpcOutcome } from "./talkPlanProtocol";

/** What the held answers read of the call they speak on, and the two things they do there. */
export interface HeldAnswersCall {
  /** Why the call takes no own write now (`ownWriteRefusal`, `./talkPlanFloor.ts`), or `undefined`. */
  readonly blocked: () => string | undefined;
  /** When the realtime session last transcribed the owner, and when the voice. */
  readonly transcribed: () => { readonly heardAt: number | undefined; readonly voiceAt: number | undefined };
  /** The Codex turns started and not completed, whose commentary the owner's newer words overtake. */
  readonly runningTurns: () => ReadonlySet<string>;
  /** Hand the voice the text to say, in its own words (`thread/realtime/appendSpeech`). */
  readonly speak: (input: { readonly text: string }) => Promise<RpcOutcome>;
  /** The voice took a release: the call restarts its progress window. */
  readonly voiced: () => void;
  /**
   * A release that may have been said — taken, or timed out — carried an answer (or the running-list line) of the
   * `answered` turns, so none of them ends having handed the voice nothing, and only commentary of the `commented`
   * ones, which tells the owner the work is on without answering it (`./talkPlanTurnOutcome.ts`).
   */
  readonly handed: (input: { readonly answered: readonly string[]; readonly commented: readonly string[] }) => void;
  /** Tell the page's stream. */
  readonly emit: (input: { readonly event: PlanCallEvent }) => void;
}

/** One completed message of the thinking model's, not yet handed to the voice. */
export interface HeldAnswer {
  readonly itemId: string;
  readonly turnId: string;
  readonly text: string;
  /** A commentary message, written while its turn keeps working, rather than the turn's answer. */
  readonly commentary: boolean;
  /**
   * The call's arrival number for the completed message, which says whether the owner's later words could have reached it:
   * ordered by arrival, never by the wall clock, which can step backwards.
   */
  readonly completedSeq: number;
}

/**
 * The one line that tells the owner a draft is on their running list. The CONSOLE says it, after a turn's answer whose turn
 * landed an unrefused `offer_copy`, and nothing else ever does: the voice prompt names no such line, and the thinking
 * model is told the console says it. With the line quoted in the voice's own
 * prompt as the thing to say once an offer landed, the voice ended ~10 turns with it across a call that made no
 * `offer_copy` call at all, and the owner's running list took no entry for nearly four hours (3h57m). The
 * thinking model never wrote it; the voice added it. Repro: `jq -r 'select(.kind=="wrote" or (.kind=="segment" and
 * .who=="voice")) | "\(.atIso) \(.kind) \(.text[-80:])"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl | grep -i
 * "running list"` prints only voice segments, and `grep -c offer_copy` on the same file prints 0.
 */
export const RUNNING_LIST_LANDED_LINE = "It's on your running list, what do you think?";

/**
 * Every running-list sign-off anywhere in a message, in the forms the voice says it, either
 * apostrophe, the halves split and the line ended by any run of marks that is no letter or digit (one listed mark at a
 * time would miss `?`, then `…`), mid-answer or quoted too, since the voice says those as well
 * — one per match, so the global replace cuts two in a row without a repeated group,
 * which `redos-check` refuses as exponential. Restated from `src/talk/copyToolSchemas.ts`'s `LIST_SIGN_OFF`, because
 * `site/lib/` imports nothing from `src/`; `src/__tests__/unit/talk/listSignOffMirror.test.ts` holds the two equal.
 */
export const OWN_LIST_SIGN_OFF =
  /\s*["“'‘]?(?:it|that)(?:['’]s| is) on your running list[^\p{L}\p{N}]*what do you think[^\p{L}\p{N}]*/giu;

/** What one message of the thinking model's carries for the voice: nothing, only a nod, or words to say. */
export type HeldMessageKind = "blank" | "backchannel" | "substantive";

/**
 * The only words read as a nod and nothing more, once lowercased. Closed on purpose: "yes", "okay" and "no" answer a
 * question, and "Mm-hmm, the build passed" says something, so each stays words to say.
 */
const BACKCHANNELS: ReadonlySet<string> = new Set(["mm-hmm", "mm-hm", "mhm", "uh-huh", "hmm"]);

/** What separates one word of a message from the next: anything but a letter, a digit or a hyphen inside a word. */
const WORD_BREAKS = /[^\p{L}\p{N}-]+/u;

/**
 * Whether a message of the thinking model's gives the voice anything to say. Measured: a turn wrote "Mm-hmm." over
 * the owner's unfinished clause, the voice was handed it, and said "I'm following that and checking what else depends
 * on those citation links" — a check nothing was running. A blank is no letter or digit, so whitespace or a
 * zero-width character alone is one, as `HeldAnswers.heard` reads the owner's words.
 *
 * @param text the message's words
 * @returns `blank`, `backchannel` when every word is one of {@link BACKCHANNELS} ("Mm-hmm. Uh-huh." too), else `substantive`
 */
export function heldMessageKind({ text }: { text: string }): HeldMessageKind {
  const trimmed = text.trim();
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return "blank";
  }
  const words = trimmed
    .toLowerCase()
    .split(WORD_BREAKS)
    .map((word) => word.replace(/^-+|-+$/gu, ""))
    .filter((word) => word !== "");
  if (words.every((word) => BACKCHANNELS.has(word))) {
    return "backchannel";
  }
  return "substantive";
}

/**
 * Whether a held message has words for the voice once its running-list sign-off is cut, which the console says itself.
 *
 * @param answer the held message
 * @returns true when it is {@link heldMessageKind} `substantive`
 */
export function saysSomething({ answer }: { answer: HeldAnswer }): boolean {
  return heldMessageKind({ text: withoutSignOff({ text: answer.text }) }) === "substantive";
}

/**
 * The words some held messages say together, joined the way a release speaks them: each one's running-list sign-off
 * cut, then the sign-off a split across two of them makes once joined.
 *
 * @param part the held messages, in the order they are spoken
 * @returns the joined text
 */
function joinedOf({ part }: { part: readonly HeldAnswer[] }): string {
  return withoutSignOff({ text: part.map((h) => withoutSignOff({ text: h.text })).join("\n\n") });
}

/**
 * The messages a release keeps, of those the owner's newer words did not supersede: a turn's commentary goes once that turn's
 * answers that each say something, joined, still do, which overtakes it — and stays beside blanks, nods or a sign-off
 * split across two answers, which say nothing to overtake it with ("Checking the logs." is not lost behind a final
 * "Mm-hmm." or behind "It's on your running list," and "what do you think?").
 *
 * @param current the held messages the owner's newer words did not supersede, oldest first
 * @returns the kept ones, in order
 */
function keptOf({ current }: { current: readonly HeldAnswer[] }): HeldAnswer[] {
  const turns = new Set(current.filter((h) => !h.commentary).map((h) => h.turnId));
  const answered = new Set(
    Array.from(turns).filter((turnId) => {
      // Only the answers a release would say: two nods joined are not words.
      const answers = current.filter((h) => !h.commentary && h.turnId === turnId && saysSomething({ answer: h }));
      return heldMessageKind({ text: joinedOf({ part: answers }) }) === "substantive";
    }),
  );
  return current.filter((h) => !h.commentary || !answered.has(h.turnId));
}

/**
 * Text less every running-list sign-off in it, cut again until none is left, since a cut can join two halves into a
 * new one. Each cut shortens the text, so it ends.
 *
 * @param text the words to clean
 * @returns them trimmed, with each sign-off run replaced by one space
 */
export function withoutSignOff({ text }: { text: string }): string {
  let before = "";
  let after = text;
  while (after !== before) {
    before = after;
    // A match starting where the last ended is the same run, so it adds no second space.
    let end = -1;
    after = after.replace(OWN_LIST_SIGN_OFF, (match, offset: number) => {
      const joined = offset === end;
      end = offset + match.length;
      return joined ? "" : " ";
    });
  }
  return after.trim();
}

/**
 * Whether a held message is one a newer Codex turn has overtaken: it arrived before that turn started, whatever its
 * own turn's state and whether it is commentary or an answer. A turn starts for the owner's newer words (or the console's own
 * owed start), on the same thread, so the newer turn reads every message the older one wrote and its answer is the one
 * owed. Handed to the voice anyway, an older answer held over a 5-minute utterance about a card was spoken 8s after the
 * owner's words had started the newer turn, and the voice re-read the card the owner had just ruled on.
 *
 * Only ANOTHER turn's start overtakes a message: its own turn's start, delivered after the message it wrote, is that
 * turn's, never a newer one.
 *
 * @param answer the held message
 * @param turnStarts each turn whose start the call has seen, by the arrival number of its first start
 * @returns the newest other turn that started after the message arrived, `undefined` when none did
 */
export function overtakingTurnOf({
  answer,
  turnStarts,
}: {
  answer: HeldAnswer;
  turnStarts: ReadonlyMap<string, number>;
}): string | undefined {
  let newest: { readonly turnId: string; readonly seq: number } | undefined;
  turnStarts.forEach((seq, turnId) => {
    const later = seq > answer.completedSeq && (newest === undefined || seq > newest.seq);
    if (turnId !== answer.turnId && later) {
      newest = { seq, turnId };
    }
  });
  return newest?.turnId;
}

/**
 * Whether a held message is words the owner has already moved past: commentary the owner's newer finished words overtook (its turn
 * still runs, so it will answer them, and it arrived before their newest worded `done`), or any message a newer turn
 * overtook ({@link overtakingTurnOf}).
 *
 * @param answer the held message
 * @param runningTurns the Codex turns started and not completed
 * @param latestHeardDoneSeq the arrival number of the owner's newest `done` with words in it
 * @param turnStarts each turn whose start the call has seen, by the arrival number of its first start
 * @returns true when it is never to be said
 */
export function supersededByOwner({
  answer,
  runningTurns,
  latestHeardDoneSeq,
  turnStarts,
}: {
  answer: HeldAnswer;
  runningTurns: ReadonlySet<string>;
  latestHeardDoneSeq: number | undefined;
  turnStarts: ReadonlyMap<string, number>;
}): boolean {
  const overtakenByHisWords =
    answer.commentary &&
    runningTurns.has(answer.turnId) &&
    latestHeardDoneSeq !== undefined &&
    answer.completedSeq < latestHeardDoneSeq;
  return overtakenByHisWords || overtakingTurnOf({ answer, turnStarts }) !== undefined;
}

/**
 * Why a release handed the voice none of what it took, every message {@link supersededByOwner}: a newer turn started
 * after the last of them was written, or the owner's words since reached its turn, still running. Its answer is the one owed.
 *
 * @param last the last message the release took
 * @param turnStarts each turn whose start the call has seen, by the arrival number of its first start
 * @returns the `dropped` event's detail
 */
export function supersededDetail({
  last,
  turnStarts,
}: {
  last: HeldAnswer;
  turnStarts: ReadonlyMap<string, number>;
}): string {
  const overtaking = overtakingTurnOf({ answer: last, turnStarts });
  if (overtaking !== undefined) {
    return `turn ${overtaking} started after it was written, and its answer is the one owed`;
  }
  return `the owner's words since it reached turn ${last.turnId}, still running, whose answer is the one owed`;
}

/**
 * The messages a release keeps but has nothing to hand the voice for — a blank, or a nod alone — each with its
 * `dropped` event's detail, so none is dropped unseen.
 *
 * @param taken every message the release took
 * @param runningTurns the Codex turns started and not completed
 * @param latestHeardDoneSeq the arrival number of the owner's newest `done` with words in it
 * @param turnStarts each turn whose start the call has seen, by the arrival number of its first start
 * @returns each such message's item, turn and detail, in the order taken
 */
export function unsaidOf({
  taken,
  runningTurns,
  latestHeardDoneSeq,
  turnStarts,
}: {
  taken: readonly HeldAnswer[];
  runningTurns: ReadonlySet<string>;
  latestHeardDoneSeq: number | undefined;
  turnStarts: ReadonlyMap<string, number>;
}): readonly { readonly detail: string; readonly itemId: string; readonly turnId: string }[] {
  const seqs = { latestHeardDoneSeq, runningTurns, turnStarts };
  return taken
    .filter((answer) => !supersededByOwner({ ...seqs, answer }) && !saysSomething({ answer }))
    .map(({ itemId, text, turnId }) => {
      const kind = heldMessageKind({ text: withoutSignOff({ text }) });
      const detail = `the message was ${kind === "blank" ? "blank" : "only a backchannel"}, so there was nothing to hand the voice`;
      return { detail, itemId, turnId };
    });
}

/**
 * The text one release hands the voice: every held message in the order written, less any commentary of a turn whose
 * answer is also held — progress the answer has overtaken is never said ahead of it. The answer of a turn whose
 * `offer_copy` landed ends on {@link RUNNING_LIST_LANDED_LINE}, and no message keeps that sign-off of its own: one the
 * thinking model writes is cut first, so the claim is the console's or absent, never said twice — wherever
 * it sits, since a mid-answer or quoted one is said all the same, and across the messages joined up to
 * each console line, so one split over two messages is cut too. A turn that answers in two messages says
 * the line once, after its last.
 *
 * Commentary of a turn still running, completed before the owner's newest finished utterance, is superseded too: the owner's words
 * reach that turn, which answers them, so the commentary is words the owner has already moved past. Otherwise the voice
 * re-reads a card's question after the owner has already said not to send it, 24s after the question was first read,
 * and the owner hung up 3s later.
 *
 * Any message completed before a newer turn started is superseded as well, an older turn's answer included: the newer
 * turn answers the owner's newer words with the older one's messages in its history ({@link overtakingTurnOf}). Its line, the
 * console's to say, is owed instead: said after the last answer of this release unless the release already says one.
 *
 * @param held the messages waiting, oldest first
 * @param listed the turns whose `offer_copy` the page answered unrefused and whose line is not yet said
 * @param owedLine whether a dropped answer's turn still owes its line, said on whatever answer goes next
 * @param runningTurns the Codex turns started and not completed
 * @param latestHeardDoneSeq the arrival number of the owner's newest `done` with words in it, `undefined` before any
 * @param turnStarts each turn whose start the call has seen, by the arrival number of its first start
 * @returns the text to speak, empty when nothing held says anything ({@link heldMessageKind})
 */
export function releaseTextOf({
  held,
  listed,
  owedLine,
  runningTurns,
  latestHeardDoneSeq,
  turnStarts,
}: ReleaseInput): string {
  return releaseOf({ held, latestHeardDoneSeq, listed, owedLine, runningTurns, turnStarts }).text;
}

/** What {@link releaseTextOf} reads. */
interface ReleaseInput {
  readonly held: readonly HeldAnswer[];
  readonly listed: ReadonlySet<string>;
  readonly owedLine: boolean;
  readonly runningTurns: ReadonlySet<string>;
  readonly latestHeardDoneSeq: number | undefined;
  readonly turnStarts: ReadonlyMap<string, number>;
}

/**
 * {@link releaseTextOf}'s text, and the messages whose words are in it: a turn's answers, or its commentary, count only
 * when the text would read otherwise without them, so a running-list sign-off split across two of a turn's messages and
 * cut from their join counts neither. A sign-off split across two TURNS' messages is
 * not judged: one is written within one turn's stream. `voiced` is narrower, the messages whose own words the text
 * says verbatim, named only for a run whose text no sign-off was cut from ACROSS turns: which turn's words survive such
 * a cut is not knowable from the text, so that run names none and fails open.
 *
 * @param held the messages waiting, oldest first
 * @param listed the turns whose `offer_copy` the page answered unrefused and whose line is not yet said
 * @param owedLine whether a dropped answer's turn still owes its line
 * @returns the text, the messages it carries words of, and those whose own words it says
 */
export function releaseOf({ held, listed, owedLine, runningTurns, latestHeardDoneSeq, turnStarts }: ReleaseInput): {
  text: string;
  carried: readonly HeldAnswer[];
  voiced: readonly HeldAnswer[];
} {
  const current = held.filter((h) => !supersededByOwner({ answer: h, latestHeardDoneSeq, runningTurns, turnStarts }));
  const kept = keptOf({ current });
  const lastAnswerOf = new Map<string, number>();
  let lastAnswer = -1;
  kept.forEach((h, index) => {
    if (!h.commentary) {
      lastAnswerOf.set(h.turnId, index);
      lastAnswer = index;
    }
  });
  const ownLine = kept.some((h, index) => listed.has(h.turnId) && lastAnswerOf.get(h.turnId) === index);
  const owedAt = owedLine && !ownLine ? lastAnswer : -1;
  const said: string[] = [];
  const carried: HeldAnswer[] = [];
  const voiced: HeldAnswer[] = [];
  let run: HeldAnswer[] = [];
  // Each turn's commentary, and each turn's answers, joined on their own first, in the order each first appears: a split
  // sign-off is cut even with another turn's message between its halves.
  // RESIDUE, stated: a run closes at every running-list line, so halves that straddle ANOTHER turn's line
  // are each said and that turn is named answered. It needs two concurrent turns, one splitting its sign-off around
  // the other's landed offer; grouping across lines would move the line off the answer it rides.
  // Each group's own words, sign-off cut, joined — before any cut ACROSS groups.
  const plainOf = (part: readonly HeldAnswer[]): string => {
    const groups = new Map<string, HeldAnswer[]>();
    for (const h of part) {
      const key = `${h.commentary ? "c" : "a"}:${h.turnId}`;
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [h]);
      } else {
        group.push(h);
      }
    }
    return Array.from(groups.values(), (group) => joinedOf({ part: group }))
      .filter((text) => text !== "")
      .join("\n\n");
  };
  const joined = (part: readonly HeldAnswer[]): string => withoutSignOff({ text: plainOf(part) });
  const close = ({ line }: { line: boolean }): void => {
    const text = joined(run);
    // By turn and kind, not by message: either half of a split sign-off left alone still reads as words.
    const sameGroup = (a: HeldAnswer, b: HeldAnswer): boolean => a.turnId === b.turnId && a.commentary === b.commentary;
    carried.push(...run.filter((h) => joined(run.filter((other) => !sameGroup(other, h))) !== text));
    // With no cut across groups every group's own words are in the text verbatim; with one, which turn's words
    // survived is not knowable, so none is named voiced.
    if (plainOf(run) === text) {
      voiced.push(...run.filter((h) => joinedOf({ part: run.filter((other) => sameGroup(other, h)) }) !== ""));
    }
    run = [];
    if (line) {
      said.push(text === "" ? RUNNING_LIST_LANDED_LINE : `${text} ${RUNNING_LIST_LANDED_LINE}`);
    } else if (text !== "") {
      said.push(text);
    }
  };
  kept.forEach((h, index) => {
    // A blank or a nod alone is nothing to say; the running-list line its turn owes still is.
    if (saysSomething({ answer: h })) {
      run.push(h);
    }
    if ((listed.has(h.turnId) && lastAnswerOf.get(h.turnId) === index) || index === owedAt) {
      close({ line: true });
    }
  });
  close({ line: false });
  return { carried, text: said.join("\n\n"), voiced };
}
