/**
 * The shapes `slopweaver slack tagged` passes between its reader, its document and its renderer. Types only, so
 * the document, the residue and the renderer can each import them without importing one another.
 */

/** How the owner is reached in a thread: their latest own-ts per thread key, and per one-to-one DM conversation. */
export interface OwnerTrail {
  /** `channel:rootTs` → the owner's latest message's own Slack `ts`, as a number. */
  readonly byThread: ReadonlyMap<string, number>;
  /** A `D…` conversation id → the owner's latest message's own Slack `ts` anywhere in it. */
  readonly byDm: ReadonlyMap<string, number>;
}

/** One message tagging the owner, as either leg found it, with its author already resolved. */
export interface TaggedCandidate {
  /** `channel:ownTs` — the message's identity, shared by both legs. */
  readonly messageKey: string;
  /** `channel:rootTs` — the thread the message sits in; a root's own key for a top-level message. */
  readonly threadKey: string;
  readonly channelId: string;
  /** The channel name the record carried, when it carried one. */
  readonly channelName: string | undefined;
  readonly authorId: string;
  readonly authorName: string;
  /** Whether the author is a person — not Slopweaver, not Slackbot, not an app, not an empty live author. */
  readonly authorIsHuman: boolean;
  /** Whether the members index knows the author at all. An unknown id is listed, and counted. */
  readonly authorKnown: boolean;
  readonly tsIso: string;
  /** The message's own Slack `ts`, as a number, to order against the owner's replies. */
  readonly ownTs: number;
  readonly permalink: string;
  /** The message text, one line, already cut to a quote. */
  readonly text: string;
}

/** What the corpus leg produced. */
export type TaggedCorpusLeg =
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "read";
      readonly candidates: readonly TaggedCandidate[];
      readonly trail: OwnerTrail;
      /** Lines carrying the owner's id that did not parse as a message — each may be a tag this read lost. */
      readonly unparsed: number;
      /**
       * How far the Slack corpus reaches: its pooled watermark capped by the furthest channel cursor, or undefined
       * when it carries no pooled watermark.
       */
      readonly newestIso: string | undefined;
      /**
       * Channel id → how far the crawl has read THAT channel, its own cursor. A channel absent here has no
       * recorded reach, so a row in it cannot say how far its "no later word" holds.
       */
      readonly channelReach: ReadonlyMap<string, string>;
    };

/** What the live leg produced. */
export type TaggedLiveLeg =
  | { readonly kind: "skipped" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "read";
      readonly candidates: readonly TaggedCandidate[];
      readonly trail: OwnerTrail;
      /** Why each of the two searches stopped short, empty when both read every page. */
      readonly incomplete: readonly string[];
      /** Search hits carrying no author id at all — an app post, never listed. */
      readonly authorless: number;
    };

/** One row of the document. */
export interface SlackTaggedRow {
  readonly permalink: string;
  readonly channelId: string;
  readonly room: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorKnown: boolean;
  readonly taggedAtIso: string;
  readonly text: string;
  /**
   * A later word of the owner's in the thread: true when seen, false when none up to `answeredThroughIso` and live search
   * returned none after it, null when unknown.
   */
  readonly answered: boolean | null;
  /**
   * How far a `false` holds: the earliest of this row's channel reach, the corpus's newest message and the run's
   * instant. Null when the channel records no reach, or the row was found by live search alone.
   */
  readonly answeredThroughIso: string | null;
  readonly source: "both" | "corpus" | "live";
}

/** The whole document. */
export interface SlackTaggedDocument {
  readonly producer: "slack tagged";
  readonly observedAtIso: string;
  readonly status: "complete" | "incomplete" | "unavailable";
  readonly coverage: {
    readonly windowDays: number;
    readonly sinceIso: string;
    /** The newest message the corpus holds, or null when it names none or could not be read. */
    readonly corpusNewestIso: string | null;
    /** The latest any row's `false` can hold to — the corpus's newest message, or the run's instant if earlier. */
    readonly answeredThroughIso: string | null;
    readonly live: "read" | "incomplete" | "unavailable" | "skipped";
    readonly residue: readonly string[];
  };
  readonly counts: {
    readonly listed: number;
    readonly unanswered: number;
    readonly unknownAuthors: number;
    readonly excludedNonHuman: number;
  };
  readonly rows: readonly SlackTaggedRow[];
}

/** The residue line that answers the question this verb was built for, printed first on every document. */
export const UNREAD_NOT_EXPOSED =
  "unread state is NOT exposed: neither the corpus nor Slack's search says whether you have seen a message, so every tag is listed whether you have read it or not";
