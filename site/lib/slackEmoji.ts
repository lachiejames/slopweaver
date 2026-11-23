/**
 * Slack's emoji shortcodes as the emoji Slack draws: `:thumbsup:` reads 👍 on a console Slack preview, the way the
 * desktop client shows it, rather than as its text form.
 *
 * The owner sees what the Slack desktop client would show, so an emoji reads in its emoji form rather than its text
 * form.
 *
 * ## Where the names come from
 *
 * `./slackEmoji.json` is a committed snapshot of `emoji-datasource@16.0.0`'s `emoji.json` (iamcal/emoji-data, the set
 * Slack's own standard shortcodes are named from; MIT, `./slackEmoji.LICENSE`): every `short_names` alias mapped to
 * its fully-qualified `unified` sequence as characters, and the aliases whose entry takes ONE skin tone. A snapshot
 * rather than a dependency because `site/` is its own Yarn project and the root unit lane, which imports this file,
 * installs nothing of it. The full package is a 24 MiB tarball; the snapshot is the 64 KiB a preview reads. 16.0.0 is
 * the latest release (`yarn npm info emoji-datasource --fields dist-tags`), so a name newer than it — an
 * Emoji 17 one such as `:orca:` — stays as written, exactly as a custom one does, until the snapshot is retaken.
 *
 * A skin tone is folded the way every single-tone variation in that source is spelled: the modifier after the first
 * code point, an `FE0F` straight after it dropped. MEASURED against all 316 entries carrying `skin_variations` in
 * 16.0.0: it holds for every one except the seven two-person emoji (the six kiss/heart couples and
 * `people_holding_hands`) that carry only two-modifier variations, which are left out of `skinToneNames`.
 *
 * ## A name the table does not hold stays EXACTLY as written — custom emoji included, decided
 *
 * A workspace's custom emoji (`:partyparrot:`) has no Unicode form, and no image address reaches the console — that
 * needs Slack's `emoji.list`, which nothing here reads yet. And from the text alone a custom name cannot be told from
 * prose with colons in it (`10:30:45`). So an unknown `:name:` is left byte for byte: a preview wrong about one custom
 * emoji still reads as the name its author typed, where one guessing would be wrong about the words. Drawing custom
 * emoji as images is the follow-up, not built here.
 *
 * Inside a backtick code span or a fenced block a shortcode stays text, as Slack leaves it. Pure: text in, pieces out.
 */

import table from "./slackEmoji.json";

/** Slack's `:skin-tone-N:` numbers, 2 (light) to 6 (dark) — the five Fitzpatrick modifiers, U+1F3FB to U+1F3FF. */
export type SlackSkinTone = 2 | 3 | 4 | 5 | 6;

/** One stretch of drawn text: words as written, or one emoji with the shortcode it was written as. */
export type EmojiPiece =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "emoji";
      /** The base shortcode name, without colons or tone. */
      readonly name: string;
      /** The emoji, its tone folded in. */
      readonly glyph: string;
      /** Exactly what the text said — `:thumbsup::skin-tone-4:` — which a surface shows on hover. */
      readonly written: string;
    };

/** Where the snapshot came from, so a reader of a stale table knows which release it holds. */
export const EMOJI_SOURCE: string = table.source;

/** Every standard shortcode name, aliases included, to its emoji. */
const GLYPHS: ReadonlyMap<string, string> = new Map(Object.entries(table.glyphs));

/** The names that take a single skin tone. */
const TONABLE: ReadonlySet<string> = new Set(table.skinToneNames);

/** A shortcode at a position: a name Slack's own grammar admits, between colons. Sticky, so a scan never re-slices. */
const SHORTCODE = /:([a-z0-9_+-]+):/y;

/** A skin-tone shortcode straight after an emoji, as Slack writes one: `:thumbsup::skin-tone-4:`. */
const TONE = /:skin-tone-([2-6]):/y;

/** A web address at a position, to the next space or mrkdwn delimiter: never words, so never an emoji inside it. */
const ADDRESS = /https?:\/\/[^\s<>|]+/iy;

/** An inline code span at a position, on one line. A fence is read over the whole text first (`fenceRanges`). */
const INLINE_CODE = /`[^`\n]+`/y;

/** Every complete backtick fence in a whole message, newlines included. */
const FENCES = /```[\s\S]*?```/g;

/** Where each complete fence in a text starts and ends, in order. */
function fenceRanges({ text }: { text: string }): readonly { from: number; to: number }[] {
  return [...text.matchAll(FENCES)].map((fence) => ({ from: fence.index, to: fence.index + fence[0].length }));
}

/** Slack's `unicode` field: lowercase hyphenated hex code points, `1f44d` or `0031-fe0f-20e3`. */
const UNICODE = /^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6})*$/i;

/** Variation selector 16, which asks for the emoji presentation of the character before it. */
const VS16 = "️";

/**
 * Whether a value is one of Slack's five skin-tone numbers.
 *
 * @returns true for an integer 2 to 6
 */
export function isSkinTone(value: unknown): value is SlackSkinTone {
  return value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

/**
 * The emoji a standard shortcode name draws as, its skin tone folded in when the emoji takes one. A tone on an emoji
 * that takes none is not applied — the base draws alone.
 *
 * @param name the shortcode name, without colons — any alias Slack accepts, `+1` and `thumbsup` alike
 * @param skinTone Slack's `skin-tone-N` number, when the text or element carried one
 * @returns the emoji, or `undefined` for a name the standard set does not hold (a workspace custom emoji, or none)
 */
export function emojiGlyph({
  name,
  skinTone,
}: {
  name: string;
  skinTone?: SlackSkinTone | undefined;
}): string | undefined {
  const glyph = GLYPHS.get(name);
  if (glyph === undefined || skinTone === undefined || !TONABLE.has(name)) {
    return glyph;
  }
  return withTone({ glyph, skinTone });
}

/** A glyph with a skin tone folded in: the modifier after the first code point, an `FE0F` straight after it dropped. */
function withTone({ glyph, skinTone }: { glyph: string; skinTone: SlackSkinTone }): string {
  // A table glyph is never empty, so it always has a first code point.
  const first = String.fromCodePoint(glyph.codePointAt(0)!);
  const rest = glyph.slice(first.length);
  const tail = rest.startsWith(VS16) ? rest.slice(VS16.length) : rest;
  return `${first}${String.fromCodePoint(0x1f3fb + skinTone - 2)}${tail}`;
}

/** The five skin-tone modifiers, U+1F3FB to U+1F3FF. */
const TONE_MODIFIER = /[\u{1F3FB}-\u{1F3FF}]/u;

/**
 * The emoji a rich-text `emoji` element draws as: the `unicode` Slack recorded first — its tone folded in when Slack
 * recorded the tone beside it rather than in it, and the name takes one — else the standard set's by name and tone.
 *
 * @param unicode the element's own hex spelling, when Slack recorded one
 * @param skinTone the element's `skin_tone`, when it carried one
 * @returns the emoji, or `undefined` for a name the standard set does not hold and no spelling (a custom emoji)
 */
export function emojiElementGlyph({
  name,
  unicode,
  skinTone,
}: {
  name: string;
  unicode: string | undefined;
  skinTone: SlackSkinTone | undefined;
}): string | undefined {
  const spelled = unicode === undefined ? undefined : emojiUnicodeGlyph({ unicode });
  if (spelled === undefined) {
    return emojiGlyph({ name, skinTone });
  }
  if (skinTone === undefined || !TONABLE.has(name) || TONE_MODIFIER.test(spelled)) {
    return spelled;
  }
  return withTone({ glyph: spelled, skinTone });
}

/**
 * The emoji a rich-text element's own `unicode` field spells — Slack's lowercase hyphenated hex, tone included.
 *
 * @param unicode the element's field, e.g. `1f44b-1f3fd`
 * @returns the emoji, or `undefined` when the field is not a sequence of Unicode scalar values
 */
export function emojiUnicodeGlyph({ unicode }: { unicode: string }): string | undefined {
  if (!UNICODE.test(unicode)) {
    return undefined;
  }
  const points = unicode.split("-").map((hex) => Number.parseInt(hex, 16));
  // A scalar value only: past the last plane, or a lone surrogate half, names no character.
  if (points.some((point) => point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))) {
    return undefined;
  }
  return String.fromCodePoint(...points);
}

/**
 * The shortcode written at `at` and how many characters it took: an emoji piece for a name the table holds, a text
 * piece for one it does not — a custom emoji's tone taken with it, so `:partyparrot::skin-tone-2:` stays whole rather
 * than growing a swatch — and `undefined` when no shortcode starts there.
 */
function shortcodeAt({ text, at }: { text: string; at: number }): { piece: EmojiPiece; consumed: number } | undefined {
  SHORTCODE.lastIndex = at;
  const code = SHORTCODE.exec(text);
  const name = code?.at(1);
  if (code === null || name === undefined) {
    return undefined;
  }
  const known = GLYPHS.has(name);
  let consumed = code[0].length;
  let skinTone: SlackSkinTone | undefined;
  TONE.lastIndex = at + consumed;
  const tone = TONABLE.has(name) || !known ? TONE.exec(text) : null;
  const toneNumber = Number(tone?.at(1));
  if (tone !== null && isSkinTone(toneNumber)) {
    skinTone = toneNumber;
    consumed += tone[0].length;
  }
  const written = text.slice(at, at + consumed);
  if (!known) {
    return { consumed, piece: { kind: "text", text: written } };
  }
  const glyph = emojiGlyph({ name, skinTone })!;
  return { consumed, piece: { glyph, kind: "emoji", name, written } };
}

/** How many characters of web address start at `at`, or 0 when none does. */
function addressAt({ text, at }: { text: string; at: number }): number {
  ADDRESS.lastIndex = at;
  const match = ADDRESS.exec(text);
  return match === null ? 0 : match[0].length;
}

/** How many characters of an inline code span start at `at`, or 0 when none does. */
function inlineCodeAt({ text, at }: { text: string; at: number }): number {
  INLINE_CODE.lastIndex = at;
  const match = INLINE_CODE.exec(text);
  return match === null ? 0 : match[0].length;
}

/**
 * Split text into its words and the standard emoji written in it, left to right in one bounded pass. A `:name:` the
 * table does not hold, prose like `10:30:45`, a web address, and anything inside complete backtick code stay text
 * exactly.
 *
 * @param text the text as a surface will draw it — a span's or a run's, its wire escapes already read
 * @returns the pieces, adjacent text merged, no empty piece — an empty list for empty text
 */
export function emojiPieces({ text }: { text: string }): readonly EmojiPiece[] {
  const out: EmojiPiece[] = [];
  const fences = fenceRanges({ text });
  let plain = "";
  let at = 0;
  while (at < text.length) {
    const fence = fences.find((each) => each.from === at);
    if (fence !== undefined) {
      plain += text.slice(at, fence.to);
      at = fence.to;
      continue;
    }
    // Nothing read here may run into the next fence: a stray backtick before one never pairs with its first backtick.
    const next = fences.find((each) => each.from > at);
    const room = next === undefined ? text.length - at : next.from - at;
    const inline = text.charAt(at) === "`" ? inlineCodeAt({ at, text }) : 0;
    const code = inline > room ? 0 : inline;
    // A scheme is case-insensitive: `HTTPS://` is as much an address as `https://`.
    const address = Math.min(room, text.charAt(at).toLowerCase() === "h" ? addressAt({ at, text }) : 0);
    const shortcode = text.charAt(at) === ":" ? shortcodeAt({ at, text }) : undefined;
    if (shortcode?.piece.kind === "emoji") {
      if (plain.length > 0) {
        out.push({ kind: "text", text: plain });
        plain = "";
      }
      out.push(shortcode.piece);
      at += shortcode.consumed;
      continue;
    }
    const step = Math.max(code, address, shortcode === undefined ? 1 : shortcode.consumed);
    plain += text.slice(at, at + step);
    at += step;
  }
  if (plain.length > 0) {
    out.push({ kind: "text", text: plain });
  }
  return out;
}

/**
 * A link's label as drawn: its shortcodes as emoji when the author wrote one (`<https://…|ship :tada:>`), and the bare
 * address exactly as written when the label IS the address, which is never words.
 *
 * @param label what the link reads as
 * @param href where it goes
 * @returns the pieces to draw
 */
export function linkLabelPieces({ label, href }: { label: string; href: string }): readonly EmojiPiece[] {
  if (label === href) {
    return label.length === 0 ? [] : [{ kind: "text", text: label }];
  }
  return emojiPieces({ text: label });
}

/** One stretch of a line: inside a complete fence, or not. */
export type FencedSegment = { readonly text: string; readonly fenced: boolean };

/** One line of a message, and its stretches in order (at least one). */
export type FencedLine = { readonly line: string; readonly segments: readonly FencedSegment[] };

/**
 * A message's lines, each cut where a complete fence opens or closes on it, for a surface that tokenizes line by line
 * and so would never show {@link emojiPieces} the fence around a middle line — and whose mrkdwn tokenizer, given a fence,
 * would read an inline code span out of its backticks. A `fenced` segment is code, its shortcodes and markup left as
 * written; the words beside a fence on the same line still draw. An unclosed fence is no fence.
 *
 * @param text the whole message, newlines and all
 * @returns one entry per `\n`-separated line, in order: the line, and its segments in order (at least one)
 */
export function fencedLines({ text }: { text: string }): readonly FencedLine[] {
  const fences = fenceRanges({ text });
  let start = 0;
  return text.split("\n").map((line) => {
    const from = start;
    const to = start + line.length;
    start = to + 1;
    const segments: FencedSegment[] = [];
    let at = from;
    for (const fence of fences.filter((each) => each.from <= to && from < each.to)) {
      const opens = Math.max(fence.from, from);
      if (opens > at) {
        segments.push({ fenced: false, text: text.slice(at, opens) });
      }
      at = Math.min(fence.to, to);
      segments.push({ fenced: true, text: text.slice(opens, at) });
    }
    if (at < to || segments.length === 0) {
      segments.push({ fenced: false, text: text.slice(at, to) });
    }
    return { line, segments };
  });
}

/**
 * Text with every standard shortcode in it drawn as its emoji — the plain-string form of {@link emojiPieces}, for a
 * surface that prints a line rather than elements.
 *
 * @returns the text, each known shortcode replaced by its emoji and everything else as written
 */
export function emojiText({ text }: { text: string }): string {
  return emojiPieces({ text })
    .map((piece) => (piece.kind === "text" ? piece.text : piece.glyph))
    .join("");
}
