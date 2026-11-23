/**
 * An HTML document named in a card's prose by its file name rather than cited by an address the owner can open — the
 * criterion `handover` and `hand` verbs refuse at the write, the HTML half of `./cardImage.ts`.
 *
 * Any HTML mentioned in a draft or card is cited so the owner can open it in the viewer. A file name is text
 * nothing on the console opens; the page published and cited by its viewer address, or attached to the draft (whose
 * card then carries an "Open in the viewer" chip, `site/lib/previewModal.ts`), is the thing the owner can press.
 *
 * **The criterion**: a whitespace-separated token, its wrapping punctuation stripped, whose last segment is a file
 * name ending in `.html` or `.htm`, and which carries no `http://` or `https://` — a bare name, a path, a `~` path or
 * a `file://` address. A web address to an HTML file is a citation and passes, a markdown link's target included.
 * Case-insensitive.
 *
 * Pure: no I/O.
 */

/** A token naming an HTML document as its last segment. */
const HTML_FILE = /[^/\\]+\.html?$/iu;

/** What a citation carries and a file name never does. */
const WEB_ADDRESS = /https?:\/\//iu;

/** What wraps a token in prose without being part of the name: quotes, brackets, code ticks, trailing stops. */
const WRAPPING = /^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$/gu;

/** The fix every refusal names, after the verb-specific half. */
const PUBLISH =
  "publish it with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
  "`slopweaver page review-prepare`) and cite the viewer address it prints";

/**
 * Every HTML document one piece of prose names by file name rather than address, in order, each once.
 *
 * @param text the prose a card will draw
 * @returns the tokens naming an HTML file, as written less their wrapping punctuation
 */
export function bareHtmlFiles({ text }: { text: string }): readonly string[] {
  const named: string[] = [];
  for (const raw of text.split(/\s+/u)) {
    const token = raw.replace(WRAPPING, "");
    if (HTML_FILE.test(token) && !WEB_ADDRESS.test(token) && !named.includes(token)) {
      named.push(token);
    }
  }
  return named;
}

/**
 * Why one field's prose may not be drawn, written to follow the field's name, or `undefined` when it names no HTML
 * file.
 *
 * @param text the field's prose
 * @param cite how this card carries the address, said after the publish step — `pass that address as --url`
 * @returns the clause naming the files and the fix, or `undefined`
 */
export function bareHtmlWhy({ text, cite }: { text: string; cite: string }): string | undefined {
  const files = bareHtmlFiles({ text });
  if (files.length === 0) {
    return undefined;
  }
  const quoted = files.map((file) => `"${file}"`).join(", ");
  return (
    `names the HTML ${quoted} as a file name, which nothing on the console opens — ${PUBLISH}, ${cite}, ` +
    "or attach it to the draft so its card carries an Open in the viewer chip"
  );
}

/** How an ask's card carries a citation: an address in its words, which the card draws as a link. */
const ASK_HTML_CITE = "writing that address into the card in its place";

/**
 * The refusal lines for every labelled field of an ask that names an HTML file, empty when none does.
 *
 * @param fields each field the card draws, with how a refusal names it
 * @returns one sentence per field naming one
 */
export function askHtmlProblems({
  fields,
}: {
  fields: readonly { readonly label: string; readonly text: string }[];
}): readonly string[] {
  return fields.flatMap((field) => {
    const why = bareHtmlWhy({ cite: ASK_HTML_CITE, text: field.text });
    return why === undefined ? [] : [`${field.label} ${why}`];
  });
}
