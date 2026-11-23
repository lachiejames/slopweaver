/**
 * PURE checks on the CSS a received mail carries, for `./mailHtml.ts` — an inline `style` reduced to its safe
 * declarations, and a `<style>` block kept whole or not at all.
 *
 * There is no CSS parser here on purpose: the checks are token tests on comment-free text, and anything they cannot
 * read with certainty — an unterminated comment, string or parenthesis, a CSS escape — is dropped rather than guessed
 * at, because guessing where attacker-written grammar ends is how a fetching token gets past a check.
 */

/**
 * Tokens that make a CSS run unsafe, matched on the run lower-cased with every whitespace character removed — so
 * `URL (` and `u r l(` read as `url(`. Each either fetches (`url(`, `image(`, `image-set(` and its `-webkit-` form,
 * `cross-fade(`, `element(`, `src(`, `@import`, `@font-face`), runs code in an old engine (`expression(`, `behavior`,
 * `-moz-binding`, `javascript:`), or hides a token from this check (`\`, a CSS escape).
 */
const UNSAFE_CSS_TOKENS: readonly string[] = [
  "url(",
  "image(",
  "image-set(",
  "cross-fade(",
  "element(",
  "src(",
  "@import",
  "@font-face",
  "@namespace",
  "expression(",
  "behavior",
  "-moz-binding",
  "javascript:",
  "\\",
];

/** A complete quoted string, either quote. */
const QUOTED = /"[^"]*"|'[^']*'/g;

/** One token of comment-free, quote-balanced CSS: a quoted string, a parenthesis, a `;`, or a run of anything else. */
const CSS_TOKEN = /"[^"]*"|'[^']*'|[();]|[^"'();]+/g;

/** One declaration's shape: a property name, a colon, a value. */
const DECLARATION = /^\s*(-?[a-z][a-z0-9-]*)\s*:([^]*)$/i;

/** Whether a comment-free CSS run carries an unsafe token. */
function cssIsUnsafe({ css }: { css: string }): boolean {
  const squeezed = css.toLowerCase().replace(/\s+/g, "");
  return UNSAFE_CSS_TOKENS.some((token) => squeezed.includes(token));
}

/**
 * CSS with its comments removed, or undefined when a comment never closes — an unterminated comment swallows the rest
 * in a browser.
 */
function withoutCssComments({ css }: { css: string }): string | undefined {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf("/*", index);
    if (open === -1) {
      return out + css.slice(index);
    }
    const close = css.indexOf("*/", open + 2);
    if (close === -1) {
      return undefined;
    }
    out += `${css.slice(index, open)} `;
    index = close + 2;
  }
  return out;
}

/** How one token moves the parenthesis depth. */
function parenDelta({ token }: { token: string }): number {
  if (token === "(") {
    return 1;
  }
  if (token === ")") {
    return -1;
  }
  return 0;
}

/**
 * An inline style split into declarations at `;` outside strings and parentheses, or undefined when a string or a
 * parenthesis never closes.
 */
function splitDeclarations({ css }: { css: string }): readonly string[] | undefined {
  if (/["']/.test(css.replace(QUOTED, ""))) {
    return undefined;
  }
  const declarations: string[] = [];
  let current = "";
  let depth = 0;
  for (const [token] of css.matchAll(CSS_TOKEN)) {
    if (token === ";" && depth === 0) {
      declarations.push(current);
      current = "";
      continue;
    }
    depth += parenDelta({ token });
    if (depth < 0) {
      return undefined;
    }
    current += token;
  }
  if (depth !== 0) {
    return undefined;
  }
  declarations.push(current);
  return declarations;
}

/** One declaration as kept — `name: value` — or undefined when it is malformed, unsafe or empty. */
function keptDeclaration({ declaration }: { declaration: string }): string | undefined {
  const match = DECLARATION.exec(declaration);
  if (match === null || cssIsUnsafe({ css: declaration }) || /[<>]/.test(declaration)) {
    return undefined;
  }
  const [, property, value] = match;
  if (property === undefined || value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const name = property.toLowerCase();
  if (name === "position" && /^(?:fixed|sticky)\b/i.test(value.trim())) {
    return undefined;
  }
  return `${name}: ${value.trim()}`;
}

/**
 * An inline `style` value reduced to its safe declarations; empty when none survives.
 *
 * `position: fixed` and `sticky` are dropped too: neither fetches, but either lets a mail paint over the card it sits in.
 *
 * @param css the attribute's value, entity-decoded by the parser — so `&#117;rl(` is already `url(` here
 * @returns the kept declarations, `; `-joined
 */
export function sanitizeInlineStyle({ css }: { css: string }): string {
  const plain = withoutCssComments({ css });
  if (plain === undefined) {
    return "";
  }
  const declarations = splitDeclarations({ css: plain });
  if (declarations === undefined) {
    return "";
  }
  return declarations
    .map((declaration) => keptDeclaration({ declaration }))
    .filter((kept) => kept !== undefined)
    .join("; ");
}

/**
 * A `<style>` block kept whole, or undefined when any part of it is unsafe.
 *
 * Deliberately all-or-nothing rather than repaired: beyond the inline checks, a block may hold no at-rule but
 * `@media`, no `position: fixed|sticky`, and no `<` — the text is written raw inside `<style>`, where `</style` would
 * end it.
 *
 * @param css the block's text
 * @returns the block's text when safe
 */
export function sanitizeStyleBlock({ css }: { css: string }): string | undefined {
  const plain = withoutCssComments({ css });
  if (plain === undefined || plain.includes("<") || cssIsUnsafe({ css: plain })) {
    return undefined;
  }
  for (const atRule of plain.matchAll(/@([a-z-]*)/gi)) {
    if (atRule[1]?.toLowerCase() !== "media") {
      return undefined;
    }
  }
  if (/position\s*:\s*(?:fixed|sticky)/i.test(plain)) {
    return undefined;
  }
  return plain;
}
