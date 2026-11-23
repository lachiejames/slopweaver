/**
 * A picture named in a card's prose, which the card can only draw as text — the criterion `handover` and `hand`
 * verbs refuse at the write, so the picture is attached instead (`handover shot`, `hand post --shot`) and drawn.
 *
 * An image belongs on the queue card itself. A still-real line carrying `~/.slopweaver/proof/…/span-profiles-tab.png`
 * is a raw text path, and nothing on the console renders a path as a picture, so the words of the card point at a
 * picture the owner never sees.
 *
 * **The criterion**: a whitespace-separated token, its wrapping punctuation stripped, whose last segment is a
 * file name ending in `.png`, `.jpg`, `.jpeg`, `.webp` or `.gif` — a bare name, a path, a `~` path or a URL. A
 * URL is named too: the card draws it as a link to a file, not as the picture. Case-insensitive.
 *
 * Pure: no I/O.
 */

/** The picture formats a card would want drawn rather than named. */
const IMAGE_FILE = /[^/\\]+\.(?:png|jpe?g|webp|gif)$/iu;

/** What wraps a token in prose without being part of the name: quotes, brackets, code ticks, trailing stops. */
const WRAPPING = /^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$/gu;

/**
 * Every picture file one piece of prose names, in order, each once.
 *
 * @param text the prose a card will draw
 * @returns the tokens naming a picture file, as written less their wrapping punctuation
 */
export function namedImageFiles({ text }: { text: string }): readonly string[] {
  const named: string[] = [];
  for (const raw of text.split(/\s+/u)) {
    const token = raw.replace(WRAPPING, "");
    if (IMAGE_FILE.test(token) && !named.includes(token)) {
      named.push(token);
    }
  }
  return named;
}

/**
 * The refusal line for one field naming pictures, or `undefined` when it names none.
 *
 * @param label how the refusal names the field — `the question`, `the still-real check`
 * @param text the field's prose
 * @param attach the verb that attaches a picture to this card instead
 * @returns one sentence naming the files and the fix, or `undefined`
 */
export function namedImageProblem({
  label,
  text,
  attach,
}: {
  label: string;
  text: string;
  attach: string;
}): string | undefined {
  const files = namedImageFiles({ text });
  if (files.length === 0) {
    return undefined;
  }
  const quoted = files.map((file) => `"${file}"`).join(", ");
  return (
    `${label} names the picture ${quoted} as text, which the card draws as a path the owner cannot see — attach it with ` +
    `${attach} --shot <png> --box x,y,width,height=<label> so the card shows it with a box on what to read, and ` +
    "say in words what it shows"
  );
}

/** The verb that attaches a picture to an ask's card. */
export const ASK_SHOT_VERB = "slopweaver handover shot <slug>";

/**
 * An ask's example scenes and gap line as the labelled fields a refusal names — the card draws both as prose.
 *
 * @param examples the `--example` scenes, in the order the card numbers them
 * @param gap the `--example-gap` line, when one was passed
 * @returns one labelled field per scene, then the gap
 */
export function exampleProseFields({
  examples,
  gap,
}: {
  examples: readonly string[];
  gap: string | undefined;
}): readonly { readonly label: string; readonly text: string }[] {
  return [
    ...examples.map((text, index) => ({ label: `example ${String(index + 1)}`, text })),
    ...(gap === undefined ? [] : [{ label: "the example gap", text: gap }]),
  ];
}

/**
 * The refusal lines for every labelled field of an ask that names a picture, empty when none does.
 *
 * @param fields each field the card draws, with how a refusal names it
 * @returns one sentence per field naming a picture
 */
export function askImageProblems({
  fields,
}: {
  fields: readonly { readonly label: string; readonly text: string }[];
}): readonly string[] {
  return fields.flatMap((field) => {
    const problem = namedImageProblem({ attach: ASK_SHOT_VERB, label: field.label, text: field.text });
    return problem === undefined ? [] : [problem];
  });
}
