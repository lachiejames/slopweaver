/**
 * The leaves of the visible-prose walk ({@link ./visibleProse.flattenSlackVisibleProse}): one value of a Slack payload
 * reduced to its text, whether a string carries anything a reader could see, and one rich-text leaf rendered. They
 * depend on nothing else in that walk, which is the line this module was split along.
 */

import { isRecord } from "#lib/parsers.js";

/**
 * A string value, or undefined when the value is not a string. Pure.
 *
 * @returns the value when it is a string, else undefined
 */
export function str({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Whether a value is absent, not a string, or only whitespace — i.e. carries nothing to render. Pure. */
function blank({ value }: { value: unknown }): boolean {
  return invisible({ text: str({ value }) });
}

/**
 * Characters that occupy no visible space: Unicode FORMAT characters (`Cf` — zero-width space and joiners, the
 * word joiner, the byte-order mark, the soft hyphen), control characters, and every kind of separator.
 *
 * ALL marks (`\p{M}`) are included too, because a mark renders only in combination with a base character — a
 * variation selector, a combining grapheme joiner or a musical combining stem ALONE shows nothing. The whole
 * mark property is named rather than the two categories a first cut happened to think of.
 *
 * `Default_Ignorable_Code_Point` is the load-bearing member of that list, because it is the Unicode property
 * that means precisely "renders nothing" — including characters whose CATEGORY suggests otherwise, such as
 * U+3164 HANGUL FILLER, a blank glyph in category `Lo` (Letter, other).
 *
 * Defined by PROPERTY rather than as an enumerated list on purpose. An earlier version listed
 * `\u200B-\u200D` and `\uFEFF`, and each round of review simply produced the next codepoint it had missed —
 * U+2060, then U+FE0F, then U+034F, then U+3164, then U+1D165. Naming the property ends the class rather than
 * one member of it; adding members one at a time never terminates.
 *
 * ONE class is knowingly left out, because it has no closed definition: a character whose Unicode properties
 * say it is ordinary while its glyph is blank — U+2800 BRAILLE PATTERN BLANK being the known example. Its only
 * consequence is that a message whose ENTIRE content is such a character stores that character instead of the
 * empty-message placeholder, which is a cosmetic difference between two records a reader sees nothing in.
 *
 * A string containing any base character is unaffected: the marks are removed only to decide whether ANYTHING
 * visible remains, so "café" still reads as visible however it is normalised.
 */
export const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}\p{Z}\p{M}]/gu;

/**
 * Whether a string carries nothing a reader could see. `trim()` alone is not enough, because a format
 * character is not whitespace under Unicode and so survives it — and a single invisible character is enough to
 * displace the empty-message placeholder with something nobody can read.
 *
 * @returns whether the text is absent or holds only invisible characters
 */
export function invisible({ text }: { text: string | undefined }): boolean {
  return text === undefined || text.replace(INVISIBLE, "").length === 0;
}

/**
 * A Block Kit "composition object" (`{ type, text }`) or a bare string, reduced to its text. Slack uses both
 * spellings for the same idea depending on the block, so both are read here rather than at every call site.
 */
function composed({ value }: { value: unknown }): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return isRecord(value) ? str({ value: value["text"] }) : undefined;
}

/** Append a fragment when it carries any non-blank text. */
export function push({ value, out }: { value: unknown; out: string[] }): void {
  const text = composed({ value });
  if (text !== undefined && !invisible({ text })) {
    out.push(text);
  }
}

/**
 * A structured mention leaf → the markup a top-level `text` field would carry for it, so ONE resolver decides
 * how a mention reads.
 *
 * `usergroup` is deliberately absent, because {@link ./visibleProse.resolveSlackMarkup} cannot render one without
 * leaking its id: its `!` branch falls back to `ref.slice(1)`, so an UNLABELLED `<!subteam^ID>` becomes `@subteam^ID`.
 * That is a pre-existing defect of the resolver rather than of this walker — measured on the local corpus,
 * roughly 3,100 unlabelled subteam mentions in raw already produce about 2,400 stored `@subteam^` strings via
 * the top-level `text` field, with no involvement from this file. Reconstructing the markup here would route
 * MORE text into that defect, so a usergroup is rendered directly as a generic instead. The resolver fix is
 * owned separately; see the handover named in this PR.
 */
const MENTION_MARKUP: Readonly<Record<string, { readonly idKey: string; readonly wrap: (id: string) => string }>> = {
  broadcast: { idKey: "range", wrap: (id) => `<!${id}>` },
  channel: { idKey: "channel_id", wrap: (id) => `<#${id}>` },
  user: { idKey: "user_id", wrap: (id) => `<@${id}>` },
};

/**
 * One rich-text leaf.
 *
 * A `link` prefers its label and falls back to its URL, because Slack VISIBLY renders a bare link — treating
 * it as transport metadata would drop something the reader sees.
 *
 * A `user`, `channel` or `broadcast` leaf carries an ID and NO `text`, and is emitted as the equivalent Slack
 * MARKUP rather than as a resolved name, so {@link ./visibleProse.resolveSlackMarkup} alone decides how a mention reads.
 * That indirection matters because nearly every ordinary human message ALSO arrives as a `rich_text` block
 * duplicating its own `text` field: a mention rendered differently here would stop the duplicate matching the
 * message text, and a mangled copy would be appended to every such record, doubling its term frequencies.
 *
 * A `usergroup` is the one mention rendered directly, as a generic — see {@link MENTION_MARKUP} for why
 * reconstructing its markup would route more text into a pre-existing resolver leak. The dedup key collapses
 * mention tokens anyway (see `key` in `./visibleProse.ts`), so this asymmetry cannot reintroduce the
 * duplicate-fragment problem.
 */
export function richLeaf({ node, out }: { node: Record<string, unknown>; out: string[] }): void {
  const type = str({ value: node["type"] });
  if (type !== undefined && SYMBOLIC_LEAF_TYPES.has(type)) {
    const rendered = symbolicLeaf({ node, type });
    if (rendered !== undefined) {
      out.push(rendered);
    }
    return;
  }
  const text = str({ value: node["text"] });
  if (text !== undefined) {
    out.push(text);
    return;
  }
  if (type === "link") {
    const url = str({ value: node["url"] });
    if (url !== undefined) {
      out.push(url);
    }
  }
}

/** Leaf types that carry no `text` of their own and are rendered from their own fields. */
const SYMBOLIC_LEAF_TYPES: ReadonlySet<string> = new Set(["emoji", "usergroup", ...Object.keys(MENTION_MARKUP)]);

/**
 * The rendered form of a leaf that has no `text` field — an emoji or a mention — or `undefined` when the leaf
 * carries nothing renderable, in which case it contributes NOTHING rather than a placeholder.
 */
function symbolicLeaf({ node, type }: { node: Record<string, unknown>; type: string }): string | undefined {
  if (type === "emoji") {
    // A blank name would manufacture "::" out of nothing — enough to look like recovered content and displace
    // the empty-message placeholder, which must only ever be displaced by real prose.
    // `blank`, not `trim`: an emoji NAME of only zero-width characters would still wrap into "::" — two
    // visible colons manufactured from nothing.
    return blank({ value: node["name"] }) ? undefined : `:${str({ value: node["name"] })!}:`;
  }
  // Every mention below is rendered from an ID, so a missing or blank one has nothing to say. Returning a
  // generic anyway would manufacture content out of an empty leaf and displace the empty-message placeholder.
  if (type === "usergroup") {
    return blank({ value: node["usergroup_id"] }) ? undefined : "@group";
  }
  const mention = MENTION_MARKUP[type];
  if (mention === undefined || blank({ value: node[mention.idKey] })) {
    return undefined;
  }
  return mention.wrap(str({ value: node[mention.idKey] })!);
}
