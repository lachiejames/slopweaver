/**
 * The hand-rolled-`Result` gate — machine-enforces the categorical rule in
 * `.claude/rules/error-handling.md`: there is no hand-rolled `Result` type in this repo, only real
 * neverthrow (`src/lib/result.ts`).
 *
 * ## The criterion, stated rather than counted
 *
 * A **union type whose members are object type literals, where at least one member declares `ok` with the
 * literal type `true`** is a success/failure discriminant, and this repo expresses those as
 * `Result<T, E>`. A type alias whose whole right-hand side is such an object literal is caught too, because
 * the shape was split across two aliases and joined elsewhere three times before this gate existed.
 *
 * The criterion is the contract; the count is only ever its output. A survey of this class reported "three"
 * because it grepped line-by-line, and these declarations wrap across lines while their object literals
 * contain semicolons, so a single-line match truncates at the first `;` and loses the failure arm. Counted
 * properly, it was 110 declarations.
 *
 * Why a gate and not a cleanup: a DEDUP refactor minted a fresh member of this family while the family was
 * being counted. In one commit the verbatim-duplication cleanup EDITED `linear/commentCore.ts` and
 * `linear/relationCore.ts` to extract their shared logic into a new `linear/formCreateArgs.ts`, left both
 * files' own hand-rolled result types exactly where they were, and reproduced the same shape in the file it
 * was creating. It had both files open and was deleting from them.
 *
 * ## What it deliberately does NOT flag, and why
 *
 * - **`ok: boolean`** — a plain success FLAG on a record that carries the same payload either way
 *   (`src/cli/commands/checkout/syncRun.ts`'s `SyncOutcome`, the `refresh` summaries). Converting one would
 *   lose the data the failure arm legitimately carries.
 * - **An `interface` with `ok: true` and no failure arm** — a provider wire envelope such as
 *   `src/outbound/slack/types.ts`'s `SlackSendResult`, which mirrors Slack's own response field. It is not a
 *   two-armed result, so there is nothing for `Result` to express.
 *
 * Pure {@link scanHandRolledResult} + an effectful {@link runHandRolledResult} edge, matching the other gates.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forEachChild,
  isPropertySignatureDeclaration,
  type NodeVisitor,
  possiblyAbsent,
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

/**
 * One hand-rolled-`Result` violation: where it is and what to write instead.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface HandRolledResultHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** Whether a type node is an object literal declaring `ok` with a literal `true`/`false` type. */
function declaresOkDiscriminant({ node }: { node: ts.TypeNode }): boolean {
  if (!ts.isTypeLiteralNode(node)) {
    return false;
  }
  return node.members.some((member) => {
    if (!isPropertySignatureDeclaration(member)) {
      return false;
    }
    // `interface X { ok }` writes no type, and 7.1 answers `undefined` for the field its declaration calls set.
    const type = possiblyAbsent({ value: member.type });
    if (type === undefined) {
      return false;
    }
    if (!ts.isIdentifier(member.name) || member.name.text !== "ok") {
      return false;
    }
    if (!ts.isLiteralTypeNode(type)) {
      return false;
    }
    const { kind } = type.literal;
    return kind === ts.SyntaxKind.TrueKeyword || kind === ts.SyntaxKind.FalseKeyword;
  });
}

/** Whether a type node is a union with at least one `ok`-discriminated object-literal member. */
function isOkDiscriminatedUnion({ node }: { node: ts.Node }): boolean {
  return ts.isUnionTypeNode(node) && node.types.some((member) => declaresOkDiscriminant({ node: member }));
}

/**
 * Every hand-rolled-`Result` violation in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanHandRolledResult({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly HandRolledResultHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly HandRolledResultHit[] => {
      const hits: HandRolledResultHit[] = [];
      const report = ({ node, what }: { node: ts.Node; what: string }): void => {
        hits.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          message:
            `${what} discriminates on a literal \`ok\` — that is a hand-rolled Result, which ` +
            "`.claude/rules/error-handling.md` bans. Use `Result<T, E>` from `src/lib/result.ts` (real " +
            "neverthrow) and return `ok(value)` / `err(error)`. A plain `ok: boolean` success FLAG is fine.",
          path,
        });
      };
      const visit: NodeVisitor = (node) => {
        // A union is reported ONCE, wherever it sits — a named alias, an inline return annotation, a dep
        // signature. Reporting from the enclosing declaration as well double-counted the inline case.
        if (isOkDiscriminatedUnion({ node })) {
          const parent = node.parent;
          const named = ts.isTypeAliasDeclaration(parent);
          // Point at the DECLARATION when there is one, not at the union body a line below it.
          report({ node: named ? parent : node, what: named ? `type \`${parent.name.text}\`` : "an inline type" });
        } else if (ts.isTypeAliasDeclaration(node) && declaresOkDiscriminant({ node: node.type })) {
          // A single arm under its own name: the two halves were split across two aliases and joined elsewhere.
          report({ node, what: `type \`${node.name.text}\`` });
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
  selfFiles: gateSelfFiles({ stem: "handRolledResult" }),
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
export function runHandRolledResult(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("hand-rolled-result: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<HandRolledResultHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanHandRolledResult({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "hand-rolled-result",
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
    process.stdout.write(`hand-rolled-result: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "hand-rolled-result" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
