/**
 * IO edge of the forbidden-identifier gate: list the working tree, scan every text file with one repository-content
 * scanner (`./ownRepository.ts`: the identifier rules, less this repository's own address and its code-owner
 * account row), and print the bounded summary — or, with `--list`, every (file, kind) finding
 * as well. Run by `dev lint` as `forbidden-identifiers`, in CI only: its subject is the tree, which CI sees.
 *
 * The exit code follows `./scan.ts`'s {@link IDENTIFIER_VERDICT}. In `report` mode a hit prints and passes,
 * so only an unreadable file or a failed listing fails the run; in `refuse` mode any tracked or untracked hit
 * fails it with the four-line lint refusal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LINT_GATE_DECLARATIONS } from "../devLint/refusal/declarations.js";
import { lintGateRefusal } from "../devLint/refusal/render.js";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf, trackedTreeFilesOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "./forbiddenIdentifiers.js";
import { identifierFindingLines, identifierReport, identifierSummaryLines } from "./identifierReport.js";
import type { IdentifierHit } from "./identifierScan.js";
import { repositoryContentIdentifierScanner } from "./ownRepository.js";
import { IDENTIFIER_VERDICT, isRefusedHit } from "./scan.js";

/** Whether a run prints only the summary or the whole per-(file, kind) inventory as well. */
export type IdentifierOutputMode = "summary" | "list";

/**
 * Pure: the output mode an argv asks for — nothing is `summary`, `--list` is `list`, anything else is refused.
 *
 * @param argv the arguments after the entry path
 * @returns the mode, or `undefined` for an argv this gate does not accept
 */
export function identifierOutputMode({ argv }: { argv: readonly string[] }): IdentifierOutputMode | undefined {
  if (argv.length === 0) {
    return "summary";
  }
  if (argv.length === 1 && argv[0] === "--list") {
    return "list";
  }
  return undefined;
}

/**
 * Scan the repository for forbidden identifiers and print the outcome.
 *
 * @param output whether to print the per-(file, kind) inventory as well as the summary
 * @returns the process exit code: 0 when nothing refused and every file was read, 1 otherwise
 */
export function runForbiddenIdentifierScan({ output }: { output: IdentifierOutputMode }): number {
  let root: string;
  let files: readonly string[];
  let tracked: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    files = workingTreeFilesOf({ root });
    tracked = trackedTreeFilesOf({ root });
  } catch {
    process.stderr.write("forbidden-identifiers: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const scanner = repositoryContentIdentifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES });
  const hits: IdentifierHit[] = [];
  const unreadable: string[] = [];
  for (const path of files) {
    let content: string;
    try {
      content = readFileSync(join(root, path), "utf8");
    } catch {
      unreadable.push(path);
      continue;
    }
    // A NUL byte is the binary signal `./scan.ts` uses; a binary file has no text to name anybody in.
    if (!content.includes("\u0000")) {
      appendAll({ from: scanner.scan({ content, path }), into: hits });
    }
  }
  const report = identifierReport({ hits, trackedPaths: new Set(tracked) });
  const refused = hits.filter((hit) => isRefusedHit({ label: hit.kind })).length;
  const lines = [
    ...(output === "list" ? identifierFindingLines({ report }) : []),
    ...identifierSummaryLines({ report, verdict: IDENTIFIER_VERDICT }),
    ...unreadable.map((path) => `  ${path}  (unreadable — NOT checked)`),
  ];
  const failing = refused > 0 || unreadable.length > 0;
  (failing ? process.stderr : process.stdout).write(`${lines.join("\n")}\n`);
  if (refused > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: LINT_GATE_DECLARATIONS["forbidden-identifiers"],
        detail: `${String(report.trackedHitFiles + report.untrackedHitFiles)} file(s)`,
      })}\n`,
    );
  }
  return failing ? 1 : 0;
}
