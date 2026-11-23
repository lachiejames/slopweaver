/**
 * The no-proof-path gate — proof output never reaches a pull request, and the gitignore that keeps a stray
 * capture from being staged is still whole.
 *
 * A pull request that commits `packages/tool-cli/proof/` leaves capture residue behind, and the rule is to make
 * that structurally impossible. The criterion is
 * `src/proofPath/criterion.ts`'s; this gate is its CI half, and the push and ready door verbs are its other.
 *
 * WHOLE TREE, not the pull request's diff: `main` carries no proof path (this gate is what keeps it so), so
 * a proof path in the tree is exactly one the branch added — and a check that needs no base commit cannot be
 * starved of one. It is a CI gate because CI can see a committed file; it never joins
 * the local pre-push lane.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { missingProofGitignoreLines, proofPathHits } from "../proofPath/criterion.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/** One thing the gate refuses: a proof path in the tree, or a gitignore line the block lost. */
export interface ProofPathFinding {
  readonly kind: "proof-path" | "gitignore";
  readonly subject: string;
}

/**
 * Pure: every proof path in the listing and every gitignore line the block is missing.
 *
 * @param paths every repository-relative file the tree carries
 * @param gitignore the root `.gitignore` text
 * @returns the findings, proof paths first, empty when clean
 */
export function scanNoProofPath({
  paths,
  gitignore,
}: {
  paths: readonly string[];
  gitignore: string;
}): readonly ProofPathFinding[] {
  return [
    ...proofPathHits({ paths }).map((subject): ProofPathFinding => ({ kind: "proof-path", subject })),
    ...missingProofGitignoreLines({ content: gitignore }).map((subject): ProofPathFinding => ({
      kind: "gitignore",
      subject,
    })),
  ];
}

/**
 * IO edge: list the tree, read the gitignore, print the verdict.
 *
 * @returns the process exit code (0 clean, 1 a finding or an unreadable input)
 */
export function runNoProofPath(): number {
  let paths: readonly string[];
  let gitignore: string;
  try {
    const root = repoRoot();
    paths = workingTreeFilesOf({ root });
    gitignore = readFileSync(join(root, ".gitignore"), "utf8");
  } catch (error: unknown) {
    // devlint: not-a-refusal -- the tree or its gitignore could not be READ, so the gate has no subject to judge
    process.stderr.write(
      `no-proof-path: could not read the tree or its .gitignore (${error instanceof Error ? error.message : String(error)})\n`,
    );
    return 1;
  }
  const findings = scanNoProofPath({ gitignore, paths });
  if (gateOutcome({ refused: findings.length, unseen: 0 }) === "clean") {
    process.stdout.write(`no-proof-path: clean (${String(paths.length)} files listed, gitignore block intact)\n`);
    return 0;
  }
  for (const finding of findings) {
    const where = finding.kind === "proof-path" ? "committed proof output" : ".gitignore is missing";
    process.stderr.write(`  ${where}: ${finding.subject}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "no-proof-path" }),
      detail: `${String(findings.length)} finding(s)`,
    })}\n`,
  );
  return 1;
}
