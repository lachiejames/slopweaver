/*
 * The asks, chair turns, relays and call words `./currency.test.ts` builds its readings from: one ask asked at a fixed
 * instant, read from a fixed floor, and a row of it read over whatever intake a case supplies.
 */
import { type CurrencyAsk, currencyRowOf, type VoiceUnread } from "../../../handover/currency.js";
import { askCurrencyCard } from "../../../handover/currencyCards.js";
import type { StandingRead } from "../../../handover/currencyStanding.js";
import type { UnreadableChair } from "../../../supervisor/chain.js";
import { EMPTY_INBOUND } from "../../../supervisor/inbound.js";
import type { IntakeReport, TurnWitness, WitnessedTurn } from "../../../supervisor/intake.js";
import type { UndeliveredRelay, VoiceRelayIntake } from "../../../talk/relayIntake.js";

export const SLACK_LINK = "https://acme.slack.com/archives/C0SYN123ABCD/p1785114398557099";
export const ASKED = "2026-10-02T10:00:00.000Z";
export const READ_FROM = "2026-10-01T12:00:00.000Z";

/**
 * The one ask every case reads, asked at {@link ASKED} with no declared check.
 *
 * @param over the fields a case changes on it
 * @returns the ask
 */
export const ask = (over: Partial<CurrencyAsk> = {}): CurrencyAsk => ({
  anchor: undefined,
  askedIso: ASKED,
  doneWhen: [],
  sameQuestionRuling: undefined,
  slug: "mirror-evidence-files",
  stillRealIso: undefined,
  ...over,
});

/**
 * One typed chair turn, as the intake walk reports it.
 *
 * @param at when it was typed
 * @param id its turn uuid, which also names its transcript pointer
 * @param witness what witnessed it, when anything did
 * @returns the witnessed turn
 */
export const turn = ({ at, id, witness }: { at: string; id: string; witness?: TurnWitness }): WitnessedTurn => ({
  inGrace: false,
  turn: {
    lineNumber: 1,
    pointer: `transcript:chair#${id}`,
    sessionId: "chair",
    source: "typed",
    text: "words",
    timestamp: at,
    turnUuid: id,
  },
  witness,
});

/**
 * A chain intake that read, from {@link READ_FROM}, over these turns.
 *
 * @param turns the chair turns it found
 * @param unreadable the chairs whose transcripts would not read
 * @param reachesSince whether the walk reached back to the floor
 * @param earliestIso the earliest instant the walk read
 * @returns the intake
 */
export const intakeOf = ({
  turns,
  unreadable = [],
  reachesSince = true,
  earliestIso = "2026-10-02T09:00:00.000Z",
}: {
  turns: readonly WitnessedTurn[];
  unreadable?: readonly UnreadableChair[];
  reachesSince?: boolean;
  earliestIso?: string;
}): IntakeReport => ({
  finding: {
    coverage: { earliestIso, linksKnown: 1, reachesSince, unreadable, walked: ["chair"] },
    inGrace: 0,
    legs: [],
    markedNoAsk: 0,
    sinceIso: READ_FROM,
    turns,
    unwitnessed: [],
    witnessed: 0,
  },
  inbound: EMPTY_INBOUND,
  kind: "read",
});

/**
 * One undelivered voice relay whose row is on the board.
 *
 * @param anchor the talk turn it names
 * @param at when it was registered
 * @param slug its board row
 * @param about what the relay said it was about
 * @param heard the words it relayed
 * @param truncated whether those words were cut
 * @returns the relay
 */
export const relay = ({
  anchor,
  at,
  slug,
  about = "",
  heard = "the words they relayed",
  truncated = false,
}: {
  anchor: string;
  at: string;
  slug: string;
  about?: string;
  heard?: string;
  truncated?: boolean;
}): UndeliveredRelay => ({
  about,
  anchor,
  delivery: null,
  heard,
  ...(truncated ? { heardTruncated: true as const } : {}),
  registeredAtIso: at,
  rowPresent: true,
  slug,
});

/**
 * A voice read that found these call words, none cut unless a case says so.
 *
 * @param words each word's instant, pointer, text and cut flag
 * @returns the voice read
 */
export const callWords = ({
  words,
}: {
  words: readonly { atIso: string; pointer: string; text: string; cut?: boolean }[];
}): VoiceUnread => ({ kind: "read", words: words.map((word) => ({ cut: false, ...word })) });

export const NO_RELAYS: VoiceRelayIntake = { kind: "read", relays: [] };
export const NO_VOICE: VoiceUnread = { kind: "read", words: [] };
export const NO_STANDING: StandingRead = {
  entries: [],
  gaps: [],
  sources: { memory: "0 memories read", profile: "no owner profile recorded", rulings: "0 rulings read" },
};
const ON_OWNER_RULING = { kind: "on-owner-ruling" } as const;

/**
 * The currency row of the one ask, read over this intake and these sources.
 *
 * @param intake the chain intake
 * @param relays the undelivered relays, none when omitted
 * @param voice the call words, none when omitted
 * @param over the fields a case changes on the ask
 * @param standing the owner's standing set, empty when omitted
 * @returns the row
 */
export const rowOf = ({
  intake,
  relays = NO_RELAYS,
  voice = NO_VOICE,
  over = {},
  standing = NO_STANDING,
}: {
  intake: IntakeReport;
  relays?: VoiceRelayIntake;
  voice?: VoiceUnread;
  over?: Partial<CurrencyAsk>;
  standing?: StandingRead;
}): ReturnType<typeof currencyRowOf> =>
  currencyRowOf({
    card: askCurrencyCard({ ask: ask(over), done: ON_OWNER_RULING }),
    done: ON_OWNER_RULING,
    intake,
    readFromIso: READ_FROM,
    relays,
    standing,
    voice,
  });
