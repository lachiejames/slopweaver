/**
 * The refusals `formRelayDraft` (`./relayDraft.ts`) returns — every way a relay's INPUT cannot become a draft,
 * judged before the turn is claimed, which is why `talk relay` exits 2 on each and the page's words-alone retry
 * can follow one.
 *
 * Still the `talk` domain's own union, not a second domain: `./errors.ts` folds {@link RelayDraftError} into
 * `TalkError` and spreads {@link RelayDraftErrors} into `TalkErrors`. They live apart because they are the one
 * family a single pure function owns, and the domain's file had grown past what a reader holds at once.
 */

/** A turn id that this process did not mint — the shape check that keeps id minting off the model. */
export interface TurnInvalidError {
  readonly code: "TURN_INVALID";
  readonly message: string;
  readonly turnId: string;
}

/** Empty or over-long relay words. */
export interface SayInvalidError {
  readonly code: "SAY_INVALID";
  readonly message: string;
  readonly length: number;
}

/**
 * A spoken relay whose board row would carry a `summary:` over the byte cap `handover start` holds it to, even
 * quoting only the last character of the owner's words (or, with none attached, the voice's reading alone) — so a row no
 * seat could start is refused before it is written.
 */
export interface AskOverCapError {
  readonly code: "ASK_OVER_CAP";
  readonly message: string;
  /** The written summary's UTF-8 size at the shortest quote. */
  readonly bytes: number;
}

/** A relay's `about` that is not a console record key. */
export interface AboutInvalidError {
  readonly code: "ABOUT_INVALID";
  readonly message: string;
  readonly about: string;
}

/** A relay's `--read-after` naming a source that is not one of the voice's reads, or a `--say` beside it. */
export interface ReadsInvalidError {
  readonly code: "READS_INVALID";
  readonly message: string;
}

/** A `--words-alone` relay carrying a reading or reads beside it, or none of the owner's words to carry. */
export interface WordsAloneInvalidError {
  readonly code: "WORDS_ALONE_INVALID";
  readonly message: string;
}

/** A typed console steer whose words are missing, too long, or travel beside a voice reading or its reads. */
export interface TypedInvalidError {
  readonly code: "TYPED_INVALID";
  readonly message: string;
}

/**
 * A relay's `--offered-file` that is not one copy-tray offer this verb can carry exactly — unreadable, not UTF-8,
 * not the offer's shape, or beside a relay that carries the owner's words alone.
 */
export interface OfferedInvalidError {
  readonly code: "OFFERED_INVALID";
  readonly message: string;
}

/** Every way a relay's input cannot become a draft. */
export type RelayDraftError =
  | TurnInvalidError
  | SayInvalidError
  | AskOverCapError
  | AboutInvalidError
  | ReadsInvalidError
  | WordsAloneInvalidError
  | TypedInvalidError
  | OfferedInvalidError;

/** The factories every draft refusal is constructed through — reached as `TalkErrors.<name>`. */
export const RelayDraftErrors = {
  aboutInvalid: ({ about }: { about: string }): AboutInvalidError => ({
    about,
    code: "ABOUT_INVALID",
    message: `${about} is not a console record key — a relay's --about is <kind>:<id>, e.g. ask:<board-slug>, and a pull request's is pr:<owner>.<repo>.<n>`,
  }),
  askOverCap: ({ bytes, cap }: { bytes: number; cap: number }): AskOverCapError => ({
    bytes,
    code: "ASK_OVER_CAP",
    message:
      `the relay's board row would carry a ${String(bytes)}-byte summary, over the ${String(cap)}-byte cap handover ` +
      "start holds a row to, with as little of the owner's words quoted as a row can carry — the voice's reading is what " +
      "does not fit; the owner's words alone (--words-alone) always do, the row quoting as many of them as fit",
  }),
  offeredInvalid: ({ why }: { why: string }): OfferedInvalidError => ({
    code: "OFFERED_INVALID",
    message: `the copy-tray offer this relay carries ${why}`,
  }),
  readsInvalid: ({ why }: { why: string }): ReadsInvalidError => ({
    code: "READS_INVALID",
    message: why,
  }),
  sayInvalid: ({ length, limit }: { length: number; limit: number }): SayInvalidError => ({
    code: "SAY_INVALID",
    length,
    message: `relay words must be 1..${String(limit)} characters, got ${String(length)}`,
  }),
  turnInvalid: ({ turnId }: { turnId: string }): TurnInvalidError => ({
    code: "TURN_INVALID",
    message:
      `${turnId} is not a turn id this process minted — a relay turn is a UUID the route mints, never a ` +
      "value the model chose, which is what keeps an utterance from naming its own receipt",
    turnId,
  }),
  typedInvalid: ({ why }: { why: string }): TypedInvalidError => ({
    code: "TYPED_INVALID",
    message: why,
  }),
  wordsAloneInvalid: ({ why }: { why: string }): WordsAloneInvalidError => ({
    code: "WORDS_ALONE_INVALID",
    message: why,
  }),
} as const;
