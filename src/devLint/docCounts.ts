/**
 * The gate that stops an AUTHORITY doc stating a number that rots.
 *
 * ## Why only some docs
 *
 * `AGENTS.md` is loaded into every session as project instructions. When it said the repo had a certain
 * number of unit files, that was not documentation — it was a false fact handed to every agent before it read
 * a line of code, and it had been wrong for dozens of commits. The same claim was duplicated across the
 * README, the constraints doc and a codebase map, each drifting independently.
 *
 * So the scope is the docs that are read as INSTRUCTIONS, listed in one visible place ({@link AUTHORITY_DOCS}).
 * A dated experiment write-up is a different kind of claim — a record of something that happened, which does
 * not go stale — and is deliberately out of scope.
 *
 * ## Why there is no per-line exemption marker
 *
 * A reason-bearing `doc-count-exempt: …` comment was designed and rejected. Nothing can verify that the stated
 * reason is true, so it is a silent allowlist with better prose, and it becomes the first thing anyone reaches
 * for. Scoping by document is checkable; scoping by self-declared intent is not.
 *
 * The grammar is shared with the handover checker rather than re-derived — two regexes for one rule is how
 * these claims drifted apart to begin with.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDocumentCounts, type DocFinding } from "../handover/check.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * The docs whose numbers are LOAD-BEARING, because they are read as instructions rather than as a record.
 *
 * Scoped deliberately, and stated in one visible place rather than enforced everywhere with a per-line escape
 * hatch. A reason-bearing `doc-count-exempt:` marker was considered and rejected: it cannot verify that a
 * measurement is genuinely historical, so it is a silent allowlist with nicer prose — and everyone reaches for
 * it the moment the gate is inconvenient.
 *
 * The distinction that makes the scope honest: a dated experiment write-up ("115 calls, 1h50m, no verdict") is
 * a RECORD of something that happened and does not go stale. An inventory claim in a file loaded as project
 * instructions ("201 unit files") is a live assertion about the tree, and it rots the moment anyone commits.
 */
export const AUTHORITY_DOCS: readonly string[] = [
  "AGENTS.md",
  "README.md",
  "docs/constraints.md",
  // The constraint set is an index over these pages, and each is as much the standing authority as the index.
  "docs/constraints/7-9.md",
  "docs/constraints/coupled-claims.md",
  "docs/constraints/hard.md",
  "docs/constraints/not-constraints.md",
  "docs/constraints/partition.md",
  "docs/constraints/refusals.md",
  "docs/constraints/relaxed.md",
  ".claude/rules/typescript-patterns.md",
  ".claude/rules/testing.md",
  // The AREA rules, scoped by `paths:` to one `src/` tree each. They are read as instructions the
  // moment a session touches that tree, so an inventory claim in one rots exactly the way it does in a
  // root file — and the memo that proposed the directory axis demanded this be decided before the first
  // one landed rather than discovered afterwards. `areaRules.test.ts` fails an area rule missing here.
  ".claude/rules/area-admit.md",
  ".claude/rules/area-atlas.md",
  ".claude/rules/area-cli.md",
  ".claude/rules/area-corpus.md",
  ".claude/rules/area-devLint.md",
  ".claude/rules/area-handover.md",
  ".claude/rules/area-live.md",
  ".claude/rules/area-outbound.md",
];

/** One stale-count claim, with the doc it lives in. */
export interface DocCountHit extends DocFinding {
  readonly path: string;
}

/**
 * Every count claim in one document.
 *
 * @param path the repo-relative path, for reporting
 * @param content the document text
 * @returns a hit per count claim
 */
export function scanDocCounts({ path, content }: { path: string; content: string }): readonly DocCountHit[] {
  return content
    .split("\n")
    .flatMap((line, index) => checkDocumentCounts({ line, lineNumber: index + 1 }).map((f) => ({ ...f, path })));
}

/**
 * Which authority docs are actually present in this repo.
 *
 * An authority doc that is listed but absent is NOT skipped silently — a rename would otherwise quietly
 * remove a file from the gate, which is the same class of failure the gate exists to catch.
 *
 * @param paths every repo-relative path in the working tree
 * @returns the in-scope paths and any listed doc that no longer exists
 */
export function authorityDocsIn({ paths }: { paths: readonly string[] }): {
  present: readonly string[];
  missing: readonly string[];
} {
  const set = new Set(paths);
  return {
    missing: AUTHORITY_DOCS.filter((doc) => !set.has(doc)),
    present: AUTHORITY_DOCS.filter((doc) => set.has(doc)),
  };
}

/**
 * Scan every authority doc for hard-coded counts, print each hit, and return an exit code.
 *
 * @returns 0 when clean, 1 on any count claim, unreadable doc, or listed-but-missing doc
 */
export function runDocCounts(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("doc-counts: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const { present, missing } = authorityDocsIn({ paths: listing });
  const { hits, unreadable, scanned } = scanTextFiles<DocCountHit>({
    paths: present,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanDocCounts({ content, path }),
  });
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}  ${hit.message}\n`);
  }
  for (const path of missing) {
    process.stderr.write(`  ${path}  (listed as an authority doc but not present — renamed or deleted?)\n`);
  }
  const complete = reportScanIntegrity({
    label: "doc-counts",
    scanned,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (hits.length === 0 && missing.length === 0 && complete) {
    process.stdout.write(`doc-counts: clean (${String(scanned)} authority doc(s) scanned)\n`);
    return 0;
  }
  if (hits.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "doc-counts" }),
        detail: `${String(hits.length)} hard-coded count(s) in docs read as INSTRUCTIONS`,
      })}\n`,
    );
  }
  return 1;
}
