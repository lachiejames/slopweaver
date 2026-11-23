/**
 * The legacy-vocabulary gate — first-party code may not NAME itself legacy.
 *
 * The doctrine it enforces is `skills/pickup/SKILL.md`'s: *rewrite in place so the current way reads as the
 * way it was always intended* (a scoped criterion rather than a word
 * ban). It is a plain lint rule: any hit fails, and there is no debt list, no exemption marker and no
 * allowlist, because a ratchet at zero is just a lint rule that fails on greater than zero violations. The way past it is to name the
 * construct for what it is.
 *
 * ## Why a word ban was refused
 *
 * Most word-boundary `legac(y|ies)` hits across `src/ docs/ skills/ .claude/` are legitimate PROSE: they
 * describe something precisely — a provider's own product (Cloudflare's Legacy WAF, Slack's legacy
 * `count`/`page` pagination, GitHub's legacy commit Statuses), or a file another build wrote that still
 * exists on disk. None of those is this repository describing itself, and a gate that refused them would be
 * asking a reader to lie about a product's name.
 *
 * ## The criterion
 *
 * **A NAME this repository declares, or a string literal in a TYPE position, may not contain `legacy` or
 * `legacies`.** Prose comments are not read at all, because a comment describing a file on disk is
 * describing data no edit to this tree can rewrite. A name is something this repository chose and can
 * change.
 *
 * The names it walks are the ones a declaration introduces — a function, class, interface, type alias or
 * enum; a variable, parameter, property signature or property assignment; a method; a type parameter; an
 * enum member — plus the file's own basename. A type-position string literal is included because a
 * discriminated union's arm (`{ readonly quality: "thread-only" }`) is a name in every sense that matters:
 * every call site spells it. Its value-position echoes are not separately reported, since the declaration
 * is the thing to fix — which is also how a decoder spells a wire byte another writer chose
 * (`src/live/ask/identity.ts`'s stored quality spelling).
 *
 * **Two kinds of name are a provider's, not this repository's, and the criterion says so rather than an
 * allowlist.** Cloudflare's product is called Legacy WAF, so {@link namesLegacy} reads a singular `legacy`
 * followed directly by the product token (`waf`, `Waf` or `WAF`, after an optional `-` or `_`, and then the
 * end of the name or a `.`, `-`, `_` or upper-case boundary) as the product's name: `legacyWaf.ts`,
 * `CloudflareLegacyWafChildItem` and `"legacy-waf"` pass, `legacyWafer` and `legaciesWaf` do not. And a
 * generated provider boundary — any file beneath `src/atlas/` with a whole `generated` path segment —
 * transcribes a provider's own wire keys (Datadog's RUM usage SKUs, JumpCloud's password-state fields) from a
 * spec or census, so it is outside {@link isScannablePath}; the generators that write those files are
 * scanned like any other source.
 *
 * **The declaration shapes it does NOT reach**, named rather than discovered. **No import shape at all**:
 * a renamed binding (`import { a as legacyA }`), a namespace import (`import * as legacyFs from "node:fs"`)
 * and an import-equals alias (`import legacyFs = require("node:fs")`) each introduce a name chosen HERE,
 * and `isJudgedDeclaration` carries no import kind — so a `legacy` name entering this tree through an
 * import is invisible to the gate. Four other shapes are out of reach too: a destructuring binding
 * element (`const { value: legacyValue } = x`), a getter or setter, a named function or class
 * EXPRESSION, and a QUOTED member name anywhere — `interface X { "legacyValue": number }`, and equally
 * `enum Mode { "legacy" = 0 }`, because `declaredName` reads an identifier name and discards a string
 * literal one, so walking `ts.isEnumMember` buys the unquoted spelling alone. Every one of these is pinned
 * as a witness in `src/__tests__/unit/devLint/legacyVocabulary.test.ts`, so the list cannot rot into a
 * claim: pass any of them to {@link scanLegacyVocabulary} and read the empty result.
 *
 * **A self-file exclusion matches a BASENAME**, not a repo path (`gateSelfFiles`, `./scanScope.ts`), which
 * every gate here shares: an unrelated `src/<anywhere>/legacyVocabulary.ts` would be skipped too.
 *
 * Pure {@link scanLegacyVocabulary} (unit-tested on inline fixtures, so this file never scans itself); the
 * effectful {@link runLegacyVocabulary} edge reads every in-scope working-tree source — committed or not,
 * minus what git ignores.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  forEachChild,
  isMethodSignatureDeclaration,
  isParameterDeclaration,
  isPropertySignatureDeclaration,
  type NamedDeclarationNode,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";
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

/** One name that calls a first-party construct legacy. */
export interface LegacyVocabularyHit {
  readonly path: string;
  readonly line: number;
  /** The offending name, exactly as written (a type-position literal keeps its quotes off). */
  readonly name: string;
}

/** Every occurrence of the refused vocabulary, singular or plural, in any casing. */
const VOCABULARY = /legac(?:y|ies)/giu;

/**
 * What follows a singular `legacy` when it is Cloudflare's product name: the product token in one of its
 * three casings, after an optional separator, then the end of the name or a boundary. Case-SENSITIVE on
 * purpose — under `/i` the upper-case boundary would also admit `legacyWafer`'s lower-case `e`.
 */
const LEGACY_WAF_SUFFIX = /^[-_]?(?:waf|Waf|WAF)(?=$|[.\-_A-Z])/u;

/**
 * Whether a name carries the refused vocabulary as anything other than Cloudflare's product name.
 *
 * A plain substring test, deliberately: no other English word contains `legacy` or `legacies`, so splitting
 * on `camelCase`/`kebab-case`/`snake_case` first would buy nothing and could only lose a spelling. Every
 * occurrence is judged, so a name carrying the product AND another `legacy` still fails.
 *
 * @param name the identifier or literal text
 * @returns true when it names something legacy
 */
export function namesLegacy({ name }: { name: string }): boolean {
  for (const match of name.matchAll(VOCABULARY)) {
    const word = match[0];
    const rest = name.slice(match.index + word.length);
    if (word.toLowerCase() === "legacies" || !LEGACY_WAF_SUFFIX.test(rest)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether this node is a DECLARATION whose name the gate judges.
 *
 * An import is deliberately absent: it re-spells a name declared somewhere else, and reporting it would name
 * every consumer of one bad export as an offender while the fix is in exactly one file.
 *
 * Positional because TS1230 forbids destructuring in a type predicate — the compiler's own exemption from
 * this repository's named-object-params rule, not an oversight.
 *
 * @param node any node the walk reaches
 * @returns true when it declares a name worth judging
 */
function isJudgedDeclaration(node: ts.Node): node is NamedDeclarationNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isEnumMember(node) ||
    ts.isVariableDeclaration(node) ||
    isParameterDeclaration(node) ||
    isPropertySignatureDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    isMethodSignatureDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isModuleDeclaration(node)
  );
}

/**
 * The name a node introduces, or `undefined` when it introduces none the gate judges.
 *
 * An IDENTIFIER only, never a string-literal member name: `{ "src/x/legacyRepair.ts": "…" }` is a
 * data key naming a FILE, and that file is where the name is declared and where it would be fixed. A
 * type-position string literal IS judged, because a discriminated union's arm is a name every call site has
 * to spell exactly.
 */
function declaredName({ node }: { node: ts.Node }): string | undefined {
  if (ts.isLiteralTypeNode(node)) {
    return ts.isStringLiteral(node.literal) ? node.literal.text : undefined;
  }
  if (!isJudgedDeclaration(node) || node.name === undefined) {
    return undefined;
  }
  const name = node.name;
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ? name.text : undefined;
}

/**
 * Every name in `content` that calls a first-party construct legacy, plus the file's own basename when that
 * does. Pure — parses in memory with the TypeScript AST, and reads no comment.
 *
 * @param path the file's repo-relative path (for reporting, and judged itself)
 * @param content the file's text
 * @returns each hit, the filename first and then in source order
 */
export function scanLegacyVocabulary({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly LegacyVocabularyHit[] {
  const hits: LegacyVocabularyHit[] = [];
  const file = basename(path);
  if (namesLegacy({ name: file })) {
    hits.push({ line: 1, name: file, path });
  }
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly LegacyVocabularyHit[] => {
      const seen = new Set<string>();
      const visit: NodeVisitor = (node) => {
        const name = declaredName({ node });
        if (name !== undefined && namesLegacy({ name })) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const key = `${String(line)} ${name}`;
          if (!seen.has(key)) {
            seen.add(key);
            hits.push({ line, name, path });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * This gate's declared scan predicate: every working-tree `.ts` under the source trees, committed or not, minus tests (a fixture
 * names the shape it is testing) and minus this gate's own files, whose text necessarily carries the word.
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "legacyVocabulary" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a path is a generated provider boundary: beneath `src/atlas/`, with one whole `generated` segment.
 * Its names are a provider's wire keys transcribed by a generator, not names this repository chose.
 *
 * @param path the repo-relative path
 * @returns true when a generator wrote the file from a provider's own schema
 */
function isGeneratedProviderBoundary({ path }: { path: string }): boolean {
  return path.startsWith("src/atlas/") && path.split("/").slice(0, -1).includes("generated");
}

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE }) && !isGeneratedProviderBoundary({ path });
}

/**
 * IO edge: scan every in-scope working-tree source file and refuse on any name the criterion catches.
 *
 * @returns the process exit code (0 clean, 1 a name, an unreadable file, or not a git checkout)
 */
export function runLegacyVocabulary(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE }).filter((path) => isScannablePath({ path }));
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found, or
    // its working-tree files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("legacy-vocabulary: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<LegacyVocabularyHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanLegacyVocabulary({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "legacy-vocabulary",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (hits.length > 0) {
    for (const hit of hits) {
      process.stderr.write(`  ${hit.path}:${String(hit.line)}: \`${hit.name}\` names a first-party construct legacy\n`);
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "legacy-vocabulary" }),
        detail: `${String(hits.length)} name(s)`,
      })}\n`,
    );
    return 1;
  }
  if (!complete) {
    return 1;
  }
  process.stdout.write(`legacy-vocabulary: clean (${String(readCount)} source(s) scanned)\n`);
  return 0;
}
