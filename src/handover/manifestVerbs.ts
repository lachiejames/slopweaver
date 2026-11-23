/**
 * Which run module a slopweaver verb's manifest entry loads, read off the manifest SOURCE by parsing it.
 *
 * Parsed rather than pattern-matched, because a text read cannot tell a live entry from one inside a comment
 * or a string: a commented-out entry or one written inside a template string would otherwise hold a row.
 * In the syntax tree neither is a property assignment,
 * so the class is closed rather than each spelling of it.
 *
 * What one member loads is `./manifestLoaders.ts`, and how the files bind names to each other `./manifestBarrel.ts`;
 * this module walks spreads and overrides to the member a verb finally reaches. All three sit beside `./evidenceRefs.ts` rather than in it, so loading the compiler is paid only by
 * `handover reconcile`'s trunk-moved read and never by `handover register`'s stale-evidence gate, which reads
 * paths alone. MEASURED at 123ms —
 * `node -e 'const t=performance.now(); require("typescript"); console.log(performance.now()-t)'`.
 */

import { ts } from "#lib/tsSyntax.js";

import { canonicalNoun } from "../cli/nounAliases.js";
import type { VerbRef } from "./evidenceRefs.js";
import {
  exportedLocals,
  importedBinding,
  type NounBinding,
  nounBinding,
  withParsedManifest,
} from "./manifestBarrel.js";
import { keyText, lazyEntry, type ManifestEntry, topLevelConsts, unwrapped } from "./manifestLoaders.js";

/**
 * One member of a manifest object, in source order: the verb key it sets — `undefined` when no key can be read,
 * so it may set any verb — and its entry, `undefined` when its value is not a loader this module can read.
 */
interface ManifestSlot {
  readonly verb: string | undefined;
  readonly entry: ManifestEntry | undefined;
}

/** A member that may set any verb to anything: an unreadable key, spread or cycle. */
const UNKNOWN_SLOT: ManifestSlot = { entry: undefined, verb: undefined };

/**
 * The local names a manifest file binds one export of the CLI's `src/cli/manifest.ts` to: `DEFAULT_VERB`, so a
 * `[DEFAULT_VERB]` key reads as `""`, the verb a bare noun runs; and `lazy`, so a call to a same-named function
 * the file declares itself is never read as the CLI's loader.
 */
function manifestImportNames({ source, exported }: { source: ts.SourceFile; exported: string }): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    const bindings = statement.importClause?.namedBindings;
    const fromManifest =
      ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "../manifest.js";
    if (
      !fromManifest ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
      bindings === undefined ||
      !ts.isNamedImports(bindings)
    ) {
      continue;
    }
    for (const element of bindings.elements.filter((each) => !each.isTypeOnly)) {
      const imported = element.propertyName === undefined ? element.name.text : element.propertyName.text;
      if (imported === exported) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

/** The verb key a member names: written bare or quoted, or `[DEFAULT_VERB]`; `undefined` for any other key. */
function memberVerb({ name, defaults }: { name: ts.PropertyName; defaults: ReadonlySet<string> }): string | undefined {
  const isDefault =
    ts.isComputedPropertyName(name) && ts.isIdentifier(name.expression) && defaults.has(name.expression.text);
  return isDefault ? "" : keyText({ name });
}

/** What one non-spread member of a manifest object sets. */
function slotOf({
  node,
  loaders,
  defaults,
  lazyNames,
}: {
  node: ts.ObjectLiteralElementLike;
  loaders: ReadonlyMap<string, ts.Expression>;
  defaults: ReadonlySet<string>;
  lazyNames: ReadonlySet<string>;
}): ManifestSlot {
  if (ts.isShorthandPropertyAssignment(node)) {
    return { entry: undefined, verb: ts.isIdentifier(node.name) ? node.name.text : undefined };
  }
  if (ts.isSpreadAssignment(node)) {
    return UNKNOWN_SLOT;
  }
  return { entry: lazyEntry({ lazyNames, loaders, node }), verb: memberVerb({ defaults, name: node.name }) };
}

/**
 * The members a top-level `const` object in `file` sets, in source order, with every object it spreads inlined
 * where the spread sits — a same-file `const`, or a name the file imports from a sibling manifest, followed to the
 * `const` that file exports: `handover`'s object is built from `...handoverAskManifest`. Order is
 * kept because a later member overrides an earlier one, as JavaScript reads `{ ...base, status: … }`. `undefined` when the name reaches no object literal this module can read; a spread of one becomes an
 * {@link UNKNOWN_SLOT}, as does a cycle. An object nothing exported reaches is never read.
 */
function objectSlots({
  file,
  name,
  manifests,
  seen,
}: {
  file: string;
  name: string;
  manifests: ReadonlyMap<string, string>;
  seen: ReadonlySet<string>;
}): readonly ManifestSlot[] | undefined {
  const key = `${file}:${name}`;
  const text = manifests.get(file);
  if (text === undefined || seen.has(key)) {
    return undefined;
  }
  return withParsedManifest({
    text,
    use: (source): readonly ManifestSlot[] | undefined => {
      const consts = topLevelConsts({ source });
      const within = new Set([...seen, key]);
      const initializer = consts.get(name);
      if (initializer === undefined) {
        const [binding, ...others] = importedBinding({ name, source });
        return binding === undefined || others.length > 0
          ? undefined
          : exportSlots({ binding, manifests, seen: within });
      }
      const object = unwrapped({ node: initializer });
      if (!ts.isObjectLiteralExpression(object)) {
        return undefined;
      }
      const defaults = manifestImportNames({ exported: "DEFAULT_VERB", source });
      const lazyNames = manifestImportNames({ exported: "lazy", source });
      return literalSlots({
        follow: (spread) => objectSlots({ file, manifests, name: spread, seen: within }),
        object,
        slot: (node) => slotOf({ defaults, lazyNames, loaders: consts, node }),
      });
    },
  });
}

/**
 * The members one object literal sets, in source order: an inline `...{ … }` spread is inlined where it sits,
 * a named one is read through `follow`, and any other spread is an {@link UNKNOWN_SLOT}.
 */
function literalSlots({
  object,
  slot,
  follow,
}: {
  object: ts.ObjectLiteralExpression;
  slot: (node: ts.ObjectLiteralElementLike) => ManifestSlot;
  follow: (name: string) => readonly ManifestSlot[] | undefined;
}): readonly ManifestSlot[] {
  return object.properties.flatMap((property): readonly ManifestSlot[] => {
    if (!ts.isSpreadAssignment(property)) {
      return [slot(property)];
    }
    const spread = unwrapped({ node: property.expression });
    if (ts.isObjectLiteralExpression(spread)) {
      return literalSlots({ follow, object: spread, slot });
    }
    const inner = ts.isIdentifier(spread) ? follow(spread.text) : undefined;
    if (inner === undefined) {
      return [UNKNOWN_SLOT];
    }
    return inner;
  });
}

/** The members of the object a manifest file exports under `binding.exported`, or `undefined` when unreadable. */
function exportSlots({
  binding,
  manifests,
  seen,
}: {
  binding: NounBinding;
  manifests: ReadonlyMap<string, string>;
  seen: ReadonlySet<string>;
}): readonly ManifestSlot[] | undefined {
  const text = manifests.get(binding.file);
  if (text === undefined) {
    return undefined;
  }
  const local = withParsedManifest({
    text,
    use: (source): string | undefined => exportedLocals({ source }).get(binding.exported),
  });
  return local === undefined ? undefined : objectSlots({ file: binding.file, manifests, name: local, seen });
}

/** What a verb finally loads in one object: absent, a readable entry, or unknown (`undefined`). */
function finalSlot({
  slots,
  verb,
}: {
  slots: readonly ManifestSlot[];
  verb: string;
}): ManifestEntry | "absent" | undefined {
  const last = slots.findLast((slot) => slot.verb === undefined || slot.verb === verb);
  if (last === undefined) {
    return "absent";
  }
  return last.entry;
}

/**
 * The run module a verb's manifest entry lazily loads.
 *
 * The entry is the LAST member setting this verb in the manifest object the barrel's last row for this noun binds,
 * so `slack status` can never resolve to `codex status`'s module, `notion read` resolves to the shared module it
 * really loads, and an override wins over what it overrides. Anything else — another loader shape, a last member
 * whose key or spread cannot be read, a noun the barrel does not bind, a barrel row that cannot be read, or a checkout with no manifests at all — resolves to nothing, and the verb is dropped rather than
 * guessed: dropping it holds nothing, which is the hold's honest direction.
 *
 * @param manifests the source text of each `src/cli/manifests/*.ts` file in the row's checkout, keyed by file name
 * @param ref the verb an evidence item named
 * @returns the repo-relative `.ts` path, or `undefined` when no live entry names it
 */
export function verbRunModule({
  manifests,
  ref,
}: {
  manifests: ReadonlyMap<string, string>;
  ref: VerbRef;
}): string | undefined {
  const barrel = manifests.get("index.ts");
  if (barrel === undefined) {
    return undefined;
  }
  // Dispatch resolves a noun's earlier name before routing, so `recipe status` loads `automation status`'s module.
  const binding = nounBinding({ barrel, manifests, noun: canonicalNoun({ noun: ref.noun }) });
  if (binding === undefined || binding === "unbound") {
    return undefined;
  }
  const slots = exportSlots({ binding, manifests, seen: new Set() });
  const final = slots === undefined ? undefined : finalSlot({ slots, verb: ref.verb });
  if (final === undefined || final === "absent") {
    return undefined;
  }
  return `src/cli/commands/${final.dir}/${final.file}.ts`;
}
