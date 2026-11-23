/**
 * What the first-party client actually ASKED FOR: the root fields selected by a captured GraphQL request
 * document, aliases resolved. PURE.
 *
 * ## Why this file exists at all — the alias problem
 *
 * The obvious reduction is to read the top-level keys of a response's `data` object and treat them as
 * schema root field names. That is unsound, and an independent review pass is what caught it: a
 * GraphQL response key is the field's ALIAS when the document supplied one, so
 * `query { latest: issues { … } }` answers under `data.latest`, which the schema does not declare. Comparing
 * response keys to schema names therefore MANUFACTURES disagreements — and this atlas's whole reason to
 * exist is finding real ones, so a comparator that invents them is worse than none.
 *
 * The sound comparison needs the request DOCUMENT. So the transport captures it, and this module parses it
 * with the GraphQL reference implementation rather than a regex: fragments, inline fragments, directives,
 * block strings and comments are all things a hand-rolled scanner gets wrong on a Tuesday, and a wrong
 * parse here is indistinguishable from a finding.
 *
 * ## What it refuses to guess
 *
 * A request carrying no document at all — an automatic persisted query, where the client sends only a hash —
 * yields {@link UNRESOLVED} rather than an attribution. `projection.ts` turns that into a
 * `request-shape-unresolved` gap. Guessing a root field from a hash is exactly the kind of confident
 * fabrication the data-integrity ruling is about.
 *
 * ## Kit-owned because a second platform needed it, not because it was tidy to move
 *
 * It was written for the Linear atlas and lived under `atlas/linear/` until the Inngest atlas needed the
 * same thing: `api.inngest.com/gql` has introspection disabled, so the ONLY census of that surface is what
 * the dashboard's own client is watched sending, and reading a response's own keys as field names is the
 * exact unsound move this module's `resolveRootFields` exists to prevent. A copy in a second atlas would
 * have regenerated the alias bug the Linear walk already paid for, so the file moved rather than being
 * cloned. Nothing about its behaviour changed in the move.
 */
import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type FragmentSpreadNode,
  type InlineFragmentNode,
  type OperationDefinitionNode,
  parse,
  type SelectionNode,
} from "graphql";

import { absentAsEmpty } from "#lib/absent.js";
import { isRecord } from "../../lib/parsers.js";

/**
 * What one captured request document resolved to.
 * @internal
 */
export interface ResolvedRootFields {
  /** `<rootKind>.<fieldName>` for every root field the document selected, sorted and de-duplicated. */
  readonly rootFields: readonly string[];
  /** The response key each root field answers under, so a body can be walked without re-parsing. */
  readonly keyToRootField: ReadonlyMap<string, string>;
  /**
   * For each response key, the ALIAS-to-schema-name map beneath it — one entry per aliased field at any
   * depth, keyed by the dotted path the response actually uses.
   *
   * Nested aliases are the second half of the alias problem, and a Codex review pass found them after the
   * root-level half was fixed: `query { latest: organization { displayName: name } }` answers under
   * `data.latest.displayName`, and translating only `latest` leaves `displayName` looking like a field the
   * schema does not declare — a manufactured disagreement, one level down.
   *
   * **Its known limit, stated rather than discovered.** One response path maps to ONE schema name, so a
   * document that legally reuses an alias across two mutually exclusive inline-fragment type conditions —
   * `... on A { x: foo } ... on B { x: bar }` — keeps the last mapping. Resolving that needs the response's
   * own `__typename`, which a client is not obliged to request, so the atlas cannot decide it from what it
   * captures. A later Codex pass raised exactly this; it is left unsolved deliberately rather than papered
   * over, and it is why a disagreement is a GAP a reader weighs rather than a resolution.
   */
  readonly aliasPaths: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** The answer when a request carried no readable document. Never merged into an attribution. */
export const UNRESOLVED: ResolvedRootFields = { aliasPaths: new Map(), keyToRootField: new Map(), rootFields: [] };

/**
 * GraphQL's own three operation types, mapped to this atlas's root-kind vocabulary.
 *
 * Complete over GraphQL's operation union, so an operation type with no mapping does not compile — there is
 * no default root kind for a lookup to fall back to.
 */
const OPERATION_ROOT_KIND: Readonly<Record<OperationDefinitionNode["operation"], string>> = {
  mutation: "mutation",
  query: "query",
  subscription: "subscription",
};

/** The key a field answers under in the response: its alias when it has one, its schema name when it does not. */
function responseKeyOf({ field }: { field: FieldNode }): string {
  if (field.alias === undefined) {
    return field.name.value;
  }
  return field.alias.value;
}

/** The selections beneath one field — none for a leaf field, which carries no selection set. */
function selectionsUnder({ field }: { field: FieldNode }): readonly SelectionNode[] {
  if (field.selectionSet === undefined) {
    return [];
  }
  return field.selectionSet.selections;
}

/**
 * The envelope the client posted, parsed once.
 *
 * Production hands this module a raw JSON STRING — `request.postData()` — and an earlier version read
 * `operationName` off that string with an `isRecord` check a string can never satisfy. A Codex review pass
 * found the consequence: a document declaring two operations lost the name of the one that
 * actually ran, both were walked, and a shared alias was attributed to the wrong root field — manufacturing
 * exactly the disagreement this atlas exists to find honestly. So the envelope is parsed once, here, and
 * everything below reads the parsed form.
 *
 * @param requestBody the POST body, as a string or an already-parsed envelope
 * @returns the parsed envelope, or `null` when it is not one
 */
function parsedEnvelope({ requestBody }: { requestBody: unknown }): unknown {
  if (typeof requestBody !== "string") {
    return requestBody;
  }
  try {
    return JSON.parse(requestBody);
  } catch {
    return null;
  }
}

/**
 * The `query` string out of whatever envelope the client posted, or `null` when there is none.
 *
 * @param requestBody the POST body, as a string or an already-parsed envelope
 * @returns the GraphQL document the envelope carries, or `null` when it carries none
 */
export function documentTextOf({ requestBody }: { requestBody: unknown }): string | null {
  if (typeof requestBody === "string") {
    return documentTextOf({ requestBody: parsedEnvelope({ requestBody }) });
  }
  if (Array.isArray(requestBody)) {
    // A batched request posts an array of envelopes; the first one that carries a document is enough to
    // establish the shape, and `resolveRootFields` is called once per envelope by the caller.
    for (const entry of requestBody) {
      const text = documentTextOf({ requestBody: entry });
      if (text !== null) {
        return text;
      }
    }
    return null;
  }
  if (!isRecord(requestBody)) {
    return null;
  }
  const query = requestBody["query"];
  return typeof query === "string" && query.trim().length > 0 ? query : null;
}

/**
 * Every aliased field beneath one selection set, keyed by the dotted path the RESPONSE will use.
 *
 * Only aliased fields are recorded: an unaliased field's response key already IS its schema name, so
 * mapping it would be a no-op and storing it would make the map the size of the whole selection.
 *
 * @param aliases the accumulator to fill
 * @param fragments every fragment the document declares
 * @param prefix the dotted response path so far
 * @param selections the selection set to walk
 */
function collectAliases({
  aliases,
  fragments,
  prefix,
  selections,
}: {
  aliases: Map<string, string>;
  fragments: ReadonlyMap<string, readonly SelectionNode[]>;
  prefix: string;
  selections: readonly SelectionNode[];
}): void {
  for (const selection of selections) {
    if (selection.kind === "Field") {
      const responseKey = responseKeyOf({ field: selection });
      const path = prefix === "" ? responseKey : `${prefix}.${responseKey}`;
      if (selection.alias !== undefined) {
        aliases.set(path, selection.name.value);
      }
      collectAliases({ aliases, fragments, prefix: path, selections: selectionsUnder({ field: selection }) });
      continue;
    }
    collectAliases({ aliases, fragments, prefix, selections: spreadOf({ fragments, selection }) });
  }
}

/**
 * The selections one fragment reference stands for: an inline fragment's own, or a named fragment's body.
 *
 * A tiny function rather than a branch inside each walker, because both walkers need exactly this and the
 * shape of a "follow the fragment" step is the same either way.
 *
 * @param fragments every fragment the document declares
 * @param selection the fragment reference to resolve
 * @returns the selections it stands for, empty when the document declares no such fragment
 */
function spreadOf({
  fragments,
  selection,
}: {
  fragments: ReadonlyMap<string, readonly SelectionNode[]>;
  selection: InlineFragmentNode | FragmentSpreadNode;
}): readonly SelectionNode[] {
  if (selection.kind === "InlineFragment") {
    return selection.selectionSet.selections;
  }
  return absentAsEmpty({ value: fragments.get(selection.name.value) });
}

/** Which operation definition the envelope names, or the sole one when it names none. */
function chosenOperation({
  document,
  operationName,
}: {
  document: DocumentNode;
  operationName: string | null;
}): readonly OperationDefinitionNode[] {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition",
  );
  if (operationName === null) {
    return operations;
  }
  const named = operations.filter((operation) => operation.name?.value === operationName);
  return named.length > 0 ? named : operations;
}

/** Every field directly in one selection set, inline fragments flattened, fragment spreads followed. */
function rootSelections({
  selections,
  fragments,
  seen,
}: {
  selections: readonly SelectionNode[];
  fragments: ReadonlyMap<string, readonly SelectionNode[]>;
  seen: Set<string>;
}): readonly {
  readonly name: string;
  readonly responseKey: string;
  readonly aliases: ReadonlyMap<string, string>;
}[] {
  const out: { name: string; responseKey: string; aliases: ReadonlyMap<string, string> }[] = [];
  for (const selection of selections) {
    if (selection.kind === "Field") {
      const aliases = new Map<string, string>();
      if (selection.selectionSet !== undefined) {
        collectAliases({ aliases, fragments, prefix: "", selections: selection.selectionSet.selections });
      }
      out.push({ aliases, name: selection.name.value, responseKey: responseKeyOf({ field: selection }) });
      continue;
    }
    if (selection.kind === "InlineFragment") {
      out.push(...rootSelections({ fragments, seen, selections: selection.selectionSet.selections }));
      continue;
    }
    const name = selection.name.value;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const spread = fragments.get(name);
    if (spread !== undefined) {
      out.push(...rootSelections({ fragments, seen, selections: spread }));
    }
  }
  return out;
}

/** A fresh copy of the aliases one response key already carries, or a fresh empty map when it carries none. */
function aliasesSoFar({ held }: { held: ReadonlyMap<string, string> | undefined }): Map<string, string> {
  if (held == null) {
    return new Map();
  }
  return new Map(held);
}

/**
 * Resolve one captured request into the schema root fields it selected.
 *
 * @param requestBody the POST body the client sent, as a string or already-parsed envelope
 * @returns the root fields and the response key each answers under, or {@link UNRESOLVED} when no document
 *   was carried or the document does not parse
 */
export function resolveRootFields({ requestBody }: { requestBody: unknown }): ResolvedRootFields {
  const envelope = parsedEnvelope({ requestBody });
  const text = documentTextOf({ requestBody: envelope });
  if (text === null) {
    return UNRESOLVED;
  }
  let document: DocumentNode;
  try {
    document = parse(text, { noLocation: true });
  } catch {
    return UNRESOLVED;
  }
  const fragments = fragmentsOf({ document });
  const operationName =
    isRecord(envelope) && typeof envelope["operationName"] === "string" ? envelope["operationName"] : null;
  const rootFields = new Set<string>();
  const keyToRootField = new Map<string, string>();
  const aliasPaths = new Map<string, ReadonlyMap<string, string>>();
  for (const operation of chosenOperation({ document, operationName })) {
    const rootKind = OPERATION_ROOT_KIND[operation.operation];
    for (const field of rootSelections({
      fragments,
      seen: new Set<string>(),
      selections: operation.selectionSet.selections,
    })) {
      const key = `${rootKind}.${field.name}`;
      rootFields.add(key);
      keyToRootField.set(field.responseKey, key);
      // MERGED, never replaced. GraphQL merges two selections that share a response key into one object, so
      // `query { latest: organization { first: id } latest: organization { second: name } }` answers under one
      // `latest` carrying both. A Codex review pass found that replacing here dropped the first selection's
      // aliases, and `first` then read as a field the schema does not declare — a manufactured disagreement
      // from a document that was perfectly ordinary.
      const merged = aliasesSoFar({ held: aliasPaths.get(field.responseKey) });
      for (const [path, name] of field.aliases) {
        merged.set(path, name);
      }
      aliasPaths.set(field.responseKey, merged);
    }
  }
  return { aliasPaths, keyToRootField, rootFields: [...rootFields].toSorted() };
}

/**
 * A tree of the field names a document selects, one level per nesting level.
 *
 * A plain nested record rather than a class: the only two questions asked of it are "was this field
 * selected here" and "what does its subtree look like", and both are one lookup.
 */
export interface FieldTree {
  readonly [field: string]: FieldTree;
}

/** Walk one selection set into a field tree, following fragments so a spread does not hide a field. */
function treeOf({
  selections,
  fragments,
  seen,
}: {
  selections: readonly SelectionNode[];
  fragments: ReadonlyMap<string, readonly SelectionNode[]>;
  seen: ReadonlySet<string>;
}): FieldTree {
  const tree: Record<string, FieldTree> = {};
  for (const selection of selections) {
    if (selection.kind === "Field") {
      tree[responseKeyOf({ field: selection })] = treeOf({
        fragments,
        seen,
        selections: selectionsUnder({ field: selection }),
      });
      continue;
    }
    for (const [field, subtree] of Object.entries(spreadTree({ fragments, seen, selection }))) {
      tree[field] = subtree;
    }
  }
  return tree;
}

/**
 * The field tree one fragment reference contributes, or an empty one when following it would cycle.
 *
 * The cycle guard is per SPREAD name rather than global, because a document may legitimately spread the
 * same fragment under two different fields — what it may not do is spread one inside itself.
 *
 * @param fragments every fragment the document declares
 * @param seen the fragment names already being followed on this branch
 * @param selection the fragment reference to resolve
 * @returns the tree beneath it
 */
function spreadTree({
  fragments,
  seen,
  selection,
}: {
  fragments: ReadonlyMap<string, readonly SelectionNode[]>;
  seen: ReadonlySet<string>;
  selection: InlineFragmentNode | FragmentSpreadNode;
}): FieldTree {
  if (selection.kind === "InlineFragment") {
    return treeOf({ fragments, seen, selections: selection.selectionSet.selections });
  }
  if (seen.has(selection.name.value)) {
    return {};
  }
  return treeOf({
    fragments,
    seen: new Set([...seen, selection.name.value]),
    selections: spreadOf({ fragments, selection }),
  });
}

/** Every fragment a document declares, indexed by name. */
function fragmentsOf({ document }: { document: DocumentNode }): ReadonlyMap<string, readonly SelectionNode[]> {
  return new Map(
    document.definitions
      .filter((definition): definition is FragmentDefinitionNode => definition.kind === "FragmentDefinition")
      .map((definition): readonly [string, readonly SelectionNode[]] => [
        definition.name.value,
        definition.selectionSet.selections,
      ]),
  );
}

/**
 * The field tree one document selects beneath one root field.
 *
 * `settings.ts` uses this to keep only what an inventory row's document asked for, so a provider returning more than
 * it was asked cannot put an unselected field on disk. An unparseable document yields an EMPTY tree, which
 * prunes everything — a loud, visible failure rather than a silent pass-through of unknown fields.
 *
 * @param document the GraphQL document, as source text
 * @param rootField the root field whose subtree is wanted
 * @returns the selected field tree beneath that root field, or an empty tree
 */
export function selectedFieldTree({ document, rootField }: { document: string; rootField: string }): FieldTree {
  let parsed: DocumentNode;
  try {
    parsed = parse(document, { noLocation: true });
  } catch {
    return {};
  }
  const fragments = fragmentsOf({ document: parsed });
  for (const operation of parsed.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition",
  )) {
    const tree = treeOf({ fragments, seen: new Set<string>(), selections: operation.selectionSet.selections });
    const found = tree[rootField];
    if (found !== undefined) {
      // A connection's rows sit under `nodes`; a caller pruning one row wants THAT subtree, not the
      // connection's. `settings.ts`'s `rowsOf` has already descended, so this descends to match it. A root
      // field that is not a connection selects no `nodes`, and its own subtree is the one wanted.
      const rows = found["nodes"];
      if (rows === undefined) {
        return found;
      }
      return rows;
    }
  }
  return {};
}
