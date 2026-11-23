/**
 * A service's own error words, lifted out of a failure's text and decoded so they read as the service wrote them.
 */

/** A service's own error words inside a failure's text: the first `message`, `error` or `error_description` string. */
const SERVICE_WORDS = /"(?:message|error_description|error)"\s*:\s*"((?:[^"\\]|\\.)+)"/;

/** One escape inside a JSON string: a `\u` code unit, or a backslash and the one character it escapes. */
const JSON_ESCAPE = /\\(?:u[\dA-Fa-f]{4}|.)/g;

/** What each single-character JSON escape stands for; `"`, `\` and `/` stand for themselves. */
const JSON_ESCAPES: Readonly<Record<string, string>> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * One JSON escape decoded, so a service's words read as it wrote them ("café" is "café"). A
 * surrogate pair decodes one half at a time and the halves rejoin in the string; an escape JSON does not define
 * reads as the character after the backslash.
 */
function unescapedOf({ escape }: { escape: string }): string {
  if (escape.startsWith(String.raw`\u`)) {
    return String.fromCodePoint(Number.parseInt(escape.slice(2), 16));
  }
  const escaped = escape.slice(1);
  const control = JSON_ESCAPES[escaped];
  if (control === undefined) {
    return escaped;
  }
  return control;
}

/**
 * The first `message`, `error` or `error_description` string a service wrote into a failure's text, with every
 * JSON escape in it decoded.
 *
 * @param raw a failure's own reason or a sync run's error, verbatim
 * @returns the service's words as it wrote them, or `null` when the text carries none
 */
export function serviceWordsOf({ raw }: { raw: string }): string | null {
  const found = SERVICE_WORDS.exec(raw);
  if (found === null) {
    return null;
  }
  return found[1]!.replaceAll(JSON_ESCAPE, (escape) => unescapedOf({ escape }));
}
