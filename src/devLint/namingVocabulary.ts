/**
 * The naming-doctrine gate's vocabulary half: a retired word may not name something we declare.
 *
 * Every external system is an INTEGRATION, and `provider`, `platform` and `connector` retire from our own vocabulary,
 * each meaning they carried taking its own glossary term (`docs/doctrine-rationale/rule-11.md` § The integration
 * glossary). The renames are their own pull requests; this half stops a NEW use landing while they happen.
 *
 * ## The criterion
 *
 * **A hit is one of `provider`, `platform` or `connector`, singular or plural, as a WHOLE segment** of an
 * identifier ({@link nameSegments}: hyphen, underscore, camelCase and acronym boundaries), so `FooProviderSpec`
 * and `SDKProvider` hit and `improvised` or `platformer` never do. **The identifiers judged are the ones we
 * declare as a contract**: the name of a type alias, interface, class, enum or namespace (exported or not, a UMD
 * `export as namespace X` included); every
 * binding an EXPORTED function, `const`, `let` or `var` declares, destructured ones included; the binding an
 * `export * as X` or `export import X =` names; and an identifier-named property or method signature in any
 * interface or type literal, an options bag's included.
 *
 * ## The wire rule, computed
 *
 * Another system's words keep their spelling. Three shapes carry that fact in syntax, and nothing else is trusted:
 *
 * - **A QUOTED name**, a member's (`interface Wire { "provider": string }`) or an export alias's
 *   (`export { x as "provider-id" }`), is a spelling another system chose; quoting it is the author asserting so,
 *   visibly, in the diff. A `Dto`/`Wire`/`Response` suffix is not evidence: those names
 *   are author-chosen and also name our own shapes.
 * - **A React context provider component**: a function declaration whose name ends in the `provider` segment and
 *   whose body renders `<X.Provider>`, exported directly or by an unrenamed `export { XProvider }`. React named
 *   that idiom; the JSX tag in its body is the proof, not the name.
 * - **A generated file** (a whole `generated` path segment) transcribes an integration's schema; its generator is
 *   still scanned. That half is the shell's ({@link isGeneratedPath}).
 *
 * An object-literal key (a `z.object({ … })` schema's, a `defineBoundary` schema's) is outside the subject in the
 * first place, so no call-ancestry exemption exists. An SDK type re-exported unchanged declares nothing here; a
 * local alias of it (`type MyProvider = Sdk.Provider`) is our name and hits.
 *
 * ## Named blind spots
 *
 * A name exported through an export list (`export { fooProvider }`, `export { x as fooProvider }`) is judged as
 * the exported spelling; an unrenamed re-export from another module keeps that module's. An arrow-function
 * component (`export const XProvider = () => …`) is not granted the React exemption, which reads a function
 * declaration only, so it hits.
 * Locals, parameters, type parameters, class members, enum members, import aliases, object-literal keys, a class
 * EXPRESSION's own name, and a binding with no `export` modifier (a `declare const`, or a member of a
 * `declare global` or `declare module "x"` block, which names another system's or the runtime's global) are not
 * judged: they are outside the owner's "type, interface or exported-field names" and would enlarge the seed for
 * little. Node's
 * `process.platform` is a use, not a declaration, and never reached. The debt identity is `{path, name}` with a
 * count, so removing one declaration and adding another of the same name in the same file in one change is
 * invisible: a line-keyed identity would churn on every edit above it.
 *
 * Pure. The effectful shell is `./namingVocabularyRun.ts`.
 */

import { z } from "zod";
import { countBy, countOf } from "#lib/collections.js";
import { compareStrings } from "#lib/compare.js";
import { err, ok, type Result } from "#lib/result.js";
import {
  bindingElementsOf,
  forEachChild,
  hasModifier,
  isClassLikeDeclaration,
  isFunctionLikeDeclaration,
  type NodeVisitor,
  nameOf,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";
import { decodeDebtList } from "./decodeDebtList.js";
import { type DevLintInputError, DevLintInputErrors } from "./errors.js";
import { nameSegments } from "./namingDoctrine.js";

/** The retired segments, singular and plural. */
const RETIRED_SEGMENTS: ReadonlySet<string> = new Set([
  "connector",
  "connectors",
  "platform",
  "platforms",
  "provider",
  "providers",
]);

/**
 * Which declaration shape a hit came from.
 *
 * @internal — reached as {@link NamingVocabularyHit}'s `kind`, never named by a consumer.
 */
export type VocabularyDeclarationKind =
  "type" | "interface" | "class" | "enum" | "namespace" | "function" | "variable" | "field";

/** One identifier we declare that carries a retired word. */
export interface NamingVocabularyHit {
  readonly kind: VocabularyDeclarationKind;
  /** 1-based. */
  readonly line: number;
  readonly name: string;
  readonly path: string;
}

/** One debt row: how many declarations of `name` in `path` the register still holds. */
export interface NamingVocabularyDebtRow {
  readonly count: number;
  readonly name: string;
  readonly path: string;
}

/** The committed register's whole document. */
export interface NamingVocabularyBaseline {
  readonly identifiers: readonly NamingVocabularyDebtRow[];
}

/** A register row the tree no longer fully fires: its recorded count against the count found. */
export interface NamingVocabularyDebtReduction {
  readonly actual: number;
  readonly name: string;
  readonly path: string;
  readonly recorded: number;
}

/**
 * Whether an identifier carries a retired word as a whole segment.
 *
 * @param name an identifier as declared
 * @returns true when one of its segments is retired
 */
export function carriesRetiredWord({ name }: { name: string }): boolean {
  return nameSegments({ name }).some((segment) => RETIRED_SEGMENTS.has(segment));
}

/**
 * Whether a repo-relative path sits beneath a whole `generated` directory segment, so a generator transcribed it.
 *
 * @param path the repo-relative path
 * @returns true for a generated file
 */
export function isGeneratedPath({ path }: { path: string }): boolean {
  return path.split("/").slice(0, -1).includes("generated");
}

/** Every identifier a binding name declares, a destructuring pattern walked to its leaves. */
function boundIdentifiers({ name }: { name: ts.BindingName }): readonly ts.Identifier[] {
  if (ts.isIdentifier(name)) {
    return [name];
  }
  return bindingElementsOf({ pattern: name }).flatMap((element) => boundIdentifiers({ name: element.name }));
}

/**
 * Whether a function body itself renders React's context provider: a JSX tag that is a member access ending
 * `.Provider` (`<VoiceContext.Provider>`). A nested function or class is a boundary: a tag inside one is rendered
 * only if something calls it, which syntax cannot prove.
 */
function rendersContextProvider({ node }: { node: ts.Node }): boolean {
  const isTag = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
  if (isTag && ts.isPropertyAccessExpression(node.tagName) && node.tagName.name.text === "Provider") {
    return true;
  }
  if (isFunctionLikeDeclaration(node) || isClassLikeDeclaration(node)) {
    return false;
  }
  return (
    forEachChild({ node, visit: (child) => (rendersContextProvider({ node: child }) ? true : undefined) }) === true
  );
}

/**
 * Whether a function is a React context provider component: its name ends in the `provider` segment and its body
 * renders React's own `<X.Provider>`. That spelling is React's (the wire rule, for an SDK), proven in syntax.
 */
function isReactContextProvider({ node, name }: { node: ts.FunctionDeclaration; name: ts.Identifier }): boolean {
  const endsInProvider = nameSegments({ name: name.text }).at(-1) === "provider";
  return endsInProvider && node.body !== undefined && rendersContextProvider({ node: node.body });
}

/** The names of a file's top-level function declarations that are React context provider components. */
function reactContextComponentsOf({ sourceFile }: { sourceFile: ts.SourceFile }): ReadonlySet<string> {
  return new Set(
    sourceFile.statements.flatMap((statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      isReactContextProvider({ name: statement.name, node: statement })
        ? [statement.name.text]
        : [],
    ),
  );
}

/** One judged identifier and the declaration shape it came from. */
type JudgedName = { kind: VocabularyDeclarationKind; id: ts.Identifier };

/**
 * The identifiers one node declares that this gate judges, each with its shape. `reactContextComponents` names the
 * file's React context provider functions, so an unrenamed `export { XProvider }` of one keeps React's spelling.
 */
function judgedNames({
  node,
  reactContextComponents,
}: {
  node: ts.Node;
  reactContextComponents: ReadonlySet<string>;
}): readonly JudgedName[] {
  if (ts.isExportDeclaration(node)) {
    return exportClauseNames({ node, reactContextComponents });
  }
  if (hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node })) {
    const bindings = exportedBindingNames({ node });
    if (bindings !== undefined) {
      return bindings;
    }
  }
  return typeLevelNames({ node });
}

/**
 * The names a type-level declaration carries, exported or not: a type alias, interface (and its members), type
 * literal's members, enum, namespace or class.
 */
function typeLevelNames({ node }: { node: ts.Node }): readonly JudgedName[] {
  if (ts.isTypeAliasDeclaration(node)) {
    return [{ id: node.name, kind: "type" }];
  }
  if (ts.isInterfaceDeclaration(node)) {
    return [{ id: node.name, kind: "interface" }, ...memberNames({ members: node.members })];
  }
  if (ts.isTypeLiteralNode(node)) {
    return memberNames({ members: node.members });
  }
  if (ts.isEnumDeclaration(node)) {
    return [{ id: node.name, kind: "enum" }];
  }
  if (ts.isModuleDeclaration(node)) {
    // `namespace BillingProvider {}` is our name; `declare module "sdk" {}` is a quoted module specifier.
    return ts.isIdentifier(node.name) ? [{ id: node.name, kind: "namespace" }] : [];
  }
  if (ts.isNamespaceExportDeclaration(node)) {
    // `export as namespace BillingProvider;`, a UMD global a declaration file names.
    return [{ id: node.name, kind: "namespace" }];
  }
  if (ts.isClassDeclaration(node)) {
    return node.name === undefined ? [] : [{ id: node.name, kind: "class" }];
  }
  return [];
}

/**
 * The bindings an `export`-modified function, variable statement or `export import X =` declares, or undefined when
 * the node is none of those (so the caller reads it as a type-level declaration). A React context provider function
 * keeps React's spelling and declares nothing judged.
 */
function exportedBindingNames({ node }: { node: ts.Node }): readonly JudgedName[] | undefined {
  if (ts.isFunctionDeclaration(node)) {
    const reactSpelling = node.name !== undefined && isReactContextProvider({ node, name: node.name });
    return node.name === undefined || reactSpelling ? [] : [{ id: node.name, kind: "function" }];
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap((declaration) =>
      boundIdentifiers({ name: declaration.name }).map((id) => ({ id, kind: "variable" as const })),
    );
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return [{ id: node.name, kind: "variable" }];
  }
  return undefined;
}

/**
 * The names an export declaration chooses here. `export { fooProvider }` or `export { x as fooProvider }` exports a
 * name chosen here; a re-export from another module keeps that module's spelling unless it is renamed on the way
 * through. `export * as BillingProvider from "./x.js"` names a binding here. A quoted name is a wire spelling.
 */
function exportClauseNames({
  node,
  reactContextComponents,
}: {
  node: ts.ExportDeclaration;
  reactContextComponents: ReadonlySet<string>;
}): readonly JudgedName[] {
  const clause = node.exportClause;
  if (clause === undefined) {
    return [];
  }
  if (ts.isNamespaceExport(clause)) {
    return ts.isIdentifier(clause.name) ? [{ id: clause.name, kind: "variable" }] : [];
  }
  const fromModule = node.moduleSpecifier !== undefined;
  return clause.elements.flatMap((specifier): readonly JudgedName[] => {
    const renamed = specifier.propertyName !== undefined;
    if ((fromModule && !renamed) || !ts.isIdentifier(specifier.name)) {
      return [];
    }
    const reactSpelling = !fromModule && !renamed && reactContextComponents.has(specifier.name.text);
    return reactSpelling ? [] : [{ id: specifier.name, kind: "variable" }];
  });
}

/**
 * The fields an interface or type literal declares: every member with a name (property, method, get or set
 * accessor). A quoted or computed member name is a wire key by spelling (see the header), so only an identifier
 * counts; an index or call signature names nothing.
 */
function memberNames({
  members,
}: {
  members: readonly ts.TypeElement[];
}): readonly { kind: VocabularyDeclarationKind; id: ts.Identifier }[] {
  return members.flatMap((member) => {
    const name = nameOf({ node: member });
    return name !== undefined && ts.isIdentifier(name) ? [{ id: name, kind: "field" as const }] : [];
  });
}

/**
 * Every identifier in one file that we declare and that carries a retired word. Pure: parses in memory and
 * reads no comment.
 *
 * @param path the repo-relative path, for reporting and for the parser's script kind (`.tsx`)
 * @param text the file's contents
 * @returns each hit in source order
 */
export function vocabularyHits({ path, text }: { path: string; text: string }): readonly NamingVocabularyHit[] {
  return withSourceFile({
    fileName: path,
    text,
    use: (sourceFile): readonly NamingVocabularyHit[] => {
      const found: { at: number; hit: NamingVocabularyHit }[] = [];
      const reactContextComponents = reactContextComponentsOf({ sourceFile });
      const visit: NodeVisitor = (node) => {
        for (const { id, kind } of judgedNames({ reactContextComponents, node })) {
          const name = id.text;
          if (carriesRetiredWord({ name })) {
            const at = id.getStart(sourceFile);
            const line = sourceFile.getLineAndCharacterOfPosition(at).line + 1;
            found.push({ at, hit: { kind, line, name, path } });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sourceFile);
      // A container reports its members as it is reached, ahead of a nested literal's; position restores order.
      return found.toSorted((a, b) => a.at - b.at).map(({ hit }) => hit);
    },
  });
}

/** The identity a hit and a debt row share. */
function identityOf({ path, name }: { path: string; name: string }): string {
  return `${path}\t${name}`;
}

/**
 * Judge the hits against the register. A row covers up to `count` hits of its identity, spent in source order, so
 * an excess hit is fresh; a row covering more than the tree holds is stale, with both counts.
 *
 * @param hits every hit this run found
 * @param debt the register's rows
 * @returns the hits the register does not cover, and the rows that overstate the tree
 */
export function partitionVocabularyAgainstDebt({
  hits,
  debt,
}: {
  hits: readonly NamingVocabularyHit[];
  debt: readonly NamingVocabularyDebtRow[];
}): { readonly fresh: readonly NamingVocabularyHit[]; readonly stale: readonly NamingVocabularyDebtReduction[] } {
  const remaining = new Map(debt.map((row) => [identityOf(row), row.count]));
  const fresh = hits.filter((hit) => {
    const key = identityOf(hit);
    const left = countOf({ counts: remaining, key });
    if (left === 0) {
      return true;
    }
    remaining.set(key, left - 1);
    return false;
  });
  const found = countBy({ keys: hits.map((hit) => identityOf(hit)) });
  const stale = debt.flatMap((row): readonly NamingVocabularyDebtReduction[] => {
    const actual = countOf({ counts: found, key: identityOf(row) });
    return actual < row.count ? [{ actual, name: row.name, path: row.path, recorded: row.count }] : [];
  });
  return { fresh, stale };
}

/**
 * The register a set of hits measures: one row per identity, counted, sorted by path then name.
 *
 * @param hits every hit a complete scan found
 * @returns the document to commit
 */
export function namingVocabularyBaselineOf({
  hits,
}: {
  hits: readonly NamingVocabularyHit[];
}): NamingVocabularyBaseline {
  const counts = countBy({ keys: hits.map((hit) => identityOf(hit)) });
  const firstOf = new Map(hits.toReversed().map((hit) => [identityOf(hit), hit]));
  const identifiers = [...firstOf]
    .map(([key, { path, name }]): NamingVocabularyDebtRow => ({ count: countOf({ counts, key }), name, path }))
    .toSorted((a, b) => compareStrings({ a: a.path, b: b.path }) || compareStrings({ a: a.name, b: b.name }));
  return { identifiers };
}

const baselineSchema = z.object({
  identifiers: z.array(
    z.object({ count: z.number().int().positive(), name: z.string().min(1), path: z.string().min(1) }).strict(),
  ),
});

/** What a reader types the register as, for the shape failure. */
const BASELINE_SHAPE = '{ identifiers: [{ "path": "…", "name": "…", "count": 1 }, …] }';

/** How the register names itself in a failure. */
const BASELINE_LABEL = "naming-vocabulary baseline";

/**
 * Decode the committed register, refusing a duplicate identity rather than summing two rows.
 *
 * @param text the committed file's contents
 * @returns the register, or which half of the decode failed
 */
export function parseNamingVocabularyBaseline({
  text,
}: {
  text: string;
}): Result<NamingVocabularyBaseline, DevLintInputError> {
  return decodeDebtList({ label: BASELINE_LABEL, schema: baselineSchema, shape: BASELINE_SHAPE, text }).andThen(
    (baseline) => {
      const keys = baseline.identifiers.map((row) => identityOf(row));
      if (new Set(keys).size !== keys.length) {
        return err(
          DevLintInputErrors.baselineShapeInvalid({
            expected: `${BASELINE_SHAPE}, each identity once`,
            label: BASELINE_LABEL,
          }),
        );
      }
      return ok(baseline);
    },
  );
}
