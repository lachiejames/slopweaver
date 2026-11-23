/**
 * Whether an OWNER hold on an automation carries the owner's words naming that automation — derived for the audited
 * view, never stored.
 *
 * An approved automation is exempt from a later general steer unless the owner names it, and a hold on an automation
 * must carry the owner's words naming that automation. MEASURED: a top-up automation was held on a reason reading
 * "owner … chose 'Hold, discussion first'" when the autonomy ledger shows the supervisor chair pressed that option
 * itself — and lifting a hold needed an anchored word while placing one needed only free text, so nothing could tell
 * the two apart.
 *
 * So the asymmetry is closed on the READ side. A standing owner hold is `anchored` only when its `placedBy` anchor
 * resolves to the owner's record (`../../handover/hisWordsResolve.ts`, the one reader of all four schemes), the
 * stored words are in that record, and those words contain one of the row's names. Anything else is `unanchored` or `unresolved`,
 * and `automation due` prints it as UNOWNED. The hold STANDS in every state: this changes what is reported, never
 * what is scheduled.
 */
import type { Result } from "#lib/result.js";

import type { HisWordsError } from "../../handover/hisWordsErrors.js";
import { anchorParses, type RawWords } from "../../handover/hisWordsResolve.js";
import type { RecipeDefinition, RecipeHold, RecipeHoldPlacedBy } from "./definition.js";

/**
 * What the audited view says about who placed a standing owner hold.
 *
 * - `anchored` — the owner's resolvable words, in the record, naming this automation.
 * - `unanchored` — the hold carries no `placedBy` at all.
 * - `unresolved` — it carries one, and `reason` says which check it failed.
 */
export type OwnerHoldPlacedByState =
  | { readonly kind: "anchored" }
  | { readonly kind: "unanchored" }
  | { readonly kind: "unresolved"; readonly reason: string };

/** The record an anchor names, read — or why it could not be. */
export type OwnerWordsReading =
  { readonly kind: "resolved"; readonly text: string } | { readonly kind: "unresolved"; readonly reason: string };

/** The effectful edge: read the owner's record at one anchor. Injected, so the classifier is tested over plain values. */
export type ResolveOwnerWords = (options: { readonly anchor: string }) => Result<RawWords, HisWordsError>;

/**
 * Whitespace runs collapsed and case folded, so a quote matches its record however either was wrapped. Lowercasing a
 * capital sigma depends on what follows it (final `ς` against medial `σ`), so a quote ending where its record runs on
 * would fold apart from it; both forms fold to `σ`, the one context-sensitive lowercasing outside Lithuanian, Turkish
 * and Azeri locales.
 */
function normalised({ text }: { text: string }): string {
  return text
    .replaceAll(/\p{White_Space}+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-AU")
    .replaceAll("ς", "σ");
}

/**
 * A name character ending the text before an occurrence, and one opening the text after it: "row-a" inside
 * "row-alpha" is not "row-a". Tested on the whole slice under the `u` flag, never on one `charAt`,
 * so a letter outside the Basic Multilingual Plane is read as the letter it is, not a lone surrogate.
 * Every letter, combining mark, digit, connector and DASH continues a name, not only ASCII `-` and `_`:
 * a wrongly refused match reads UNOWNED, the safe side, where a wrongly taken one reads as the owner's pause.
 */
const NAME_CHARACTER_BEFORE = /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}]$/u;
const NAME_CHARACTER_AFTER = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}]/u;

/**
 * Whether `words` carry `name` as a WHOLE name — some occurrence with no name character either side of it.
 */
function namesWhole({ words, name }: { words: string; name: string }): boolean {
  for (let at = words.indexOf(name); at >= 0; at = words.indexOf(name, at + 1)) {
    const before = words.slice(0, at);
    const after = words.slice(at + name.length);
    if (!NAME_CHARACTER_BEFORE.test(before) && !NAME_CHARACTER_AFTER.test(after)) {
      return true;
    }
  }
  return false;
}

/**
 * Judge one owner hold's `placedBy` against the record its anchor names and the row's names.
 *
 * Literal matching, deliberately: a similarity test would let "lead with the discussion" pass as naming the security
 * automation, which is the incident this exists for. A name counts only WHOLE, never inside a longer one.
 *
 * @param names every name the row answers to — its recipeId first, then any declared alias
 * @param placedBy the hold's stored attribution, or `undefined` when it carries none
 * @param reading the record its anchor names, or `undefined` when there is no anchor to read
 * @returns the state the audited view reports
 */
export function classifyOwnerHoldPlacedBy({
  names,
  placedBy,
  reading,
}: {
  readonly names: readonly string[];
  readonly placedBy: RecipeHoldPlacedBy | undefined;
  readonly reading: OwnerWordsReading | undefined;
}): OwnerHoldPlacedByState {
  if (placedBy === undefined) {
    return { kind: "unanchored" };
  }
  if (reading === undefined) {
    return { kind: "unresolved", reason: `the anchor ${placedBy.anchor} was not read` };
  }
  if (reading.kind === "unresolved") {
    return { kind: "unresolved", reason: reading.reason };
  }
  const words = normalised({ text: placedBy.words });
  if (!normalised({ text: reading.text }).includes(words)) {
    return { kind: "unresolved", reason: `the words on the hold are not in the owner's record at ${placedBy.anchor}` };
  }
  const accepted = names.map((name) => normalised({ text: name })).filter((name) => name.length > 0);
  if (!accepted.some((name) => namesWhole({ name, words }))) {
    return {
      kind: "unresolved",
      reason: `the owner's words on the hold name none of this automation's names (${names.join(", ")})`,
    };
  }
  return { kind: "anchored" };
}

/**
 * What the audit judged, keyed by the frozen `placedBy` it minted, with the names it judged against. Module-private
 * and never on the row, so no caller can hand a reader a state: a row built carrying `anchored` would make the
 * card say "paused on your word". A spread copy of the hold keeps the same `placedBy`
 * reference, so the judgement follows the row through every copy and attaches to nothing else.
 */
const AUDITED = new WeakMap<RecipeHoldPlacedBy, { readonly names: string; readonly state: OwnerHoldPlacedByState }>();

/**
 * Every `anchored` state the audit minted, with the recipeId it was minted for. A state is a plain value a caller
 * can spell or carry elsewhere, so a reader deciding whether the owner chose a hold asks {@link ownerHoldIsOwners} with
 * the row it is reading, never `kind`: a spelled `anchored` would read "You paused it." back on the card, and a
 * minted one moved onto another row's line would do the same.
 */
const MINTED = new WeakMap<OwnerHoldPlacedByState, string>();

/**
 * Whether a hold's state says the owner chose it: `anchored`, minted by the audit that read their words, for THIS row.
 *
 * @param state the state a reader carries, wherever it came from
 * @param recipeId the row the reader is describing — its own, never one the state carries
 * @returns true only for a state the audit minted for this recipeId
 */
export function ownerHoldIsOwners({
  recipeId,
  state,
}: {
  readonly recipeId: string;
  readonly state: OwnerHoldPlacedByState;
}): boolean {
  return state.kind === "anchored" && MINTED.get(state) === recipeId;
}

/** A fresh `anchored` state, registered as minted for one row. */
function mintedAnchored({ recipeId }: { readonly recipeId: string }): OwnerHoldPlacedByState {
  const state: OwnerHoldPlacedByState = Object.freeze({ kind: "anchored" });
  MINTED.set(state, recipeId);
  return state;
}

/**
 * The names a judgement was made against, as one comparable key. Serialised as a JSON array, never joined on a
 * separator a name may itself carry: `["alpha", "beta"]` and `["alpha\nbeta"]` must not share a key.
 */
function namesKey({ definition }: { readonly definition: RecipeDefinition }): string {
  return JSON.stringify(automationNamesOf({ definition }));
}

/**
 * A standing owner hold's state as a reader takes it. `unanchored` with no `placedBy`. Otherwise only what the
 * audited view judged THIS `placedBy` to be, for THIS row's names: a `placedBy` no audit read — hand-built, parsed in
 * the lifted view, or moved here from another automation's hold — is `unresolved`, never `anchored`.
 *
 * @param definition the row whose hold is a standing owner hold
 * @returns its state
 */
export function ownerHoldPlacedByStateOf({
  definition,
}: {
  readonly definition: RecipeDefinition & { readonly hold: RecipeHold };
}): OwnerHoldPlacedByState {
  const { placedBy } = definition.hold;
  if (placedBy === undefined) {
    return { kind: "unanchored" };
  }
  const judged = AUDITED.get(placedBy);
  if (judged === undefined) {
    return { kind: "unresolved", reason: "this view did not read the hold's anchor" };
  }
  if (judged.names !== namesKey({ definition })) {
    return { kind: "unresolved", reason: "the hold's words were read for another automation" };
  }
  return judged.state;
}

/**
 * Every name a row answers to: its recipeId, always, then the aliases its definition declares.
 *
 * @param definition the row
 * @returns the names, recipeId first
 */
function automationNamesOf({ definition }: { readonly definition: RecipeDefinition }): readonly string[] {
  if (definition.names === undefined) {
    return [definition.recipeId];
  }
  return [definition.recipeId, ...definition.names];
}

/**
 * Why a record may hold fewer words than were said, or `undefined` when it is known whole. A record cut at either end
 * (a stretch the call never finished, one at the call file's cap, a relay that lost its start), or one written before
 * it recorded whether it was cut, may have lost the words that take the hold back, so it never reads as the owner's
 * pause: the refusal reads UNOWNED, the safe side.
 *
 * @param anchor the anchor the record was read at, named in the reason
 * @param raw the record as read
 * @returns the reason, or `undefined` when the record is whole
 */
function cutReason({ anchor, raw }: { anchor: string; raw: RawWords }): string | undefined {
  if (raw.tailLost) {
    return `the owner's words at ${anchor} were cut before they finished`;
  }
  if (raw.headLost) {
    return `the owner's words at ${anchor} lost their start`;
  }
  if (!raw.headKnown || !raw.tailKnown) {
    return `the record at ${anchor} predates saying whether its words were cut`;
  }
  return undefined;
}

/**
 * The row with its standing owner hold audited, or unchanged when it has none: its `placedBy` replaced by a frozen
 * copy that {@link ownerHoldPlacedByStateOf} answers for.
 *
 * Only a standing OWNER hold is audited: a failure hold names a board finding, and a cleared hold holds nothing. An
 * absent `placedBy` and an anchor its scheme's parser refuses are both judged without reading anything.
 *
 * @param definition the row, in the lifted view
 * @param resolveOwnerWords reads the owner's record at one anchor
 * @returns the row, its hold's `placedBy` now one the audit judged
 */
export function withOwnerHoldPlacedByState({
  definition,
  resolveOwnerWords,
}: {
  readonly definition: RecipeDefinition;
  readonly resolveOwnerWords: ResolveOwnerWords;
}): RecipeDefinition {
  const { hold } = definition;
  if (hold === undefined || hold.finding !== undefined || hold.clearedBy !== null || hold.placedBy === undefined) {
    return definition;
  }
  const names = automationNamesOf({ definition });
  const placedBy: RecipeHoldPlacedBy = Object.freeze({ anchor: hold.placedBy.anchor, words: hold.placedBy.words });
  let reading: OwnerWordsReading | undefined;
  if (anchorParses({ anchor: placedBy.anchor })) {
    reading = resolveOwnerWords({ anchor: placedBy.anchor }).match(
      (raw): OwnerWordsReading => {
        const cut = cutReason({ anchor: placedBy.anchor, raw });
        return cut === undefined ? { kind: "resolved", text: raw.text } : { kind: "unresolved", reason: cut };
      },
      (error): OwnerWordsReading => ({ kind: "unresolved", reason: error.message }),
    );
  } else {
    reading = { kind: "unresolved", reason: `the anchor ${placedBy.anchor} is not one the owner-words reader parses` };
  }
  const judged = classifyOwnerHoldPlacedBy({ names, placedBy, reading });
  let state = judged;
  if (judged.kind === "anchored") {
    state = mintedAnchored({ recipeId: definition.recipeId });
  }
  AUDITED.set(placedBy, { names: namesKey({ definition }), state });
  return { ...definition, hold: { ...hold, placedBy } };
}
