/**
 * Why an anchor's words could not be read — its own union, never shared (`.claude/rules/error-handling.md`).
 *
 * A row whose words could not be read stores the MESSAGE as an unread record (`./hisWords.ts`), never words: its card
 * says why, and `handover quote --apply` tries again on every run — so a record that was merely unreadable for a moment
 * (a call file mid-write) heals itself, and one that is gone for good keeps saying so.
 */

/** The anchor is not one of the four schemes whose record holds the owner's words. */
export interface NotOwnerSchemeError {
  readonly code: "NOT_OWNER_SCHEME";
  readonly message: string;
  readonly anchor: string;
}

/** The anchor carries an owner-words scheme but is not a well-formed pointer of it. */
export interface AnchorMalformedError {
  readonly code: "ANCHOR_MALFORMED";
  readonly message: string;
  readonly anchor: string;
}

/** The record the anchor names is not there: no landing, no segment, no turn. */
export interface RecordMissingError {
  readonly code: "RECORD_MISSING";
  readonly message: string;
  readonly anchor: string;
}

/** The record is there and holds no words once whitespace is set aside. */
export interface WordsEmptyError {
  readonly code: "WORDS_EMPTY";
  readonly message: string;
  readonly anchor: string;
}

/** The call segment the anchor names is the voice speaking, or speech a console that is not the owner's recorded. */
export interface SegmentNotOwnerError {
  readonly code: "SEGMENT_NOT_OWNER";
  readonly message: string;
  readonly anchor: string;
}

/** The session turn the anchor names is text Claude Code suggested and the owner accepted, not words they wrote. */
export interface TurnNotTypedError {
  readonly code: "TURN_NOT_TYPED";
  readonly message: string;
  readonly anchor: string;
}

/** The session turn the anchor names had a wrapper span cut from between the owner's words, so no quote of it is verbatim. */
export interface TurnSplicedError {
  readonly code: "TURN_SPLICED";
  readonly message: string;
  readonly anchor: string;
}

/** The session turn the anchor names carries no `promptSource` saying the owner typed or queued it. */
export interface TurnUnprovenError {
  readonly code: "TURN_UNPROVEN";
  readonly message: string;
  readonly anchor: string;
}

/** The session turn the anchor names is a line the console typed into the chair — a relay's delivery or a quiet batch. */
export interface TurnConsoleLineError {
  readonly code: "TURN_CONSOLE_LINE";
  readonly message: string;
  readonly anchor: string;
}

/** The file holding the record could not be read whole. */
export interface RecordUnreadableError {
  readonly code: "RECORD_UNREADABLE";
  readonly message: string;
  readonly anchor: string;
}

/** Every way an anchor's words fail to read. */
export type HisWordsError =
  | NotOwnerSchemeError
  | AnchorMalformedError
  | RecordMissingError
  | WordsEmptyError
  | SegmentNotOwnerError
  | TurnNotTypedError
  | TurnSplicedError
  | TurnUnprovenError
  | TurnConsoleLineError
  | RecordUnreadableError;

/** The one place each variant's message is worded. */
export const HisWordsErrors = {
  anchorMalformed: ({ anchor }: { anchor: string }): AnchorMalformedError => ({
    anchor,
    code: "ANCHOR_MALFORMED",
    message: `${anchor} is not a well-formed pointer of its scheme`,
  }),
  notOwnerScheme: ({ anchor }: { anchor: string }): NotOwnerSchemeError => ({
    anchor,
    code: "NOT_OWNER_SCHEME",
    message: `${anchor} does not point at a record of the owner's words`,
  }),
  recordMissing: ({ anchor, what }: { anchor: string; what: string }): RecordMissingError => ({
    anchor,
    code: "RECORD_MISSING",
    message: `${anchor}: ${what}`,
  }),
  recordUnreadable: ({ anchor, why }: { anchor: string; why: string }): RecordUnreadableError => ({
    anchor,
    code: "RECORD_UNREADABLE",
    message: `${anchor} could not be read — ${why}`,
  }),
  segmentForeign: ({ anchor, origin }: { anchor: string; origin: string }): SegmentNotOwnerError => ({
    anchor,
    code: "SEGMENT_NOT_OWNER",
    message: `${anchor} was recorded on ${origin}, so its speech is not read as the owner's`,
  }),
  segmentNotOwner: ({ anchor }: { anchor: string }): SegmentNotOwnerError => ({
    anchor,
    code: "SEGMENT_NOT_OWNER",
    message: `${anchor} is the voice speaking, not the owner`,
  }),
  turnConsoleLine: ({
    anchor,
    relay,
  }: {
    anchor: string;
    /**
     * The relay the line's head names, with its exact `talk:` anchor when one turn file on disk carries that slug —
     * `undefined` for a quiet batch or a line whose head names no minted slug.
     */
    relay:
      | {
          readonly slug: string;
          readonly talkAnchor: string | undefined;
          /** Why the turns directory would not list, when it would not — the route then names the slug alone. */
          readonly unlisted: string | undefined;
        }
      | undefined;
  }): TurnConsoleLineError => {
    const head = `${anchor} is a line the console typed into the chair, not words the owner wrote — anchor on`;
    if (relay?.talkAnchor !== undefined) {
      return {
        anchor,
        code: "TURN_CONSOLE_LINE",
        message: `${head} the relay it delivered, ${relay.talkAnchor}`,
      };
    }
    let instead = "the relay itself (talk:<turn>) or the call words a wake points at (talk-call:<call>#<segment>)";
    if (relay?.unlisted !== undefined) {
      instead = `relay ${relay.slug}'s own turn (talk:<turn>; the turn files would not list: ${relay.unlisted})`;
    } else if (relay !== undefined) {
      instead = `relay ${relay.slug}'s own turn (talk:<turn>; the slug picks out no one readable turn on disk)`;
    }
    return {
      anchor,
      code: "TURN_CONSOLE_LINE",
      message: `${head} ${instead}, which \`slopweaver profile words\` lists`,
    };
  },
  turnNotTyped: ({ anchor }: { anchor: string }): TurnNotTypedError => ({
    anchor,
    code: "TURN_NOT_TYPED",
    message: `${anchor} is a prompt Claude Code suggested and the owner accepted, not words they wrote`,
  }),
  turnSpliced: ({ anchor }: { anchor: string }): TurnSplicedError => ({
    anchor,
    code: "TURN_SPLICED",
    message: `${anchor} is a turn with a wrapper span cut from between the owner's words, so no verbatim quote of it can be drawn`,
  }),
  turnUnproven: ({ anchor }: { anchor: string }): TurnUnprovenError => ({
    anchor,
    code: "TURN_UNPROVEN",
    message: `${anchor} carries no promptSource saying the owner typed or queued it, so it is not read as the owner's words`,
  }),
  wordsEmpty: ({ anchor }: { anchor: string }): WordsEmptyError => ({
    anchor,
    code: "WORDS_EMPTY",
    message: `${anchor} holds no words`,
  }),
} as const;
