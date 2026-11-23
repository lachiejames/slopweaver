/**
 * Enumerate every REST operation the installed `xero-node` declares, from the package's own generated
 * sources.
 *
 * Pure: it takes one generated module's TEXT and returns rows, so the whole extraction is unit-testable
 * with no `node_modules` present. The effectful half — finding and reading those files — is `sdkRead.ts`.
 *
 * ## Why the generated `.js` rather than the `.d.ts`
 *
 * Only the `.js` carries the things that make a row a reproduction handle. The declaration reduces an
 * operation to a parameter list and a promise, and throws away the PATH, the HTTP verb, the query parameter
 * names and the model the response is deserialised into — all four of which live in the method body. Both
 * files carry the same `@summary` JSDoc, so nothing is lost by reading the one that has everything.
 *
 * ## Scanning, not matching
 *
 * Every parser here finds a short literal anchor and walks forward by hand, the same discipline
 * `slackApi/sdkTypings.ts` and `notion/sdkEndpoints.ts` arrived at: the shapes a regex would want here — a
 * lazy run up to an optional group, a bracketed list that may be empty — are exactly the ones the
 * `redos-check` gate flags as polynomial-backtracking.
 *
 * ## An operation the SDK declares is not an operation this installation may call
 *
 * These rows are the API surface's DECLARED denominator and nothing more. Whether a call is authorised is a
 * property of an OAuth connection's scopes and of the tenant that consented to it, which no file in the
 * package knows — so a row here never claims reach, and `descriptor.ts` states that ceiling.
 */

import { absentAsNull } from "#lib/absent.js";

/** One operation the SDK declares, as the package's own generated source states it. */
export interface XeroSdkOperation {
  /** The generated API class this was declared in — `accountingApi`, `payrollNZApi`. */
  readonly module: string;
  /** The SDK's own method name, e.g. `getInvoices`. */
  readonly name: string;
  /** Upper-cased, e.g. `GET`. */
  readonly httpMethod: string;
  /** The product root this module's operations hang off, e.g. `https://api.xero.com/api.xro/2.0`. */
  readonly basePath: string;
  /** The path beneath that root, with each path parameter as `{Name}` — `/Invoices/{InvoiceID}`. */
  readonly path: string;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly headerParams: readonly string[];
  /** The model name serialised into the request body, or `null` when the operation sends none. */
  readonly requestModel: string | null;
  /** The model name the response is deserialised into, or `null` when the operation declares none. */
  readonly responseModel: string | null;
  /** The one-line `@summary` above the declaration, or `null` when it carries none. */
  readonly summary: string | null;
}

/** The characters a JavaScript identifier is made of — the only thing a scanner accepts as a name. */
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/;

/** The literal that opens a generated method at class-body indentation. */
const METHOD_ANCHOR = "\n    ";

/** The three class members every generated API class has that are not operations. */
const NON_OPERATIONS: ReadonlySet<string> = new Set(["constructor", "setDefaultAuthentication", "setApiKey"]);

/** The anchor the base path is declared at, once per module. */
const BASE_PATH_ANCHOR = "let defaultBasePath = '";

/** The anchor a method body's path is assembled at. */
const PATH_ANCHOR = "const localVarPath = this.basePath + '";

/** The anchor the axios request options declare the verb at. */
const VERB_ANCHOR = "method: '";

/** The anchor a path parameter substitution opens with. */
const PATH_PARAM_ANCHOR = ".replace('{' + '";

/** The anchor a query parameter assignment opens with. */
const QUERY_PARAM_ANCHOR = "localVarQueryParameters['";

/** The anchor a header parameter assignment opens with. */
const HEADER_PARAM_ANCHOR = "localVarHeaderParams['";

/** The anchor the request body's model name follows. */
const REQUEST_MODEL_ANCHOR = "data: models_";

/** The anchor the response model name follows. */
const RESPONSE_MODEL_ANCHOR = 'deserialize(response.data, "';

/** The JSDoc tag carrying the operation's one-line description. */
const SUMMARY_ANCHOR = "@summary ";

/**
 * Two header names every generated operation sets on its own, whatever it does.
 *
 * Kept rather than filtered: `xero-tenant-id` is the parameter that makes every Xero call tenant-scoped and
 * is the single most load-bearing fact about this API's shape, and `Accept` records what the operation
 * negotiates. An operation that does NOT set the tenant header is the interesting one, and a filter would
 * make that invisible.
 *
 * @internal
 */
export const XERO_UBIQUITOUS_HEADERS: readonly string[] = ["Accept", "xero-tenant-id"];

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
 * The single-quoted string that follows an anchor, from a given index.
 *
 * @param text the source to scan
 * @param anchor the literal that precedes the value
 * @param from the index to start looking at
 * @param quote the quote character the value is delimited by
 * @returns the value and the index just past its closing quote, or `null` when the anchor is absent or the
 *   value is unterminated
 */
function quotedAfter({
  text,
  anchor,
  from,
  quote,
}: {
  text: string;
  anchor: string;
  from: number;
  quote: string;
}): { value: string; end: number } | null {
  const at = text.indexOf(anchor, from);
  if (at < 0) {
    return null;
  }
  const start = at + anchor.length;
  const end = text.indexOf(quote, start);
  return end < 0 ? null : { end: end + 1, value: text.slice(start, end) };
}

/**
 * Every single-quoted value following each occurrence of an anchor, in source order and deduplicated.
 *
 * @param body the method body to scan
 * @param anchor the literal each occurrence opens with
 * @param quote the quote character the value is delimited by
 * @returns the values, first occurrence first, with repeats dropped
 */
function allQuotedAfter({ body, anchor, quote }: { body: string; anchor: string; quote: string }): readonly string[] {
  const found: string[] = [];
  let cursor = 0;
  for (;;) {
    const next = quotedAfter({ anchor, from: cursor, quote, text: body });
    if (next === null) {
      return [...new Set(found)];
    }
    found.push(next.value);
    cursor = next.end;
  }
}

/** Where one generated method starts in a module, and what it is called. */
interface MethodStart {
  readonly name: string;
  readonly at: number;
}

/**
 * Every class-body method in a generated module, in source order.
 *
 * A generated class writes each member at exactly four spaces of indentation and nothing else at that
 * depth, so the anchor is the indentation itself. The three non-operation members are dropped by name
 * rather than by shape, because each is a real method and only its purpose distinguishes it.
 *
 * @param source the module's whole generated source
 * @returns each candidate method's name and start index
 */
function methodStarts({ source }: { source: string }): readonly MethodStart[] {
  const starts: MethodStart[] = [];
  let cursor = 0;
  for (;;) {
    const at = source.indexOf(METHOD_ANCHOR, cursor);
    if (at < 0) {
      return starts;
    }
    const from = at + METHOD_ANCHOR.length;
    const identifier = readIdentifier({ from, text: source });
    cursor = from;
    if (identifier.value.length === 0 || source.charAt(identifier.end) !== "(") {
      continue;
    }
    starts.push({ at: from, name: identifier.value });
  }
}

/**
 * The product root every operation in this module hangs off.
 *
 * @param source the module's whole generated source
 * @returns the base path, or `null` when the module declares none
 */
export function xeroModuleBasePath({ source }: { source: string }): string | null {
  return absentAsNull({ value: quotedAfter({ anchor: BASE_PATH_ANCHOR, from: 0, quote: "'", text: source })?.value });
}

/**
 * The `@summary` line documenting the method starting at an index.
 *
 * The JSDoc block sits directly above the declaration, so the search is bounded to the text between the
 * previous method and this one — an unbounded backward search would attach the wrong summary to any method
 * whose own block carries none.
 *
 * @param source the module's whole generated source
 * @param from where the preceding method ended
 * @param to where this method starts
 * @returns the summary, or `null` when the block carries none
 */
function summaryBetween({ source, from, to }: { source: string; from: number; to: number }): string | null {
  const window = source.slice(from, to);
  const at = window.lastIndexOf(SUMMARY_ANCHOR);
  if (at < 0) {
    return null;
  }
  const start = at + SUMMARY_ANCHOR.length;
  const newline = window.indexOf("\n", start);
  const line = (newline < 0 ? window.slice(start) : window.slice(start, newline)).trim();
  return line.length === 0 ? null : line;
}

/** The model name a `serialize(<value>, "<Model>")` request body names, or `null` when there is none. */
function requestModelOf({ body }: { body: string }): string | null {
  const at = body.indexOf(REQUEST_MODEL_ANCHOR);
  if (at < 0) {
    return null;
  }
  // The serializer is referenced through a numbered import alias, so the anchor stops before the digit and
  // the model name is the last quoted argument on that line.
  const newline = body.indexOf("\n", at);
  const line = newline < 0 ? body.slice(at) : body.slice(at, newline);
  const opened = line.lastIndexOf('"');
  if (opened < 0) {
    return null;
  }
  const closed = line.lastIndexOf('"', opened - 1);
  return closed < 0 ? null : line.slice(closed + 1, opened);
}

/**
 * Parse every operation one generated API module declares.
 *
 * @param module the module's own name, e.g. `accountingApi`
 * @param source the module's whole generated source
 * @returns one row per declared operation, in source order; a module with no base path yields none, because
 *   a row that cannot say what it addresses is not a reproduction handle
 */
export function parseXeroSdkModule({
  module,
  source,
}: {
  module: string;
  source: string;
}): readonly XeroSdkOperation[] {
  const basePath = xeroModuleBasePath({ source });
  if (basePath === null) {
    return [];
  }
  const starts = methodStarts({ source });
  return starts.flatMap((start, index): readonly XeroSdkOperation[] => {
    if (NON_OPERATIONS.has(start.name)) {
      return [];
    }
    // A method runs to the next one's start; the last method in the module runs to the end of the source.
    const end = index + 1 < starts.length ? starts[index + 1]!.at : source.length;
    const body = source.slice(start.at, end);
    const path = quotedAfter({ anchor: PATH_ANCHOR, from: 0, quote: "'", text: body });
    const verb = quotedAfter({ anchor: VERB_ANCHOR, from: 0, quote: "'", text: body });
    if (path === null || verb === null) {
      return [];
    }
    const responseModel = quotedAfter({ anchor: RESPONSE_MODEL_ANCHOR, from: 0, quote: '"', text: body });
    return [
      {
        basePath,
        headerParams: allQuotedAfter({ anchor: HEADER_PARAM_ANCHOR, body, quote: "'" }).toSorted(),
        httpMethod: verb.value.toUpperCase(),
        module,
        name: start.name,
        path: path.value,
        pathParams: allQuotedAfter({ anchor: PATH_PARAM_ANCHOR, body, quote: "'" }).toSorted(),
        queryParams: allQuotedAfter({ anchor: QUERY_PARAM_ANCHOR, body, quote: "'" }).toSorted(),
        requestModel: requestModelOf({ body }),
        responseModel: absentAsNull({ value: responseModel?.value }),
        summary: summaryBetween({ from: index === 0 ? 0 : starts[index - 1]!.at, source, to: start.at }),
      },
    ];
  });
}

/**
 * Parse every field one generated MODEL declares, in the API's own wire spelling.
 *
 * The generated models carry an `attributeTypeMap` pairing the TypeScript property `name` with the
 * `baseName` the wire actually uses — `amountDue` against `AmountDue`. The wire spelling is the one a reader
 * asking "is there any call that hands me this" needs, so it is the one stored.
 *
 * @param source one generated model module's whole source
 * @returns every declared wire field name, in declaration order
 */
export function parseXeroSdkModelFields({ source }: { source: string }): readonly string[] {
  return allQuotedAfter({ anchor: '"baseName": "', body: source, quote: '"' });
}
