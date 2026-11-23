/**
 * Inline markdown as ATOMS, rendered to HTML — and a word diff over atoms, so an insertion can never cut a link or a
 * code span in half.
 *
 * A diff over characters or plain words would wrap `<ins>` around half of `[NET-38](…)` and break the anchor, or
 * leave the link out of the diff entirely. Here a link, an image, a code span and a bold run are each ONE atom: an
 * atom is either wholly unchanged, wholly added or wholly removed, so every `<ins>`/`<del>` holds complete HTML.
 *
 * Pure.
 */
import { diffArrays } from "diff";

import { escapeAttribute, escapeText } from "../../outbound/briefing/escape.js";
import { bareWebAddress } from "./link.js";
import { plainText } from "./units.js";

/** One indivisible piece of inline markdown. */
export type InlineAtom =
  | { readonly kind: "space" | "word"; readonly raw: string }
  | { readonly kind: "code"; readonly raw: string; readonly code: string }
  | { readonly kind: "link"; readonly raw: string; readonly text: string; readonly url: string }
  | { readonly kind: "image"; readonly raw: string; readonly alt: string; readonly src: string }
  | { readonly kind: "strong"; readonly raw: string; readonly inner: string };

/*
 * One sticky pattern per atom kind, tried at the cursor in the order {@link atomAt} lists them: the order is the
 * precedence. Separate patterns rather than one alternation, because the address and word rules stop at markup ahead
 * of them, and a lookahead inside a repeated group is the shape that backtracks without bound.
 */
const IMAGE_AT = /!\[([^\]]*)\]\(([^)\s]*)\)/y;
const LINK_AT = /\[([^\]]*)\]\(([^)\s]+)\)/y;
const CODE_AT = /`([^`]+)`/y;
const STRONG_AT = /\*\*(.+?)\*\*/uy;
const SPACE_AT = /\s+/uy;
/** A bare web address, before {@link addressAt} cuts it at markup glued after it. */
const ADDRESS_AT = /https?:\/\/[^\s<>`|]+/iuy;
/** Markup that ends a bare address: a bold run, or a link or image opening. */
const MARKUP_AT = /\*\*|!?\[[^\]]*\]\(/y;
/** A word, before {@link wordAt} cuts it where an address begins. */
const WORD_AT = /[^\s`[!*]+/uy;
const SCHEME = /https?:\/\//i;

/** What a sticky pattern matches exactly at `at`, or null. */
function matchAt({ pattern, text, at }: { pattern: RegExp; text: string; at: number }): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

/**
 * A bare web address at `at`: one word up to the next space, code span, bold run, link or table bar glued after it,
 * so a lone `!`, `*` or `[` inside it never cuts the link short and markup after it keeps its own meaning.
 *
 * @returns the address, or null when none starts here or markup follows its scheme at once
 */
function addressAt({ text, at }: { text: string; at: number }): string | null {
  const candidate = matchAt({ at, pattern: ADDRESS_AT, text });
  if (candidate === null) {
    return null;
  }
  const scheme = SCHEME.exec(candidate[0])![0].length;
  for (let index = scheme; index < candidate[0].length; index += 1) {
    if (matchAt({ at: at + index, pattern: MARKUP_AT, text }) !== null) {
      return index === scheme ? null : candidate[0].slice(0, index);
    }
  }
  return candidate[0];
}

/**
 * A word at `at`, stopping where an address begins, so a bracket or quote opening onto one is a word of its own.
 *
 * @returns the word, or null when an address starts here
 */
function wordAt({ text, at }: { text: string; at: number }): string | null {
  const candidate = matchAt({ at, pattern: WORD_AT, text });
  if (candidate === null) {
    return null;
  }
  const address = candidate[0].search(SCHEME);
  if (address === -1) {
    return candidate[0];
  }
  return address === 0 ? null : candidate[0].slice(0, address);
}

/** The atom at `at`; a character no rule takes is a word of its own. */
function atomAt({ text, at }: { text: string; at: number }): InlineAtom {
  const image = matchAt({ at, pattern: IMAGE_AT, text });
  if (image !== null) {
    return { alt: image[1]!, kind: "image", raw: image[0], src: image[2]! };
  }
  const link = matchAt({ at, pattern: LINK_AT, text });
  if (link !== null) {
    return { kind: "link", raw: link[0], text: link[1]!, url: link[2]! };
  }
  const code = matchAt({ at, pattern: CODE_AT, text });
  if (code !== null) {
    return { code: code[1]!, kind: "code", raw: code[0] };
  }
  const strong = matchAt({ at, pattern: STRONG_AT, text });
  if (strong !== null) {
    return { inner: strong[1]!, kind: "strong", raw: strong[0] };
  }
  const space = matchAt({ at, pattern: SPACE_AT, text });
  if (space !== null) {
    return { kind: "space", raw: space[0] };
  }
  const address = addressAt({ at, text });
  if (address !== null) {
    return { kind: "word", raw: address };
  }
  const word = wordAt({ at, text });
  if (word !== null) {
    return { kind: "word", raw: word };
  }
  return { kind: "word", raw: String.fromCodePoint(text.codePointAt(at)!) };
}

/**
 * Split inline markdown into atoms.
 *
 * @param markdown the inline text
 * @returns its atoms; joined, their `raw`s are the input exactly
 */
export function inlineAtoms({ markdown }: { markdown: string }): readonly InlineAtom[] {
  const atoms: InlineAtom[] = [];
  let at = 0;
  while (at < markdown.length) {
    const atom = atomAt({ at, text: markdown });
    atoms.push(atom);
    at += atom.raw.length;
  }
  return atoms;
}

/** How an image's source is turned into the address the page shows — a data URI, for a file beside the document. */
export type ImageSources = ReadonlyMap<string, string>;

/** The address an image is shown from: its inlined data, when the caller resolved one, else its own source. */
function imageAddress({ src, images }: { src: string; images: ImageSources }): string {
  const inlined = images.get(src);
  if (inlined === undefined) {
    return src;
  }
  return inlined;
}

/**
 * A word as HTML: a bare web address becomes the link it reads as, unless it already sits inside one, which a second
 * anchor would break.
 *
 * @returns the word's HTML
 */
function renderWord({ raw, inLink }: { raw: string; inLink: boolean }): string {
  const url = inLink ? null : bareWebAddress({ word: raw });
  if (url === null) {
    return escapeText({ text: raw });
  }
  const anchor = `<a href="${escapeAttribute({ text: url })}">${escapeText({ text: url })}</a>`;
  return `${anchor}${escapeText({ text: raw.slice(url.length) })}`;
}

/**
 * Render one atom as HTML.
 *
 * @param inLink whether the atom is part of a link's own text
 * @returns the atom's HTML
 */
function renderAtom({ atom, images, inLink }: { atom: InlineAtom; images: ImageSources; inLink: boolean }): string {
  switch (atom.kind) {
    case "space":
      return escapeText({ text: atom.raw });
    case "word":
      return renderWord({ inLink, raw: atom.raw });
    case "code":
      return `<code>${escapeText({ text: atom.code })}</code>`;
    case "link":
      return `<a href="${escapeAttribute({ text: atom.url })}">${renderAtoms({ images, inLink: true, markdown: atom.text })}</a>`;
    case "image":
      return `<img src="${escapeAttribute({ text: imageAddress({ images, src: atom.src }) })}" alt="${escapeAttribute({ text: atom.alt })}">`;
    case "strong":
      return `<strong>${renderAtoms({ images, inLink, markdown: atom.inner })}</strong>`;
    default: {
      const unreachable: never = atom;
      return unreachable;
    }
  }
}

/** Inline markdown as HTML, knowing whether it is a link's own text. */
function renderAtoms({
  markdown,
  images,
  inLink,
}: {
  markdown: string;
  images: ImageSources;
  inLink: boolean;
}): string {
  return inlineAtoms({ markdown })
    .map((atom) => renderAtom({ atom, images, inLink }))
    .join("");
}

/**
 * Render inline markdown as HTML.
 *
 * @param markdown the inline text
 * @param images inlined image addresses, by the source the markdown names
 * @returns the HTML
 */
export function renderInline({ markdown, images }: { markdown: string; images: ImageSources }): string {
  return renderAtoms({ images, inLink: false, markdown });
}

/**
 * What an atom is compared on: its words, never its markup. A label that only became bold, or a name that only
 * became a link, is formatting, and highlighting it would put it beside the reworded words it is not.
 */
function atomKey({ atom }: { atom: InlineAtom }): string {
  if (atom.kind === "space") {
    return " ";
  }
  return plainText({ markdown: atom.raw });
}

/**
 * Both sides of a reworded line as HTML, with what was removed in `<del>` on the before side and what was added in
 * `<ins>` on the after side. Whitespace alone never opens a marker, and markup alone never does either: an
 * unchanged stretch shows each side's own markup.
 *
 * @param before the earlier inline markdown
 * @param after the later inline markdown
 * @param images inlined image addresses
 * @returns the two sides' HTML
 */
export function wordDiffHtml({ before, after, images }: { before: string; after: string; images: ImageSources }): {
  readonly before: string;
  readonly after: string;
} {
  const b = inlineAtoms({ markdown: before });
  const a = inlineAtoms({ markdown: after });
  let bi = 0;
  let ai = 0;
  let beforeHtml = "";
  let afterHtml = "";
  const run = ({ atoms }: { atoms: readonly InlineAtom[] }): string =>
    atoms.map((atom) => renderAtom({ atom, images, inLink: false })).join("");
  const wrap = ({ tag, atoms }: { tag: "del" | "ins"; atoms: readonly InlineAtom[] }): string => {
    if (atoms.every((atom) => atom.kind === "space")) {
      return run({ atoms });
    }
    return `<${tag}>${run({ atoms })}</${tag}>`;
  };
  for (const part of diffArrays(
    b.map((atom) => atomKey({ atom })),
    a.map((atom) => atomKey({ atom })),
  )) {
    const count = part.value.length;
    if (part.removed === true) {
      beforeHtml += wrap({ atoms: b.slice(bi, bi + count), tag: "del" });
      bi += count;
    } else if (part.added === true) {
      afterHtml += wrap({ atoms: a.slice(ai, ai + count), tag: "ins" });
      ai += count;
    } else {
      beforeHtml += run({ atoms: b.slice(bi, bi + count) });
      afterHtml += run({ atoms: a.slice(ai, ai + count) });
      bi += count;
      ai += count;
    }
  }
  return { after: afterHtml, before: beforeHtml };
}
