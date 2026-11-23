/**
 * The console-loading-prose gate — machine-enforces the rule for the desktop app's loading states: something not loaded yet
 * is shown with a progress indicator, never with text, as other apps do it. A line reading "reading the machine…"
 * makes a page that is only loading look broken to the owner, and twenty-odd components each wrote their own.
 *
 * ## The criterion
 *
 * Text a reader SEES, in the console's source under `site/` — a JSX text node, a string literal or a template's
 * literal text — where a read or load word (`reading`, `re-reading`, `loading`) is followed by an ellipsis (`…` or
 * `...`). The ellipsis is what marks prose as in-progress rather than describing a read, so "the board did not
 * read" and a `Spinner`'s own `label="reading the board"` are outside it by construction. Comments are never read:
 * the AST does not carry them as text. The replacement is `site/components/ui/spinner.tsx`.
 *
 * The vocabulary is read and load only. A button saying "Sending…" while it sends is the label of a control the
 * reader pressed, not a page waiting on data, and the owner's words were about the second.
 *
 * Pure {@link scanConsoleLoadingProse} + an effectful {@link runConsoleLoadingProse} edge, matching the other gates
 * in this directory. Run it alone: `yarn lint --only console-loading-prose`.
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

/**
 * One loading line written as prose: where it is and the words it shows.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface LoadingProseHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** A read or load word, then an ellipsis later in the same run of text. */
const LOADING_PROSE = /\b(?:re-?reading|reading|loading)\b[^…]*?(?:…|\.\.\.)/i;

/** The literal text a node shows, or `undefined` for a node that carries none. */
function shownText({ node }: { node: ts.Node }): string | undefined {
  if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
  }
  return undefined;
}

/**
 * Every loading line written as prose in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path, which also decides whether it parses as TSX
 * @param content the file's text
 * @returns each hit, in source order
 */
export function scanConsoleLoadingProse({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly LoadingProseHit[] {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return withSourceFile({
    fileName: path,
    text: content,
    scriptKind: kind,
    use: (sf): readonly LoadingProseHit[] => {
      const hits: LoadingProseHit[] = [];
      const visit: NodeVisitor = (node) => {
        const text = shownText({ node });
        if (text !== undefined && LOADING_PROSE.test(text)) {
          hits.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            path,
            text: text.trim(),
          });
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/** This gate's declared scan predicate: the console's TypeScript and TSX, minus its tests and its own files. */
const SCOPE: ScanScope = {
  excludeTestsDir: true,
  extensions: [".ts", ".tsx"],
  selfFiles: gateSelfFiles({ stem: "consoleLoadingProse" }),
  trees: ["site/"],
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
 * IO edge: scan the console's source, print each hit, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a hit found or not a git checkout)
 */
export function runConsoleLoadingProse(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("console-loading-prose: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<LoadingProseHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanConsoleLoadingProse({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "console-loading-prose",
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
    process.stdout.write(`console-loading-prose: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: "${hit.text}"\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "console-loading-prose" }),
      detail: `${String(hits.length)} loading line(s) written as prose`,
    })}\n`,
  );
  return 1;
}
