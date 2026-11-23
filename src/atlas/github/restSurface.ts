/**
 * Enumerate GitHub's whole REST surface from the OpenAPI description the installed client ships.
 *
 * Pure: it takes the declaration TEXT and returns rows, so the extraction is unit-testable with no
 * `node_modules` present and no network call. The effectful half — finding and reading those files — lives
 * in the CLI shell, exactly as the Slack atlas splits `sdkTypings.ts` from its own verb.
 *
 * ## Why this is the API surface's DENOMINATOR rather than a list somebody typed
 *
 * A hand-written endpoint list is a snapshot of the day it was typed, and a route it invents looks exactly
 * as correct as one that works. `@octokit/openapi-types` is generated from GitHub's OWN published OpenAPI
 * description and ships with the client this repository already calls, so a route here is a route this
 * version can send — a denominator the platform chose, not one this repository chose for itself. That is
 * the same property Falcon's published sitemap gives the CrowdStrike walk, and it is what makes a coverage
 * fraction over the API surface checkable instead of self-graded.
 *
 * ## Three documents, one pass each, joined on the operation id
 *
 * The description is one `.d.ts` carrying three interfaces, and each answers a different half:
 *
 * - `paths` — every route, its verb, and the operation id each verb resolves to, plus the summary and
 *   `@description` GitHub writes for it.
 * - `operations` — that operation's path and query PARAMETER names, and the schema its 200 response
 *   carries.
 * - `components.schemas` — that schema's top-level FIELD names.
 *
 * Nothing here resolves a schema recursively. A response is described by its schema NAME and its top-level
 * fields, because the question this kind answers is "is there any call that hands me this", and a fully
 * inlined object graph would bury that under GitHub's own type reuse.
 *
 * ## Scanning, not matching
 *
 * Every parser here finds a short literal anchor and walks forward by hand. The Slack sibling learned this
 * the expensive way: the shapes a regex wants here (`[\s\S]*?` up to an optional group) are exactly the
 * ambiguous ones the ReDoS gate rejects, and a scanner is also what makes brace-balanced blocks cheap to
 * read at all.
 *
 * ## Names, never values
 *
 * Only identifiers and GitHub's own prose are read. The description carries `@example` values in its
 * JSDoc — GitHub's own documentation examples — and none of them is extracted, because a field NAME is what
 * this kind is about and an example is a value.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { GithubRefusalErrors, githubRefusalErrorLines } from "./errors.js";
import {
  blockMembers,
  depthDelta,
  IDENTIFIER_CHARACTER,
  interfaceBody,
  isQuote,
  memberNames,
  nextBrace,
  readBlock,
  skipString,
  skipTrivia,
} from "./restDeclarationScan.js";

/** The HTTP verbs an OpenAPI path object may declare. Closed: anything else is not a route. */
const HTTP_VERBS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** One REST route as GitHub's own description declares it. */
export interface GithubRestRoute {
  /** `GET /orgs/{org}` — the verb and path template, as a reader would write them. */
  readonly route: string;
  /** GitHub's own operation id, e.g. `orgs/get`. The join key between the three interfaces. */
  readonly operationId: string;
  /** The one-line summary GitHub writes for the operation, or `""` when it writes none. */
  readonly summary: string;
  /** Path parameter names, sorted. */
  readonly pathParams: readonly string[];
  /** Query parameter names, sorted. */
  readonly queryParams: readonly string[];
  /** The component schema its 200/201 response carries, or `null` when it declares none. */
  readonly responseSchema: string | null;
  /** Top-level field names of that schema, sorted. Empty when the schema is absent or not an object. */
  readonly responseFields: readonly string[];
}

/** What one operation's own declaration contributes, before the schema is resolved. */
interface OperationFacts {
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly responseSchema: string | null;
}

/**
 * The component schema name a `components["schemas"]["x"]` reference names.
 *
 * @param text the text to search
 * @returns the first schema name referenced, or `null` when there is none
 */
export function schemaReference({ text }: { text: string }): string | null {
  const anchor = 'components["schemas"]["';
  const at = text.indexOf(anchor);
  if (at < 0) {
    return null;
  }
  const from = at + anchor.length;
  const close = text.indexOf('"', from);
  return close < 0 ? null : text.slice(from, close);
}

/**
 * What one operation declares: its parameter names and the schema its success response carries.
 *
 * The success response is whichever of 200/201 the operation declares first, because those are the only
 * two GitHub uses for a read that returns a body — a 204 carries none and a 3xx/4xx is not what a caller
 * asking "what does this hand me" means.
 *
 * @param block the operation's own block body
 * @returns its parameter names and response schema
 */
export function operationFacts({ block }: { block: string }): OperationFacts {
  const parameters = namedBlock({ body: block, name: "parameters" });
  const responses = namedBlock({ body: block, name: "responses" });
  const successBlock =
    responses === null
      ? null
      : (namedBlock({ body: responses, name: "200" }) ?? namedBlock({ body: responses, name: "201" }));
  return {
    pathParams: parameters === null ? [] : namedBlockMembers({ body: parameters, name: "path" }),
    queryParams: parameters === null ? [] : namedBlockMembers({ body: parameters, name: "query" }),
    responseSchema: successBlock === null ? null : schemaReference({ text: successBlock }),
  };
}

/**
 * The block that follows a bare or quoted member name at depth 0.
 *
 * @param body the block body to scan
 * @param name the member whose block is wanted
 * @returns its body, or `null` when the member is absent or carries no block
 */
function namedBlock({ body, name }: { body: string; name: string }): string | null {
  let index = 0;
  let depth = 0;
  while (index < body.length) {
    const skipped = skipTrivia({ from: index, text: body });
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const character = body.charAt(index);
    const delta = depthDelta({ character });
    if (delta !== 0) {
      depth += delta;
      index += 1;
      continue;
    }
    const start = namedMemberStart({ body, depth, from: index, name });
    if (start !== null) {
      return blockAfter({ body, from: start });
    }
    index = character === '"' || character === "'" ? skipString({ from: index, text: body }) : index + 1;
  }
  return null;
}

/** The body of the block a member declares, or `null` when it declares something other than a block. */
function blockAfter({ body, from }: { body: string; from: number }): string | null {
  const opens = nextBrace({ body, from });
  if (opens < 0) {
    return null;
  }
  const block = readBlock({ from: opens, text: body });
  return block === null ? null : block.body;
}

/**
 * Where this member's block would begin, when the member named `name` starts at `from` at depth 0.
 *
 * Both spellings, because a schema name is quoted only when it has to be — see {@link blockMembers}.
 *
 * @param body the block body
 * @param from the index to look at
 * @param depth the nesting depth there; only depth 0 is a member of this block
 * @param name the member wanted
 * @returns the index just past the name, or `null` when this is not it
 */
function namedMemberStart({
  body,
  from,
  depth,
  name,
}: {
  body: string;
  from: number;
  depth: number;
  name: string;
}): number | null {
  if (depth !== 0) {
    return null;
  }
  const character = body.charAt(from);
  if (isQuote({ character })) {
    const close = skipString({ from, text: body });
    return body.slice(from + 1, close - 1) === name ? close : null;
  }
  return startsNamedMember({ body, from, name }) ? from + name.length : null;
}

/** Whether a bare member of this name starts at an index. */
function startsNamedMember({ body, from, name }: { body: string; from: number; name: string }): boolean {
  return body.startsWith(name, from) && isBoundedName({ body, from, name });
}

/**
 * Whether a literal match sits on its own rather than inside a longer identifier.
 *
 * The trailing character may be ANY whitespace, not only a space. A newline between a member name and its
 * colon is valid and is what a formatter produces on a long line — an earlier version admitted only a
 * space, a colon or a `?`, and a review found it silently dropping a real route because of one.
 */
function isBoundedName({ body, from, name }: { body: string; from: number; name: string }): boolean {
  const before = from === 0 ? "" : body.charAt(from - 1);
  const after = body.charAt(from + name.length);
  const startsClean = before === "" || !IDENTIFIER_CHARACTER.test(before);
  const endsClean = after === ":" || after === "?" || /\s/u.test(after);
  return startsClean && endsClean;
}

/** The member names inside a named sub-block, or an empty list when it is absent. */
function namedBlockMembers({ body, name }: { body: string; name: string }): readonly string[] {
  const block = namedBlock({ body, name });
  return block === null ? [] : memberNames({ body: block });
}

/**
 * The verb entries of one path object: each HTTP verb it declares and the operation id it resolves to.
 *
 * @param block the path object's block body
 * @returns each verb (upper-cased) and its operation id, in declaration order
 */
export function pathOperations({ block }: { block: string }): readonly { verb: string; operationId: string }[] {
  const found: { verb: string; operationId: string }[] = [];
  for (const verb of HTTP_VERBS) {
    const operationId = verbDeclarationAt({ block, verb });
    if (operationId !== null) {
      found.push({ operationId, verb: verb.toUpperCase() });
    }
  }
  return found;
}

/**
 * Where a path object DECLARES one verb — at depth 0, outside every comment.
 *
 * A plain `indexOf` was enough until a review pointed out what it admits: GitHub's description is full of
 * prose, and the text `get: operations[...]` sitting inside a DOC COMMENT matched exactly as well as a real
 * declaration. The parser then reported a route the description does not declare, which is the one thing a
 * DENOMINATOR must never do — a coverage fraction over invented routes is worse than none.
 *
 * @param block the path object's block body
 * @param verb the HTTP verb to look for
 * @returns the index the declaration starts at, or `null` when the path declares no such verb
 */
function verbDeclarationAt({ block, verb }: { block: string; verb: string }): string | null {
  let index = 0;
  let depth = 0;
  while (index < block.length) {
    const skipped = skipTrivia({ from: index, text: block });
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const character = block.charAt(index);
    const delta = depthDelta({ character });
    if (delta !== 0) {
      depth += delta;
      index += 1;
      continue;
    }
    if (isQuote({ character })) {
      index = skipString({ from: index, text: block });
      continue;
    }
    const operationId = declarationAt({ block, depth, from: index, verb });
    if (operationId !== null) {
      return operationId;
    }
    index += 1;
  }
  return null;
}

/**
 * Past every space, tab, newline and comment from an index.
 *
 * Whitespace and trivia are equivalent everywhere TypeScript allows either, and a review found the version
 * that skipped only spaces and tabs: a newline between a verb and its colon — valid, and something a
 * formatter produces on a long line — made the parser silently drop a real declaration.
 *
 * @param block the source
 * @param from the index to start at
 * @returns the index of the next non-blank, non-comment character
 */
function skipBlanks({ block, from }: { block: string; from: number }): number {
  let index = skipTrivia({ from, text: block });
  while (index < block.length && /\s/u.test(block.charAt(index))) {
    index = skipTrivia({ from: index + 1, text: block });
  }
  return index;
}

/**
 * The operation id declared at an index, when a verb declaration starts there at depth 0.
 *
 * @param block the path object's block body
 * @param from the index to look at
 * @param depth the nesting depth there
 * @param verb the HTTP verb being looked for
 * @returns the operation id, or `null` when no such declaration starts here
 */
function declarationAt({
  block,
  from,
  depth,
  verb,
}: {
  block: string;
  from: number;
  depth: number;
  verb: string;
}): string | null {
  if (depth !== 0 || !block.startsWith(verb, from) || !isBoundedName({ body: block, from, name: verb })) {
    return null;
  }
  return operationIdAfter({ block, from: from + verb.length });
}

/**
 * The operation id a verb declares, reading `: operations["…"]` with trivia allowed at every join.
 *
 * A fixed `verb + ": operations[\""` anchor was enough for GitHub's generated description and was still
 * wrong: a comment between the colon and `operations` is valid TypeScript, and a review's counterexample
 * showed the parser SILENTLY DROPPING a real route because of one. Dropping a declared route is the same
 * class of harm as inventing one — the denominator stops being the platform's.
 *
 * @param block the path object's block body
 * @param from the index just past the verb
 * @returns the operation id, or `null` when this is not an operation declaration
 */
function operationIdAfter({ block, from }: { block: string; from: number }): string | null {
  let index = skipBlanks({ block, from });
  if (block.charAt(index) !== ":") {
    return null;
  }
  index = skipBlanks({ block, from: index + 1 });
  const anchor = 'operations["';
  if (!block.startsWith(anchor, index)) {
    return null;
  }
  const close = block.indexOf('"', index + anchor.length);
  return close < 0 ? null : block.slice(index + anchor.length, close);
}

/**
 * The one-line summary preceding a member, taken from the JSDoc block directly above it.
 *
 * GitHub writes the summary as the block's first prose line and the long form after an `@description` tag.
 * Only the summary is kept: it is one line, it is what a reader scanning a surface map wants, and the long
 * form runs to paragraphs of migration notes on some operations.
 *
 * The comment must sit IMMEDIATELY above the member — nothing but whitespace between them. A looser search
 * would hand a verb that carries no documentation the JSDoc of the verb declared above it, which reads as
 * documentation and is a different operation's.
 *
 * @param body the enclosing block
 * @param at the index the member starts at
 * @returns the summary, or `""` when the member carries no JSDoc
 *
 * @internal
 */
export function summaryBefore({ body, at }: { body: string; at: number }): string {
  const close = body.lastIndexOf("*/", at);
  if (close < 0) {
    return "";
  }
  const open = body.lastIndexOf("/**", close);
  if (open < 0 || body.slice(close + 2, at).trim().length > 0) {
    return "";
  }
  for (const raw of body.slice(open + 3, close).split("\n")) {
    const line = raw.trim().replace(/^\*+/u, "").trim();
    if (line.length > 0 && !line.startsWith("@")) {
      return line;
    }
  }
  return "";
}

/**
 * Extract every REST route GitHub's own description declares.
 *
 * Refuses rather than returning an empty list: a description whose shape changed would otherwise report
 * full coverage over nothing, which is the failure the CrowdStrike sitemap parser was written against.
 *
 * @param declarations the text of `@octokit/openapi-types`'s `types.d.ts`
 * @returns every route with its parameters and response shape, sorted by route, or why the description was
 *   unusable
 */
export function parseGithubRestSurface({ declarations }: { declarations: string }): Result<readonly GithubRestRoute[]> {
  const paths = interfaceBody({ name: "paths", text: declarations });
  const operations = interfaceBody({ name: "operations", text: declarations });
  const components = interfaceBody({ name: "components", text: declarations });
  if (paths === null || operations === null) {
    return err(githubRefusalErrorLines({ error: GithubRefusalErrors.shapeChanged() }));
  }
  const schemas = componentSchemas({ components });
  const operationBlocks = new Map(blockMembers({ body: operations }).map((member) => [member.key, member.block]));
  const routes: GithubRestRoute[] = [];
  for (const path of blockMembers({ body: paths })) {
    for (const operation of pathOperations({ block: path.block })) {
      const block = operationBlocks.get(operation.operationId);
      const facts = block === undefined ? null : operationFacts({ block });
      const schema = facts?.responseSchema ?? null;
      routes.push({
        operationId: operation.operationId,
        pathParams: facts?.pathParams ?? [],
        queryParams: facts?.queryParams ?? [],
        responseFields: schema === null ? [] : (schemas.get(schema) ?? []),
        responseSchema: schema,
        route: `${operation.verb} ${path.key}`,
        summary: summaryBefore({
          at: path.block.indexOf(`${operation.verb.toLowerCase()}: operations[`),
          body: path.block,
        }),
      });
    }
  }
  if (routes.length === 0) {
    return err(githubRefusalErrorLines({ error: GithubRefusalErrors.noRoutes() }));
  }
  return ok(routes.toSorted((left, right) => left.route.localeCompare(right.route)));
}

/**
 * Every component schema's top-level field names, keyed by schema name.
 *
 * @param components the `components` interface body, or `null` when the description declares none
 * @returns each schema name mapped to its sorted field names
 */
function componentSchemas({ components }: { components: string | null }): ReadonlyMap<string, readonly string[]> {
  if (components === null) {
    return new Map();
  }
  const schemas = namedBlock({ body: components, name: "schemas" });
  if (schemas === null) {
    return new Map();
  }
  return new Map(blockMembers({ body: schemas }).map((member) => [member.key, memberNames({ body: member.block })]));
}
