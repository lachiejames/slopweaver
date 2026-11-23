/**
 * What the owner said while a console card was open, cut out of one call's lines — pure: lines in, utterances out.
 *
 * The rule: every word the owner says while a card is open lands on that card, relayed or not. Without it, the owner
 * opens a card, remembers steering it the day before, and finds it unchanged — because a spoken steer became a NEW
 * row and never touched the card they were looking at. The page stamps every stretch of speech with the card open
 * when it began (`site/lib/transcriptSink.ts`); this module groups those stretches into utterances, and
 * `../cli/commands/talk/cardLandApply.ts` lands each one on its card. A card the voice's `open_card` put in front of
 * the owner is not one they opened, and `talk transcript` lands nothing said over it
 * ({@link transcriptCardUtterances}). An utterance lands only when a relay of it recorded the voice judging it an
 * answer to that card, never because the owner said it with the card open — "Uh, good morning" would otherwise take
 * a hand step off the owner's Queue ({@link transcriptCardUtterances}). A card a relay of the same words named in its
 * `alsoAnswers` was landed by `talk relay` under the relay's anchor, so it lands nothing here a second way (Queue
 * cards must refresh).
 *
 * ## One utterance, and when it is finished
 *
 * The speech recogniser splits one sentence across several segment ids, so a card would otherwise receive a
 * sentence in pieces. Consecutive final stretches of the OWNER's speech carrying one card are one utterance, joined
 * with a space. It is landable only once something after it proves it finished: the voice spoke, a relay began, the
 * owner spoke with a different card open (or none), or the call closed. A stretch still going on — a snapshot the
 * grouper has not closed — ends the scan, because anything after it cannot yet be ordered against it.
 *
 * ## A call that dropped is finished by the next one
 *
 * A page that crashed or reloaded writes no close line, and the steers the owner gave on that call would be lost.
 * So a call is also over once ANOTHER call opened after its last line — the page runs one call at a time — and
 * {@link unfinishedBefore} is that test. `talk transcript` applies it when a call's open line arrives, landing the
 * dropped call's tail as it stood, an unfinished last stretch included. The residue, stated: two tabs in two calls
 * at once would read the quieter one as dropped, and a call that dropped lands only when the owner next opens a
 * call.
 *
 * ## Order is by instant, not by file position
 *
 * `./callRecord.ts` says why: a `keepalive` post as the page goes can land before a batch still in flight. So a
 * stretch is placed at the instant of its FIRST line, file position breaking ties.
 *
 * ## The anchor is the utterance, and the relay beside it is found, not threaded
 *
 * `call:<callId>#<first segment id>` names the utterance; a re-posted batch re-derives the same one, which is
 * what makes landing idempotent. Its later segments' anchors ride beside it: a `keepalive` post can land a later
 * segment before an earlier one arrives, and the regrouped utterance must then read as the one already landed. A
 * relay the voice made of the same words records its own line in the call,
 * carrying the card and its turn; every such line between this utterance's start and the owner's next utterance is
 * returned beside it, so the landing reuses the relay's board row instead of registering a second one. A relay of
 * words begun over more than one card names no card, or only the open one the owner's latest words began over when the voice
 * judged them its answer (`site/lib/heardOver.ts` `relayJudgeable`), and any relay can carry several
 * utterances, so a relay is also matched by the words it heard: every utterance before it whose words it carries
 * reuses its row.
 *
 * The page writes a relay's line as `sending` BEFORE it posts, and its outcome once the post answers — so a batch
 * can prove an utterance finished while the relay's row does not exist yet. Landed then, the utterance would get a
 * dispatch row and the relay a second one. So an utterance whose relay is still `sending` is not returned until the
 * relay's line settles; the next batch lands it on the relay's row. A close line does not release it — the relay can
 * still be registering its row, and would then add a second — so a closed call a relay still holds is
 * finished by the owner's next call's open line, exactly as a dropped one is, by which time the relay has landed its
 * own card and the utterance reuses its row. The residue, stated: a relay whose `sending` line reaches the call file
 * only AFTER a batch landed the utterance — made after that landing, or begun while that batch was in flight, its
 * line still queued in the page behind it — adds its own row beside the dispatch row, and both landings name
 * the card. The page's queue is invisible here, and the words are on both rows.
 */
import { createHash } from "node:crypto";

import { callTouchedByTestInstance } from "./callOrigin.js";
import { type CallEntry, callActivity } from "./callRecord.js";
import { lineBeganIso } from "./callSegmentFold.js";
import { cardAnswerVerdict } from "./cardAnswer.js";
import { normaliseSay } from "./relayAskText.js";
import { stretchLineLost } from "./stretchLineLost.js";

/** One utterance the owner made with a card open, finished and ready to land. */
export interface CardUtterance {
  /** `call:<callId>#<first segment id>` — the owner utterance, and half of every landing's identity. */
  readonly anchor: string;
  /** The `<kind>:<id>` key of the card open when the owner began. */
  readonly cardKey: string;
  /** The owner's words, whitespace-normalised, the stretches joined with one space. */
  readonly words: string;
  /**
   * Whether these words may be fewer than were said: a stretch of them the call never finished (landed because the call
   * closed or dropped), one the call file capped at `CALL_TEXT_CHARS` — `segmentWords`' own test of one stretch — or
   * one where another line of the stretch carried text the line that won does not print (`printsSnapshot`), which may
   * have dropped a take-back or a tail.
   */
  readonly wordsCut: boolean;
  /** When the owner began:the first line of its first stretch. */
  readonly decidedIso: string;
  /** Turn ids of relays the voice made of these words onto this card, oldest first: each names its row and its anchor. */
  readonly relayTurns: readonly string[];
  /** The anchor each later segment of it would carry alone — what it was landed as if those arrived first. */
  readonly laterAnchors: readonly string[];
  /** `voice` when the voice's `open_card` put the card in front of the owner; absent when they opened it. */
  readonly openBy?: "voice";
  /** `true` when a relay of these words recorded the voice's judgement that they answer this card; absent otherwise. */
  readonly answered?: true;
  /**
   * `true` when a relay of these words named this card in its `alsoAnswers`, so `talk relay` landed it under the
   * relay's own anchor and `talk transcript` lands nothing on it a second way; absent otherwise.
   */
  readonly relayLanded?: true;
}

/**
 * A segment id the anchor may carry literally. Anything else is carried as a hash of its UTF-16 code units behind a `~`,
 * which no literal id holds: a percent-encoded id could run to nine times its length, past the ledger's anchor bound,
 * and throws on a lone surrogate. A literal anchor is at most 242 characters, a hashed one 67.
 */
const LITERAL_SEGMENT_ID = /^[A-Za-z0-9._-]{1,200}$/u;

/** One stretch of speech, folded from every line that carried its id. */
interface Stretch {
  readonly id: string;
  readonly who: "owner" | "voice";
  readonly text: string;
  readonly final: boolean;
  readonly open: string | undefined;
  /** `voice` when the voice opened that card, taken from the same first line as `open`. */
  readonly openBy: "voice" | undefined;
  /** The instant of its first line, which places it. */
  readonly firstIso: string;
  /** The file position of its first line, which breaks a tie. */
  readonly firstIndex: number;
  /** The instant of the line whose text it carries. */
  readonly textIso: string;
  /**
   * Every text a line of this id carried, the winner's included. One the winner does not print (`printsSnapshot`) may
   * hold words of the owner's the winner dropped — a take-back, a lost tail — and the record cannot tell a correction
   * from a loss. A second final saying other words is a revision the first-final-wins fold
   * drops whatever its length, so its finality is kept too; and a line under another speaker may be the
   * one that finished it, so its speaker is kept as well.
   */
  readonly snapshots: readonly { readonly final: boolean; readonly text: string; readonly who: Stretch["who"] }[];
}

/**
 * The anchor that names one utterance of one call.
 *
 * @param callId the call, a v4 UUID
 * @param segmentId the utterance's first segment id
 * @returns `call:<callId>#<segment id>`, or `call:<callId>#~<hash>` when the id is not a plain token
 */
export function callSegmentAnchor({ callId, segmentId }: { callId: string; segmentId: string }): string {
  if (LITERAL_SEGMENT_ID.test(segmentId)) {
    return `call:${callId}#${segmentId}`;
  }
  const hashed = createHash("sha256").update(Buffer.from(segmentId, "utf16le")).digest("hex").slice(0, 24);
  return `call:${callId}#~${hashed}`;
}

/**
 * Every finished utterance the owner made with a card open, in the order they said them.
 *
 * @param callId the call the lines belong to
 * @param entries the call's lines that parsed, in file order
 * @param ended a later call opened after this one's last line ({@link unfinishedBefore}): its last stretch is finished
 *   without a close line, and no relay of it is still in flight, so none holds an utterance back
 * @returns the utterances, each ready to land; none for a call where no card was open while the owner spoke
 */
export function closedCardUtterances({
  callId,
  entries,
  ended = false,
}: {
  callId: string;
  entries: readonly CallEntry[];
  ended?: boolean;
}): readonly CardUtterance[] {
  const stretches = stretchesOf({ entries });
  const closed = ended || entries.some((entry) => entry.kind === "closed");
  const relays = relayMarks({ entries });
  const sending = sendingTurns({ entries });
  const groups = ownerGroups({ closed, relayStarts: relays.map((relay) => relay.atMs), stretches });
  const utterances = groups.map((group) => {
    const first = group.members[0]!;
    const startMs = Date.parse(first.firstIso);
    const words = normaliseSay({ say: group.members.map((member) => member.text).join(" ") });
    const covering = coveringRelays({ cardKey: group.cardKey, relays, startMs, words });
    const utterance: CardUtterance = {
      anchor: callSegmentAnchor({ callId, segmentId: first.id }),
      cardKey: group.cardKey,
      decidedIso: first.firstIso,
      laterAnchors: group.members.slice(1).map((member) => callSegmentAnchor({ callId, segmentId: member.id })),
      relayTurns: [...new Set(covering.map((relay) => relay.turnId))],
      words,
      wordsCut: group.members.some((member) => !member.final || snapshotLost({ member })),
    };
    const answered = covering.some((relay) => relay.answersCard && relay.about === group.cardKey);
    let shaped: CardUtterance = group.openBy === undefined ? utterance : { ...utterance, openBy: group.openBy };
    shaped = answered ? { ...shaped, answered: true } : shaped;
    const landedByRelay = covering.some((relay) => relay.alsoAnswers.includes(group.cardKey));
    shaped = landedByRelay ? { ...shaped, relayLanded: true } : shaped;
    return {
      relayInFlight: !ended && covering.some((relay) => sending.has(relay.turnId)),
      utterance: shaped,
    };
  });
  return utterances.filter(({ relayInFlight }) => !relayInFlight).map(({ utterance }) => utterance);
}

/**
 * The utterances `talk transcript` lands: those {@link closedCardUtterances} finds that a relay of the same words
 * recorded the voice judging an ANSWER to the card the owner opened, less a hand step and words that are only greeting
 * or filler (`./cardAnswer.ts`).
 *
 * Things that are obviously not answers to a card must not be treated as answers: "Uh, good morning" would land on an
 * open hand step and take it off the owner's Queue. Being said with a card open is where the words were said, never
 * what they were about, and only the voice, which heard the question the owner was answering, can tell "send it"
 * from a stretch about other work. So this narrows the "relayed or not" rule: words the voice never relayed as an
 * answer to the card stay in the call file, which `talk unread` still reads whole, and leave the card where it is.
 * An older relay line carries no judgement and is never read as one.
 *
 * Reading an item in the queue must not cause it to be removed from the queue. A card the voice's `open_card` put in
 * front of the owner is not one they chose, so nothing said over it lands here; the voice's relay lands on its own
 * (`../cli/commands/talk/relayCardLand.ts` `landRelayCard`). The full list stays {@link closedCardUtterances}, which
 * `talk land` resolves a call anchor against.
 *
 * A call any of whose opens carries the desktop test instance's mark (`./callOrigin.ts`) lands nothing: its words are
 * not the owner's, and the owner's next call's open would otherwise sweep it up as a dropped call. A call with no mark
 * lands as before.
 *
 * @param callId the call the lines belong to
 * @param entries the call's lines that parsed, in file order
 * @param ended as for {@link closedCardUtterances}
 * @returns the utterances to land, each an answer to a card the owner opened
 */
export function transcriptCardUtterances({
  callId,
  entries,
  ended = false,
}: {
  callId: string;
  entries: readonly CallEntry[];
  ended?: boolean;
}): readonly CardUtterance[] {
  if (callTouchedByTestInstance({ entries })) {
    return [];
  }
  return closedCardUtterances({ callId, ended, entries }).filter(
    (utterance) =>
      utterance.openBy !== "voice" &&
      utterance.answered === true &&
      utterance.relayLanded !== true &&
      cardAnswerVerdict({ cardKey: utterance.cardKey, words: utterance.words }).kind === "land",
  );
}

/** One relay line of a call, as coverage reads it. */
interface RelayMark {
  readonly about: string;
  /** Whether the voice judged the words it heard an answer to `about`, read off its first line. */
  readonly answersCard: boolean;
  /** The other cards the voice judged the words it heard answer, which `talk relay` landed itself. */
  readonly alsoAnswers: readonly string[];
  readonly atMs: number;
  /** What it heard, in {@link spokenForm}. */
  readonly heard: string;
  readonly turnId: string;
}

/**
 * Words as the relay's gate log and the transcript can both spell them: case folded — compatibility forms joined,
 * upper-cased then lower-cased so a letter with two lower forms (ß, a final sigma) reads one way — no
 * apostrophe or other punctuation, single spaces, padded with one space each side so a containment test matches whole words only.
 *
 * @param text the words as one of the two wrote them
 * @returns the comparable form
 */
function spokenForm({ text }: { text: string }): string {
  return ` ${text
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .replace(/\u03c2/gu, "\u03c3")
    .replace(/['\u2019]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/**
 * Each relay turn of a call, placed once at its FIRST line: every later state of a turn repeats what it heard when it
 * began, so placing it at a later one would let it cover speech it never heard.
 *
 * @param entries the call's lines that parsed, in file order
 * @returns one mark per relay turn, in the order the turns began
 */
function relayMarks({ entries }: { entries: readonly CallEntry[] }): readonly RelayMark[] {
  const first = new Map<string, RelayMark>();
  for (const entry of entries) {
    if (entry.kind !== "relay" || entry.turnId === null) {
      continue;
    }
    const atMs = Date.parse(entry.atIso);
    // A line written before a relay named other cards names none.
    const { alsoAnswers = [] } = entry;
    const held = first.get(entry.turnId);
    if (held === undefined || atMs < held.atMs) {
      first.set(entry.turnId, {
        about: entry.about,
        alsoAnswers,
        answersCard: entry.answersCard === true,
        atMs,
        heard: spokenForm({ text: entry.heard }),
        turnId: entry.turnId,
      });
    }
  }
  return [...first.values()].toSorted((a, b) => a.atMs - b.atMs);
}

/**
 * The relays that carried one utterance. A relay covers an utterance begun before it whose words it heard: a relay
 * can carry several utterances, and one about no card carried words begun over more than one.
 * Whatever card a relay is about, it covers only words it heard: one that heard other words
 * carried none of these, and pointing them at its row would leave them on no work row at all.
 *
 * @param relays the call's relay lines
 * @param cardKey the card open when the utterance began
 * @param startMs when the utterance began
 * @param words the utterance's normalised words
 * @returns the covering relays, in file order
 */
function coveringRelays({
  relays,
  cardKey,
  startMs,
  words,
}: {
  relays: readonly RelayMark[];
  cardKey: string;
  startMs: number;
  words: string;
}): readonly RelayMark[] {
  const said = spokenForm({ text: words });
  if (said.trim() === "") {
    return [];
  }
  return relays.filter(
    (relay) =>
      relay.atMs >= startMs &&
      (relay.about === "" || relay.about === cardKey || relay.alsoAnswers.includes(cardKey)) &&
      relay.heard.includes(said),
  );
}

/**
 * The relay turns whose latest line is still `sending` — posted, with no answer written yet.
 *
 * @param entries the call's lines that parsed, in file order
 * @returns the turn ids
 */
function sendingTurns({ entries }: { entries: readonly CallEntry[] }): ReadonlySet<string> {
  const latest = new Map<string, { atMs: number; outcome: string }>();
  for (const entry of entries) {
    if (entry.kind !== "relay" || entry.turnId === null) {
      continue;
    }
    const atMs = Date.parse(entry.atIso);
    const held = latest.get(entry.turnId);
    if (held === undefined || atMs >= held.atMs) {
      latest.set(entry.turnId, { atMs, outcome: entry.outcome });
    }
  }
  return new Set([...latest].filter(([, line]) => line.outcome === "sending").map(([turnId]) => turnId));
}

/**
 * Whether a call still has words only a later call can finish, now that one opened after its last line: it dropped,
 * writing no close line, or it closed while a relay of it was still `sending`.
 *
 * @param entries the earlier call's lines that parsed
 * @param openedIso when the later call's open line was stamped
 * @returns `true` only for a call with at least one line, none after `openedIso` (the sink writes no line of a call
 *   once the next began, so one stamped in the same millisecond is before it), and no close line or a
 *   relay still sending
 */
export function unfinishedBefore({
  entries,
  openedIso,
}: {
  entries: readonly CallEntry[];
  openedIso: string;
}): boolean {
  const opened = Date.parse(openedIso);
  // A reconnect step is written after the call ended, often after the next one opened: it is not the call running.
  const running = callActivity({ entries });
  if (running.length === 0 || !running.every((entry) => Date.parse(entry.atIso) <= opened)) {
    return false;
  }
  return !running.some((entry) => entry.kind === "closed") || sendingTurns({ entries: running }).size > 0;
}

/**
 * Whether a stretch may have lost words: a line of it the call file capped at `CALL_TEXT_CHARS`, one its winning
 * text does not print, a final saying other words than the winner, or a line under another speaker, which may be the
 * one that finished it — so words that line held are not in the words landed.
 *
 * @returns true when any line of the stretch is capped, not printed by the winner, a final the winner is not, or another
 *   speaker's
 */
function snapshotLost({ member }: { member: Stretch }): boolean {
  return member.snapshots.some((line) => stretchLineLost({ line, winner: member }));
}

/**
 * Fold the lines into one stretch per segment id, placed by its first line: a final line wins over a snapshot,
 * and a later snapshot over an earlier one — `./callRecord.ts`'s own rule — while the card is the first line's.
 *
 * @returns the stretches, in the order the owner and the voice began them
 */
function stretchesOf({ entries }: { entries: readonly CallEntry[] }): readonly Stretch[] {
  const byId = new Map<string, Stretch>();
  entries.forEach((entry, index) => {
    if (entry.kind !== "segment") {
      return;
    }
    const held = byId.get(entry.id);
    // When the stretch began, as `./callSegmentFold.ts` reads it: a snapshot written late still names its start, so
    // an overtaken unfinished stretch stands ahead of the voice that spoke after it.
    const began = lineBeganIso({ entry });
    if (held === undefined) {
      byId.set(entry.id, {
        final: entry.final,
        firstIndex: index,
        firstIso: began,
        id: entry.id,
        open: entry.open,
        openBy: entry.openBy,
        snapshots: [{ final: entry.final, text: entry.text, who: entry.who }],
        text: entry.text,
        textIso: entry.atIso,
        who: entry.who,
      });
      return;
    }
    // The card and hand are the earliest line's, beside when it began.
    const earlier = Date.parse(began) < Date.parse(held.firstIso);
    const seen = { ...held, snapshots: [...held.snapshots, { final: entry.final, text: entry.text, who: entry.who }] };
    const placed = earlier ? { ...seen, firstIso: began, open: entry.open, openBy: entry.openBy } : seen;
    const replaces = !held.final && (entry.final || Date.parse(entry.atIso) >= Date.parse(held.textIso));
    if (replaces) {
      byId.set(entry.id, { ...placed, final: entry.final, text: entry.text, textIso: entry.atIso });
      return;
    }
    byId.set(entry.id, placed);
  });
  return [...byId.values()].toSorted((left, right) => {
    const byInstant = Date.parse(left.firstIso) - Date.parse(right.firstIso);
    if (byInstant !== 0) {
      return byInstant;
    }
    return left.firstIndex - right.firstIndex;
  });
}

/** A run of the owner's stretches said over one open card, opened by one hand. */
interface CardRun {
  readonly cardKey: string;
  readonly openBy: "voice" | undefined;
  readonly members: Stretch[];
}

/**
 * The run with one more stretch of the owner's added.
 *
 * @param run the run going on, if one is
 * @param stretch a stretch of the owner's that did not end `run`, so it shares its card and its opener when both exist
 * @returns the run grown by `stretch`, a new run when none was going, or none when no card was open
 */
function joined({ run, stretch }: { run: CardRun | undefined; stretch: Stretch }): CardRun | undefined {
  if (stretch.open === undefined) {
    return run;
  }
  if (run === undefined) {
    return { cardKey: stretch.open, members: [stretch], openBy: stretch.openBy };
  }
  run.members.push(stretch);
  return run;
}

/**
 * Whether a relay began after one stretch began and no later than the next: the sink stamps every line of a page
 * strictly after the one before it, so a relay line is never stamped at a stretch's own instant by the same page.
 *
 * @param after the stretch before
 * @param before the stretch after
 * @param relayStarts when each relay of the call began
 * @returns `true` when one did
 */
function relayBetween({
  after,
  before,
  relayStarts,
}: {
  after: Stretch;
  before: Stretch;
  relayStarts: readonly number[];
}): boolean {
  const fromMs = Date.parse(after.firstIso);
  const toMs = Date.parse(before.firstIso);
  return relayStarts.some((atMs) => atMs > fromMs && atMs <= toMs);
}

/**
 * The finished runs of the owner's speech that share one open card.
 *
 * @param stretches every stretch, in order
 * @param closed whether the call wrote its close line — the boundary that finishes the last utterance
 * @param relayStarts when each relay of the call began
 * @returns each finished run with its card
 */
function ownerGroups({
  stretches,
  closed,
  relayStarts,
}: {
  stretches: readonly Stretch[];
  closed: boolean;
  relayStarts: readonly number[];
}): readonly CardRun[] {
  const finished: CardRun[] = [];
  let run: CardRun | undefined;
  for (const stretch of stretches) {
    // The voice speaking at all — even a stretch it has not finished — means the owner had stopped. So does a relay begun
    // between the owner's last stretch and this one: it carried what came before it, and joining the two would leave the
    // joined words heard by no relay, landing the relayed half a second time on a dispatch row. The owner
    // opening the card the voice had opened ends a run too, so words said over each are judged apart.
    const ends =
      stretch.who === "voice" ||
      stretch.open !== run?.cardKey ||
      stretch.openBy !== run?.openBy ||
      (run !== undefined && relayBetween({ after: run.members.at(-1)!, before: stretch, relayStarts }));
    if (run !== undefined && ends) {
      finished.push(run);
      run = undefined;
    }
    if (stretch.who === "voice") {
      continue;
    }
    // The owner's stretch still going on may yet run on, and nothing after it can be ordered against it.
    if (!stretch.final && !closed) {
      return finished;
    }
    run = joined({ run, stretch });
  }
  if (closed && run !== undefined) {
    finished.push(run);
  }
  return finished;
}
