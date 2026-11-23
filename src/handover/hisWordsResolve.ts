/**
 * Read the owner's words off the record an anchor names — the one effectful half of `./hisWords.ts`.
 *
 * Four schemes, each read by the module that already owns its record, never by a second parser of the same file:
 *
 * - `talk:<turnId>` — the relay turn (`../talk/relayStore.ts`). Its `heard` is the owner's transcribed or typed words; its
 *   `words` is the VOICE's paraphrase and is never quoted. The instant is `stagedAtIso`, when the relay was made —
 *   the turn records no instant for the words themselves, so the card says relayed, never said.
 * - `call:<callId>#<segment>` — an utterance landed on a card (`../talk/cardLanding.ts`): the ledger row whose
 *   anchor, or one of whose later anchors, is this one. The latest such row wins, as the queue reads it, and the call
 *   file says whether its words are now cut (`./hisWordsLanded.ts`).
 * - `talk-call:<callId>#<segmentId>` — one stretch of a call file (`../talk/callRecord.ts`), which must be the
 *   OWNER's: their speaker, begun on their console or an unstamped one (`../talk/callOrigin.ts`).
 * - `transcript:<sessionId>#<turnUuid>` — a turn the owner typed into a Claude session
 *   (`../supervisor/chairTranscript.ts`). A turn the console typed into the chair — a relay's delivery or a quiet
 *   batch — is never the owner's words, and is refused.
 */
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { isConsoleTypedLine } from "../profile/ownerWords.js";
import { findOwnerTurn } from "../supervisor/chairTranscript.js";
import { cutUnknownWhy } from "../talk/callLines.js";
import { originPhrase, segmentForeignOrigin } from "../talk/callOrigin.js";
import { foldCall, OWNER_SPEAKER } from "../talk/callRecord.js";
import { readCallEntriesCounted } from "../talk/callStore.js";
import { callSegmentAnchor } from "../talk/cardUtterance.js";
import { callShowsLandingCut, stretchRunCut } from "../talk/landingCut.js";
import { parseRelayAnchor, relayAnchor, relaySlug } from "../talk/relayDraft.js";
import { relayLineHeadSlug } from "../talk/relayLine.js";
import { readTurn } from "../talk/relayStore.js";
import type { TriageRuling } from "../talk/triageVocabulary.js";
import { turnIdsOnDisk } from "../talk/turnFiles.js";
import { parseCallPointer } from "../talk/unreadWords.js";
import { formatTurnPointer, parseTurnPointer } from "../transcripts/pointer.js";
import { type HisWords, type HisWordsWhere, hisWordsExcerpt, ownerWordsSchemeOf } from "./hisWords.js";
import { type HisWordsError, HisWordsErrors } from "./hisWordsErrors.js";
import { CALL_SEGMENT_ANCHOR, landedWords } from "./hisWordsLanded.js";

/** A record's raw text and instant, before it is cut to an excerpt — what `profile words <anchor>` prints whole. */
export interface RawWords {
  readonly text: string;
  readonly atIso: string;
  readonly where: HisWordsWhere;
  /** The record says it kept only the end of what the owner said. */
  readonly headLost: boolean;
  /** Whether the record says either way — a relay written before it stored that does not, and is never read as whole. */
  readonly headKnown: boolean;
  /**
   * The record holds fewer words than the owner said at their end: the reader cut the text at an unclosed wrapper, a
   * call stretch never finished or hit the cap, a relay was made while the stretch was still open, or a card landing
   * carries words the call no longer holds whole.
   */
  readonly tailLost: boolean;
  /**
   * Whether the record says either way about its end — a voice relay, or a card landing, written before it stored that
   * does not, and is never read as whole.
   */
  readonly tailKnown: boolean;
  /** What the same record says the owner's words were ABOUT — the card and verdict an approval is bound by. */
  readonly context: RawWordsContext;
}

/**
 * What the record holding the owner's words says they were about, read off the very record that supplied them, so words and
 * binding can never come from two versions of one file. `slack draft approve` reads it to refuse a yes whose relay
 * ruled otherwise or named another card (`../cli/commands/slack/draftApprovalGate.ts`).
 */
export type RawWordsContext =
  | {
      readonly kind: "relay";
      /** The console card the owner was looking at, or empty for none. */
      readonly about: string;
      /** The owner's triage ruling; `null` the relay carried none, `undefined` the record predates storing it. */
      readonly triageRuling: TriageRuling | null | undefined;
    }
  | {
      readonly kind: "card-landing";
      readonly cardKey: string;
      /** The draft ids an ask or hand card named as the owner's words landed, when the landing kept them. */
      readonly draftIds: readonly string[] | undefined;
      /** Why the card would not read as the owner's words landed, so which drafts it named is unknown. */
      readonly draftIdsUnread: string | undefined;
    }
  | {
      readonly kind: "call-segment";
      /** The console card open when the stretch began, or `undefined` for none or a call that predates recording it. */
      readonly open: string | undefined;
    }
  | { readonly kind: "transcript" };

/**
 * The owner's words at an anchor, as a row stores them.
 *
 * @param home the Slopweaver home the talk records live under
 * @param projectsDir `~/.claude/projects`, where a transcript anchor's session lives
 * @param anchor the row's `anchor:`
 * @returns the words, or why they could not be read
 */
export function resolveHisWords({
  home,
  projectsDir,
  anchor,
}: {
  home: string;
  projectsDir: string;
  anchor: string;
}): Result<HisWords, HisWordsError> {
  return resolveRawWords({ anchor, home, projectsDir }).andThen((raw) => hisWordsFromRaw({ anchor, raw }));
}

/**
 * The owner's words as a row stores them, drawn from a record already read — so a caller that also judges that record (`handover
 * quote --anchor`) quotes the very read it judged.
 *
 * @param anchor the anchor the record was read at
 * @param raw the record's whole text and what it says about itself
 * @returns the words, or why they cannot be quoted
 */
export function hisWordsFromRaw({ anchor, raw }: { anchor: string; raw: RawWords }): Result<HisWords, HisWordsError> {
  const excerpt = hisWordsExcerpt({ headLost: raw.headLost, text: raw.text });
  if (excerpt === undefined) {
    return err(HisWordsErrors.wordsEmpty({ anchor }));
  }
  // One spelling for every record's instant, so a stored group compares equal to a fresh read of the same record.
  const at = Date.parse(raw.atIso);
  if (Number.isNaN(at)) {
    return err(HisWordsErrors.recordUnreadable({ anchor, why: "the record carries no instant" }));
  }
  const atIso = new Date(at).toISOString();
  // A quote the reader cut short is marked where it is short, never drawn as complete.
  let cut = excerpt.cut;
  if (raw.tailLost && cut === "none") {
    cut = "end";
  }
  return ok({ anchor, cut, atIso, where: raw.where, words: excerpt.words });
}

/**
 * The record's whole text at an anchor, dispatched by scheme — never cut to the excerpt a board row stores.
 *
 * @param home the Slopweaver home the talk records live under
 * @param projectsDir `~/.claude/projects`, where a transcript anchor's session lives
 * @param anchor a talk, call, talk-call or transcript anchor
 * @returns the text as the record holds it, with whether the record itself lost its head or tail, or why not
 */
export function resolveRawWords({
  home,
  projectsDir,
  anchor,
}: {
  home: string;
  projectsDir: string;
  anchor: string;
}): Result<RawWords, HisWordsError> {
  const scheme = ownerWordsSchemeOf({ anchor });
  if (scheme === "talk") {
    return relayWords({ anchor, home });
  }
  if (scheme === "call") {
    return landedWords({ anchor, home });
  }
  if (scheme === "talk-call") {
    return segmentWords({ anchor, home });
  }
  if (scheme === "transcript") {
    return sessionWords({ anchor, home, projectsDir });
  }
  return err(HisWordsErrors.notOwnerScheme({ anchor }));
}

/**
 * Whether an anchor is one its scheme's own parser here takes — the exact parser {@link resolveRawWords} reads it
 * with. A lister asks before printing one, so no anchor it prints is refused as malformed when read again; a record
 * accepted by a looser writer-side check (a uuid outside the pointer grammar, a segment id holding `#`) would
 * otherwise list under an anchor nothing reads. It must parse to ITSELF: a parser that canonicalises
 * (lower-cases an id) would reopen a different file than the one the record came from.
 *
 * @param anchor a talk, call, talk-call or transcript anchor
 * @returns true when the resolver would parse it, unchanged
 */
export function anchorParses({ anchor }: { anchor: string }): boolean {
  const scheme = ownerWordsSchemeOf({ anchor });
  if (scheme === "talk") {
    return parseRelayAnchor({ text: anchor }) === anchor;
  }
  if (scheme === "call") {
    return CALL_SEGMENT_ANCHOR.test(anchor);
  }
  if (scheme === "talk-call") {
    return parseCallPointer({ text: anchor }) === anchor;
  }
  if (scheme === "transcript") {
    const pointer = parseTurnPointer({ text: anchor });
    return pointer !== undefined && formatTurnPointer({ pointer }) === anchor;
  }
  return false;
}

/** A relay turn's `heard`: what the owner said or typed, never the voice's paraphrase of it. */
function relayWords({ home, anchor }: { home: string; anchor: string }): Result<RawWords, HisWordsError> {
  const canonical = parseRelayAnchor({ text: anchor });
  if (canonical === undefined) {
    return err(HisWordsErrors.anchorMalformed({ anchor }));
  }
  const turn = readTurn({ home, turnId: canonical.slice("talk:".length) });
  if (turn.isErr()) {
    // No turn file is an absence every run will find again, not a read that may pass next time.
    if (turn.error.code === "PATH_UNREADABLE" && isAbsentError({ error: turn.error.cause, path: turn.error.path })) {
      return err(HisWordsErrors.recordMissing({ anchor, what: "no relay turn file carries it" }));
    }
    return err(HisWordsErrors.recordUnreadable({ anchor, why: turn.error.message }));
  }
  const where = turn.value.typed ? "console-typed" : "console-voice";
  // Only a record that SAYS it kept the tail is marked; an older one that never stored it is not guessed at.
  const headLost = turn.value.heardTruncated === true;
  const headKnown = turn.value.heardTruncated !== undefined;
  // A relay made while a call stretch was still open carries words that end mid-sentence. A
  // typed steer is whole by construction; a voice relay written before the record said either way stays unknown.
  const tailLost = turn.value.heardTailCut === true;
  const tailKnown = turn.value.typed || turn.value.heardTailCut !== undefined;
  const context: RawWordsContext = {
    about: turn.value.about,
    kind: "relay",
    triageRuling: turn.value.triageRuling,
  };
  return ok({
    atIso: turn.value.stagedAtIso,
    context,
    headKnown,
    headLost,
    tailKnown,
    tailLost,
    text: turn.value.heard,
    where,
  });
}

/**
 * One stretch of a call, which must be the owner's. A torn line could hold a missing stretch, or the `open` stamping
 * the console a line of it was recorded on, so a call with one is unreadable whether or not the stretch was found.
 */
function segmentWords({ home, anchor }: { home: string; anchor: string }): Result<RawWords, HisWordsError> {
  const canonical = parseCallPointer({ text: anchor });
  if (canonical === undefined) {
    return err(HisWordsErrors.anchorMalformed({ anchor }));
  }
  const body = canonical.slice("talk-call:".length);
  const hash = body.indexOf("#");
  const callId = body.slice(0, hash);
  const segmentId = body.slice(hash + 1);
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    return err(HisWordsErrors.recordUnreadable({ anchor, why: read.error.message }));
  }
  const call = foldCall({ callId, entries: read.value.entries, skipped: read.value.skipped });
  const segment = call?.segments.find((one) => one.id === segmentId);
  if (read.value.skipped > 0) {
    const why = `${String(read.value.skipped)} line(s) of the call do not parse, so whose console recorded it is unknown`;
    return err(HisWordsErrors.recordUnreadable({ anchor, why }));
  }
  const unknownCut = cutUnknownWhy({ read: read.value });
  if (unknownCut !== undefined) {
    return err(HisWordsErrors.recordUnreadable({ anchor, why: unknownCut }));
  }
  if (segment === undefined) {
    return err(HisWordsErrors.recordMissing({ anchor, what: "the call holds no such segment" }));
  }
  if (segment.who !== OWNER_SPEAKER) {
    return err(HisWordsErrors.segmentNotOwner({ anchor }));
  }
  // The owner's speaker from a console that is not theirs is a seat's test speech, never the owner's
  // (`../talk/callOrigin.ts`).
  const foreign = segmentForeignOrigin({ entries: read.value.entries, segmentId });
  if (foreign !== undefined) {
    return err(HisWordsErrors.segmentForeign({ anchor, origin: originPhrase({ origin: foreign }) }));
  }
  // A stretch the call dropped mid-speech is not final, and the call file caps one at CALL_TEXT_CHARS — either holds
  // less than the owner said, exactly as the list marks it. So does a later stretch of the owner's run, card open or
  // not, and a card utterance the call file shows cut, which may join a stretch in ahead of it.
  const tailLost =
    stretchRunCut({ entries: read.value.entries, segmentId, segments: call!.segments }) ||
    callShowsLandingCut({
      anchors: [callSegmentAnchor({ callId, segmentId })],
      callId,
      entries: read.value.entries,
    });
  return ok({
    atIso: segment.atIso,
    context: { kind: "call-segment", open: segment.open },
    headKnown: true,
    headLost: false,
    tailKnown: true,
    tailLost,
    text: segment.text,
    where: "call",
  });
}

/**
 * The refusal for a chair turn the console typed, naming the exact `talk:<turn>` anchor to re-anchor on when the
 * line's head names a slug exactly one turn file on disk carries, and that file is lowercase and reads — so an old row
 * is repairable without a search through `profile words`' recent window. Uniqueness is judged
 * off the directory listing, so it costs one `readdir` and one read rather than a parse of every relay. The slug is
 * twelve hex of the turn id, so it only ever SUGGESTS: two files sharing it, or none, leave the slug named alone.
 */
function consoleLineRefusal({
  anchor,
  home,
  text,
}: {
  anchor: string;
  home: string;
  text: string;
}): Result<RawWords, HisWordsError> {
  const slug = relayLineHeadSlug({ text });
  if (slug === undefined) {
    return err(HisWordsErrors.turnConsoleLine({ anchor, relay: undefined }));
  }
  const ids = turnIdsOnDisk({ home });
  // The lookup only enriches the route: the turn is already proven the console's, so a directory that will not list
  // drops the suggestion and says why, and never turns the refusal into a transient unreadable record.
  if (ids.isErr()) {
    return err(
      HisWordsErrors.turnConsoleLine({ anchor, relay: { slug, talkAnchor: undefined, unlisted: ids.error.message } }),
    );
  }
  // Every ENTRY named like a turn file counts toward uniqueness — readable or not, either case, a directory too — so an
  // exact anchor is never named beside a second entry that might carry the same slug. Conservative on purpose: an
  // ambiguous slug costs only the suggestion, and the route then says the slug picks out no one readable turn.
  const named = ids.value.filter((id) => relaySlug({ turnId: id.toLowerCase() }) === slug);
  const only = named.length === 1 ? named[0]! : undefined;
  let relayTalkAnchor: string | undefined;
  // `talk:<id>` reopens `<id>.json` exactly, and the anchor parser normalises to lowercase and wants a v4 id — so only
  // a name the parser hands back unchanged, and whose file reads, is an anchor that resolves.
  const candidate = only === undefined ? undefined : relayAnchor({ turnId: only });
  const resolves = candidate !== undefined && parseRelayAnchor({ text: candidate }) === candidate;
  if (resolves && readTurn({ home, turnId: only! }).isOk()) {
    relayTalkAnchor = candidate;
  }
  return err(
    HisWordsErrors.turnConsoleLine({ anchor, relay: { slug, talkAnchor: relayTalkAnchor, unlisted: undefined } }),
  );
}

/**
 * The turn the owner typed into a Claude session. A turn the console typed into the chair is refused, never quoted: a
 * relay's delivery wraps the owner's words in the console's own instructions, and `../profile/ownerWords.ts` leaves
 * the same lines out of a list. It is not read through to the relay either — the row would then name a transcript turn
 * while quoting another record's words, instant and context, and the delivery names its relay by a twelve-hex slug
 * alone, which is no durable key to it. The row is re-anchored on the relay itself (`talk:<turn>`) instead.
 */
function sessionWords({
  home,
  projectsDir,
  anchor,
}: {
  home: string;
  projectsDir: string;
  anchor: string;
}): Result<RawWords, HisWordsError> {
  const pointer = parseTurnPointer({ text: anchor });
  if (pointer === undefined) {
    return err(HisWordsErrors.anchorMalformed({ anchor }));
  }
  const turn = findOwnerTurn({ pointer, projectsDir });
  if (turn.isErr() && turn.error.code === "TURN_NOT_FOUND") {
    return err(HisWordsErrors.recordMissing({ anchor, what: turn.error.message }));
  }
  if (turn.isErr()) {
    return err(HisWordsErrors.recordUnreadable({ anchor, why: turn.error.message }));
  }
  // The console typed this line, so how the transcript says it arrived is the console's provenance, not the owner's: it is
  // judged before the checks below, which read a turn as the owner's.
  if (isConsoleTypedLine({ text: turn.value.text })) {
    return consoleLineRefusal({ anchor, home, text: turn.value.text });
  }
  // The record says Claude Code wrote this prompt and the owner only accepted it.
  if (turn.value.source === "suggestion-accepted") {
    return err(HisWordsErrors.turnNotTyped({ anchor }));
  }
  // A quote on a card carries the owner's authority, so a record that does not SAY the owner typed or queued it is not
  // read as theirs — the extractor's fail-open `unknown` is right for an inspector, not for a quote.
  if (turn.value.source === "unknown") {
    return err(HisWordsErrors.turnUnproven({ anchor }));
  }
  // The reader joined the owner's words across a span it cut, so the text is not the record's.
  if (turn.value.spliced === true) {
    return err(HisWordsErrors.turnSpliced({ anchor }));
  }
  const tailLost = turn.value.tailCut === true;
  const text = turn.value.text;
  return ok({
    atIso: turn.value.timestamp,
    context: { kind: "transcript" },
    headKnown: true,
    headLost: false,
    tailKnown: true,
    tailLost,
    text,
    where: "session",
  });
}
