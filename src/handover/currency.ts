/**
 * Whether a Queue card is still the owner's to act on — the pure half of `slopweaver handover currency`.
 *
 * The owner wants zero chance of opening a card already answered or implicitly steered. Currency is BATCHED, not
 * real-time — so the card says when it was last checked, against what, and whether anything from the owner since
 * could have changed it. Every Queue card kind gets a row, keyed and floored by `./currencyCards.ts` — rank every
 * card by what needs the owner most, checking both the facts and the steers. Three questions per card, answered
 * here from reads the shell made:
 *
 * - **Are its facts still true?** The candidate's {@link CurrencyFact}: re-confirmed, by what, or why not.
 * - **Is it done?** An ask's own done-check (`./askDoneCommand.ts`): a Slack-anchored ask is done when the owner has
 *   replied after its anchor, and the reply's link is the evidence. Any other declared check is named and NOT run —
 *   the tick never runs a doc's shell — and an ask with none is done when the owner rules on it or it is settled.
 * - **Has the owner said anything since?** Measured strictly after the card's floor — when it reached the owner —
 *   and read through the SAME intake witnesses `handover reconcile` uses, never the owner's globally newest turn: a
 *   word filed to a different card cannot have steered this one, so it does not count; a word filed to THIS
 *   card's exact key does; a word nothing has filed might have, so it counts too.
 * - **Has the owner's standing guidance changed since?** "Fresh"
 *   means nothing the owner has ever said bears on it, not only nothing since. The floor is when the card's
 *   producer had the then-standing guidance in hand, so only a change strictly after it can bear on the card: a
 *   memory leaf, an owner profile revision, a ruling journalled on any row (`./currencyStanding.ts`). A ruling
 *   filed to another row does not count unless it places a gate still in force. No relevance matching and no
 *   model: any such change fails the half.
 *
 * A read that could not be made is a GAP, carried beside what was read and never folded into "nothing since": a
 * check that could not run reads could-not-check, never still-a-problem.
 */
import type { OwnerReply } from "../live/slack/ownerReply.js";
import type { IntakeReport } from "../supervisor/intake.js";
import type { VoiceRelayIntake } from "../talk/relayIntake.js";
import { askDoneCommand } from "./askDoneCommand.js";
import { chairReachesFloor, unreadableAfterFloor } from "./currencyChairFloor.js";
import { instantCeilingMs, type StandingChange, type StandingRead, standingSince } from "./currencyStanding.js";
import type { HisWordsCut } from "./hisWords.js";
import type { Probe } from "./probe.js";
import type { CurrencyPullRequest } from "./prProof.js";
import type { RulingIdentity } from "./ruling.js";

/** One ask waiting on the owner, as the reading needs it. */
export interface CurrencyAsk {
  readonly slug: string;
  /** When the owner was asked; the binding a card checks so a re-ask never inherits an old reading. */
  readonly askedIso: string | undefined;
  /** When the ask was last re-confirmed as still real, if ever. */
  readonly stillRealIso: string | undefined;
  readonly anchor: string | undefined;
  readonly doneWhen: readonly Probe[];
  /**
   * The ruling the owner gave before this same question was asked again word for word, as `talk restore` re-asks a
   * landed ask (`./heldQuestion.ts`, `rulingBeforeRepeatedQuestion`). Required, so no caller can omit the decision.
   */
  readonly sameQuestionRuling: RulingIdentity | undefined;
}

/** Voice words past the chair's own unread cursor — said on a call, not yet read by the chair. */
export type VoiceUnread =
  | {
      readonly kind: "read";
      readonly words: readonly {
        readonly pointer: string;
        readonly atIso: string;
        readonly text: string;
        /** The call store's cap took the end of it. */
        readonly cut: boolean;
      }[];
    }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * The owner's words behind one pointer, shaped the way a row's own `hisWords` is (`./hisWords.ts`): one line,
 * capped, and where it is known cut. A row that shows only an instant, a source and a transcript pointer reads as
 * "nothing readable", so a card quotes the owner. One turn is named by every card it postdates, so the words ride the document once per pointer.
 */
export interface SaidText {
  readonly text: string;
  readonly cut: HisWordsCut;
}

/** One thing the owner said after a card's floor that could bear on it. */
interface SinceWord {
  readonly atIso: string;
  readonly pointer: string;
  /** Typed into the chair, said on a call, or relayed from a call without reaching the chair. */
  readonly source: "chair" | "voice" | "relay";
  /** `here` when filed to this row; `unfiled` when nothing has filed it anywhere yet. */
  readonly filed: "here" | "unfiled";
}

/**
 * The done-check of a row that declares none: it is done on the owner's ruling. A recorded `handover currency` reading
 * carries it. `site/lib/cardCurrency.ts` restates it, held equal by
 * `src/__tests__/unit/notConfirmedWhysMirror.test.ts`.
 */
export const OWNER_RULING_DONE_KIND = "on-owner-ruling" as const;

/** What the row's done-check found. */
export type CurrencyDone =
  | { readonly kind: "replied"; readonly atIso: string; readonly permalink: string }
  | { readonly kind: "not-yet"; readonly readAtIso: string }
  | { readonly kind: "could-not-check"; readonly why: string }
  | { readonly kind: "declared-not-run"; readonly checks: readonly string[] }
  | { readonly kind: typeof OWNER_RULING_DONE_KIND };

/**
 * Every reason a card's facts may be not confirmed. Closed, because the console prints it on the card's own Facts line
 * and hover, where a failed read's raw reason — an id, a path — must never reach; that reason rides `unread` instead.
 * `site/lib/cardCurrency.ts` restates it, held equal by `src/__tests__/unit/notConfirmedWhysMirror.test.ts`.
 */
export const NOT_CONFIRMED_WHYS = [
  "no pass of its monitor is recorded",
  "its monitor's last recorded pass is not a monitor check document",
  "its monitor's last recorded pass holds no reading of that monitor",
  "its monitor's last recorded pass declares a state this check does not know",
  "its monitor's last recorded pass carries a subject this check cannot read",
  "its monitor's last pass would not read",
  "its monitor's last pass found the condition clear",
  "its monitor's last pass no longer names it",
  "its monitor's last pass found a steer of yours already answers it",
  "its monitor's last pass could not measure it",
  "no monitor this build defines posts it, so no pass can re-confirm it",
  "its Slack thread could not be read",
  "nothing has re-confirmed it since it was asked",
  "two sources mint this card's key and floor and disagree on its reading, so neither is confirmed",
] as const;

/** One of {@link NOT_CONFIRMED_WHYS}. */
export type NotConfirmedWhy = (typeof NOT_CONFIRMED_WHYS)[number];

/**
 * Whether a card's facts were re-confirmed, and by what. A hand step the hands register merely still holds is NOT
 * confirmed by that: a monitor-raised one is confirmed only by that monitor's own last firing pass naming it
 * (`./currencyCards.ts`), so a card whose monitor has since gone clear never reads fresh. A not-confirmed fact's
 * `unread` is a failed read's own reason, which the console shows only in the card's staleness mark.
 */
export type CurrencyFact =
  | { readonly kind: "confirmed"; readonly atIso: string; readonly by: string }
  | { readonly kind: "not-confirmed"; readonly why: NotConfirmedWhy; readonly unread?: string };

/** One Queue card the reading covers, before the owner's words are read against it (`./currencyCards.ts`). */
export interface CurrencyCardCandidate {
  /** The card's exact Queue key — `hand:<id>`, `ask:<slug>`, `draft:<id>`, `post:<id>`, `review:<id>`, `pr:<owner>.<repo>.<n>`. */
  readonly key: string;
  /**
   * The card's version — what "since" is measured from, and what the console checks the row against, so a newer card
   * never inherits an older card's reading. Absent when nothing dates the card.
   */
  readonly floorIso: string | undefined;
  readonly fact: CurrencyFact;
  /** The ask behind an ask card — its done-check and its asking — and `undefined` on every other kind. */
  readonly ask: CurrencyAsk | undefined;
  /**
   * The board row the card stands for — an ask's slug, the row a hand step unblocks — so a ruling filed to that row
   * bears on it; `undefined` when the card names none. A hand card reading only `ask` here would drop a ruling on its
   * own row.
   */
  readonly row: string | undefined;
}

/** One card's reading. */
export interface CurrencyRow {
  readonly key: string;
  /** When an ask card was asked; absent on every other kind. */
  readonly askedIso?: string;
  /** The instant "since" is measured from, absent when nothing dates the card. */
  readonly floorIso: string | undefined;
  readonly fact: CurrencyFact;
  /** An ask card's done-check; absent on every other kind, which has none. */
  readonly done?: CurrencyDone;
  /**
   * The ruling the owner gave on this same question before it was asked again
   * ({@link CurrencyAsk.sameQuestionRuling}). It predates the floor, so it rides here rather than in `since`, whose
   * every word is after the floor; the console reads it as the owner's reaction to this card. Absent when they gave
   * none, and on every other kind.
   */
  readonly sameQuestionRuling?: { readonly atIso: string; readonly pointer: string };
  /**
   * What could bear on it since its floor: the owner's words, the changes to the owner's standing rulings, memories and owner profile
   * (`./currencyStanding.ts`), and every read of either that could not be made.
   */
  readonly since: {
    readonly words: readonly SinceWord[];
    readonly standing: readonly StandingChange[];
    readonly gaps: readonly string[];
  };
}

/**
 * The document's version: 3 reads every row's steers against the owner's standing rulings, memories and owner
 * profile as well as the owner's words (`./currencyStanding.ts`); 2 carries a row per Queue card kind, each with its
 * {@link CurrencyFact}, and reads the owner's words only; a reading with no version is the ask-only one. The console
 * reads both other shapes (`site/components/live/readCurrency.ts`) and never passes their steers half, since neither
 * reads the standing set. A build that reads none of it shows no reading rather than a falsely fresh one.
 */
export const CURRENCY_SCHEMA_VERSION = 3;

/** The whole reading `handover currency --json` emits and the tick records. */
export interface CurrencyDocument {
  readonly schemaVersion: typeof CURRENCY_SCHEMA_VERSION;
  readonly checkedIso: string;
  /** The earliest instant the owner's words were read from. */
  readonly readFromIso: string;
  readonly sources: {
    readonly chair: string;
    readonly relays: string;
    readonly voice: string;
    /** The pull-request body read behind {@link CurrencyDocument.pullRequests}. */
    readonly github: string;
    /** What the standing read found in each of its sources (`./currencyStanding.ts`). */
    readonly memory: string;
    readonly profile: string;
    readonly rulings: string;
  };
  readonly rows: readonly CurrencyRow[];
  /** The owner's words for every pointer a row names that a source carried text for — once each, however many rows name it. */
  readonly said: Readonly<Record<string, SaidText>>;
  /** Every pull request the owner asked proof on, and whether its live body carries it (`./prProof.ts`). */
  readonly pullRequests: readonly CurrencyPullRequest[];
}

/**
 * The Slack link an ask's done-check reads, when its `doneWhen` carries exactly the check the register wrote.
 *
 * @param ask the row
 * @returns the anchor to check live, or `undefined` when the row declares no such check
 */
export function derivedReplyCheck({ ask }: { ask: CurrencyAsk }): string | undefined {
  const derived = askDoneCommand({ anchor: ask.anchor });
  if (derived === undefined || ask.anchor === undefined) {
    return undefined;
  }
  const declared = ask.doneWhen.some((probe) => probe.kind === "command" && probe.command === derived);
  if (!declared) {
    return undefined;
  }
  return ask.anchor;
}

/**
 * A probe as one line a card can print.
 *
 * @param probe the declared check
 * @returns its kind and target
 */
function probeText({ probe }: { probe: Probe }): string {
  if (probe.kind === "command") {
    return `command: ${probe.command}`;
  }
  if (probe.kind === "path") {
    return `path: ${probe.path}`;
  }
  return `${probe.kind}: ${probe.file}#${probe.symbol}`;
}

/**
 * The row's done-check, from the live reply read when it has one.
 *
 * @param reply the live read of the derived check, absent when the row declares none
 * @returns what the check found
 */
export function doneOf({ ask, reply }: { ask: CurrencyAsk; reply: OwnerReply | undefined }): CurrencyDone {
  if (reply !== undefined) {
    if (reply.kind === "replied") {
      return { atIso: reply.atIso, kind: "replied", permalink: reply.permalink };
    }
    return reply;
  }
  if (ask.doneWhen.length > 0) {
    return { checks: ask.doneWhen.map((probe) => probeText({ probe })), kind: "declared-not-run" };
  }
  return { kind: OWNER_RULING_DONE_KIND };
}

/**
 * Whether a witness or a relay's card files a word to THIS card: its exact key, byte for byte, and the bare slug of the
 * board row it stands for (`row` — an ask's own, a hand step's or a parked post's), the grammar an intake witness names a
 * row in. Never a prefix, a text match or another card's key. Read off `ask` alone, a word filed to a hand card's row
 * is dropped.
 *
 * @param target the witness text, or the relay's card key
 * @param card the card
 * @returns true when it names this card
 */
function filesTo({ target, card }: { target: string; card: CurrencyCardCandidate }): boolean {
  return target === card.key || (card.row !== undefined && target === card.row);
}

/**
 * The chair's turns after the floor that could bear on this card, and why the read may be short of it.
 *
 * @param intake the chain read
 * @param card the card whose words are read
 * @param floorMs the floor, epoch milliseconds
 * @returns the words and the gaps
 */
function chairSince({
  intake,
  card,
  floorMs,
}: {
  intake: IntakeReport;
  card: CurrencyCardCandidate;
  floorMs: number;
}): {
  words: SinceWord[];
  gaps: string[];
} {
  // Each gap is a line on the owner's card, so it reads as a sentence to the owner: no session id, pointer, instant or "chair".
  // Which session or turn it was is `supervisor intake`'s to name.
  if (intake.kind === "unavailable") {
    return { gaps: [`your supervisor-chat turns could not be read: ${intake.why}`], words: [] };
  }
  const { coverage, turns } = intake.finding;
  const gaps = coverage.unreadable
    .filter((unreadable) => unreadableAfterFloor({ floorMs, unreadable }))
    .map(({ why }) => `one supervisor-chat session would not read: ${why}`);
  if (!chairReachesFloor({ coverage, floorMs })) {
    gaps.push("the supervisor chat's record does not reach back to when this reached you");
  }
  const words: SinceWord[] = [];
  for (const { turn, witness } of turns) {
    const atMs = instantCeilingMs({ iso: turn.timestamp });
    if (Number.isNaN(atMs)) {
      gaps.push("one supervisor-chat turn carries no time, so whether it came after this reached you cannot be told");
      continue;
    }
    if (atMs <= floorMs) {
      continue;
    }
    if (witness === undefined) {
      words.push({ atIso: turn.timestamp, filed: "unfiled", pointer: turn.pointer, source: "chair" });
    } else if (witness.kind !== "no-ask" && filesTo({ card, target: witness.witness })) {
      words.push({ atIso: turn.timestamp, filed: "here", pointer: turn.pointer, source: "chair" });
    }
  }
  return { gaps, words };
}

/**
 * One card's reading: everything the owner said after its floor that could bear on it, read through the same intake
 * witnesses `handover reconcile` uses, and its facts and done-check as the candidate and the shell carry them.
 *
 * @param card the card, with its floor and fact (`./currencyCards.ts`)
 * @param done an ask card's done-check; `undefined` on every other kind
 * @param intake the chair's turns
 * @param relays the voice relays that never reached the chair
 * @param voice the call words the chair has not read
 * @param standing the owner's standing rulings, memories and owner profile, read once for every row
 * @param readFromIso the earliest instant every source of the owner's words was read from
 * @returns the row
 */
export function currencyRowOf({
  card,
  done,
  intake,
  relays,
  voice,
  standing,
  readFromIso,
}: {
  card: CurrencyCardCandidate;
  done: CurrencyDone | undefined;
  intake: IntakeReport;
  relays: VoiceRelayIntake;
  voice: VoiceUnread;
  standing: StandingRead;
  readFromIso: string;
}): CurrencyRow {
  const askedIso = card.ask?.askedIso;
  const ruled = card.ask?.sameQuestionRuling;
  const base = {
    ...(askedIso === undefined ? {} : { askedIso }),
    ...(done === undefined ? {} : { done }),
    ...(ruled === undefined ? {} : { sameQuestionRuling: { atIso: ruled.decidedIso, pointer: ruled.anchor } }),
    fact: card.fact,
    floorIso: card.floorIso,
    key: card.key,
  };
  const floorMs = card.floorIso === undefined ? Number.NaN : Date.parse(card.floorIso);
  if (Number.isNaN(floorMs)) {
    const gaps = ["nothing records when this card reached you", ...standing.gaps.map((gap) => gap.why)];
    return { ...base, since: { gaps, standing: [], words: [] } };
  }
  const chair = chairSince({ card, floorMs, intake });
  const relayed = relaysSince({ card, floorMs, relays });
  const spoken = voiceSince({ floorMs, voice });
  const steady = standingSince({ floorMs, row: card.row, standing });
  const unread =
    floorMs < instantCeilingMs({ iso: readFromIso })
      ? ["what you said before this check's window opened was not read"]
      : [];
  const gaps = [...chair.gaps, ...unread, ...relayed.gaps, ...spoken.gaps, ...steady.gaps];
  const words = [...chair.words, ...relayed.words, ...spoken.words].toSorted(
    (a, b) => Date.parse(a.atIso) - Date.parse(b.atIso),
  );
  return { ...base, since: { gaps, standing: steady.changes, words } };
}

/**
 * Relays filed to this card that never reached the chair, after the floor: the card the owner was looking at when saying it,
 * or, on a relay naming no card, the card standing for the row the relay registered into.
 *
 * @param relays the relay read
 * @param card the card whose words are read
 * @param floorMs the floor, epoch milliseconds
 * @returns the words and the gaps
 */
function relaysSince({
  relays,
  card,
  floorMs,
}: {
  relays: VoiceRelayIntake;
  card: CurrencyCardCandidate;
  floorMs: number;
}): {
  words: SinceWord[];
  gaps: string[];
} {
  if (relays.kind === "unavailable") {
    return { gaps: [`the voice relays could not be read: ${relays.why}`], words: [] };
  }
  const gaps: string[] = [];
  const words: SinceWord[] = [];
  for (const relay of relays.relays) {
    const filed = relay.about === "" ? card.row !== undefined && relay.slug === card.row : relay.about === card.key;
    if (!filed) {
      continue;
    }
    const atMs = instantCeilingMs({ iso: relay.registeredAtIso });
    if (Number.isNaN(atMs)) {
      gaps.push("one voice relay carries no time, so whether it came after this reached you cannot be told");
    } else if (atMs > floorMs) {
      words.push({ atIso: relay.registeredAtIso, filed: "here", pointer: relay.anchor, source: "relay" });
    }
  }
  return { gaps, words };
}

/**
 * Call words the chair has not read, after the floor — filed nowhere yet, so they count.
 *
 * @param voice the unread call words
 * @param floorMs the floor, epoch milliseconds
 * @returns the words and the gaps
 */
function voiceSince({ voice, floorMs }: { voice: VoiceUnread; floorMs: number }): {
  words: SinceWord[];
  gaps: string[];
} {
  if (voice.kind === "unavailable") {
    return { gaps: [`the call words could not be read: ${voice.why}`], words: [] };
  }
  const gaps: string[] = [];
  const words: SinceWord[] = [];
  for (const word of voice.words) {
    const atMs = instantCeilingMs({ iso: word.atIso });
    if (Number.isNaN(atMs)) {
      gaps.push("one call word carries no time, so whether it came after this reached you cannot be told");
    } else if (atMs > floorMs) {
      words.push({ atIso: word.atIso, filed: "unfiled", pointer: word.pointer, source: "voice" });
    }
  }
  return { gaps, words };
}

/**
 * One source's state, as the card's hover names it.
 *
 * @param why the reason it could not be read, absent when it was
 * @param read the line for a read source
 * @returns the line
 */
export function sourceLine({ why, read }: { why: string | undefined; read: string }): string {
  if (why === undefined) {
    return read;
  }
  return `could not read: ${why}`;
}
