/**
 * The epoch-arithmetic gate — one destination for every epoch-seconds-to-instant conversion in the repo.
 *
 * ## The criterion
 *
 * A `new Date(<expr>)` whose SOLE argument is a multiplication (`x * 1000`, `1000 * x`, `x * MS_PER_SECOND`)
 * fails. That is exactly the shape a scaled epoch takes, and nothing else in this tree writes it: a window
 * bound is `new Date(now.getTime() - days * 86_400_000)`, whose top-level operator is `-`, and a plain
 * millisecond value is `new Date(ms)`, with no operator at all. So the check needs no allowlist and has no
 * exemption marker — the two legitimate shapes are already outside it.
 *
 * ## Why a gate rather than a note
 *
 * Because the class regenerates. FOUR independent copies of `tsToIso` stood in this tree at once
 * (`corpus/slack/shape.ts`, `corpus/slack/curated.ts`, `live/listen/recover.ts`,
 * `live/slack/searchMessages.ts`), two returning `""` on a bad input and two returning `undefined`, plus
 * four more ad-hoc `* 1000` conversions in the Slack curated shaper, the Codex quota log, the huddle
 * transcript reader and the listener's stall detector. Every one was written carefully, by someone who knew
 * what an epoch is. None of them was wrong — and that is the point: with the conversion scattered there was
 * no single function for a rule to name, so "derive the instant, never convert it by hand" could only ever
 * be advice.
 *
 * The human half of the same defect is what made it urgent. MEASURED, a run read
 * a Slack `ts` as an instant 80 minutes out, and
 * that instant propagated into a board row, two cron schedules, a doc's status summary and two supervisors'
 * deadman deadlines before anyone noticed; the announcement they governed went out 53 minutes late. The
 * answer to a hand-conversion is a verb you can run (`slopweaver slack when`), and the answer to the verb
 * being ignorable is that every conversion in the codebase goes to the same place too.
 *
 * Pure {@link scanEpochArithmetic} + an effectful {@link runEpochArithmetic} edge, matching the other gates
 * in this directory.
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
 * One ad-hoc epoch conversion: where the `new Date(x * y)` is.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface EpochArithmeticHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The two modules allowed to scale an epoch, because they are what everything else is routed through. */
const CONVERSION_OWNERS: ReadonlySet<string> = new Set(["src/lib/date.ts", "src/lib/slackTs.ts"]);

/** The node with any wrapping parentheses stripped, so `((x * 1000))` reads the same as `x * 1000`. */
function unwrapParens({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Whether a `new` expression constructs a `Date` from a single multiplied value. */
function isScaledDateConstruction({ node }: { node: ts.NewExpression }): boolean {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "Date") {
    return false;
  }
  if (node.arguments?.length !== 1) {
    return false;
  }
  const sole = unwrapParens({ node: node.arguments[0]! });
  return ts.isBinaryExpression(sole) && sole.operatorToken.kind === ts.SyntaxKind.AsteriskToken;
}

/**
 * Every ad-hoc epoch conversion in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path (for reporting, and to exempt the owning modules)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanEpochArithmetic({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly EpochArithmeticHit[] {
  if (CONVERSION_OWNERS.has(path)) {
    return [];
  }
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly EpochArithmeticHit[] => {
      const hits: EpochArithmeticHit[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isNewExpression(node) && isScaledDateConstruction({ node })) {
          hits.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            message:
              "`new Date(x * y)` scales an epoch by hand. Call `epochSecondsToIso` (`src/lib/date.ts`) for a " +
              "numeric provider field, or `slackTsToIso` / `slackTsToEpochMs` (`src/lib/slackTs.ts`) for a " +
              "Slack `ts` — one destination is what makes `slopweaver slack when` the answer everywhere.",
            path,
          });
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/** This gate's declared scan predicate: every `.ts` under the source trees, minus its own files. */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "epochArithmetic" }),
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
 * IO edge: scan every source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runEpochArithmetic(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("epoch-arithmetic: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<EpochArithmeticHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanEpochArithmetic({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "epoch-arithmetic",
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
    process.stdout.write(`epoch-arithmetic: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "epoch-arithmetic" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
