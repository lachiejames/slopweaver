/**
 * The testing-discipline gate — ports the `*.test.ts`-only `no-restricted-syntax` selectors that used to
 * live in `eslint.config.js` (deleted along with ESLint itself) into a direct TypeScript-compiler-API walk.
 * Machine-enforces `.claude/rules/testing.md`: zero mocks, and exact + falsifiable assertions.
 *
 * Pure {@link scanTestingDiscipline} (unit-tested with inline fixtures) + an effectful {@link runTestingDiscipline}
 * edge that walks every `.ts` under `__tests__/` — see {@link SCOPE} for why the shared fakes are
 * in scope and not only the `*.test.ts` files.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
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

/** One testing-discipline violation: where it is and the message to show. */
export interface TestingDisciplineHit {
  readonly path: string;
  readonly line: number;
  readonly id: string;
  readonly message: string;
}

/** One rule: an id, a display message, and a predicate over a single AST node. */
interface TestBan {
  readonly id: string;
  readonly message: string;
  readonly matches: (args: { node: ts.Node }) => boolean;
}

const MOCK_METHODS: ReadonlySet<string> = new Set(["mock", "spyOn", "fn"]);
const WEAK_MATCHERS: ReadonlySet<string> = new Set(["toBeTruthy", "toBeFalsy"]);

/** The four testing-discipline bans, applied across the whole test tree — see {@link SCOPE}. */
const TEST_BANS: readonly TestBan[] = [
  {
    id: "no-mocks",
    matches: isMockCall,
    message:
      "No mocks (testing.md): vi.mock/vi.spyOn/vi.fn are banned. Extract the pure logic and test it, or " +
      "inject a plain fake function (not a mock).",
  },
  {
    id: "no-weak-boolean-matcher",
    matches: isWeakBooleanMatcherCall,
    message: "Assert the actual value, not truthiness (testing.md): .toBeTruthy()/.toBeFalsy() are banned.",
  },
  {
    id: "no-bare-to-have-property",
    matches: isBareToHavePropertyCall,
    message:
      "toHaveProperty needs a value — toHaveProperty('k', value) (testing.md): a key-only check is not falsifiable.",
  },
  {
    id: "no-expect-typeof",
    matches: isExpectTypeofCall,
    message: "Do not assert on typeof (testing.md): assert the actual value, not its type.",
  },
];

/** `vi.mock(...)` / `vi.spyOn(...)` / `vi.fn(...)`. */
function isMockCall({ node }: { node: ts.Node }): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  const callee = node.expression;
  return MOCK_METHODS.has(callee.name.text) && ts.isIdentifier(callee.expression) && callee.expression.text === "vi";
}

/** `expect(x).toBeTruthy()` / `.toBeFalsy()`, matched on the matcher call itself. */
function isWeakBooleanMatcherCall({ node }: { node: ts.Node }): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    WEAK_MATCHERS.has(node.expression.name.text)
  );
}

/** `expect(x).toHaveProperty("k")` — exactly one argument, so no expected value was given. */
function isBareToHavePropertyCall({ node }: { node: ts.Node }): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "toHaveProperty" &&
    node.arguments.length === 1
  );
}

/** `expect(typeof x)`. */
function isExpectTypeofCall({ node }: { node: ts.Node }): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "expect") {
    return false;
  }
  const [first] = node.arguments;
  return first !== undefined && ts.isTypeOfExpression(first);
}

/**
 * Every testing-discipline violation in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanTestingDiscipline({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly TestingDisciplineHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly TestingDisciplineHit[] => {
      const hits: TestingDisciplineHit[] = [];
      const visit: NodeVisitor = (node) => {
        for (const ban of TEST_BANS) {
          if (ban.matches({ node })) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            hits.push({ id: ban.id, line, message: ban.message, path });
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
 * This gate's declared scan predicate: every `.ts` under `__tests__/` — the test TREE, setup files
 * and shared fakes included, not only its `*.test.ts` files. A fake is exactly where somebody reaches for a
 * `vi.fn`, and under the old `*.test.ts`-only predicate the helpers were invisible: appending
 * `export const proof = { spy: vi.fn() };` to a shared capture-transport fake under `src/__tests__/` and running
 * `yarn tsx src/cli/index.ts dev lint --only testing-discipline` printed `clean` and PASS (measured). Three of those helpers carried a hand-written comment telling the reader not to, which is a
 * convention rather than a mechanism. Nothing the old predicate selected is lost — every
 * `*.test.ts` is already under the test tree: `git ls-files '*.test.ts' | grep -vc '__tests__/'` is 0.
 * This gate's own source stays excluded explicitly.
 */
const SCOPE: ScanScope = {
  onlyTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "testingDiscipline" }),
  trees: [],
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
 * IO edge: scan every `.ts` under `__tests__/`, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runTestingDiscipline(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("testing-discipline: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<TestingDisciplineHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanTestingDiscipline({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "testing-discipline",
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
    process.stdout.write(`testing-discipline: clean (${String(readCount)} test-tree files scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: [${hit.id}] ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "testing-discipline" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
