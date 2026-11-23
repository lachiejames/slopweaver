/**
 * Reading the SHAPE of a JSON credential file without ever assembling one of its values.
 *
 * ## Why this exists rather than `JSON.parse`
 *
 * `$CODEX_HOME/auth.json` holds live OAuth material. `./auth.ts` needs three facts out of it — the auth mode,
 * whether a `tokens` object is present and non-empty, and whether an API key is configured — and every one is
 * answerable from the file's STRUCTURE. `JSON.parse` cannot answer them that way: it builds every value in
 * the document, so the access token and the refresh token become live strings in a retained object graph a
 * later reader can print. Two Codex reviews of the parsing version found exactly that.
 *
 * So this walks the text and **skips** values instead of building them. The only characters it accumulates
 * are top-level KEY NAMES (not secrets — `tokens`, `auth_mode`, `OPENAI_API_KEY`) and, when the caller names
 * a key as non-sensitive, that key's value. A token's characters are advanced over by index.
 *
 * ## It does NOT decide whether the document is valid JSON, and that is deliberate
 *
 * It tried, and three review rounds found three holes in the hand-derived grammar: a bare token, a nested
 * bare token, a trailing comma. Writing a third JSON parser to avoid the one the platform ships is how that
 * list keeps growing. `./auth.ts` asks `JSON.parse` for validity — discarding its result — and only calls
 * this scanner on a document already known to be well formed. What `wellFormed` reports here is therefore
 * the weaker claim it can actually keep: the walk reached a closing brace without losing its place.
 *
 * **What remains true, stated rather than glossed.** The file's bytes are in a transient read buffer, as they
 * are for anything that opens the file at all. What this removes is the extraction: no credential value is
 * located, assembled, bound to a name, returned, logged or stored.
 *
 * Pure — the caller supplies the text, so every branch is a fixture test.
 */

/** What a scan established about one top-level key. */
export interface JsonKeyShape {
  /** The key was present at the top level of the document. */
  readonly present: boolean;
  /** The value was the literal `null`. */
  readonly isNull: boolean;
  /** The value was an object or array carrying at least one member. `false` for every other value kind. */
  readonly nonEmptyContainer: boolean;
  /**
   * The value as text, and ONLY when the caller named this key as non-sensitive.
   *
   * Opt-in by construction: a key the caller did not name is skipped by index, so there is no code path that
   * can capture a value the caller did not ask for by name.
   */
  readonly text: string | undefined;
}

/** What a whole scan found. */
export interface JsonShapeScan {
  /** The walk reached a closing brace without losing its place. NOT a grammar verdict — see the header. */
  readonly wellFormed: boolean;
  readonly keys: ReadonlyMap<string, JsonKeyShape>;
}

/** Characters that end a bare token: JSON structure, or whitespace. */
const STRUCTURE = ",:{}[] \t\n\r";

/** The two characters that open a JSON container. */
const OPENS = "{[";

/** The two that close one. */
const CLOSES = "}]";

/** Whether the character at `index` is JSON whitespace. */
function isSpaceAt({ index, text }: { index: number; text: string }): boolean {
  const char = text.charAt(index);
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/** The index of the first character at or after `from` that is not JSON whitespace. */
function skipSpace({ from, text }: { from: number; text: string }): number {
  let index = from;
  while (index < text.length && isSpaceAt({ index, text })) {
    index += 1;
  }
  return index;
}

/**
 * Walk over a JSON string starting at its opening quote, honouring backslash escapes.
 *
 * @param from the index of the opening `"`
 * @returns the index just past the closing quote, or the text length when the string never closes
 */
function skipString({ from, text }: { from: number; text: string }): number {
  let index = from + 1;
  while (index < text.length) {
    if (text.charAt(index) === "\\") {
      index += 2;
      continue;
    }
    if (text.charAt(index) === '"') {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

/**
 * Read a JSON string starting at its opening quote.
 *
 * Called ONLY for a key name and for a value the caller named as non-sensitive — never on a value reached by
 * the skip path. Escape sequences are kept verbatim rather than decoded: the two callers compare against
 * plain ASCII names, and decoding would be a second parser to get wrong.
 *
 * @param from the index of the opening `"`
 * @returns the string's contents and the index just past its closing quote
 */
function readString({ from, text }: { from: number; text: string }): { readonly value: string; readonly next: number } {
  const next = skipString({ from, text });
  const closed = next <= text.length && text.charAt(next - 1) === '"';
  return { next, value: text.slice(from + 1, closed ? next - 1 : text.length) };
}

/**
 * Walk over one JSON value of any kind, without accumulating any of its characters.
 *
 * The load-bearing function: a token's bytes are advanced over by index here and never assembled. Nesting is
 * tracked with a depth counter rather than recursion, so a pathological document costs stack nothing, and a
 * string inside a container is skipped as a string so its contents can never be read as structure.
 *
 * @param from the index of the value's first character
 * @returns the index just past the value, or the text length when it never terminates
 */
function skipValue({ from, text }: { from: number; text: string }): number {
  const index = skipSpace({ from, text });
  const first = text.charAt(index);
  if (first === '"') {
    return skipString({ from: index, text });
  }
  if (first === "{" || first === "[") {
    return skipContainer({ from: index, text });
  }
  return skipBareToken({ from: index, text });
}

/** Walk past a bare (unquoted) token — a literal or a number — to the first structural character after it. */
function skipBareToken({ from, text }: { from: number; text: string }): number {
  let index = from;
  while (index < text.length && !STRUCTURE.includes(text.charAt(index))) {
    index += 1;
  }
  return index;
}

/**
 * Walk past a whole object or array, counting depth and skipping strings as strings.
 *
 * Skipping a string wholesale is the part that matters: a brace inside a token value is DATA, and counting it
 * as structure would end the container early and let the document's own contents be read as a key.
 *
 * @param from the index of the opening `{` or `[`
 * @returns the index just past the matching close, or the text length when it never closes
 */
function skipContainer({ from, text }: { from: number; text: string }): number {
  let index = from;
  let depth = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '"') {
      index = skipString({ from: index, text });
      continue;
    }
    depth += OPENS.includes(char) ? 1 : 0;
    depth -= CLOSES.includes(char) ? 1 : 0;
    index += 1;
    if (depth === 0) {
      return index;
    }
  }
  return text.length;
}

/**
 * Whether a container value starting at `from` carries at least one member.
 *
 * @param from the index of the opening `{` or `[`
 * @returns true when the next non-whitespace character is not the matching close
 */
function containerHasMember({ from, text }: { from: number; text: string }): boolean {
  const open = text.charAt(from);
  if (open !== "{" && open !== "[") {
    return false;
  }
  const inner = skipSpace({ from: from + 1, text });
  return inner < text.length && text.charAt(inner) !== "}" && text.charAt(inner) !== "]";
}

/** What one top-level member's value is shaped like, and where it ends. */
function memberShape({ capture, text, valueAt }: { capture: boolean; text: string; valueAt: number }): {
  readonly shape: JsonKeyShape;
  readonly next: number;
} {
  const isString = text.charAt(valueAt) === '"';
  return {
    next: skipValue({ from: valueAt, text }),
    shape: {
      isNull: text.startsWith("null", valueAt),
      nonEmptyContainer: containerHasMember({ from: valueAt, text }),
      present: true,
      text: capture && isString ? readString({ from: valueAt, text }).value : undefined,
    },
  };
}

/**
 * Scan a JSON object's top-level keys, capturing a value only for a key the caller declares non-sensitive.
 *
 * @param text the whole document — expected to be valid JSON already (see the module header)
 * @param captureText the top-level keys whose values are safe to read as text; anything else is skipped by
 *   index, so a key absent from this set has no path by which its value could be captured
 * @returns what each top-level key's value is shaped like, and whether the walk kept its place
 */
export function scanJsonShape({
  text,
  captureText,
}: {
  text: string;
  captureText: ReadonlySet<string>;
}): JsonShapeScan {
  const keys = new Map<string, JsonKeyShape>();
  let index = skipSpace({ from: 0, text });
  if (text.charAt(index) !== "{") {
    return { keys, wellFormed: false };
  }
  index = skipSpace({ from: index + 1, text });
  while (index < text.length && text.charAt(index) !== "}") {
    if (text.charAt(index) !== '"') {
      return { keys, wellFormed: false };
    }
    const key = readString({ from: index, text });
    index = skipSpace({ from: key.next, text });
    if (text.charAt(index) !== ":") {
      return { keys, wellFormed: false };
    }
    const valueAt = skipSpace({ from: index + 1, text });
    const member = memberShape({ capture: captureText.has(key.value), text, valueAt });
    keys.set(key.value, member.shape);
    index = skipSpace({ from: member.next, text });
    if (text.charAt(index) === ",") {
      index = skipSpace({ from: index + 1, text });
    }
  }
  return { keys, wellFormed: text.charAt(index) === "}" };
}

/**
 * The shape a scan found for one key, defaulted to absent.
 *
 * A total accessor rather than a map lookup at each call site, so "the scan did not see this key" and "the
 * scan saw it and it was empty" are both spellable and neither is an `undefined` a caller has to branch on.
 *
 * @param scan what {@link scanJsonShape} returned
 * @param key the top-level key to report on
 * @returns that key's shape, or an all-false reading when the scan never saw it
 */
export function keyShape({ scan, key }: { scan: JsonShapeScan; key: string }): JsonKeyShape {
  const found = scan.keys.get(key);
  if (found === undefined) {
    return { isNull: false, nonEmptyContainer: false, present: false, text: undefined };
  }
  return found;
}
