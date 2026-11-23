/**
 * The named-object-params gate — the machine half of the biggest rule in the repo
 * (`.claude/rules/typescript-patterns.md`). Until this existed the rule was prose upheld only by review, which
 * is the shape `testing.md`'s bans were already converted away from.
 *
 * ## What it checks, and why it needs the type checker
 *
 * Two properties, because implementations and declarations differ:
 *
 * - an **implementation** takes at most one parameter, and it must be an options object;
 * - a **declared signature** takes at most one parameter.
 *
 * The second half of the first rule is why this is the only gate here that builds a whole-repo Program rather than
 * parsing one file at a time: deciding whether `facts: FailureFacts` is an options bag needs resolved types,
 * and no syntactic selector can do it. An `eslint` `no-restricted-syntax` selector CAN express "the sole
 * parameter is not an ObjectPattern" — but that is the destructuring spelling, which is deliberately NOT the
 * bar, so the cheap mechanism checks the wrong thing.
 *
 * ## Why "options object" is not "any object"
 *
 * A parameter's job under this rule is to name the options available. `Date`, `Map`, `URL` and `Uint8Array`
 * name nothing — they are values you pass. Testing for a class misses all of them, because TypeScript declares
 * `Date` as an **interface** in its lib files; a first cut of this scanner reported `toYyyyMmDd(date: Date)` as
 * compliant for exactly that reason. So the test is provenance: does the type expose a property declared in
 * THIS repo (or a string index signature, which is a bag by construction).
 *
 * ## Fail-closed
 *
 * A gate that reports clean over files it did not check is this repo's recurring silent-failure class, and a
 * `Program` adds a new way to hit it: an unresolved import turns an imported type into an error type, which
 * would manufacture violations. So `runNamedObjectParams` (`./namedObjectParamsRun.ts`) refuses to print
 * `clean` unless the Program
 * loaded every in-scope file, loaded nothing git does not report, and read a non-zero number of sources.
 *
 * The Program's own diagnostics sit on the OTHER side of the scan, and that placement is the whole reason
 * this gate is no longer the heaviest thing in CI (`verdictAfterScan`, `./namedObjectParamsVerdict.ts`). They answer exactly one
 * question — could a type the
 * checker failed to resolve have manufactured this violation? — and that question only arises once there IS
 * a violation. A broken import cannot produce a false CLEAN here: an error type is `any` by flags, so the
 * options-object test in `./namedObjectParamsDecide.ts` takes its primitive branch and answers false, which is
 * a violation; and the arity half of the rule, with every documented exception, is decided
 * from the AST and never from a resolved type. So a clean scan pays nothing, a violating scan pays for the
 * diagnostics that justify it, and the two properties are the same one. MEASURED: 926 MiB and
 * ~24 s of every clean run, see `HEAP_BUDGET_MIB` in `./namedObjectParamsHeap.ts`. And a violating scan
 * asks only about the files carrying a finding, after it has already printed them: the whole-repo pass on
 * top of the clean path's live set does not fit under the 8,192 MiB ceiling, so it reported every real
 * violation as a V8 heap FATAL instead. Scoped, it is bounded rather than complete — a re-export of a
 * missing module puts the diagnostic in another file — and `verdictAfterScan` names that residue.
 *
 * What that pass ALSO used to buy was compiler diagnostics for `eval/` and `hooks/`. Those live where they
 * belong: `yarn typecheck` runs `tsc --noEmit -p tsconfig.json` as its own CI job, under the same compiler
 * options this gate extends (`skipLibCheck` included, so a `.d.ts` is checked by neither), and its `include`
 * reaches `src/`, `eval/` and `hooks/` alike while excluding `site/` and `desktop/src`.
 *
 * A source marker (`./namedObjectParamsMarkers.ts`) that exempts nothing is itself a `redundant-marker` finding:
 * the signature below it is compliant, already exempt by construction (a type predicate, an inline callback), or
 * the marker is not on the line directly above one. Left alone, a marker whose reason the compiler already
 * decided ("TS1230 forbids destructuring") reads as a judgement call somebody made.
 *
 * ## The decision stream
 *
 * Every signature the walk examines is settled by ONE branch of the rule (`decideSignature`,
 * `./namedObjectParamsDecide.ts`), and a caller that passes `onDecision` receives one
 * {@link NamedObjectParamsDecisionRow} per signature and per redundant marker. The gate run passes none and
 * builds no rows. The stream is the acceptance instrument for moving this rule onto another compiler: the old
 * rule and the new one each write it over the SAME fixed subject tree (`./namedObjectParamsOracle.ts`), and the
 * two files compare byte for byte, so a single signature the compilers decide differently is a visible line.
 *
 * This file is the PURE half — {@link scanNamedObjectParams}, unit-tested against a labelled fixture
 * table — with the decision in `./namedObjectParamsDecide.ts` and the callback exemptions in
 * `./namedObjectParamsCallbacks.ts`. The effectful edge is `./namedObjectParamsRun.ts` and the heap budget
 * `./namedObjectParamsHeap.ts`.
 */

import * as ts from "#lib/tsCompiler.js";

import { identifierArguments } from "./namedObjectParamsCallbacks.js";
import { decideSignature, type NamedObjectParamsDecision } from "./namedObjectParamsDecide.js";
import { isMarkerLine, literalInteriorLines, physicalLines, unusedMarkers } from "./namedObjectParamsMarkers.js";

/** Directories whose TypeScript this rule governs — the same set `tsconfig.lint.json` includes. */
const SCOPED_PREFIXES: readonly string[] = ["src/", "eval/", "hooks/"];

/** Every extension the compiler will load from those directories. Narrower than this is a blind spot. */
const TS_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Which rule a finding broke: one of the two signature rules, or a marker that exempts nothing. For a
 * `redundant-marker` the `name` is empty and the `signature` is the marker comment itself.
 */
type ViolationRule = "arity" | "not-an-options-object" | "redundant-marker";

/** One offending signature, or one marker that exempts nothing. */
export interface NamedObjectParamsViolation {
  readonly path: string;
  readonly line: number;
  readonly name: string;
  readonly rule: ViolationRule;
  readonly signature: string;
}

/**
 * One decision the walk made: a signature and the branch that settled it, or a marker no signature needed.
 * `path` is the source file's name as the Program holds it — the oracle relativises it before writing — and
 * `line`/`column` are 1-based. For a marker row `name` is empty, `column` is the marker's first non-blank
 * column and `signature` is the trimmed marker text.
 */
export interface NamedObjectParamsDecisionRow {
  readonly kind: "signature" | "marker";
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly name: string;
  readonly signature: string;
  readonly decision: NamedObjectParamsDecision;
}

/**
 * Every signature form this rule governs: the implementations and the declarations. Narrowed by the `isX`
 * chain rather than asserted, so the compiler proves each form really is a `SignatureDeclarationBase`.
 */
function signatureOf({ node }: { node: ts.Node }): ts.SignatureDeclaration | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignatureDeclaration(node) ||
    ts.isFunctionTypeNode(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node)
  ) {
    return node;
  }
  return undefined;
}

/** The best display name for a signature. */
function nameOf({ node, sf }: { node: ts.Node; sf: ts.SourceFile }): string {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    return node.name.text;
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignatureDeclaration(node)) {
    return node.name.getText(sf);
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  // A function TYPE behind an alias — `type GraphqlRunner = (query, variables) => …`. Without this the gate
  // reported the repo's own GraphQL transports as `(anonymous)`, which named nothing a reader could go fix.
  if (ts.isTypeAliasDeclaration(parent)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent) || ts.isPropertySignatureDeclaration(parent)) {
    return parent.name.getText(sf);
  }
  return "(anonymous)";
}

/** A signature's parameter list as one line of text — the form both a finding and a decision row carry. */
function signatureText({ sf, signature }: { sf: ts.SourceFile; signature: ts.SignatureDeclaration }): string {
  return `(${signature.parameters.map((p) => p.getText(sf)).join(", ")})`.replace(/\s+/g, " ");
}

/** Where a marker row is: its 1-based column is the first non-blank character of the marker's line. */
function markerColumn({ text }: { text: string }): number {
  return text.length - text.trimStart().length + 1;
}

/** Whether a decision breaks the rule before any marker is consulted. */
function isViolation({ decision }: { decision: NamedObjectParamsDecision }): boolean {
  return decision === "violation-arity" || decision === "violation-not-options-object";
}

/**
 * Settle one decided signature against the line above it. A violation with a marker there is accounted for —
 * the marker is recorded as leaned on and the decision becomes `marker-accounted-*`; a violation without one
 * becomes a finding; anything else is already settled. Only a violation can be accounted, so a marker above a
 * signature the rule lets through stays redundant.
 *
 * @returns the decision as the stream records it
 */
function settleSignature({
  accountedFor,
  decision,
  found,
  lines,
  node,
  sf,
  signature,
  start,
}: {
  accountedFor: Set<number>;
  decision: NamedObjectParamsDecision;
  found: NamedObjectParamsViolation[];
  lines: readonly string[];
  node: ts.Node;
  sf: ts.SourceFile;
  signature: ts.SignatureDeclaration;
  start: ts.LineAndCharacter;
}): NamedObjectParamsDecision {
  if (!isViolation({ decision })) {
    return decision;
  }
  const arity = decision === "violation-arity";
  if (start.line > 0 && isMarkerLine({ line: lines[start.line - 1]! })) {
    accountedFor.add(start.line - 1);
    return arity ? "marker-accounted-arity" : "marker-accounted-not-options-object";
  }
  found.push({
    line: start.line + 1,
    name: nameOf({ node, sf }),
    path: sf.fileName,
    rule: arity ? "arity" : "not-an-options-object",
    signature: signatureText({ sf, signature }),
  });
  return decision;
}

/**
 * Every signature in the given sources that breaks its rule, and every marker that exempts none. Pure — takes a
 * checker and the files to walk, so a unit test drives it over an in-memory program and asserts exactly which
 * signatures trip it. With `onDecision`, also hands over one row per examined signature in walk order, then one
 * per redundant marker, file by file; without it no row is built, so the gate pays nothing for the stream.
 *
 * @param checker the program's type checker
 * @param sourceFiles the in-scope sources to walk
 * @param onDecision receives every decision row as the walk makes it
 * @returns each violation, in path then line order
 */
export function scanNamedObjectParams({
  checker,
  onDecision,
  sourceFiles,
}: {
  checker: ts.Checker;
  onDecision?: (row: NamedObjectParamsDecisionRow) => void;
  sourceFiles: readonly ts.SourceFile[];
}): readonly NamedObjectParamsViolation[] {
  const found: NamedObjectParamsViolation[] = [];
  for (const sf of sourceFiles) {
    const lines = physicalLines({ text: sf.getFullText() });
    const argumentsByName = identifierArguments({ sf });
    // Marker-shaped lines that need no report: template-literal text now, and each marker a signature leans on.
    const accountedFor = literalInteriorLines({ sf });
    const visit = (node: ts.Node): void => {
      const signature = signatureOf({ node });
      if (signature !== undefined) {
        const decision = decideSignature({ argumentsByName, checker, node, signature });
        // The gate run (no sink) locates only a violation, exactly as it did before the stream existed.
        if (isViolation({ decision }) || onDecision !== undefined) {
          const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const settled = settleSignature({ accountedFor, decision, found, lines, node, sf, signature, start });
          onDecision?.({
            column: start.character + 1,
            decision: settled,
            kind: "signature",
            line: start.line + 1,
            name: nameOf({ node, sf }),
            path: sf.fileName,
            signature: signatureText({ sf, signature }),
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
    for (const { line, text } of unusedMarkers({ accountedFor, lines })) {
      found.push({ line, name: "", path: sf.fileName, rule: "redundant-marker", signature: text });
      onDecision?.({
        column: markerColumn({ text: lines[line - 1]! }),
        decision: "redundant-marker",
        kind: "marker",
        line,
        name: "",
        path: sf.fileName,
        signature: text,
      });
    }
  }
  return found.toSorted((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * Whether a repo-relative path is governed by this rule.
 *
 * Every extension TypeScript will load from the included directories, not just `.ts` — `.mts`/`.cts` and their
 * `.d.` variants included. A suffix test narrower than what the compiler loads is not a scoping choice, it is a
 * blind spot: the Program loads such a file, the coverage check then drops it before comparing against git, and
 * a `src/injected.d.mts` git does not report slips through while the gate still prints `clean`. `.tsx` is listed for the
 * same reason even though nothing here uses JSX — if one ever appears, it must be seen rather than skipped.
 *
 * @param path the repo-relative path
 * @returns true when this gate governs the file
 */
export function isScopedPath({ path }: { path: string }): boolean {
  const isTypeScript = TS_EXTENSIONS.some((extension) => path.endsWith(extension));
  return isTypeScript && SCOPED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Which in-scope working-tree files the Program failed to load, and which in-scope files it loaded that git
 * does not report at all. Either direction means the scan did not cover what it claims, so the gate must refuse rather than
 * report clean. Pure, so the integrity rule itself is testable.
 *
 * @param loaded repo-relative paths the Program actually loaded
 * @param listed the in-scope working-tree paths git reports
 * @returns the two discrepancies, each in path order
 */
export function scanCoverageGaps({ loaded, listed }: { loaded: readonly string[]; listed: readonly string[] }): {
  readonly missing: readonly string[];
  readonly unlisted: readonly string[];
} {
  const loadedSet = new Set(loaded);
  const listedSet = new Set(listed);
  return {
    missing: listed.filter((p) => !loadedSet.has(p)).toSorted(),
    unlisted: loaded.filter((p) => !listedSet.has(p)).toSorted(),
  };
}
