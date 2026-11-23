/**
 * What a Slack message can be EVIDENCE of, for the one question the owner cares most about: did the owner ask
 * somebody to review this pull request, and whom.
 *
 * ## Why the answer has three values and not two
 *
 * The rule: a message containing a PR link, or a PR link plus the word review, is not enough; the message has
 * to be read. Rule 2 forbids a model inside a verb, so the CLI cannot read a message the way the owner does.
 * What it CAN do is certify the constructions the owner actually writes and refuse to guess at the rest — which is why
 * {@link AskDecision} carries `undecided` beside `ask` and `non-ask`. A confident wrong answer on two pull
 * requests is worse than an honest abstention on twenty, and the visible session is what resolves one.
 *
 * MEASURED over every Slack bronze record linking one of the owner's 22 open `acme-admin` pull requests —
 * 46 distinct messages, hand-labelled in a visible session — the deterministic rules in
 * `./askClassification.ts` answer **17 pull requests asked, 2 never asked, 2 undecided**, with no false
 * positive and no false negative against that labelling. Reproduce the capture with
 * `slopweaver github landing --repo acme/acme-admin --author <login> --slack-live --json`.
 *
 * Pure types. No I/O, no clock.
 */

/** Where a piece of evidence sits inside the text it was read from, so a reader can check the quotation. */
export interface TextSpan {
  /** UTF-16 offset of the first character, into the exact string the span was measured against. */
  readonly start: number;
  /** UTF-16 offset one past the last character. */
  readonly end: number;
  /** The quoted text itself — always equal to `source.slice(start, end)`. */
  readonly text: string;
}

/** One Slack mention run, with where it sits so a recipient can be scoped to the line it was written on. */
export interface MentionRun {
  /** The Slack id the run addresses — `U`/`W` a person, `S` a user group. */
  readonly id: string;
  readonly span: TextSpan;
}

/**
 * Who wrote a message, in the only three categories that change what it can prove.
 *
 * `owner` covers the as-me lane: `../corpus/slack/ownerBot.ts` already resolves the owner's own bot back to
 * the owner's user id at projection time, so a message the owner sent through the bot arrives here as theirs. `app` is any
 * application speaking as ITSELF, including Slopweaver's own digests. `other-human` is everybody else — and
 * their message can never answer "did the OWNER ask", however perfectly it is worded.
 */
export type AuthorRole = "owner" | "other-human" | "app";

/**
 * The conversation a message sits in, as it bears on whether an ask is even possible.
 *
 * `owner-only` is the conversation between the owner and the owner's own bot. Nobody
 * else is in it, so a pull-request link there can never be somebody being asked — **whoever posted it**.
 * The exclusion covers the owner's own messages in that DM as well as the app's posts: otherwise they read
 * as asks, and in a measured sample six of them did. Two were verbatim DRAFTS of a message
 * that went to a real channel minutes later, so the rehearsal and the performance both counted.
 */
export type ConversationKind = "channel" | "direct-message" | "owner-only";

/** Everything {@link ./askClassification.classifyReviewCandidate} needs about one message and one pull request. */
export interface AskCandidate {
  /** `owner/repo#number` — the one pull request this decision is about. */
  readonly prKey: string;
  /**
   * The author's OWN visible words, never the raw payload and never a quoted attachment.
   *
   * `./prLink.ts`'s `slackHaystack` deliberately matches the whole raw payload, because 29.8% of linking
   * messages carry the URL only there. That is right for DISCOVERY and wrong for attribution: a quoted
   * message's words are not the quoting author's words. MEASURED — an "Also, bumping this" message
   * from the owner carries no GitHub link in its own text at all, and reaches the matcher purely
   * through `attachments[].fallback`.
   */
  readonly authoredText: string;
  /** Where this pull request is linked inside {@link authoredText}. Empty when only a quote linked it. */
  readonly linkSpans: readonly TextSpan[];
  /** How many DISTINCT pull requests {@link authoredText} links, which decides whether recipients are scoped. */
  readonly authoredPrCount: number;
  /**
   * Where the FIRST link to any pull request sits in {@link authoredText}, or -1 when it links none.
   *
   * The message's own first link, never this pull request's. A heading addresses the whole list beneath it,
   * so the mentions that count as a heading are the ones written before the list STARTS — measured from
   * this pull request's first link instead, every mention on an EARLIER pull request's line falls inside
   * the heading and leaks onto this one. Found by a Codex review with a two-line counterexample.
   */
  readonly firstLinkAt: number;
  /** Every mention run in {@link authoredText}, in the order written. */
  readonly mentions: readonly MentionRun[];
  /** Who posted it, as a Slack id — so a tag of the owner is never read as somebody asked. */
  readonly authorId: string;
  readonly authorRole: AuthorRole;
  readonly conversation: ConversationKind;
  /**
   * In a direct message, the counterpart's Slack id — the audience the conversation itself names.
   *
   * Empty when this read could not name one, which is an absence rather than an answer: a DM whose
   * counterpart is unknown cannot certify a recipient, so it answers `undecided` instead of guessing.
   */
  readonly counterpartId: string;
  /**
   * Whether the corpus holds copies of this message whose authored text disagrees, with nothing that orders
   * them. Hygiene rewrites `raw.edited.ts`, so an edit's TIME is unreadable; which copy the owner meant is then a
   * reading for a visible session, never a guess.
   */
  readonly versionsDisagree: boolean;
  /**
   * The pull requests linked inside the message(s) this one QUOTES, as `owner/repo#number`.
   *
   * Read from Slack's own unfurl of a permalink written in {@link authoredText}. A message that asks "could you
   * pls review this one?" beside a permalink names the pull request only there. Empty when it quotes nothing,
   * and always empty on the live leg, whose search results carry no attachments.
   */
  readonly quotedPrKeys: readonly string[];
  /**
   * The pull requests the THREAD ROOT reaches — its words, quotes and forwards — as `owner/repo#number`, set on
   * a reply that reaches no pull request itself, which is how "@Jasper please review this" under `<PR> is ready` names its pull request.
   * Empty on a root, on a reply that links, quotes or forwards one, and when the root was never read.
   */
  readonly threadPrKeys: readonly string[];
}

/**
 * What one message proves about one pull request.
 *
 * `ruleId` names the rule that decided it, so a row can say WHY rather than only what — and so a wrong
 * answer names the rule to fix instead of sending a reader back through the whole classifier.
 */
export type AskDecision =
  | {
      readonly kind: "ask";
      /** The Slack ids this message asked, scoped to THIS pull request. Never empty. */
      readonly recipients: readonly string[];
      /** The request construction that carried it, quoted from {@link AskCandidate.authoredText}. */
      readonly request: TextSpan;
      readonly ruleId: string;
    }
  | {
      readonly kind: "non-ask";
      readonly ruleId: string;
      /** What a reader is told, in a phrase fit to print beside the message. */
      readonly why: string;
    }
  | {
      readonly kind: "undecided";
      readonly ruleId: string;
      /** What the deterministic layer could not settle, so a visible session knows what to read. */
      readonly why: string;
    };
