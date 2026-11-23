/**
 * A JSON string's escapes undone, with a map from every unescaped character back to where it came from — so a
 * credential found in the unescaped copy is masked at the right place in the original.
 *
 * Why it exists: a Claude or Codex transcript is JSONL, and a config file quoted into one reads
 * `\"password\": \"x\"` and `\n  password: x`. Every value pass needs a real quote, `=` or line start beside its
 * key, so none fired (a JSON-encoded transcript row returned its password in clear, and
 * `~/.claude/history.jsonl` and the session logs are readable files).
 */

/** An unescaped text and where each of its characters started in the source. */
export interface Unescaped {
  readonly text: string;
  /** `origin[i]` is the source offset of `text[i]`; `origin[text.length]` is the source's own length. */
  readonly origin: readonly number[];
}

/** The single-character escapes JSON defines, as what they decode to. */
const SIMPLE: Readonly<Record<string, string>> = {
  '"': '"',
  "/": "/",
  "\\": "\\",
  b: " ",
  f: " ",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Undo one level of JSON string escaping over a whole text, leaving anything that is not an escape as it is.
 *
 * @param text the source, which need not be valid JSON — a window cut from a JSONL file rarely is
 * @returns the unescaped copy and its origin map, or `undefined` when the text holds no backslash to undo
 */
export function unescapeJson({ text }: { text: string }): Unescaped | undefined {
  if (!text.includes("\\")) {
    return undefined;
  }
  let out = "";
  const origin: number[] = [];
  let at = 0;
  while (at < text.length) {
    const escape = escapeAt({ at, text });
    out += escape.char;
    origin.push(at);
    at += escape.width;
  }
  origin.push(text.length);
  return { origin, text: out };
}

/** The character a source position decodes to, and how many source characters it takes. */
function escapeAt({ text, at }: { text: string; at: number }): { char: string; width: number } {
  const here = text[at]!;
  if (here !== "\\" || at + 1 >= text.length) {
    return { char: here, width: 1 };
  }
  const next = text[at + 1]!;
  const simple = SIMPLE[next];
  if (simple !== undefined) {
    return { char: simple, width: 2 };
  }
  const hex = text.slice(at + 2, at + 6);
  if (next === "u" && /^[0-9a-f]{4}$/iu.test(hex)) {
    return { char: String.fromCharCode(Number.parseInt(hex, 16)), width: 6 };
  }
  return { char: here, width: 1 };
}
