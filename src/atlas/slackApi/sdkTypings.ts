/**
 * Enumerate every Web API method from the installed `@slack/web-api` TypeScript declarations.
 *
 * Pure: it takes the declaration TEXT and returns rows, so the whole extraction is unit-testable without
 * `node_modules` present. The effectful half — finding and reading those files — lives in the CLI shell.
 *
 * ## Why parse the .d.ts rather than trust a list
 *
 * The alternative is a hand-written method list, and that is the exact failure the atlas doctrine exists to
 * stop: it is a snapshot of the day somebody typed it. The typings are generated from Slack's own API
 * definitions and shipped with the client this repo already calls, so a method here is a method that
 * version can send.
 *
 * ## Scanning, not matching
 *
 * Every parser here finds a short literal anchor and then walks forward by hand. That is deliberate. The
 * first version used four regexes and every one of them was flagged as polynomial-backtracking by the
 * ReDoS gate — the shapes wanted (`[\s\S]*?` up to an optional group, `[^{;]*?` up to a brace) are exactly
 * the ambiguous ones. Scanning is also what makes the three JSDoc shapes `methodHeads.ts` tolerates cheap to
 * handle at all.
 */
import { methodHeads } from "./methodHeads.js";
import type { MethodParam, SdkMethod } from "./model.js";

/** A declaration's opening: `export interface X`, `interface X`, `export type X`, `type X`. */
const DECLARATION_HEAD = /(?:^|\n)(?:export\s+)?(interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** Characters that make up a TypeScript identifier — the only thing the scanners ever accept as a name. */
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/;

/** A declaration reduced to what resolution needs: its own members, and the names it inherits from. */
interface Declaration {
  readonly body: string;
  readonly bases: readonly string[];
}

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
 * Every identifier in a heritage clause or an alias right-hand side, minus the keywords around them.
 *
 * Intersection and union members are treated alike on purpose: an argument type spelled `A & (B | C)` still
 * accepts every field of B and of C, and a caller reading the atlas wants to see all of them.
 *
 * @param text the heritage clause or alias right-hand side
 * @returns the names it refers to
 */
function referencedNames({ text }: { text: string }): readonly string[] {
  const names: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (!IDENTIFIER_CHARACTER.test(text.charAt(index))) {
      index += 1;
      continue;
    }
    const { value, end } = readIdentifier({ from: index, text });
    if (value !== "extends" && value !== "readonly") {
      names.push(value);
    }
    index = end;
  }
  return names;
}

/**
 * Find a block's closing brace by counting, so a nested object literal cannot end it early.
 *
 * @param text the whole source
 * @param from the index just past the opening brace
 * @returns the index just past the matching closing brace
 */
function endOfBlock({ text, from }: { text: string; from: number }): number {
  let depth = 1;
  let index = from;
  while (index < text.length && depth > 0) {
    const character = text.charAt(index);
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    }
    index += 1;
  }
  return index;
}

/**
 * Does this character end the declaration's head, and how?
 *
 * A newline ends it only when the line so far cannot continue: a heritage clause wraps, and a wrapped one
 * is still held open by a trailing operator or an unclosed bracket.
 *
 * @param character the character under the cursor
 * @param lead the head text scanned so far
 * @returns what the head turned out to be, or `undefined` when the scan should continue
 */
function terminator({ character, lead }: { character: string; lead: string }): "block" | "alias" | "none" | undefined {
  if (character === "{") {
    return "block";
  }
  if (character === ";") {
    return "alias";
  }
  if (character !== "\n") {
    return undefined;
  }
  return /[,&|=<]\s*$/.test(lead) ? undefined : "none";
}

/**
 * Scan forward from a declaration's name to whichever comes first: the `{` that opens its body, or the `;`
 * that ends a brace-less alias.
 *
 * @param text the whole source
 * @param from the index just past the declaration's name
 * @returns what was found, the index of it, and the text in between (the heritage or alias right-hand side)
 */
function declarationTail({ text, from }: { text: string; from: number }): {
  kind: "block" | "alias" | "none";
  at: number;
  lead: string;
} {
  let index = from;
  while (index < text.length) {
    const character = text.charAt(index);
    const kind = terminator({ character, lead: text.slice(from, index) });
    if (kind !== undefined) {
      return { at: index, kind, lead: text.slice(from, index) };
    }
    index += 1;
  }
  return { at: text.length, kind: "none", lead: text.slice(from) };
}

/**
 * The names a braced type alias intersects with AFTER its closing brace: `type X = { … } & A & B;`.
 *
 * Bounded to the run of `& Name` pairs that follows the brace immediately. Anything past the first thing
 * that is not one belongs to the next declaration, not this one.
 *
 * @param text the whole source
 * @param from the index just past the closing brace
 * @returns the intersected names, in order
 */
function trailingIntersections({ text, from }: { text: string; from: number }): readonly string[] {
  const names: string[] = [];
  let index = from;
  const skipSpace = (): void => {
    while (index < text.length && /\s/.test(text.charAt(index))) {
      index += 1;
    }
  };
  skipSpace();
  while (text.charAt(index) === "&") {
    index += 1;
    skipSpace();
    const { value, end } = readIdentifier({ from: index, text });
    if (value === "") {
      return names;
    }
    names.push(value);
    index = end;
    skipSpace();
  }
  return names;
}

/**
 * Every named declaration in a `.d.ts`. Braced declarations win over brace-less aliases of the same name,
 * and the first of a repeated name wins — a `.d.ts` bundle re-exports, so the same name can appear more
 * than once with the same body.
 *
 * @param text the declaration source
 * @returns declarations by name
 */
export function collectDeclarations({ text }: { text: string }): ReadonlyMap<string, Declaration> {
  const declarations = new Map<string, Declaration>();
  for (const head of text.matchAll(new RegExp(DECLARATION_HEAD.source, "g"))) {
    const kind = head[1];
    const name = head[2];
    const start = head.index + head[0].length;
    if (name === undefined || declarations.has(name)) {
      continue;
    }
    const tail = declarationTail({ from: start, text });
    if (tail.kind === "none") {
      continue;
    }
    if (tail.kind === "alias") {
      declarations.set(name, {
        bases: referencedNames({ text: tail.lead }).filter((base) => base !== name),
        body: "",
      });
      continue;
    }
    const end = endOfBlock({ from: tail.at + 1, text });
    declarations.set(name, {
      // An `interface` cannot have a trailing intersection; only a `type` alias can, and only immediately
      // after its closing brace. Scanning further than that is how the first version of this gave EVERY
      // interface in the file the bases of the next alias 300 characters downstream — a silent
      // over-resolution that reported arguments a method does not accept.
      bases: [
        ...referencedNames({ text: tail.lead }),
        ...(kind === "type" ? trailingIntersections({ from: end, text }) : []),
      ],
      body: text.slice(tail.at + 1, end - 1),
    });
  }
  return declarations;
}

/**
 * One `name?: type;` member, if this line declares one at the top level.
 *
 * @param line the trimmed line
 * @returns the member, or `undefined` when the line declares none
 */
function memberOf({ line }: { line: string }): MethodParam | undefined {
  const isProse = line === "" || line.startsWith("*") || line.startsWith("/") || line.startsWith("}");
  if (isProse || !/^[A-Za-z_$]/.test(line)) {
    return undefined;
  }
  const { value, end } = readIdentifier({ from: 0, text: line });
  const optional = line.charAt(end) === "?";
  const colon = end + (optional ? 1 : 0);
  if (line.charAt(colon) !== ":") {
    return undefined;
  }
  return {
    name: value,
    optional,
    type: line
      .slice(colon + 1)
      .trim()
      .replace(/;$/, "")
      .trim(),
  };
}

/**
 * How far a line opens or closes braces, so a member's own object type is skipped rather than read.
 *
 * @param line the raw line
 * @returns opens minus closes
 */
function braceDelta({ line }: { line: string }): number {
  let delta = 0;
  for (const character of line) {
    if (character === "{") {
      delta += 1;
    } else if (character === "}") {
      delta -= 1;
    }
  }
  return delta;
}

/**
 * The members declared directly in a body, skipping anything nested inside a member's own object type.
 *
 * @param body the brace block's contents
 * @returns its own members, in declaration order
 */
export function membersOf({ body }: { body: string }): readonly MethodParam[] {
  const members: MethodParam[] = [];
  let depth = 0;
  for (const rawLine of body.split("\n")) {
    const member = depth > 0 ? undefined : memberOf({ line: rawLine.trim() });
    if (member !== undefined) {
      members.push(member);
    }
    depth += braceDelta({ line: rawLine });
  }
  return members;
}

/**
 * A type's full member list, following `extends`, `&` and `|` to their declarations. A name already on the
 * path is skipped rather than followed, because the SDK's request types are mutually recursive.
 *
 * @param declarations every declaration in scope
 * @param typeName the type to resolve
 * @param seen names already on this resolution path
 * @returns the members, own ones overriding inherited ones of the same name
 */
export function resolveMembers({
  declarations,
  typeName,
  seen = new Set<string>(),
}: {
  declarations: ReadonlyMap<string, Declaration>;
  typeName: string | undefined;
  seen?: Set<string>;
}): readonly MethodParam[] {
  if (typeName === undefined || seen.has(typeName)) {
    return [];
  }
  seen.add(typeName);
  const declaration = declarations.get(typeName);
  if (declaration === undefined) {
    return [];
  }
  const byName = new Map<string, MethodParam>();
  for (const base of declaration.bases) {
    for (const member of resolveMembers({ declarations, seen, typeName: base })) {
      byName.set(member.name, member);
    }
  }
  for (const member of membersOf({ body: declaration.body })) {
    byName.set(member.name, member);
  }
  return [...byName.values()];
}

/**
 * One level of nesting under a response's top-level fields, so `messages[].reply_count` is visible without
 * storing the whole recursive shape. One level is where the thread-refetch answer lives, and the full
 * transitive closure of a Slack response is tens of thousands of paths.
 *
 * @param declarations the response file's own declarations
 * @param fields the resolved top-level fields
 * @returns field name to the member names inside it, for fields whose type is declared in the same file
 */
function nestedFields({
  declarations,
  fields,
}: {
  declarations: ReadonlyMap<string, Declaration>;
  fields: readonly MethodParam[];
}): Record<string, readonly string[]> {
  const nested: Record<string, readonly string[]> = {};
  for (const field of fields) {
    const base = field.type
      .replace(/\[\]$/, "")
      .replace(/\s{0,4}\|\s{0,4}null/g, "")
      .trim();
    if (declarations.has(base)) {
      nested[field.name] = resolveMembers({ declarations, typeName: base })
        .map((member) => member.name)
        .toSorted();
    }
  }
  return nested;
}

/** Sort two rows by name, so every list this module returns is stable. */
const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * Build the SDK half of the atlas from declaration text.
 *
 * @param methodsText the contents of `methods.d.ts`
 * @param requestText every request-type declaration file, concatenated
 * @param responseTexts response-type declaration text by interface name, so sub-shapes resolve in their own file
 * @returns one row per distinct method, sorted by name
 */
export function extractSdkMethods({
  methodsText,
  requestText,
  responseTexts,
}: {
  methodsText: string;
  requestText: string;
  responseTexts: ReadonlyMap<string, string>;
}): readonly SdkMethod[] {
  const requestDeclarations = collectDeclarations({ text: requestText });
  const responseDeclarations = new Map<string, ReadonlyMap<string, Declaration>>();
  for (const [name, text] of responseTexts) {
    responseDeclarations.set(name, collectDeclarations({ text }));
  }
  const empty: ReadonlyMap<string, Declaration> = new Map<string, Declaration>();
  return methodHeads({ methodsText })
    .map((head): SdkMethod => {
      const declarations =
        head.responseType === undefined ? empty : (responseDeclarations.get(head.responseType) ?? empty);
      const responseFields = resolveMembers({ declarations, typeName: head.responseType }).toSorted(byName);
      return {
        argsType: head.argsType,
        description: head.description,
        name: head.name,
        params: resolveMembers({ declarations: requestDeclarations, typeName: head.argsType }).toSorted(byName),
        responseFields,
        responseNested: nestedFields({ declarations, fields: responseFields }),
        responseType: head.responseType,
      };
    })
    .toSorted(byName);
}
