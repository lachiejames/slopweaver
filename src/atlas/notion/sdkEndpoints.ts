/**
 * Enumerate every REST endpoint the installed `@notionhq/client` declares, from the package's own generated
 * sources.
 *
 * Pure: it takes one module's declaration TEXT and returns rows, so the whole extraction is unit-testable
 * with no `node_modules` present. The effectful half — finding and reading those files — is `sdkRead.ts`.
 *
 * ## Why the generated `.js` rather than the `.d.ts`
 *
 * Both carry `method`, `pathParams`, `queryParams` and `bodyParams`, and only the `.js` carries the PATH:
 * the declaration reduces `path` to `(p: GetUserPathParameters) => string` and throws the template away. The
 * path is the reproduction handle every atlas record owes a reader — `AtlasSource.endpoint` — so a parser
 * that read the declarations alone would produce 48 rows that cannot say what any of them addresses. Both
 * files carry the same JSDoc description, so nothing else is lost by reading the one that has everything.
 *
 * ## Scanning, not matching
 *
 * Every parser here finds a short literal anchor and walks forward by hand, the same discipline
 * `slackApi/sdkTypings.ts` arrived at: the shapes a regex would want here — a lazy run up to an optional
 * group, a bracketed list that may be empty — are exactly the ones the `redos-check` gate flags as
 * polynomial-backtracking.
 *
 * ## An endpoint the SDK declares is not an endpoint this token may call
 *
 * These rows are the API surface's DECLARED denominator and nothing more. Whether a call is authorised is a
 * property of the integration's capabilities, which no file in the package knows — so a row here never
 * claims reach, and `sync.ts` is what turns a subset of them into observed coverage.
 */

/** One endpoint the SDK declares, as the package's own generated source states it. */
export interface NotionSdkEndpoint {
  /** The `api-endpoints/<module>.js` this was declared in — `users`, `pages`, `views`. */
  readonly module: string;
  /** The exported constant's name, e.g. `listUsers`. */
  readonly name: string;
  /** Upper-cased, e.g. `GET`. The package spells it lower-case. */
  readonly httpMethod: string;
  /**
   * The path beneath the API's version root, with each path parameter as `{name}` — `users/{user_id}`.
   * `null` when the template could not be read, which is a fact the row carries rather than a parse failure.
   */
  readonly pathTemplate: string | null;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly bodyParams: readonly string[];
  /** The one-line JSDoc description above the declaration, or `null` when it carries none. */
  readonly description: string | null;
}

/** The literal that opens every endpoint declaration in a generated module. */
const EXPORT_ANCHOR = "\nexports.";

/** The characters a JavaScript identifier is made of — the only thing a scanner accepts as a name. */
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/;

/**
 * Read an identifier forward from an index.
 *
 * @param text the source
 * @param from the index to start at
 * @returns the identifier and the index just past it; the identifier is `""` when there is none
 */
function readIdentifier({ text, from }: { text: string; from: number }): { value: string; end: number } {
  let end = from;
  while (end < text.length && IDENTIFIER_CHARACTER.test(text.charAt(end))) {
    end += 1;
  }
  return { end, value: text.slice(from, end) };
}

/**
 * Find an object literal's closing brace by counting.
 *
 * Template literals in these modules interpolate with `${…}`, whose braces are balanced, so a counter is
 * correct here without a template-aware scanner.
 *
 * @param text the whole source
 * @param from the index just past the opening brace
 * @returns the index of the matching closing brace, or the source length when it is unterminated
 */
function endOfObject({ text, from }: { text: string; from: number }): number {
  let depth = 1;
  let index = from;
  while (index < text.length) {
    const character = text.charAt(index);
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }
  return text.length;
}

/**
 * The double-quoted string that follows a field name, e.g. `get` from `method: "get",`.
 *
 * @param body the object literal's body
 * @param field the field name to read
 * @returns the string, or `null` when the field is absent or unterminated
 */
function quotedField({ body, field }: { body: string; field: string }): string | null {
  const at = body.indexOf(`${field}: "`);
  if (at < 0) {
    return null;
  }
  const from = at + field.length + 3;
  const end = body.indexOf('"', from);
  return end < 0 ? null : body.slice(from, end);
}

/**
 * The double-quoted members of a bracketed list field, e.g. `["start_cursor", "page_size"]`.
 *
 * @param body the object literal's body
 * @param field the field name to read
 * @returns the members in source order; empty for an absent field and for an empty list alike, because the
 *   generated modules write `[]` for both and the distinction has no meaning here
 */
function listField({ body, field }: { body: string; field: string }): readonly string[] {
  const at = body.indexOf(`${field}: [`);
  if (at < 0) {
    return [];
  }
  const from = at + field.length + 3;
  const close = body.indexOf("]", from);
  if (close < 0) {
    return [];
  }
  const members: string[] = [];
  let index = from;
  while (index < close) {
    const open = body.indexOf('"', index);
    if (open < 0 || open > close) {
      break;
    }
    const end = body.indexOf('"', open + 1);
    if (end < 0 || end > close) {
      break;
    }
    members.push(body.slice(open + 1, end));
    index = end + 1;
  }
  return members;
}

/**
 * The path template, with `${p.page_id}` rewritten to `{page_id}`.
 *
 * @param body the object literal's body
 * @returns the template, or `null` when the declaration carries no backticked path
 */
export function pathTemplateOf({ body }: { body: string }): string | null {
  const at = body.indexOf("path: ");
  if (at < 0) {
    return null;
  }
  const open = body.indexOf("`", at);
  if (open < 0) {
    return null;
  }
  const close = body.indexOf("`", open + 1);
  if (close < 0) {
    return null;
  }
  return rewriteInterpolations({ template: body.slice(open + 1, close) });
}

/**
 * Rewrite every `${p.name}` interpolation to `{name}`, leaving anything else it finds verbatim.
 *
 * @param template the raw template-literal body
 * @returns the path with named placeholders
 */
function rewriteInterpolations({ template }: { template: string }): string {
  let out = "";
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf("${", index);
    if (open < 0) {
      out += template.slice(index);
      break;
    }
    const close = template.indexOf("}", open);
    if (close < 0) {
      out += template.slice(index);
      break;
    }
    const expression = template.slice(open + 2, close).trim();
    const dot = expression.lastIndexOf(".");
    out += `${template.slice(index, open)}{${dot < 0 ? expression : expression.slice(dot + 1)}}`;
    index = close + 1;
  }
  return out;
}

/**
 * Whether what sits between the end of a JSDoc block and the declaration below it is only the one line
 * break that separates them.
 *
 * @param gap the text between the two
 * @returns whether the block is directly above the declaration
 */
function isDirectlyAbove({ gap }: { gap: string }): boolean {
  return gap.trim().length === 0 && gap.split("\n").length <= 2;
}

/**
 * The one-line description from the JSDoc block immediately above a declaration.
 *
 * A block separated from its declaration by a BLANK LINE is not read, which is the same judgement
 * `.claude/rules/typescript-patterns.md` makes about this repository's own JSDoc: a block with a gap under
 * it documents the section it sits in rather than the one declaration that follows. The generated modules
 * never do this today, so the rule costs nothing and stops a stray file-level block being attributed to
 * whichever endpoint happens to be declared next.
 *
 * @param text the whole source
 * @param before the index the declaration starts at
 * @returns the first non-empty line of that block, or `null` when there is no block directly above
 */
export function descriptionAbove({ text, before }: { text: string; before: number }): string | null {
  const close = text.lastIndexOf("*/", before);
  if (close < 0 || !isDirectlyAbove({ gap: text.slice(close + 2, before) })) {
    return null;
  }
  const open = text.lastIndexOf("/**", close);
  if (open < 0) {
    return null;
  }
  for (const line of text.slice(open + 3, close).split("\n")) {
    const stripped = line.trim().replace(/^\*+/, "").trim();
    if (stripped.length > 0) {
      return stripped;
    }
  }
  return null;
}

/**
 * Every endpoint one generated module declares.
 *
 * @param module the module's own name, which becomes each row's `module`
 * @param source the module's generated JavaScript, verbatim
 * @returns the endpoints in source order; a module that declares none yields an empty list
 */
export function parseNotionSdkModule({
  module,
  source,
}: {
  module: string;
  source: string;
}): readonly NotionSdkEndpoint[] {
  const endpoints: NotionSdkEndpoint[] = [];
  let index = 0;
  while (index < source.length) {
    const anchor = source.indexOf(EXPORT_ANCHOR, index);
    if (anchor < 0) {
      break;
    }
    const nameFrom = anchor + EXPORT_ANCHOR.length;
    const { value: name, end } = readIdentifier({ from: nameFrom, text: source });
    index = end;
    if (name.length === 0 || !source.startsWith(" = {", end)) {
      continue;
    }
    const body = source.slice(end + 4, endOfObject({ from: end + 4, text: source }));
    const httpMethod = quotedField({ body, field: "method" });
    if (httpMethod === null) {
      continue;
    }
    endpoints.push({
      bodyParams: listField({ body, field: "bodyParams" }),
      description: descriptionAbove({ before: anchor + 1, text: source }),
      httpMethod: httpMethod.toUpperCase(),
      module,
      name,
      pathParams: listField({ body, field: "pathParams" }),
      pathTemplate: pathTemplateOf({ body }),
      queryParams: listField({ body, field: "queryParams" }),
    });
  }
  return endpoints;
}
