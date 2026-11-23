/**
 * Reading a register line about a Codex comparison — a `compared` or `picked` event, and the two fields a park carries
 * — into what this version can vouch for. Split from `./draftLog.ts` and `./draftParkedLine.ts` along the feature seam
 * (`./draftComparison.ts`). Pure.
 *
 * A line this version cannot read is passed over and HIDES its row (`./draftLog.ts` `foldSlackDraftLog`), so an older
 * seat reading a register a newer one wrote fails closed: it never draws a row whose pick it cannot see as sendable.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { carriesWords } from "./carriesWords.js";
import {
  COMPARISON_SKIP_REASONS,
  type ComparisonOutcome,
  DRAFT_COMPOSERS,
  DRAFT_VARIANTS,
  type DraftPickVoice,
  type SlackDraftCandidate,
} from "./draftComparison.js";
import { SLACK_DRAFT_SCHEMA_VERSION, type SlackDraftEvent } from "./draftRegister.js";
import { REVIEWER_CONTEXTS } from "./reviewAskShape.js";
import { richTextBlockValid } from "./richTextShape.js";

/**
 * Whether a park's `composer`, `comparison` and `reviewer` are absent or a value this version knows. An unknown
 * comparison state is a later vocabulary whose gate this build cannot apply, so the park does not read.
 *
 * @param value the line's `draft` record
 * @returns true when all three fields are absent or well-formed
 */
export function parkedComparisonValid({ value }: { value: Record<string, unknown> }): boolean {
  const { composer, comparison, reviewer } = value;
  const composerKnown = composer === undefined || DRAFT_COMPOSERS.some((known) => known === composer);
  const reviewerKnown = reviewer === undefined || REVIEWER_CONTEXTS.some((known) => known === reviewer);
  if (!composerKnown || !reviewerKnown) {
    return false;
  }
  if (comparison === undefined) {
    return true;
  }
  // A bot row never owes a comparison at park, so one carrying it is hand-written, and its release path has no re-read
  // a retried pass could land against.
  if (!isRecord(comparison) || value["actor"] === "bot") {
    return false;
  }
  // The comparison is exactly the one the park derives from the row (`./draftComparison.ts` `comparisonAtPark`): a
  // pending row with a yes on it would owe a pick no verb can make, and a skip whose
  // reason the row does not carry frees A from a pick it owes.
  const owed = skipReasonOf({ value });
  if (comparison["state"] === "pending") {
    return Object.keys(comparison).length === 1 && owed === undefined;
  }
  // A skipped comparison is a closed shape too: a field beside its reason is a meaning this version would drop while
  // freeing A.
  const reason = comparison["reason"];
  const closed = onlyKeys({ bag: comparison, keys: SKIPPED_KEYS });
  const known = COMPARISON_SKIP_REASONS.some((skip) => skip === reason);
  return closed && comparison["state"] === "skipped" && known && reason === owed;
}

/** The skip reason a park derives from its row, in `comparisonAtPark`'s order, or `undefined` when it owes a pass. */
function skipReasonOf({ value }: { value: Record<string, unknown> }): string | undefined {
  const media = value["media"];
  if (value["approval"] !== undefined) {
    return "approved-at-record";
  }
  if (Array.isArray(media) && media.length > 0) {
    return "has-media";
  }
  if (value["composer"] === "codex") {
    return "composed-by-codex";
  }
  return undefined;
}

/**
 * A `compared` or `picked` line into its event, or `undefined` when it is neither or a field is the wrong shape.
 *
 * @param value the parsed line
 * @param id the row it names
 * @param tsIso when it was journalled
 * @returns the event, or `undefined`
 */
export function comparisonEventOf({
  value,
  id,
  tsIso,
}: {
  value: Record<string, unknown>;
  id: string;
  tsIso: string;
}): SlackDraftEvent | undefined {
  if (parseStrictIsoInstantMs({ text: tsIso }) === undefined) {
    return undefined;
  }
  // The writer always stamps its version; a line at any other, or none, is a vocabulary this build cannot vouch for.
  const keys = EVENT_KEYS.get(String(value["kind"]));
  if (keys === undefined || !onlyKeys({ bag: value, keys }) || value["schemaVersion"] !== SLACK_DRAFT_SCHEMA_VERSION) {
    return undefined;
  }
  if (value["kind"] === "compared") {
    const outcome = outcomeOf({ value: value["outcome"] });
    return outcome === undefined ? undefined : { id, kind: "compared", outcome, tsIso };
  }
  if (value["kind"] !== "picked") {
    return undefined;
  }
  const variant = DRAFT_VARIANTS.find((known) => known === value["variant"]);
  const voice = value["voice"];
  if (variant === undefined) {
    return undefined;
  }
  if (voice === undefined) {
    return { id, kind: "picked", tsIso, variant };
  }
  const read = voiceOf({ voice });
  return read === undefined ? undefined : { id, kind: "picked", tsIso, variant, voice: read };
}

/** A pick's voice anchor, whole, or `undefined`. */
function voiceOf({ voice }: { voice: unknown }): DraftPickVoice | undefined {
  if (!isRecord(voice) || !onlyKeys({ bag: voice, keys: VOICE_KEYS })) {
    return undefined;
  }
  const { anchor, atIso, heard } = voice;
  const whole =
    typeof anchor === "string" &&
    carriesWords({ text: anchor }) &&
    typeof heard === "string" &&
    carriesWords({ text: heard }) &&
    typeof atIso === "string" &&
    parseStrictIsoInstantMs({ text: atIso }) !== undefined;
  return whole ? { anchor, atIso, heard } : undefined;
}

/**
 * The keys each outcome state carries, every other refused: an outcome is a closed shape, so a field this version
 * would drop hides its row rather than folding as if it were absent. A `Map`, as `EVENT_KEYS`
 * is: a plain object answers `constructor` from its prototype, so a line naming it threw rather than refusing.
 */
const OUTCOME_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["ready", new Set(["candidate", "elapsedMs", "requestedModel", "state"])],
  ["refused", new Set(["reasons", "stage", "state"])],
  ["unavailable", new Set(["reason", "state"])],
]);

/**
 * The keys each line's envelope carries (`./draftRegister.ts` `slackDraftEventLine`), every other refused: an unknown
 * field beside a pick could be a meaning this version would drop while acting on the pick.
 */
const EVENT_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["compared", new Set(["id", "kind", "outcome", "schemaVersion", "tsIso"])],
  ["picked", new Set(["id", "kind", "schemaVersion", "tsIso", "variant", "voice"])],
]);

/** Whether a record carries no key outside `keys`. */
function onlyKeys({ bag, keys }: { bag: Record<string, unknown>; keys: ReadonlySet<string> }): boolean {
  return Object.keys(bag).every((key) => keys.has(key));
}

/** A comparison outcome, whole, or `undefined`. */
function outcomeOf({ value }: { value: unknown }): ComparisonOutcome | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const keys = OUTCOME_KEYS.get(String(value["state"]));
  if (keys === undefined || !onlyKeys({ bag: value, keys })) {
    return undefined;
  }
  if (value["state"] === "unavailable") {
    const reason = value["reason"];
    return typeof reason === "string" && carriesWords({ text: reason }) ? { reason, state: "unavailable" } : undefined;
  }
  if (value["state"] === "refused") {
    return refusedOutcome({ value });
  }
  const { candidate, elapsedMs, requestedModel } = value;
  const counted = typeof elapsedMs === "number" && Number.isInteger(elapsedMs) && elapsedMs >= 0;
  const named = typeof requestedModel === "string" && requestedModel !== "";
  if (value["state"] !== "ready" || !counted || !named || !candidateValid(candidate)) {
    return undefined;
  }
  return { candidate, elapsedMs, requestedModel, state: "ready" };
}

/** A refused outcome, whole, or `undefined`: its stage from the closed set, and at least one reason with words. */
function refusedOutcome({ value }: { value: Record<string, unknown> }): ComparisonOutcome | undefined {
  const { reasons, stage } = value;
  const stageKnown = stage === "voice-rules" || stage === "admission" || stage === "evidence";
  // A refusal names why: an empty list or a blank reason would draw a stage with nothing after it.
  const listed =
    Array.isArray(reasons) &&
    reasons.length > 0 &&
    reasons.every((reason) => typeof reason === "string" && carriesWords({ text: reason }));
  return stageKnown && listed ? { reasons: reasons.map(String), stage, state: "refused" } : undefined;
}

/**
 * Whether a candidate carries every field a release re-prepares and an approval binds, each element included: a pick
 * makes these the row's words, so a candidate is held to more than a park's own line, whose words this version wrote.
 * A voice revision's words are held to the same (`./draftRevisionLine.ts`).
 *
 * @param candidate the line's candidate, or a revision's words without their receipts
 * @returns true when every field is whole
 */
export function candidateValid(candidate: unknown): candidate is SlackDraftCandidate {
  if (!isRecord(candidate) || !onlyKeys({ bag: candidate, keys: CANDIDATE_KEYS })) {
    return false;
  }
  const { advisory, digest, form, mentions, payload } = candidate;
  const whole =
    typeof form === "string" &&
    typeof digest === "string" &&
    carriesWords({ text: digest }) &&
    dripPayloadValid({ payload }) &&
    Array.isArray(mentions) &&
    mentions.every((mention) => mentionValid({ mention })) &&
    Array.isArray(advisory) &&
    advisory.every((line) => typeof line === "string");
  return whole && referencesNamed({ mentions, payload });
}

/** The mention kind a rich-text reference element is named by on the card. */
const REFERENCE_KIND: ReadonlyMap<string, string> = new Map([
  ["user", "person"],
  ["usergroup", "group"],
]);

/**
 * Whether every person or group the payload tags carries a mention naming it: the card draws a tag by its recorded
 * mention, so one with none would draw its raw id where Slack draws the name.
 */
function referencesNamed({ mentions, payload }: { mentions: readonly unknown[]; payload: unknown }): boolean {
  const named = new Set(
    mentions
      .filter((mention) => isRecord(mention))
      .map((mention) => `${String(mention["kind"])}:${String(mention["target"])}`),
  );
  return referencesIn({ node: payload }).every(({ id, kind }) => named.has(`${kind}:${id}`));
}

/** Every person or group reference under a node, walking its `blocks` and `elements`. */
function referencesIn({ node }: { node: unknown }): readonly { readonly id: string; readonly kind: string }[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => referencesIn({ node: child }));
  }
  if (!isRecord(node)) {
    return [];
  }
  const kind = REFERENCE_KIND.get(String(node["type"]));
  const own = kind === undefined ? [] : [{ id: String(node[`${String(node["type"])}_id`]), kind }];
  return [...own, ...referencesIn({ node: node["blocks"] }), ...referencesIn({ node: node["elements"] })];
}

/** Every key a skipped comparison at park declares (`./draftComparison.ts` `comparisonAtPark`). */
const SKIPPED_KEYS: ReadonlySet<string> = new Set(["reason", "state"]);

/** Every key a candidate declares (`./draftComparison.ts` `SlackDraftCandidate`). */
const CANDIDATE_KEYS: ReadonlySet<string> = new Set(["advisory", "digest", "form", "mentions", "payload"]);

/** Every key a tagged person or group declares (`./draftRegister.ts` `ParkedMention`). */
const MENTION_KEYS: ReadonlySet<string> = new Set(["key", "kind", "target"]);

/** Every key a pick's voice anchor declares (`./draftComparison.ts` `DraftPickVoice`). */
const VOICE_KEYS: ReadonlySet<string> = new Set(["anchor", "atIso", "heard"]);

/** Every key a rich drip message payload declares (`./types.ts`). */
const PAYLOAD_KEYS: ReadonlySet<string> = new Set(["blocks", "form", "text", "unfurl_links", "unfurl_media"]);

/**
 * Whether a payload is a whole rich drip message (`./types.ts`): text, both unfurl flags and a single `rich_text`
 * block, whole to its leaves (`./richTextShape.ts`). `slack draft show` walks that block, so a half-arm would crash it.
 * A key it does not declare refuses too: the console draws an `attachments` field
 * as a card, which no drip message carries. A plain arm refuses outright: a pass's answer is
 * always a `drip` form, rendered rich, so only a hand-written line carries one, and its text is sent as Slack markup
 * the card draws literally. Both unfurl flags are `true`, as the as-me renderer always sets
 * them: the card draws a link's unfurl as Slack was measured drawing it, so a suppressed one would show a preview
 * Slack never adds.
 */
function dripPayloadValid({ payload }: { payload: unknown }): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  const { blocks, form, text, unfurl_links: links, unfurl_media: media } = payload;
  if (typeof text !== "string" || links !== true || media !== true) {
    return false;
  }
  if (!Object.keys(payload).every((key) => PAYLOAD_KEYS.has(key))) {
    return false;
  }
  if (form !== "rich" || !Array.isArray(blocks) || blocks.length !== 1) {
    return false;
  }
  // A candidate is words a pick would send: a block with nothing in it, or a fallback with no words, would draw a blank
  // B.
  const block: unknown = blocks[0];
  const filled = isRecord(block) && Array.isArray(block["elements"]) && block["elements"].length > 0;
  return filled && carriesWords({ text }) && richTextBlockValid({ block });
}

/** The notified id each mention kind carries: a member id for a person, a usergroup (subteam) id for a group. */
const MENTION_TARGET: ReadonlyMap<string, RegExp> = new Map([
  ["group", /^S[A-Z0-9]+$/u],
  ["person", /^[UW][A-Z0-9]+$/u],
]);

/**
 * Whether one tagged person or group carries a key, a kind this version knows and the id that kind notifies — a
 * group paired with a member id would ping nobody, or the wrong one.
 */
function mentionValid({ mention }: { mention: unknown }): boolean {
  if (!isRecord(mention) || !onlyKeys({ bag: mention, keys: MENTION_KEYS })) {
    return false;
  }
  const { key, kind, target } = mention;
  if (typeof key !== "string" || !carriesWords({ text: key }) || typeof kind !== "string") {
    return false;
  }
  const shape = MENTION_TARGET.get(kind);
  return shape !== undefined && typeof target === "string" && shape.test(target);
}
