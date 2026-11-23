/**
 * The unexpanded-plugin-root gate — keeps a shell variable the emitting process has already resolved out of
 * a command it PRINTS for somebody else to paste.
 *
 * ## The two readers, and why only one of them substitutes
 *
 * `${CLAUDE_PLUGIN_ROOT}` is substituted by the Claude Code harness when it reads a `SKILL.md`. So the
 * `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" <verb>` form every skill in `skills/` uses is CORRECT there, and
 * this gate never looks at a `.md` file. The variable is not exported into any shell, and a command a verb
 * writes to stdout is read by a shell.
 *
 * `docs/install-stays-current/running-sessions-and-cli.md` had already drawn exactly that line — _"a skill is read by an agent, which
 * has that variable. Prose addressed to a human does not"_ — and the distinction still did not reach the two
 * lines that needed it, which is the whole argument for a gate over a paragraph.
 *
 * ## Why a gate rather than fixing the two lines
 *
 * MEASURED: two sites emitted the
 * literal: `cli/commands/turn/resume.ts`'s worker-brief step 0a, and `cli/commands/turn/sweepCard.ts`'s
 * `card-stale:` remedy clause. A worker on the SaaS-spend ask pasted step 0a verbatim; the empty variable
 * left it running `/bin/slopweaver`, which is not on disk; and because the line ends in `&` the shell
 * backgrounded that failure and reported exit 0. `echo "$CLAUDE_PLUGIN_ROOT"` was empty in the worker's
 * shell and in the loop session's. The automated remedy was silently inert in exactly the case it was built
 * for — a live card whose clock nobody had started — and nothing failed to say so.
 *
 * The failure is invisible by construction: the emitted string is well-formed, the types are right, and the
 * only symptom is a command that does nothing. A reviewer reading the diff sees the same form every skill
 * uses correctly. `./runningCheckoutRoot.ts` is the sibling case in the same family, and its header carries
 * the same finding about prose — one warning in one file protects one file.
 *
 * ## The criterion
 *
 * A STRING the code emits — a string literal, a no-substitution template, or any text span of a template
 * literal — whose cooked text contains a brace-form reference to one of the variables the HARNESS
 * substitutes: `CLAUDE_PLUGIN_ROOT` or `PLUGIN_ROOT` ({@link HARNESS_VARIABLES}). Walked with the TypeScript
 * AST, so a comment is never read: prose naming the defect, including this header, is outside the criterion
 * by construction rather than by exemption. No allowlist, no exemption marker.
 *
 * The fix is `../lib/pluginRoot.ts`'s `bundledLauncherPath`, or the resolved value the process already has.
 *
 * **Why those two names rather than every upper-case variable.** The first shape of this gate matched any
 * brace-form variable and reddened on two sites that are correct, which is what settled the criterion:
 * `../live/turn/freeze/redact.ts`'s `HOME_PLACEHOLDER` is the token a frozen fixture's absolute paths become
 * so the fixture stays relocatable, and `../admit/documentDeliverableGate.ts`'s `LOCAL_ROOTS` is a MATCHER
 * over a composer's own prose. Neither is a command, and in both the variable's NAME is the value. What
 * makes the two harness variables different is that only they have a reader that silently supplies them
 * somewhere else — so only they produce a string that looks right in review and is empty at the one moment
 * it matters.
 *
 * **The blind spots, named rather than left to be found.** The brace-LESS `$CLAUDE_PLUGIN_ROOT` spelling
 * fails identically and passes this gate; so does a name reached through a constant. Every standing use of
 * the brace-less form in this tree is PROSE about where a path lives — `$SLOPWEAVER_HOME/secrets/…` in an
 * error message, a JSDoc line naming a directory — so there is no shape to match on today, and a gate is
 * worth only the class it can see.
 *
 * Pure {@link scanUnexpandedPluginRoot} + an effectful {@link runUnexpandedPluginRoot} edge, matching the
 * other gates in this directory.
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
 * One emitted shell variable: where it is, and which name it would have expanded.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface UnexpandedVariableHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/**
 * The variables a HARNESS supplies and a shell does not — the whole criterion, as names.
 *
 * `CLAUDE_PLUGIN_ROOT` is set by Claude Code when it reads a `SKILL.md`; `PLUGIN_ROOT` is the launcher's own
 * preferred spelling of the same root (`hooks/hooks.json` reads `${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}`, and
 * that file is JSON the harness reads, never a string this code emits). Both name a directory the running
 * process can already resolve for itself, which is why emitting either is always the defect.
 */
const HARNESS_VARIABLES: readonly string[] = ["CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT"];

/**
 * A brace-form reference to one of {@link HARNESS_VARIABLES}.
 *
 * Built from the names rather than written out, so the list above is the single place the criterion is
 * stated. `\b` after the brace is unnecessary and the closing brace is required, so `${PLUGIN_ROOTX}` —
 * which is nothing this repo has — does not match.
 */
const EMITTED_HARNESS_VARIABLE = new RegExp(String.raw`\$\{(${HARNESS_VARIABLES.join("|")})\}`, "g");

/**
 * Every emitted harness variable in one string of source text.
 *
 * @param text the cooked text of one string or template span
 * @returns each variable name it would leave for a shell that will never supply one, in order
 */
function emittedVariableNames({ text }: { text: string }): readonly string[] {
  return [...text.matchAll(EMITTED_HARNESS_VARIABLE)].map((match) => match[1]!);
}

/**
 * The text a node contributes to the string the program emits, or `undefined` when it contributes none.
 *
 * Template HEADS, MIDDLES and TAILS are visited as their own `TemplateLiteralLikeNode`s, so every literal
 * span of a template is reached without the walker having to reassemble one. Their `.text` is the COOKED
 * value, which is why an escaped `\${CLAUDE_PLUGIN_ROOT}` inside a template and a plain
 * `"${CLAUDE_PLUGIN_ROOT}"` string both arrive here spelled identically — the two ways this defect has
 * actually been written.
 *
 * @param node the node being visited
 * @returns its emitted text, or `undefined` for a node that emits none
 */
function emittedText({ node }: { node: ts.Node }): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return undefined;
}

/**
 * Every emitted-shell-variable violation in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanUnexpandedPluginRoot({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly UnexpandedVariableHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly UnexpandedVariableHit[] => {
      const hits: UnexpandedVariableHit[] = [];
      const visit: NodeVisitor = (node) => {
        const text = emittedText({ node });
        if (text !== undefined) {
          for (const name of emittedVariableNames({ text })) {
            hits.push({
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              message:
                `this string emits \${${name}}, which is empty in the shell of whoever runs it — the harness ` +
                "substitutes that variable only when it reads a `SKILL.md`. Emit the value this process has " +
                "already resolved (`bundledLauncherPath` in `src/lib/pluginRoot.ts` for the launcher), or pass " +
                "it in.",
              path,
            });
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
 * This gate's declared scan predicate.
 *
 * The three source trees, minus its own files and minus the TEST tree. A test is excluded for the reason
 * `./runningCheckoutRoot.ts` excludes it: a test naming this literal is EXERCISING the substitution
 * contract rather than printing an instruction — `src/__tests__/unit/docs/coverage.test.ts` asserts that the
 * doc-coverage pattern still matches the `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" facts` form every skill
 * writes, and that assertion has to keep standing.
 */
const SCOPE: ScanScope = {
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "unexpandedPluginRoot" }),
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
export function runUnexpandedPluginRoot(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("unexpanded-plugin-root: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<UnexpandedVariableHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanUnexpandedPluginRoot({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "unexpanded-plugin-root",
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
    process.stdout.write(`unexpanded-plugin-root: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "unexpanded-plugin-root" }),
      detail: `${String(hits.length)} emitted shell variable(s)`,
    })}\n`,
  );
  return 1;
}
