/**
 * Find every Web API method's name, description and argument and response types in the SDK's `methods.d.ts`.
 *
 * Pure: it takes the declaration TEXT and returns heads. `sdkTypings.ts` resolves each head's types into the
 * members a method accepts and returns.
 *
 * ## Three JSDoc shapes, all real
 *
 * The SDK's own `@see` tags are not uniform, and a parser that assumed they were silently lost four
 * methods — `search.all`, `search.files`, `search.messages` (whose tag drops the opening backtick, so the
 * name is followed by a stray one) and `entity.presentDetails` (whose tag has no `API reference` tail at
 * all). Silently, because a missing method looks exactly like a method that does not exist. So the anchor
 * is the LINK PREFIX and everything after the name is ignored up to the declaration itself.
 */

/** The literal that precedes every method's canonical dotted name in the SDK's JSDoc. */
const DOCS_LINK_PREFIX = "@see {@link https://docs.slack.dev/reference/methods/";

/** The JSDoc tag carrying a method's one-line description, when it has one. */
const DESCRIPTION_TAG = "@description ";

/** A method name paired with the argument and response types its declaration names. */
interface MethodHead {
  readonly name: string;
  readonly description: string;
  readonly argsType: string | undefined;
  readonly responseType: string | undefined;
}

/**
 * The description immediately above a docs link, if the same comment block carries one.
 *
 * @param text the whole source
 * @param linkAt the index of the docs-link prefix
 * @returns the description with its comment leader stripped, or `""` when the block declares none
 */
function descriptionAbove({ text, linkAt }: { text: string; linkAt: number }): string {
  const blockStart = text.lastIndexOf("/**", linkAt);
  if (blockStart === -1) {
    return "";
  }
  const tagAt = text.indexOf(DESCRIPTION_TAG, blockStart);
  if (tagAt === -1 || tagAt > linkAt) {
    return "";
  }
  return text
    .slice(tagAt + DESCRIPTION_TAG.length, linkAt)
    .replace(/\*\s*$/, "")
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^\*\s?/, "")
        .trim(),
    )
    .join(" ")
    .trim();
}

/**
 * The `Method…<Args, Response>` declaration that follows a docs link.
 *
 * @param text the whole source
 * @param from the index just past the docs link's method name
 * @returns the two generic arguments, or `undefined` when no method declaration follows
 */
function methodTypesAfter({
  text,
  from,
}: {
  text: string;
  from: number;
}): { args?: string; response?: string } | undefined {
  const close = text.indexOf("*/", from);
  const open = text.indexOf("<", close === -1 ? from : close);
  const methodAt = text.indexOf("Method", close === -1 ? from : close);
  if (close === -1 || open === -1 || methodAt === -1 || methodAt > open) {
    return undefined;
  }
  const end = text.indexOf(">", open);
  if (end === -1) {
    return undefined;
  }
  const [args, response] = text
    .slice(open + 1, end)
    .split(",")
    .map((part) => part.trim());
  return { ...(args === undefined || args === "" ? {} : { args }), ...(response === undefined ? {} : { response }) };
}

/**
 * Every method the SDK declares, by name. `api.test` is declared twice under different families; the first
 * wins, so the count is of distinct API methods rather than of declarations.
 *
 * @param methodsText the contents of the SDK's `methods.d.ts`
 * @returns one head per distinct method name, in declaration order
 */
export function methodHeads({ methodsText }: { methodsText: string }): readonly MethodHead[] {
  const heads = new Map<string, MethodHead>();
  let linkAt = methodsText.indexOf(DOCS_LINK_PREFIX);
  while (linkAt !== -1) {
    const nameFrom = linkAt + DOCS_LINK_PREFIX.length;
    let nameEnd = nameFrom;
    while (nameEnd < methodsText.length && /[A-Za-z0-9._]/.test(methodsText.charAt(nameEnd))) {
      nameEnd += 1;
    }
    const name = methodsText.slice(nameFrom, nameEnd);
    const types = methodTypesAfter({ from: nameEnd, text: methodsText });
    if (name !== "" && types !== undefined && !heads.has(name)) {
      heads.set(name, {
        argsType: types.args,
        description: descriptionAbove({ linkAt, text: methodsText }),
        name,
        responseType: types.response,
      });
    }
    linkAt = methodsText.indexOf(DOCS_LINK_PREFIX, nameEnd);
  }
  return [...heads.values()];
}
