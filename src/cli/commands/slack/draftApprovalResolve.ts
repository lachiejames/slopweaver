/**
 * The effectful half of a recording's approval: read the owner's words at `--approved`, read the rows `--supersedes` names, and
 * hand both to the pure rule in `../../../outbound/slack/draftApproval.ts`.
 *
 * Checked before any Slack read, beside the register's own refusals, because a row recorded approved is one the next
 * chair pass SENDS: an anchor that does not resolve to the owner's own whole words parks nothing at all.
 */
import type { RawWords } from "../../../handover/hisWordsResolve.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { inheritedDraftApproval, type RecordedApproval } from "../../../outbound/slack/draftApproval.js";
import { SlackDraftErrors } from "../../../outbound/slack/draftErrors.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { DraftApproval, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { supersedeRefusal } from "../../../outbound/slack/draftSpent.js";
import type { ApprovalRelayAnchor } from "../../../talk/approvalRelayRead.js";
import { parseRelayAnchor } from "../../../talk/relayDraft.js";
import {
  type DraftApprovalAnchorError,
  DraftApprovalAnchorErrors,
  type DraftApprovalCardMismatchError,
} from "./draftApprovalErrors.js";
import {
  draftApprovalAnchorError,
  draftApprovalBindingIds,
  draftApprovalCardIds,
  draftApprovalLaterRelayError,
  draftApprovalRefusalLines,
} from "./draftApprovalGate.js";
import { partialWordsWhy } from "./draftApprovalWhole.js";
import type { DraftRecordOptions } from "./draftCore.js";
import type { SlackDraftDeps } from "./draftRun.js";

/** The verb a recording's refusal names. */
const RECORD_COMMAND = "slopweaver slack draft record";

/** A relay anchor's scheme, ahead of its turn id. */
const RELAY_SCHEME = "talk:";

/** A card landing anchor's scheme, ahead of `<callId>#<segment>`. */
const CALL_SCHEME = "call:";

/**
 * A fresh yes said over the card of a row the recording does not re-cut. It binds only when the composed row carries
 * exactly that row's words — the register's own test of one message (`recordedCutOf`) — which is how a yes landing
 * after its row was dropped is re-recorded. The words exist only once the row is composed, so the check waits for the
 * lock.
 */
interface CardBoundApproval {
  /** The refusal if no named row carries these words. */
  readonly refusal: DraftApprovalCardMismatchError;
  /** The rows the card named. */
  readonly sameMessageAs: readonly string[];
}

/** The approval fields a recording resolved before its Slack reads, and the check a card-bound yes still owes. */
export interface RecordingApproval extends RecordedApproval {
  readonly cardBound?: CardBoundApproval | undefined;
}

/**
 * {@link recordedApproval}, asked only once what the recording refused before any read is clear, so a recording
 * already refused reads neither the owner's words nor the register for its approval.
 *
 * @param refusals what the recording refused before any read (the register check, or the as-me recorder's early checks)
 * @returns the approval fields the row parks with, or the earlier refusals, or the approval's own refusal lines
 */
export function approvalAfterRefusals({
  deps,
  options,
  refusals,
}: {
  deps: Pick<SlackDraftDeps, "readApprovalLaterRelays" | "readOwnerWords" | "readLog">;
  options: DraftRecordOptions;
  refusals: readonly string[];
}): Result<RecordingApproval> {
  if (refusals.length > 0) {
    return err([...refusals]);
  }
  return recordedApproval({ deps, options });
}

/**
 * The approval a recording carries, or every reason it cannot carry the one it claims.
 *
 * @param deps the injected world, for the owner's words and the register
 * @param options the parsed record, naming `--approved`, `--meaning-changed` and `--supersedes`
 * @returns the approval fields the row parks with, or the refusal lines
 */
export function recordedApproval({
  deps,
  options,
}: {
  deps: Pick<SlackDraftDeps, "readApprovalLaterRelays" | "readOwnerWords" | "readLog">;
  options: DraftRecordOptions;
}): Result<RecordingApproval> {
  const named = new Set(options.supersedes);
  let items: readonly SlackDraftItem[] = [];
  if (named.size > 0 || options.approved !== undefined) {
    items = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home: options.home }) }) });
  }
  const fresh = freshApproval({ deps, items, options });
  if (fresh.isErr()) {
    return err(fresh.error);
  }
  const superseded = items.filter((item) => named.has(item.id));
  const { approval, cardBound } = fresh.value;
  return inheritedDraftApproval({ fresh: approval, meaningChanged: options.meaningChanged, superseded })
    .map((carried): RecordingApproval => (cardBound === undefined ? carried : { ...carried, cardBound }))
    .mapErr((error) => [error.message]);
}

/**
 * The approval a recording parks with, re-derived from the register as it stands under the lock. The read before the
 * Slack work may be stale: an approve, a hold or a drop landing on a superseded row meanwhile changes what the re-cut
 * carries, exactly as if it had landed before the recording began.
 *
 * @param approval what the recording resolved before its Slack reads; a fresh `--approved` and a `--meaning-changed`
 *   in it stand, an inherited approval is derived again, and a card-bound yes is checked against the composed words
 * @param digest the composed row's digest, which a card-bound yes must share with a row its card named
 * @param items the register's rows, read under the lock
 * @param supersedes the rows the recording re-cuts
 * @returns the fields the row parks with, or why nothing parks
 */
export function approvalUnderLock({
  approval,
  digest,
  items,
  supersedes,
}: {
  approval: RecordingApproval;
  digest: string;
  items: readonly SlackDraftItem[];
  supersedes: readonly string[];
}): Result<RecordedApproval> {
  const spent = supersedes.map((id) => supersedeRefusal({ id, items })).filter((line) => line !== undefined);
  if (spent.length > 0) {
    return err(spent);
  }
  const bound = approval.cardBound;
  if (
    bound !== undefined &&
    !items.some((item) => bound.sameMessageAs.includes(item.id) && item.draft.digest === digest)
  ) {
    const { about, claimed, expectedDraftIds } = bound.refusal;
    const why = `the owner's yes was said over ${about}, and these are not that row's exact words`;
    const error = DraftApprovalAnchorErrors.cardMismatch({ about, claimed, expectedDraftIds, why });
    return err(draftApprovalRefusalLines({ command: RECORD_COMMAND, error }));
  }
  const named = new Set(supersedes);
  const superseded = items.filter((item) => named.has(item.id));
  const fresh = approval.approval?.inheritedFrom === undefined ? approval.approval : undefined;
  return inheritedDraftApproval({ fresh, meaningChanged: approval.meaningChanged, superseded }).mapErr((error) => [
    error.message,
  ]);
}

/**
 * The owner's words at `--approved`, whole and bound to the rows `--supersedes` names, or why they cannot stand as
 * their yes; nothing when the flag was not passed. The row being recorded has no id until it parks, so the owner cannot have said yes
 * over its card: a yes the record ties to a card binds through a row this one re-cuts, or — said over another row's
 * card — only to that row's exact words, checked under the lock ({@link CardBoundApproval}).
 */
function freshApproval({
  deps,
  items,
  options,
}: {
  deps: Pick<SlackDraftDeps, "readApprovalLaterRelays" | "readOwnerWords">;
  items: readonly SlackDraftItem[];
  options: DraftRecordOptions;
}): Result<{ approval: DraftApproval | undefined; cardBound: CardBoundApproval | undefined }> {
  const anchor = options.approved;
  if (anchor === undefined) {
    return ok({ approval: undefined, cardBound: undefined });
  }
  const claimed = `--approved ${anchor}`;
  const words = wholeWords({ anchor, claimed, deps, home: options.home });
  if (words.isErr()) {
    return err(words.error);
  }
  const { atIso, context, text } = words.value;
  const approval = { anchor, atIso, heard: text };
  const lineage = draftApprovalBindingIds({ items, targetIds: options.supersedes });
  const unbound = draftApprovalAnchorError({ allowedDraftIds: lineage, claimed, context, heard: text });
  const takenBack = () => laterRelayRefusal({ anchor, claimed, deps, home: options.home, words: words.value });
  if (unbound === undefined) {
    const later = takenBack();
    if (later !== undefined) {
      return err(draftApprovalRefusalLines({ command: RECORD_COMMAND, error: later }));
    }
    return ok({ approval, cardBound: undefined });
  }
  const sameMessageAs = draftApprovalCardIds({ context }).filter((id) => !lineage.has(id));
  const viaCard = draftApprovalAnchorError({
    allowedDraftIds: new Set([...lineage, ...sameMessageAs]),
    claimed,
    context,
    heard: text,
  });
  if (viaCard !== undefined) {
    return err(draftApprovalRefusalLines({ command: RECORD_COMMAND, error: viaCard }));
  }
  // The verdict and the affirmative act read no ids, so a refusal the card's rows lift is always the card's.
  if (unbound.code !== "DRAFT_APPROVAL_CARD_MISMATCH") {
    return err(draftApprovalRefusalLines({ command: RECORD_COMMAND, error: unbound }));
  }
  const later = takenBack();
  if (later !== undefined) {
    return err(draftApprovalRefusalLines({ command: RECORD_COMMAND, error: later }));
  }
  return ok({ approval, cardBound: { refusal: unbound, sameMessageAs } });
}

/**
 * The owner's whole words at an anchor, or why they cannot stand as theirs — what `draft pick --anchor` carries. Proves
 * only that the anchor holds the owner's own whole words: a pick is not a yes, so it passes no verdict or card check. A yes goes through
 * {@link resolveBoundDraftApproval}.
 *
 * @param anchor a `talk-call:`, `talk:`, `call:` or `transcript:` anchor
 * @param claimed how the caller's flag spelled it, for the refusal
 * @param deps the injected world, for the owner's words
 * @param home the state home the records live under
 * @returns the words as an approval-shaped record, or the refusal lines
 */
export function resolveDraftApproval({
  anchor,
  claimed,
  deps,
  home,
}: {
  anchor: string;
  claimed: string;
  deps: Pick<SlackDraftDeps, "readOwnerWords">;
  home: string;
}): Result<DraftApproval> {
  return wholeWords({ anchor, claimed, deps, home }).map((words) => ({
    anchor,
    atIso: words.atIso,
    heard: words.text,
  }));
}

/**
 * The owner's whole words at an anchor as their yes to a parked draft, or why they cannot stand as one — what `draft approve`
 * binds. Beyond whole words, the record that holds them must not contradict the yes: a relay's triage verdict must be
 * `send-it`, an unruled relay's or a card landing's words must carry a yes and no take-back, and the card they were
 * said over must be this draft's (`./draftApprovalGate.ts`). Every check reads the same record the words came from.
 * Whether words carrying a yes MEAN yes to this draft stays the caller's judgement.
 *
 * @param allowedDraftIds the draft the yes is recorded on and every cut the register records it re-cut
 * @param anchor a `talk-call:`, `talk:`, `call:` or `transcript:` anchor
 * @param claimed how the caller's flag spelled it, for the refusal
 * @param command the verb recording the yes, as its refusal names it
 * @param deps the injected world, for the owner's words
 * @param home the state home the records live under
 * @returns the approval, or the refusal lines
 */
export function resolveBoundDraftApproval({
  allowedDraftIds,
  anchor,
  claimed,
  command,
  deps,
  home,
}: {
  allowedDraftIds: ReadonlySet<string>;
  anchor: string;
  claimed: string;
  command: string;
  deps: Pick<SlackDraftDeps, "readApprovalLaterRelays" | "readOwnerWords">;
  home: string;
}): Result<DraftApproval> {
  const words = wholeWords({ anchor, claimed, deps, home });
  if (words.isErr()) {
    return err(words.error);
  }
  const refused = draftApprovalAnchorError({
    allowedDraftIds,
    claimed,
    context: words.value.context,
    heard: words.value.text,
  });
  if (refused !== undefined) {
    return err(draftApprovalRefusalLines({ command, error: refused }));
  }
  const takenBack = laterRelayRefusal({ anchor, claimed, deps, home, words: words.value });
  if (takenBack !== undefined) {
    return err(draftApprovalRefusalLines({ command, error: takenBack }));
  }
  return ok({ anchor, atIso: words.value.atIso, heard: words.value.text });
}

/**
 * Why a relay the owner made after the yes stops it binding, or `undefined` when none does — asked only once the anchor's own
 * record has passed (`./draftApprovalGate.ts`). A relay or a card landing is on a call; a `talk-call:` stretch and a
 * `transcript:` turn are the gate's stated residue and read nothing here.
 *
 * @returns the refusal, or `undefined`
 */
function laterRelayRefusal({
  anchor,
  claimed,
  deps,
  home,
  words,
}: {
  anchor: string;
  claimed: string;
  deps: Pick<SlackDraftDeps, "readApprovalLaterRelays">;
  home: string;
  words: RawWords;
}): DraftApprovalAnchorError | undefined {
  const located = approvalRelayAnchor({ anchor, claimed, words });
  if (located.isErr()) {
    return located.error;
  }
  const target = located.value;
  if (target === undefined) {
    return undefined;
  }
  const later = deps.readApprovalLaterRelays({ anchor: target, home });
  if (later.isErr()) {
    return DraftApprovalAnchorErrors.callUnreadable({ claimed, why: later.error.message });
  }
  return draftApprovalLaterRelayError({ anchorCard: target.card, claimed, laterRelays: later.value });
}

/** The call position a yes was said at, `undefined` for a record on no call, or why the anchor names none. */
function approvalRelayAnchor({
  anchor,
  claimed,
  words,
}: {
  anchor: string;
  claimed: string;
  words: RawWords;
}): Result<ApprovalRelayAnchor | undefined, DraftApprovalAnchorError> {
  const { context } = words;
  if (context.kind === "relay") {
    const canonical = parseRelayAnchor({ text: anchor });
    if (canonical === undefined) {
      return err(DraftApprovalAnchorErrors.callUnreadable({ claimed, why: `${anchor} does not name a relay turn` }));
    }
    const turnId = canonical.slice(RELAY_SCHEME.length);
    return ok({ anchor: canonical, card: context.about, kind: "relay", stagedAtIso: words.atIso, turnId });
  }
  if (context.kind === "card-landing") {
    const hash = anchor.indexOf("#");
    if (!anchor.startsWith(CALL_SCHEME) || hash === -1) {
      const why = `${anchor} does not name one stretch of a call`;
      return err(DraftApprovalAnchorErrors.callUnreadable({ claimed, why }));
    }
    const callId = anchor.slice(CALL_SCHEME.length, hash);
    const segmentId = anchor.slice(hash + 1);
    return ok({ anchor, callId, card: context.cardKey, kind: "card-landing", segmentId });
  }
  return ok(undefined);
}

/** The owner's whole, dated words at an anchor, or why the record cannot stand as them (`./draftApprovalWhole.ts`). */
function wholeWords({
  anchor,
  claimed,
  deps,
  home,
}: {
  anchor: string;
  claimed: string;
  deps: Pick<SlackDraftDeps, "readOwnerWords">;
  home: string;
}): Result<RawWords> {
  const words = deps.readOwnerWords({ anchor, home });
  if (words.isErr()) {
    return err([SlackDraftErrors.approvalInvalid({ claimed, why: words.error.message }).message]);
  }
  const why = partialWordsWhy({ words: words.value });
  if (why !== undefined) {
    return err([SlackDraftErrors.approvalInvalid({ claimed, why }).message]);
  }
  return ok(words.value);
}
