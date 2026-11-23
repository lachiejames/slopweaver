/**
 * The relay DRAFT — pure, and the module that decides what one relay may write.
 *
 * ## Three properties, and each is here rather than at a call site because each was a near miss
 *
 * **The turn id is not the model's to choose.** `relay_steer` takes the voice's reading and nothing else. The
 * console mints the id with `crypto.randomUUID()` and the verb REFUSES anything that is not a v4 UUID, so a model
 * that emits `--turn ../../something` or reuses an id it saw in a file gets a refusal rather than a receipt.
 * Shape-checking is not authentication and does not pretend to be: what it buys is that the id space is the
 * route's, so an utterance cannot name a receipt.
 *
 * **The board slug is derived from the TURN, never from the words.** `handover register` otherwise derives
 * a slug from the ask's first eight words (`src/cli/commands/handover/askRowText.ts`), and a Codex pre-mortem
 * ran the real function: two different asks sharing eight opening words produce
 * ONE slug. On a word slug a second relay's registration refuses because an unrelated row already holds the
 * name, and a retry that reconciled by "is the slug there" would then promote a receipt for words that were
 * never registered. A turn-derived slug makes that collision unrepresentable instead of recoverable.
 *
 * **The owner's words lead the row, and the voice's reading is labelled as the voice's.** A relay is registered with
 * `--dispatch`, which says the row is the OWNER's word, and what the model supplies is only its
 * paraphrase. So the row opens with {@link RelayDraft.heard} — the owner's own words as the speech recogniser
 * transcribed them, collected by the page from the input transcript and never passed through the model —
 * and the model's `say` follows under its own label. The board summary is capped, so the first thing the
 * chair reads is what the owner said rather than what the voice made of it. The cap is in BYTES (`handover start`
 * refuses a row over it), so the row's quote of the owner's words is cut to fit the whole ask under it, and a reading
 * too long to leave room for any of the owner's words is refused before anything is written — the page's words-alone
 * retry then carries the owner's words, which always fit.
 *
 * **What is shown is what is written, byte for byte.** The draft normalises once, and both the call widget's relay
 * record and the row take the normalised words, so "the row says what the owner said" is a property of the data rather
 * than of the rendering. {@link RelayDraft.digest} is what a retry of the same turn is compared against, and it
 * binds the picture's sha256 as well as the text: every retry of a turn names the same picture PATH, so the
 * path alone would let a second frame pass as the first.
 *
 * **When the voice read something after the owner last spoke, its reading is not carried at all.** The page's gate
 * (`site/lib/relayGate.ts`) opens such a relay in heard-only mode and names the reads; the draft then refuses
 * a `say` beside them rather than trusting the caller to have blanked it, and the row says the reading was
 * dropped and why. A read source is one of the voice's own read tools or a standing read such as the context pack,
 * from a closed list. A words-alone relay — the page's retry after a refusal — carries neither a reading nor reads.
 *
 * **A typed steer is the owner's words and nothing else.** The console's steer composer sends what the owner typed
 * with `--typed`: no voice was involved, so there is no reading to carry or drop, and the row says the words were
 * typed rather than transcribed. Typed words keep their line breaks and are never cut — over the limit, in
 * characters or in the row summary's bytes, is a refusal, because a composer the owner can see can simply be
 * shortened.
 */
import type { StatedWorkspace } from "../handover/workspace.js";
import { err, ok, type Result } from "../lib/result.js";
import { CARD_KEY } from "./cardKey.js";
import type { DiscussFirstRecord } from "./discussFirst.js";
import { type TalkError, TalkErrors } from "./errors.js";
import { prCardKeyParts } from "./prCardKey.js";
import { normaliseSay, relayAskText } from "./relayAskText.js";
import { relayCutHold } from "./relayCutHold.js";
import { type DigestBound, draftDigest, type RelayCandidateVerdict } from "./relayDraftDigest.js";
import { readsAfterRefusal, wordsAloneRefusal } from "./relayModeRefusals.js";
import { OFFERED_SPOKEN_ONLY, type RelayOffer } from "./relayOffer.js";
import type { RelayPicture } from "./relayPicture.js";
import { RELAY_STANDING_READS, RELAY_TRANSIENT_READS } from "./relayReadSources.js";
import { fittedRowQuote } from "./relayRowQuote.js";
import { typedAsk } from "./relayTypedAsk.js";
import { TALK_TOOLS } from "./talkToolSchemas.js";
import { type TriageRuling, withTriageRuling } from "./triageVocabulary.js";

/** Why a typed steer refuses `--heard-tail cut`: the composer sends typed words whole, so no stretch was left open. */
const HEARD_CUT_SPOKEN_ONLY =
  "--heard-tail cut marks a spoken relay made while a call stretch was still open; a typed steer is whole";

/** The longest reading a relay may carry. Long enough for a paragraph the owner dictated, short of a wall of text. */
export const RELAY_SAY_LIMIT = 2000;

/**
 * Every source a relay may name as read after the owner: the voice's read tools, the page's one-turn reads and the standing
 * reads (`relayReadSources.ts`) — the context pack a call carries from its mint among them.
 */
export const RELAY_READ_SOURCES: readonly string[] = [
  ...TALK_TOOLS.filter((tool) => tool.kind === "read").map((tool) => tool.name),
  ...RELAY_TRANSIENT_READS,
  ...RELAY_STANDING_READS,
];

/** One relay: everything the call widget's relay record shows and everything the write consumes, and nothing else. */
export interface RelayDraft {
  /** The route-minted turn this draft belongs to. */
  readonly turnId: string;
  /** The voice's reading of the steer, normalised — what the receipt prints; empty in heard-only mode. */
  readonly words: string;
  /** What the voice read after the owner last spoke, which is why {@link words} is empty; empty in full mode. */
  readonly readsAfter: readonly string[];
  /** The page's retry after a refused relay: the owner's words alone, no reading and no reads. */
  readonly wordsAlone: boolean;
  /** The owner typed the steer on the console: {@link heard} is their typed words, and there is no voice reading. */
  readonly typed: boolean;
  /** The frame of the owner's shared screen, or the image they attached to a typed steer, or why it carries none. */
  readonly picture: RelayPicture;
  /** The owner's own words as transcribed, normalised and whole — every word — or empty when none were attached. */
  readonly heard: string;
  /**
   * Whether {@link heard} ends before the owner did: `true` the page relayed while a stretch of their call was still
   * open,
   * `false` every stretch had finished, `undefined` the caller did not say. Always `false` on a typed steer, which is
   * whole by construction. Bound into the digest when stated.
   */
  readonly heardTailCut: boolean | undefined;
  /** The console record the owner was looking at, or empty. */
  readonly about: string;
  /** The exact ask text the board row carries — the owner's words first. */
  readonly ask: string;
  /** The board slug, derived from the turn so it can never collide with an unrelated ask's word slug. */
  readonly slug: string;
  /** The board row's anchor, which is what a recovery pass matches on. */
  readonly anchor: string;
  /**
   * The copy-tray offer the owner was reacting to, exactly as the voice offered it, or `undefined` when the relay
   * carries none. The voice's draft and never the owner's words: the heard words say what the owner made of it
   * (`./relayOffer.ts`).
   */
  readonly offered: RelayOffer | undefined;
  /**
   * The owner's verdict, label and feedback on the card a triage pass had open, or `undefined` when the relay carries none.
   * The ask already spells it for the supervisor; this is the same ruling as data, so the turn record carries it for a
   * verb to read — `slack draft approve` refuses a yes from a relay whose verdict is not `send-it`, and a repeat
   * counter reads its feedback, since a sentence is not a class (`site/lib/alignmentRules.ts`'s
   * `cardRulingCandidates`).
   */
  readonly triageRuling: TriageRuling | undefined;
  /**
   * The discuss-first question this relay put, or the owner's answer to one (`./discussFirst.ts`), or `undefined` when
   * it names no team fix. The turn record keeps it, so a later answer can be checked against the relay that really put it.
   * Optional in the type only so a draft built by hand for another reader need not name it; `formRelayDraft` names it.
   */
  readonly discussFirst?: DiscussFirstRecord | undefined;
  /**
   * The other Queue cards the voice judged the owner's words answer (`relay_steer`'s `also_answers`), which `talk relay` lands
   * beside {@link about}, in the order named; bound into the digest. Empty when it named none, and always on a typed
   * steer.
   */
  readonly alsoAnswers: readonly string[];
  /**
   * sha256 of {@link ask}, the picture's own sha256 and every field of {@link offered} — what a retry of the same turn
   * is compared against.
   */
  readonly digest: string;
}

/** Matches a v4 UUID and nothing else. Anchored, so a longer string carrying one does not pass. */
const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The scheme a relay row's anchor carries — `talk:<turnId>`, the pointer a mark or a sweep names it by. */
const RELAY_ANCHOR_SCHEME = "talk:";

/**
 * A relay's anchor, normalised, when the text is exactly one — `talk:` and a v4 turn id, nothing around it.
 *
 * @param text a pointer as typed (`supervisor intake-mark --turn talk:<turnId>`)
 * @returns `talk:<turnId>`, lower-cased, or `undefined` when the text is not a relay anchor
 */
export function parseRelayAnchor({ text }: { text: string }): string | undefined {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed.startsWith(RELAY_ANCHOR_SCHEME)) {
    return undefined;
  }
  const turnId = trimmed.slice(RELAY_ANCHOR_SCHEME.length);
  if (!V4_UUID.test(turnId)) {
    return undefined;
  }
  return `${RELAY_ANCHOR_SCHEME}${turnId}`;
}

/**
 * Form the draft a relay will write, or say why the input cannot be one.
 *
 * @param turnId the id the route minted for this turn
 * @param say the words the model proposed, before normalisation; must be empty when `readsAfter` is not
 * @param heard the owner's own transcribed words, attached by the page; empty when a caller has none
 * @param about the console record key the owner was looking at; empty for none
 * @param readsAfter what the voice read after the owner last spoke — non-empty is heard-only mode
 * @param wordsAlone the page's retry after a refused relay: the owner's words only, with no reading and no reads
 * @param typed the owner typed the steer on the console, so `heard` is their typed words and there is no reading
 * @param picture the frame of the owner's shared screen or the image they attached, or why there is none
 * @param candidateVerdict the owner's ruling on a workstream candidate the relay carries, bound into the digest so a
 *   replay of the turn naming another candidate or word conflicts instead of writing it
 * @param workspace whose work the page stated the relay is at hand-off, bound into the digest the same way, so a
 *   replay of the turn stating another workspace conflicts instead of registering it
 * @param offered the copy-tray offer the owner was reacting to, bound into the digest whole, so a replay of the turn
 *   carrying another offer or none conflicts instead of registering beside different text; a spoken relay's only
 * @param triageRuling the owner's verdict and label on the card a triage pass had open, written into the row's ask (so
 *   the digest binds it with the ask) because a heard-only relay drops the voice's reading and the owner's words may
 *   be "yep"
 * @param discussFirst the discuss-first question this relay put or answered (`./discussFirst.ts`), bound into the
 *   digest so a replay of the turn cannot turn a held fix into a go-ahead
 * @param alsoAnswers the other Queue cards the owner's words answer, bound into the digest in order, so a replay of the
 *   turn naming other cards conflicts instead of landing them; a spoken relay's only
 * @param heardTailCut whether `heard` ends before the owner did — `true` a stretch of their call was still open,
 *   `false` every one had finished, `undefined` unstated; bound into the digest when stated, so a replay cannot turn cut words
 *   whole; `true` is a spoken relay's only
 * @returns the draft, or a `TURN_INVALID` / `SAY_INVALID` / `ASK_OVER_CAP` / `ABOUT_INVALID` / `READS_INVALID` /
 *   `WORDS_ALONE_INVALID` / `TYPED_INVALID` / `OFFERED_INVALID` refusal
 */
export function formRelayDraft({
  turnId,
  say,
  heard,
  about,
  readsAfter,
  wordsAlone,
  typed,
  picture,
  candidateVerdict,
  workspace,
  offered,
  triageRuling,
  discussFirst,
  alsoAnswers = [],
  heardTailCut,
}: {
  turnId: string;
  say: string;
  heard: string;
  about: string;
  readsAfter: readonly string[];
  wordsAlone: boolean;
  typed: boolean;
  picture: RelayPicture;
  candidateVerdict?: RelayCandidateVerdict | undefined;
  workspace?: StatedWorkspace | undefined;
  offered?: RelayOffer | undefined;
  triageRuling?: TriageRuling | undefined;
  discussFirst?: DiscussFirstRecord | undefined;
  alsoAnswers?: readonly string[];
  heardTailCut?: boolean | undefined;
}): Result<RelayDraft, TalkError> {
  if (!V4_UUID.test(turnId)) {
    return err(TalkErrors.turnInvalid({ turnId }));
  }
  // A bare `pr:<number>` names whichever repository's pull request shared the number, so a relay never mints one.
  const barePr = about.startsWith("pr:") && prCardKeyParts({ key: about }) === undefined;
  if (about !== "" && (!CARD_KEY.test(about) || barePr)) {
    return err(TalkErrors.aboutInvalid({ about }));
  }
  if (offered !== undefined && (typed || wordsAlone)) {
    return err(TalkErrors.offeredInvalid({ why: OFFERED_SPOKEN_ONLY }));
  }
  if (heardTailCut === true && typed) {
    return err(TalkErrors.typedInvalid({ why: HEARD_CUT_SPOKEN_ONLY }));
  }
  const bound = { alsoAnswers, candidateVerdict, discussFirst, heardTailCut, offered, triageRuling, workspace };
  if (typed) {
    return formTypedDraft({ about, bound, heard, picture, readsAfter, say, turnId, wordsAlone });
  }
  return formSpokenDraft({ about, bound, heard, picture, readsAfter, say, turnId, wordsAlone });
}

/**
 * Form a spoken steer's draft: the voice's reading and the owner's transcribed words, each bounded, or why they cannot stand.
 *
 * @returns the draft, or the first refusal its inputs earn
 */
function formSpokenDraft({
  turnId,
  say,
  heard,
  about,
  readsAfter,
  wordsAlone,
  picture,
  bound,
}: {
  turnId: string;
  say: string;
  heard: string;
  about: string;
  readsAfter: readonly string[];
  wordsAlone: boolean;
  picture: RelayPicture;
  bound: DigestBound;
}): Result<RelayDraft, TalkError> {
  const words = normaliseSay({ say });
  const whole = normaliseSay({ say: heard });
  const refusal = spokenRefusal({ heard: whole, readsAfter, wordsAlone, words });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const fitted = fittedSpokenAsk({ about, bound, picture, readsAfter, turnId, whole, words, wordsAlone });
  if (fitted.isErr()) {
    return err(fitted.error);
  }
  const { ask, quote } = fitted.value;
  // The ask quotes only a tail, so a retry with another head under this turn id would match it: past the quote the
  // digest binds every word as well. A quote carrying every word digests exactly as one did before.
  const wholeHeard = quote.cut === undefined ? undefined : whole;
  return ok({
    about,
    alsoAnswers: [...bound.alsoAnswers],
    anchor: relayAnchor({ turnId }),
    ask,
    digest: draftDigest({ ask, bound, picture, wholeHeard }),
    discussFirst: bound.discussFirst,
    heard: whole,
    heardTailCut: bound.heardTailCut,
    offered: bound.offered,
    picture,
    readsAfter: [...readsAfter],
    slug: relaySlug({ turnId }),
    triageRuling: bound.triageRuling,
    turnId,
    typed: false,
    words,
    wordsAlone,
  });
}

/**
 * A spoken steer's row ask, with the owner's words quoted as much as fits under the board summary's byte cap.
 *
 * @returns the ask and the quote it carries, or the over-cap refusal
 */
function fittedSpokenAsk({
  about,
  bound,
  picture,
  readsAfter,
  turnId,
  whole,
  words,
  wordsAlone,
}: {
  about: string;
  bound: DigestBound;
  picture: RelayPicture;
  readsAfter: readonly string[];
  turnId: string;
  whole: string;
  words: string;
  wordsAlone: boolean;
}): ReturnType<typeof fittedRowQuote> {
  return fittedRowQuote({
    askOf: ({ quote }) =>
      withTriageRuling({
        ask: relayAskText({
          about,
          heard: quote.text,
          heardTailCut: bound.heardTailCut === true,
          picture,
          quoteCut: quote.cut,
          readsAfter,
          words,
          wordsAlone,
        }),
        triageRuling: bound.triageRuling,
        // Spoken only: a typed steer forms its ask in `./relayTypedAsk.ts`, whole by construction.
        held: relayCutHold({ heardTailCut: bound.heardTailCut }) !== undefined,
      }),
    heard: whole,
    turnId,
  });
}

/**
 * Why a spoken steer's normalised words, reads and words-alone flag cannot stand, before any row is composed.
 *
 * @returns the first refusal they earn, or `undefined` when they stand
 */
function spokenRefusal({
  words,
  heard,
  readsAfter,
  wordsAlone,
}: {
  words: string;
  heard: string;
  readsAfter: readonly string[];
  wordsAlone: boolean;
}): TalkError | undefined {
  const aloneRefusal = wordsAloneRefusal({ heard, readsAfter, wordsAlone, words });
  if (aloneRefusal !== undefined) {
    return TalkErrors.wordsAloneInvalid({ why: aloneRefusal });
  }
  const readsRefusal = readsAfterRefusal({ heard, readsAfter, sources: RELAY_READ_SOURCES, words });
  if (readsRefusal !== undefined) {
    return TalkErrors.readsInvalid({ why: readsRefusal });
  }
  const withinLimit = words.length > 0 && words.length <= RELAY_SAY_LIMIT;
  if (readsAfter.length === 0 && !wordsAlone && !withinLimit) {
    return TalkErrors.sayInvalid({ length: words.length, limit: RELAY_SAY_LIMIT });
  }
  return undefined;
}

/**
 * Form a typed steer's draft: the owner's words, kept byte for byte as the composer sent them, and nothing the voice
 * supplied. Only the row's ask reads a normalised copy (`normaliseTyped`), so the turn record never holds words
 * other than the ones first sent on the turn.
 *
 * @returns the draft, or a `TYPED_INVALID` refusal
 */
function formTypedDraft({
  turnId,
  say,
  heard,
  about,
  readsAfter,
  wordsAlone,
  picture,
  bound,
}: {
  turnId: string;
  say: string;
  heard: string;
  about: string;
  readsAfter: readonly string[];
  wordsAlone: boolean;
  picture: RelayPicture;
  bound: DigestBound;
}): Result<RelayDraft, TalkError> {
  if (say !== "" || readsAfter.length > 0 || wordsAlone || bound.alsoAnswers.length > 0) {
    return err(
      TalkErrors.typedInvalid({
        why: "--typed carries the owner's typed words only: it takes no --say, --read-after, --words-alone or --also-answers",
      }),
    );
  }
  const composed = typedAsk({ about, heard, picture, triageRuling: bound.triageRuling });
  if (composed.isErr()) {
    return err(composed.error);
  }
  const ask = composed.value;
  return ok({
    about,
    alsoAnswers: [],
    anchor: `${RELAY_ANCHOR_SCHEME}${turnId}`,
    ask,
    digest: draftDigest({ ask, bound, picture, wholeHeard: undefined }),
    discussFirst: bound.discussFirst,
    heard,
    heardTailCut: false,
    offered: undefined,
    picture,
    readsAfter: [],
    slug: relaySlug({ turnId }),
    triageRuling: bound.triageRuling,
    turnId,
    typed: true,
    words: "",
    wordsAlone: false,
  });
}

/**
 * The board slug one turn owns.
 *
 * @param turnId a v4 UUID this process minted
 * @returns a slug in the `talk-<12 hex>` shape, stable for the life of the turn
 */
export function relaySlug({ turnId }: { turnId: string }): string {
  return `talk-${turnId.replace(/-/gu, "").slice(0, 12)}`;
}

/**
 * The anchor one turn's row carries, the proof a row at {@link relaySlug} is that turn's rather than one sitting on
 * its name.
 *
 * @param turnId a v4 UUID this process minted
 * @returns `talk:<turnId>`
 */
export function relayAnchor({ turnId }: { turnId: string }): string {
  return `${RELAY_ANCHOR_SCHEME}${turnId}`;
}
