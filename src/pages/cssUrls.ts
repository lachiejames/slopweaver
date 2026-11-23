/**
 * Every address a stylesheet loads, read the way the CSS tokenizer reads it: each `url()`, each `@import` string, and
 * each bare string at the top level of an `image-set()` or `-webkit-image-set()`, in order, with comments skipped and
 * escapes resolved so `\66 ile:` is still a `file:` address and `\75rl(` still a `url(`.
 *
 * A string nested deeper inside an `image-set()` is not an address: `type("image/png")` names a media type. So the
 * scan keeps one frame per open parenthesis and reads a string only when the innermost frame is an `image-set()`'s
 * own (Codex review, r3: a sheet's `image-set("../../secret.png" 1x)` loaded a file outside the page unread).
 *
 * What it does NOT model, on purpose: the tokenizer's bad-url rule. An unquoted `url(a b.png)` is a bad-url token a
 * browser never fetches, and this still reads `a b.png`, so a publish stores that one unused file from its
 * `--assets-from`, under every check any other file passes. Reading MORE than a browser loads stores a spare file;
 * reading less ships a page that 404s, so the scan errs this way (Codex review r3, put to the owner as by design).
 *
 * Pure: a string in, addresses out.
 */

/** The function names whose top-level strings are image addresses. */
const IMAGE_SET_NAMES: ReadonlySet<string> = new Set(["image-set", "-webkit-image-set"]);

/** Where the scan stands between steps. */
interface ScanState {
  /** An `@import` was read and its string has not come yet. */
  readonly afterImport: boolean;
  /** One entry per open parenthesis, innermost last: whether it opened an `image-set()`. */
  readonly frames: readonly boolean[];
}

/** One step's result: the address it read, if any, the state after it, and where the next step starts. */
interface ScanStep {
  readonly url: string | undefined;
  readonly state: ScanState;
  readonly next: number;
}

/** Whether a character is a hex digit, which is what a CSS escape's code point is spelled in. */
function isHex({ char }: { char: string | undefined }): boolean {
  return char !== undefined && /^[\da-f]$/iu.test(char);
}

/**
 * One CSS escape starting at the backslash `at`, resolved: up to six hex digits and one optional whitespace,
 * or the next character as itself.
 *
 * @returns the character it stands for and the index after it
 */
function cssEscape({ css, at }: { css: string; at: number }): { char: string; next: number } {
  let end = at + 1;
  while (end < at + 7 && isHex({ char: css[end] })) {
    end += 1;
  }
  if (end === at + 1) {
    // A backslash ending the sheet escapes nothing; a browser reads it as U+FFFD.
    const next = css[at + 1];
    if (next === undefined) {
      return { char: "�", next: at + 2 };
    }
    return { char: next, next: at + 2 };
  }
  const point = Number.parseInt(css.slice(at + 1, end), 16);
  const next = css[end] !== undefined && /\s/u.test(css[end]!) ? end + 1 : end;
  return { char: point === 0 || point > 0x10_ff_ff ? "�" : String.fromCodePoint(point), next };
}

/**
 * A quoted CSS string opening at `at`, its escapes resolved.
 *
 * @returns its value and the index after its closing quote, or after the line it broke on
 */
function cssString({ css, at }: { css: string; at: number }): { value: string; next: number } {
  const quote = css[at];
  let value = "";
  let index = at + 1;
  while (index < css.length && css[index] !== quote && css[index] !== "\n") {
    if (css[index] === "\\") {
      if (css[index + 1] === "\n") {
        index += 2;
        continue;
      }
      const escaped = cssEscape({ at: index, css });
      value += escaped.char;
      index = escaped.next;
      continue;
    }
    value += css[index]!;
    index += 1;
  }
  return { next: index + 1, value };
}

/**
 * The address inside a `url(` whose parenthesis closes at `open`, quoted or not, its escapes resolved.
 *
 * @returns the address and the index after its closing parenthesis
 */
function cssUrl({ css, open }: { css: string; open: number }): { value: string; next: number } {
  let index = open + 1;
  while (index < css.length && /\s/u.test(css[index]!)) {
    index += 1;
  }
  if (css[index] === '"' || css[index] === "'") {
    const quoted = cssString({ at: index, css });
    const close = css.indexOf(")", quoted.next);
    return { next: close === -1 ? css.length : close + 1, value: quoted.value };
  }
  let value = "";
  while (index < css.length && css[index] !== ")") {
    if (css[index] === "\\") {
      const escaped = cssEscape({ at: index, css });
      value += escaped.char;
      index = escaped.next;
      continue;
    }
    value += css[index]!;
    index += 1;
  }
  return { next: index + 1, value: value.trim() };
}

/**
 * Every address a stylesheet loads: each `url()`, each `@import` string and each top-level `image-set()` string, in
 * order, with comments skipped and escapes resolved.
 *
 * @param css a stylesheet, or one `style` attribute's declarations
 * @returns the addresses as a browser would read them
 */
export function cssUrls({ css }: { css: string }): readonly string[] {
  const urls: string[] = [];
  let index = 0;
  let state: ScanState = { afterImport: false, frames: [] };
  while (index < css.length) {
    const step = cssToken({ css, index, state });
    if (step.url !== undefined) {
      urls.push(step.url);
    }
    state = step.state;
    index = step.next;
  }
  return urls;
}

/**
 * One step of the scan from `index`: a comment, a string, an at-keyword, a parenthesis, or what `identToken` reads.
 *
 * @returns the address this step read if it loads one, the state after it, and where the next step starts
 */
function cssToken({ css, index, state }: { css: string; index: number; state: ScanState }): ScanStep {
  if (css.startsWith("/*", index)) {
    const close = css.indexOf("*/", index + 2);
    return { next: close === -1 ? css.length : close + 2, state, url: undefined };
  }
  const char = css[index]!;
  if (char === '"' || char === "'") {
    const quoted = cssString({ at: index, css });
    const loads = state.afterImport || state.frames.at(-1) === true;
    return { next: quoted.next, state: { ...state, afterImport: false }, url: loads ? quoted.value : undefined };
  }
  if (char === "@") {
    const keyword = cssIdent({ at: index + 1, css });
    const afterImport = keyword.name.toLowerCase() === "import";
    return { next: keyword.next, state: { ...state, afterImport }, url: undefined };
  }
  if (char === "(" || char === ")") {
    const frames = char === "(" ? [...state.frames, false] : state.frames.slice(0, -1);
    return { next: index + 1, state: { afterImport: false, frames }, url: undefined };
  }
  return identToken({ css, index, state });
}

/**
 * One step that starts on anything but a comment, string, at-keyword or parenthesis: a name, read whole, which a
 * `url(` follows into its address and any other `(` opens a frame for, or a single other character.
 *
 * @returns the address a `url(` loads, the state after the step, and where the next step starts
 */
function identToken({ css, index, state }: { css: string; index: number; state: ScanState }): ScanStep {
  const ident = cssIdent({ at: index, css });
  if (ident.next === index) {
    const afterImport = state.afterImport && /\s/u.test(css[index]!);
    return { next: index + 1, state: { ...state, afterImport }, url: undefined };
  }
  const name = ident.name.toLowerCase();
  const opens = css[ident.next] === "(";
  if (opens && name === "url") {
    const read = cssUrl({ css, open: ident.next });
    return { next: read.next, state: { ...state, afterImport: false }, url: read.value };
  }
  if (opens) {
    const frames = [...state.frames, IMAGE_SET_NAMES.has(name)];
    return { next: ident.next + 1, state: { afterImport: false, frames }, url: undefined };
  }
  return { next: ident.next, state: { ...state, afterImport: false }, url: undefined };
}

/**
 * The name starting at `at` with its escapes resolved, as the CSS tokenizer reads an identifier, so `@\69mport` is
 * `@import` and `\75rl(` is `url(` (Codex review, r3). A name is read whole, so `myurl(` is never a `url(`.
 *
 * @returns the name, "" when none starts at `at`, and the index after it
 */
function cssIdent({ css, at }: { css: string; at: number }): { name: string; next: number } {
  let name = "";
  let index = at;
  while (index < css.length) {
    const char = css[index]!;
    const escapes = char === "\\" && index + 1 < css.length && css[index + 1] !== "\n";
    if (escapes) {
      const escaped = cssEscape({ at: index, css });
      name += escaped.char;
      index = escaped.next;
      continue;
    }
    if (!/[\w\u0080-\u{10FFFF}-]/u.test(char)) {
      break;
    }
    name += char;
    index += 1;
  }
  return { name, next: index };
}
