/**
 * The pure invocation types for `slopweaver slack post|reply`, split out of `./core.js` so its
 * arg-parsing (`./coreArgs.js`) and form-validation (`./coreForm.js`) siblings can depend on these
 * without a circular import back through `core.js` itself.
 */
import type { DmPurpose } from "../../../outbound/slack/dmPurpose.js";
import type { ReviewerDeclaration } from "../../../outbound/slack/reviewAskShape.js";
import type { DripShape, SlackActor } from "../../../outbound/slack/types.js";

/** The write verbs PR5 ships. `image` is deliberately gone — media rides on a card, never alone. */
export type SlackWriteVerb = "post" | "reply";

/** `--form -` reads the form from stdin, which is load-bearing: prose dies on an inline shell quote. */
export const STDIN_SENTINEL = "-";

/** The break-glass that downgrades an unresolved-owner REFUSAL to a warning. One flag, one named risk. */
export const ALLOW_UNRESOLVED_OWNER_FLAG = "allow-unresolved-owner";

/** What both lanes need: where it goes, under which home, and how it is reported. */
interface SlackWriteCommon {
  readonly channel: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
  readonly verb: SlackWriteVerb;
  readonly threadTs?: string;
}

/** A parsed `--as bot` invocation: one schema-enforced card, optionally carrying media. */
export interface SlackCardOptions extends SlackWriteCommon {
  readonly actor: "bot";
  readonly formJson: string;
  readonly media: readonly string[];
  /**
   * Whether to post a digest whose owner did not resolve, with the name as plain text and nobody notified.
   * OFF by default and never inferred — see {@link unresolvedOwnerRefusal} in `./coreForm.js`.
   */
  readonly allowUnresolvedOwner: boolean;
  /**
   * Whether to re-send a card a previous run reserved but never confirmed. OFF by default and never inferred:
   * the operator has to have read the target to know this is safe. A send Slack itself REFUSED releases its
   * own reservation, so this is for a lost response, never for a refused call.
   */
  readonly resendUnconfirmed: boolean;
  /**
   * The DELIVERY's own identity, when the caller has one — `--idempotency-key`.
   *
   * Present only for a send whose second delivery must be refused rather than warned about: a scheduled
   * recipe firing hands its own slot key (`live/automation/slotLedger.ts#slotDeliveryKey`), so a crash between
   * the post and the receipt cannot put the same card out twice. `undefined` is the ordinary hand-typed
   * send, which keys on content and warns.
   */
  readonly idempotencyKey?: string | undefined;
  /**
   * The session's answer to the picture question a composed card naming three or more things is held on
   * (`../../cardPictureDoor.ts`) — `--no-picture-because`. Recorded on the send's door-ledger row.
   */
  readonly noPictureBecause?: string | undefined;
  /**
   * What a post to the owner's own bot DM is FOR — `--dm-purpose`, one of `DM_PURPOSES`
   * (`../../../outbound/slack/dmPurpose.ts`). A post aimed at the owner's DM without one is held; anywhere else it is
   * carried and unread.
   */
  readonly dmPurpose?: DmPurpose | undefined;
  /**
   * Whether this card is a parked draft — recorded by `slack draft record --as bot`, or released by `slack post
   * --as bot --draft` on the owner's approval. Never parsed from argv: only those two set it, and the one hold that reads
   * it lets a `finding` go into the channel and thread the owner approved it for
   * (`../../../outbound/slack/findingDestination.ts`).
   */
  readonly approvedDraft?: true | undefined;
}

/** Where an as-me message's words come from: the sectioned form, or the raw escape hatch. */
export type DripSource =
  { readonly kind: "form"; readonly json: string } | { readonly kind: "body"; readonly text: string };

/** A parsed `--as me` invocation: a drip, with its shape stated explicitly by the caller. */
export interface SlackDripOptions extends SlackWriteCommon {
  readonly actor: "me";
  readonly source: DripSource;
  readonly shape: DripShape;
  /**
   * The files to attach, in the caller's order. They ride on the LAST message of the drip — see
   * {@link buildSlackDripPlan}'s own doc for why that message and not the first.
   */
  readonly media: readonly string[];
  /**
   * Whether to re-send messages a previous run reserved but never confirmed. OFF by default and never
   * inferred: the operator has to have looked at the channel to know this is safe.
   */
  readonly resendUnconfirmed: boolean;
  /**
   * Lifts the untagged-bump gate because the destination is a direct message, where the one other person IS
   * the reader and a mention adds nothing — the `untagged-bump` hatch's own named exception. Never parsed
   * from argv: only a draft release sets it, and only from a live `conversations.info` answer.
   */
  readonly bumpExemption?: "direct-message" | undefined;
  /**
   * Whether the person a DM review ask goes to was in the conversation the work came from — `slack draft record
   * --reviewer`, `undeclared` when a recording owes it and gave none, or `approved` on a release, whose bytes the owner
   * already said yes to. Absent on a direct post (`../../../outbound/slack/reviewAskShape.ts`).
   */
  readonly reviewer?: ReviewerDeclaration;
}

/**
 * A parsed `slack post|reply --as me|bot --draft <id> --approve <digest>`: release one parked draft, under the
 * identity it was recorded as — a `--as bot` row through the card lane, any other through the as-me drip.
 *
 * The destination, shape, thread and words all come from the ROW (`../../../outbound/slack/draftRegister.ts`),
 * so the invocation carries only which row, the digest the owner's approval named, an optional `--form` for a row
 * whose form was never kept, and the VERB — which must agree with the row: `reply` for a thread row, `post`
 * for a top-level one (`./releaseRun.ts`). The digest binds the POSTED bytes and the thread, so any form
 * rendering them is the same approval, and any other is refused as drift.
 */
export interface SlackDraftReleaseOptions {
  readonly actor: SlackActor;
  readonly release: { readonly draftId: string; readonly approve: string };
  /** The `--form` value as typed, when given — JSON, or `-` for stdin. Absent means the row's own form. */
  readonly formSource?: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
  readonly verb: SlackWriteVerb;
  readonly resendUnconfirmed: boolean;
  /**
   * `--thread-moved-cleared`: the exact set of messages a person changed since the row's read, which the releasing
   * session read and judged leaves the message meaning what the owner approved. Absent means nothing was cleared.
   */
  readonly threadMovedCleared?: readonly string[] | undefined;
  /**
   * `--thanks-instead "<one line>"`: the just-in-time re-read found the message no longer needed, so this line is
   * sent in its place and the row closes (owner turn EV8WlMNo). As-me rows only. Absent on an ordinary release.
   */
  readonly thanksInstead?: string | undefined;
}

/**
 * A fully-parsed invocation, discriminated by WHOSE name it goes out under.
 *
 * A union rather than one options object with half its fields optional, because the two lanes genuinely
 * take different flags: `--shape` is meaningless for a card, and `--allow-unresolved-owner` governs a
 * digest's owner ping, which the human lane has none of. Optional-flag soup would let
 * `--as bot --shape thread` parse and then be ignored. `--media` is now the one flag BOTH lanes take, and
 * it means the same thing on each: these files, in this order, under the words.
 */
export type SlackWriteOptions = SlackCardOptions | SlackDripOptions | SlackDraftReleaseOptions;

/**
 * Whether a parsed invocation releases a parked draft rather than composing a fresh send.
 *
 * @param options the parsed invocation
 * @returns true for a `--draft` release
 */
export function isDraftRelease(options: SlackWriteOptions): options is SlackDraftReleaseOptions {
  return "release" in options;
}

/**
 * Whether a parsed invocation sends words in the owner's name that the invoking session supplies now: a fresh as-me
 * send, or a release carrying a `--thanks-instead` line. A plain release sends bytes its row admitted when recorded.
 *
 * @param options the parsed invocation
 * @returns true when the owner's voice brief is owed before the write
 */
export function takesFreshWordsAsMe({ options }: { options: SlackWriteOptions }): boolean {
  if (options.actor !== "me") {
    return false;
  }
  if (!isDraftRelease(options)) {
    return true;
  }
  return options.thanksInstead !== undefined;
}
