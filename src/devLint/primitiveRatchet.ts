/**
 * The primitive-clone ratchet (code-quality round 2, item 7) — the narrow AST check
 * `duplicateWindows.ts`'s own header names as its complement: "not a family like `optStr` that drifted
 * slightly across its copies... a complement to the narrow AST ratchets that class of duplication needs,
 * not a substitute." `optStr` went from 12 to 14 copies in the day after round 1 recommended deleting it,
 * two of the new ones in files that did not exist at round-1 HEAD — proof the class reopens the moment
 * nothing watches it, so this is a standing gate rather than a one-off cleanup.
 *
 * ## What it checks
 *
 * A small, deliberately curated registry ({@link REGISTERED_PRIMITIVES}) names each canonical primitive as
 * a `{ file, name }` pair — a top-level `function` declaration this repo has decided is the ONE home for
 * that logic. The gate parses that declaration's body once, then walks every OTHER source file: a
 * new top-level function whose body is STRUCTURALLY equal to a registered primitive's is refused, wherever
 * it is declared.
 *
 * "Structurally equal" is exact-shape equality over the parsed AST — same node kinds in the same
 * arrangement, same identifier and literal text — computed by {@link structuralKeyOf} without ever reading
 * a node's original position or trivia. That is deliberately NOT the same test as `ts.createPrinter`'s
 * output: printing an ORIGINAL (non-synthesized) node reuses some of the source's own line breaks inside
 * binary/conditional expressions, so two copies reformatted differently can print unequal text while being
 * the same shape — measured directly against this file's own registered case. A structural key walks
 * `forEachChild` and never touches `pos`/`end`, so whitespace, comments and reflowed line breaks cannot
 * affect the verdict, and only the FIRST-authored token still counts as a match: a renamed variable changes
 * `structuralKeyOf`'s output (an `Identifier:value` vs. `Identifier:v`), because a rename is exactly the
 * kind of copy that has stopped being a duplicate and started being a decision that deserves review.
 *
 * ## Why not `src/lib/`
 *
 * The registry can name any file, not only `src/lib/` — the code-quality survey's own item 7 recommendation
 * said "a registered `src/lib/` primitive", but `optStr`'s actual canonical home is
 * `src/corpus/slack/shape.ts` (see that file's own header for why), so the mechanism has to be general
 * rather than assuming one directory.
 *
 * ## Why a plain per-file parse, not a shared `ts.Program`
 *
 * This needs syntax only — no resolved types — so it follows `noNestedTernaries.ts`'s shape: one
 * `withSourceFile` per candidate, no `ts.Program`. `devLint.ts`'s own header is explicit that a second
 * whole-repo `ts.Program` pays the ~2 GB `named-object-params` already pays again; this gate never builds
 * one at all, which is stronger than joining the existing one for a check that needs no type information.
 *
 * Pure {@link canonicalBodyOf} + {@link scanPrimitiveRatchet} (unit-tested); the effectful
 * {@link runPrimitiveRatchet} edge reads the registry's own files, then every other source.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isStringLiteralLikeNode, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/**
 * One canonical primitive this repo has decided has exactly one home.
 *
 * @internal — nothing outside this gate names it; the registry below is the one place it is edited.
 */
export interface RegisteredPrimitive {
  /** Repo-relative path of the file declaring the canonical copy. */
  readonly file: string;
  /** The top-level function's name. */
  readonly name: string;
}

/**
 * The curated registry. Each entry is a deliberate decision, not an auto-detected one — see
 * `src/corpus/slack/shape.ts`'s own header for why `optStr` lives there rather than in `src/lib/`.
 *
 * @internal — edited in place here to register a new primitive; nothing outside this gate reads it.
 */
export const REGISTERED_PRIMITIVES: readonly RegisteredPrimitive[] = [
  { file: "src/corpus/slack/shape.ts", name: "optStr" },
];

/** One registered primitive with its body's precomputed structural key. */
interface CanonicalPrimitive {
  readonly primitive: RegisteredPrimitive;
  readonly key: string;
}

/**
 * One violation: a new top-level function duplicating a registered primitive's body.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface PrimitiveRatchetViolation {
  readonly path: string;
  readonly line: number;
  readonly functionName: string;
  readonly primitive: RegisteredPrimitive;
}

/**
 * A structural fingerprint of an AST subtree: same node kinds in the same arrangement, same identifier and
 * literal text, and nothing else — never a node's position or trivia, so whitespace, comments and reflowed
 * line breaks cannot change it. Pure.
 *
 * @param node the AST subtree to fingerprint
 * @returns a string equal for two subtrees iff they are structurally identical by this definition
 */
export function structuralKeyOf({ node }: { node: ts.Node }): string {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return `Identifier:${node.text}`;
  }
  if (isStringLiteralLikeNode(node)) {
    return `StringLiteral:${JSON.stringify(node.text)}`;
  }
  if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) {
    return `NumericLiteral:${node.text}`;
  }
  const children: string[] = [];
  node.forEachChild((child) => {
    children.push(structuralKeyOf({ node: child }));
  });
  return `${ts.SyntaxKind[node.kind]}(${children.join(",")})`;
}

/** Every top-level, named, bodied function declaration in a source file — never one nested inside another. */
function topLevelFunctions({ sourceFile }: { sourceFile: ts.SourceFile }): readonly ts.FunctionDeclaration[] {
  return sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined,
  );
}

/**
 * The structural key of a named top-level function's body in `content`, or `undefined` when no top-level
 * function by that name (with a body) exists there. Pure.
 *
 * @param content the file's text
 * @param name the top-level function name to find
 * @returns the body's structural key, or undefined when the function is absent
 */
export function canonicalBodyOf({ content, name }: { content: string; name: string }): string | undefined {
  return withSourceFile({
    fileName: "canonical.ts",
    text: content,
    use: (sourceFile): string | undefined => {
      const fn = topLevelFunctions({ sourceFile }).find((candidate) => candidate.name?.text === name);
      if (fn?.body === undefined) {
        return undefined;
      }
      return fn.body.statements.map((statement) => structuralKeyOf({ node: statement })).join("|");
    },
  });
}

/**
 * Every top-level function in `content` whose body's structural key matches a canonical primitive. Pure.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @param canonicalPrimitives every registered primitive with its body's precomputed structural key
 * @returns each violation, in source order
 */
export function scanPrimitiveRatchet({
  path,
  content,
  canonicalPrimitives,
}: {
  path: string;
  content: string;
  canonicalPrimitives: readonly CanonicalPrimitive[];
}): readonly PrimitiveRatchetViolation[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sourceFile): readonly PrimitiveRatchetViolation[] => {
      const violations: PrimitiveRatchetViolation[] = [];
      for (const fn of topLevelFunctions({ sourceFile })) {
        const key = fn.body!.statements.map((statement) => structuralKeyOf({ node: statement })).join("|");
        const match = canonicalPrimitives.find((canonical) => canonical.key === key);
        if (match !== undefined) {
          violations.push({
            functionName: fn.name!.text,
            line: sourceFile.getLineAndCharacterOfPosition(fn.getStart(sourceFile)).line + 1,
            path,
            primitive: match.primitive,
          });
        }
      }
      return violations;
    },
  });
}

/** This gate's declared scan predicate: every `.ts` under the source trees, minus its own files. */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "primitiveRatchet" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * Read every registered primitive's own file and compute its body's structural key.
 *
 * Fails loud rather than quietly scanning nothing: a registry entry whose file is unreadable or whose named
 * function is gone is a broken registry, not zero primitives to check — the silent-clean failure this
 * repo's gates are built against.
 *
 * @param root the repository root
 * @returns the canonical primitives with their keys, or the one-line reason the registry could not be read
 */
function loadCanonicalPrimitives({
  root,
}: {
  root: string;
}):
  | { readonly canonicalPrimitives: readonly CanonicalPrimitive[] }
  | { readonly failure: string; readonly kind: "unreadable" | "stale-registry" } {
  const canonicalPrimitives: CanonicalPrimitive[] = [];
  for (const primitive of REGISTERED_PRIMITIVES) {
    let content: string;
    try {
      content = readFileSync(join(root, primitive.file), "utf8");
    } catch {
      return {
        failure: `registered primitive ${primitive.name} — ${primitive.file} could not be read`,
        kind: "unreadable",
      };
    }
    const key = canonicalBodyOf({ content, name: primitive.name });
    if (key === undefined) {
      return {
        // A POLICY failure, not a read one: the file was read fine and the register names something that
        // is no longer in it. Distinguished from the unreadable arm above so the refusal can say which.
        failure: `registered primitive ${primitive.name} — no top-level \`function ${primitive.name}\` with a body in ${primitive.file}`,
        kind: "stale-registry",
      };
    }
    canonicalPrimitives.push({ key, primitive });
  }
  return { canonicalPrimitives };
}

/**
 * IO edge: load the registry, scan every other in-scope source, print each violation.
 *
 * @returns the process exit code (0 clean, 1 a violation, a broken registry, an unread file, or not a git
 *   checkout)
 */
export function runPrimitiveRatchet(): number {
  let root: string;
  let scannedPaths: readonly string[];
  try {
    root = repoRoot();
    scannedPaths = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ (absent checkout, or unenumerable files)
    process.stderr.write("primitive-ratchet: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const loaded = loadCanonicalPrimitives({ root });
  if ("failure" in loaded) {
    return reportRegistryFailure({ loaded });
  }
  const { canonicalPrimitives } = loaded;
  const registeredFiles = new Set(REGISTERED_PRIMITIVES.map((primitive) => primitive.file));
  const candidates = scannedPaths.filter((path) => !registeredFiles.has(path));
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<PrimitiveRatchetViolation>({
    paths: candidates,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanPrimitiveRatchet({ canonicalPrimitives, content, path }),
  });
  const complete = reportScanIntegrity({
    label: "primitive-ratchet",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(
      `primitive-ratchet: clean (${String(readCount)} file(s) scanned against ${String(canonicalPrimitives.length)} registered primitive(s))\n`,
    );
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(
      `  ${hit.path}:${String(hit.line)}: \`${hit.functionName}\` duplicates the registered primitive ` +
        `\`${hit.primitive.name}\` (${hit.primitive.file}) — import it instead of redefining it.\n`,
    );
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "primitive-ratchet" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}

/**
 * Report a registry that could not be loaded, and say WHICH kind of failure it was.
 *
 * Split from {@link runPrimitiveRatchet} for the body cap. The two arms are genuinely different animals: an
 * unreadable file is a fact the gate could not get past, while a register row naming a function that is no
 * longer there is a POLICY refusal — the register disagrees with the tree, and somebody has to fix one of
 * them. An earlier pass called both a read failure, which an adversarial review pass caught.
 *
 * @param loaded the failed load, carrying its kind
 * @returns 1, the exit code either arm gives
 */
function reportRegistryFailure({
  loaded,
}: {
  loaded: { readonly failure: string; readonly kind: "unreadable" | "stale-registry" };
}): number {
  // devlint: not-a-refusal -- the failure itself, quoted; which KIND it is decides what follows
  process.stderr.write(`primitive-ratchet: ${loaded.failure}\n`);
  if (loaded.kind === "stale-registry") {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "primitive-ratchet-registry" }),
        detail: "1 register row names a function that is not there",
      })}\n`,
    );
  }
  return 1;
}
