/**
 * The `outbound-privacy-closure` gate: no outbound write family lands without a classification against the one
 * outbound privacy check, and a family classified guarded is proven wired, not trusted.
 *
 * ## The denominator, and what it trusts
 *
 * Two structural inventories the repository already keeps, so a new family cannot simply be left off a hand list:
 *
 * - every non-alias verb in `NOUN_GROUPS` whose manifest declares `effect: "external-write"`
 *   (`src/cli/defineCommand.ts`), read exactly as `src/admit/coverage.ts` reads it; and
 * - every key of `SANCTIONED_CLIENT_FACTORIES` (`./schedulerBypass.ts`), the files allowed to build an SDK client.
 *
 * Each verb must be selected by a family in `./outboundPrivacyRegistry.ts`, and each factory owned by exactly one.
 * What slips past, stated: a write verb labelled `external-read` or `local-state`; a write no verb reaches and no
 * recognised SDK constructor builds; a new provider branch inside a verb a family already selects; and a second
 * transport inside a family that its row does not list. The transport lists are hand-kept, so they are the
 * load-bearing part.
 *
 * ## What "guarded" means, checkably
 *
 * Every transport root and factory of a guarded family reaches, through its static RUNTIME import closure
 * (`./staticImportClosure.ts`: type imports and dynamic `import()` are not edges), at least one of its declared
 * check modules, and every check module imports `checkPrivacy` by name and CALLS it. That walk is syntax, so a named
 * import used only in a type position but written without `type` still counts as an edge the compiler would elide
 * (`typescript/consistent-type-imports` warns on that spelling; it does not refuse it). Reachability is not
 * dominance: a transport that imports a guarded helper and sends down another branch passes, which is why a root is
 * the final SDK, `fetch` or relay choke point rather than a verb. Policy freshness and payload completeness stay
 * the provider transport tests' obligation.
 *
 * ## Residue shrinks, and cannot rot
 *
 * A residue family passes only while NO root of it reaches a module that calls `checkPrivacy`. The moment its guard
 * lands the row fails until it reads `guarded`. A family whose roots disagree is `PARTIAL_FAMILY` either way.
 *
 * No `ts.Program`: syntax only, one file at a time. The denominators and every issue raised before a file is read
 * are `./outboundPrivacyDenominator.ts`; this module reads modules and judges reach.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { forEachChild, isParameterDeclaration, type NodeVisitor, nameOf, ts, withSourceFile } from "#lib/tsSyntax.js";
import { NOUN_GROUPS } from "../cli/nounGroups.js";
import type { NounGroups } from "../cli/router.js";
import {
  externalWriteVerbsOf,
  factoryIssues,
  type OutboundPrivacyClosureIssue,
  shapeIssues,
  verbIssues,
} from "./outboundPrivacyDenominator.js";
import { OUTBOUND_PRIVACY_FAMILIES, type OutboundWriteFamily } from "./outboundPrivacyRegistry.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";
import { SANCTIONED_CLIENT_FACTORIES } from "./schedulerBypass.js";
import { staticClosureOf } from "./staticImportClosure.js";
import { resolveSpecifier } from "./untestedModules.js";

/** The one module that defines the check. */
const PRIVACY_CHECK_MODULE = "src/outbound/privacyCheck.ts";

/** What the closure read and what it found. */
export interface OutboundPrivacyClosureReport {
  readonly externalWrites: readonly string[];
  readonly issues: readonly OutboundPrivacyClosureIssue[];
}

/** The repository edge the analyser reads through: real files in the gate, a fixture map in a test. */
interface TreeReader {
  readonly exists: (path: string) => boolean;
  readonly readText: (path: string) => string;
}

/** The identifier a declaration node binds in its scope, when it binds a plain one. */
function declaredIdentifierOf({ node }: { node: ts.Node }): string | undefined {
  const binds =
    isParameterDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportEqualsDeclaration(node);
  if (!binds) {
    return undefined;
  }
  const name = nameOf({ node });
  if (name === undefined || !ts.isIdentifier(name)) {
    return undefined;
  }
  return name.text;
}

/**
 * The runtime named-import elements of one statement that imports from the check module. TypeScript 7 spells
 * `import type { … }` as the clause's `phaseModifier`, not an `isTypeOnly` flag on the clause; an inline
 * `{ type checkPrivacy }` is the element's own `isTypeOnly`. Both are erased, so neither binds a runtime name.
 */
function runtimeCheckImportsOf({
  path,
  statement,
}: {
  path: string;
  statement: ts.Statement;
}): readonly ts.ImportSpecifier[] {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return [];
  }
  const clause = statement.importClause;
  if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    return [];
  }
  if (resolveSpecifier({ fromPath: path, specifier: statement.moduleSpecifier.text }) !== PRIVACY_CHECK_MODULE) {
    return [];
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) {
    return [];
  }
  return bindings.elements.filter((element) => !element.isTypeOnly);
}

/** The local names a module binds `checkPrivacy` to through a runtime named import from the check module. */
function checkBindingsOf({ path, source }: { path: string; source: ts.SourceFile }): ReadonlySet<string> {
  const locals = new Set<string>();
  for (const statement of source.statements) {
    for (const element of runtimeCheckImportsOf({ path, statement })) {
      const imported = element.propertyName === undefined ? element.name.text : element.propertyName.getText(source);
      if (imported === "checkPrivacy") {
        locals.add(element.name.text);
      }
    }
  }
  return locals;
}

/**
 * Whether one module imports `checkPrivacy` from the check module by name and calls that binding. A comment, a
 * string, a re-export, a type import or an unused import is not a call, and neither is a call through a name the
 * module binds a second time (a parameter, local or other import that could shadow the check): syntax alone cannot
 * say which binding such a call reads, so the module is not credited.
 *
 * @param path the module's repo-relative path, against which its import specifiers resolve
 * @param content its source text
 * @returns true only for a runtime named import of `checkPrivacy` that is invoked
 */
export function callsCheckPrivacy({ path, content }: { path: string; content: string }): boolean {
  return withSourceFile({
    fileName: "m.ts",
    text: content,
    use: (source): boolean => {
      const locals = checkBindingsOf({ path, source });
      const declarations = new Map<string, number>();
      const calledNames = new Set<string>();
      const visit: NodeVisitor = (node) => {
        const declared = declaredIdentifierOf({ node });
        if (declared !== undefined) {
          const prior = declarations.get(declared);
          declarations.set(declared, prior === undefined ? 1 : prior + 1);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          calledNames.add(node.expression.text);
        }
        forEachChild({ node, visit });
        return undefined;
      };
      visit(source);
      return [...locals].some((local) => calledNames.has(local) && declarations.get(local) === 1);
    },
  });
}

/** Which roots of one family reach a module calling the check, and which reach a declared check module. */
function reachOf({
  checks,
  roots,
  tree,
}: {
  checks: readonly string[];
  roots: readonly string[];
  tree: TreeReader;
}): readonly { readonly root: string; readonly reachesAny: boolean; readonly reachesDeclared: boolean }[] {
  return roots.map((root) => {
    const files = staticClosureOf({ readText: tree.readText, roots: [root] }).files;
    const reachesAny = files.some(
      (file) => file !== PRIVACY_CHECK_MODULE && callsCheckPrivacy({ content: tree.readText(file), path: file }),
    );
    return { reachesAny, reachesDeclared: checks.some((check) => files.includes(check)), root };
  });
}

/** The issues one guarded or residue family's modules raise. */
function moduleIssues({
  family,
  tree,
}: {
  family: OutboundWriteFamily;
  tree: TreeReader;
}): readonly OutboundPrivacyClosureIssue[] {
  const { classification } = family;
  if (classification.kind === "read-only") {
    return [];
  }
  const checks = classification.kind === "guarded" ? classification.checks : [];
  const roots = [...new Set([...family.transports, ...family.factories])];
  const missing = [...roots, ...checks].filter((path) => !tree.exists(path));
  if (missing.length > 0) {
    return missing.map((path) => ({
      code: "MISSING_MODULE" as const,
      message: `${family.id}: ${path} does not exist: point the row at the module that now holds that role`,
      subject: `${family.id}: ${path}`,
    }));
  }
  const uncalled = checks.filter((path) => !callsCheckPrivacy({ content: tree.readText(path), path }));
  const issues: OutboundPrivacyClosureIssue[] = uncalled.map((path) => ({
    code: "CHECK_NOT_CALLED",
    message: `${family.id}: ${path} no longer calls checkPrivacy: restore the call, or name the module that does`,
    subject: `${family.id}: ${path}`,
  }));
  const reach = reachOf({ checks, roots, tree });
  const judged = reach.filter(({ reachesAny }) => reachesAny).length;
  if (judged > 0 && judged < reach.length) {
    issues.push({
      code: "PARTIAL_FAMILY",
      message: `${family.id}: only ${String(judged)} of its ${String(reach.length)} roots reach checkPrivacy: guard the rest, or split the family`,
      subject: family.id,
    });
    return issues;
  }
  if (classification.kind === "residue" && judged > 0) {
    issues.push({
      code: "RESIDUE_IS_NOW_GUARDED",
      message: `${family.id}: every root now reaches checkPrivacy: classify it guarded, naming its check module`,
      subject: family.id,
    });
  }
  for (const { root, reachesDeclared } of classification.kind === "guarded" ? reach : []) {
    if (!reachesDeclared) {
      issues.push({
        code: "GUARD_NOT_REACHED",
        message: `${family.id}: ${root} no longer reaches ${checks.join(" or ")} at runtime: every write must cross the check`,
        subject: `${family.id}: ${root}`,
      });
    }
  }
  return issues;
}

/**
 * Judge the closure: every external-write verb belongs to a family, every sanctioned factory to exactly one, every
 * guarded family's roots reach a module that calls the check, and every residue family's reach none.
 *
 * @param families the registry
 * @param groups the folded verb registry, the verb denominator
 * @param sanctioned the sanctioned SDK factory paths, the factory denominator
 * @param exists whether a repo-relative file exists; the edge where the real tree is read
 * @param readText a repo-relative file's text
 * @returns the external-write verbs read, and every issue sorted by subject then code
 */
export function analyzeOutboundPrivacyClosure({
  families,
  groups,
  sanctioned,
  exists,
  readText,
}: {
  families: readonly OutboundWriteFamily[];
  groups: NounGroups;
  sanctioned: readonly string[];
  exists: (path: string) => boolean;
  readText: (path: string) => string;
}): OutboundPrivacyClosureReport {
  const externalWrites = externalWriteVerbsOf({ groups });
  if (families.length === 0 || externalWrites.length === 0 || sanctioned.length === 0) {
    const issue: OutboundPrivacyClosureIssue = {
      code: "EMPTY_DENOMINATOR",
      message: `read ${String(families.length)} families, ${String(externalWrites.length)} external-write verbs and ${String(sanctioned.length)} sanctioned factories: an empty input proves no closure`,
      subject: "denominator",
    };
    return { externalWrites, issues: [issue] };
  }
  const tree: TreeReader = { exists, readText };
  const issues = [
    ...shapeIssues({ families }),
    ...verbIssues({ externalWrites, families }),
    ...factoryIssues({ families, sanctioned }),
    ...families.flatMap((family) => moduleIssues({ family, tree })),
  ].toSorted((a, b) => a.subject.localeCompare(b.subject) || a.code.localeCompare(b.code));
  return { externalWrites, issues };
}

/**
 * IO edge: judge the real registry against this checkout, print each issue, return 0 (closed) or 1.
 *
 * @returns the process exit code
 */
export function runOutboundPrivacyClosure(): number {
  const root = repoRoot();
  const texts = new Map<string, string>();
  const report = analyzeOutboundPrivacyClosure({
    exists: (path) => existsSync(join(root, path)),
    families: OUTBOUND_PRIVACY_FAMILIES,
    groups: NOUN_GROUPS,
    readText: (path) => {
      const cached = texts.get(path);
      if (cached !== undefined) {
        return cached;
      }
      const text = readFileSync(join(root, path), "utf8");
      texts.set(path, text);
      return text;
    },
    sanctioned: Object.keys(SANCTIONED_CLIENT_FACTORIES),
  });
  if (report.issues.length === 0) {
    process.stdout.write(
      `outbound-privacy-closure: closed (${String(report.externalWrites.length)} external-write verbs, ${String(OUTBOUND_PRIVACY_FAMILIES.length)} families)\n`,
    );
    return 0;
  }
  for (const issue of report.issues) {
    process.stderr.write(`  [${issue.code}] ${issue.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "outbound-privacy-closure" }),
      detail: `${String(report.issues.length)} closure issue(s)`,
    })}\n`,
  );
  return 1;
}
