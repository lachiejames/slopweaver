/**
 * `baseline-against-main` — every committed ratchet baseline read against MAIN's copy, so what a change loosens
 * is measured against the bar main holds rather than one the change raised for itself.
 *
 * A ratchet that checks the tree only against a baseline in the same tree lets one pull request add a violation
 * and raise its own baseline. Each gate still holds the tree to the committed file; this one measures the
 * committed file against main's (`./baselineRegistry.ts`), and the landing verbs hold every loosening it finds to
 * a witnessed bump record.
 *
 * ## What it refuses, and what it only reports
 *
 * Bump records live in the state home (`src/codex/bumpRecordStore.ts`), which CI cannot see, so a loosening
 * PASSES here: the gate prints how many there are and that landing owes a bump record and a Codex witness for
 * them. A manifest the change commits under `.baselines/bumps/` is one the landing verbs read too, so it passes.
 * What it still refuses is a change rewriting one of main's manifests there — its witness judged the old bytes —
 * and, as facts about the inputs, a baseline that will not decode, a file under `.baselines/` no registry row
 * names, and a base it cannot read.
 *
 * ## What this gate cannot do, and what does
 *
 * It cannot tell whether a loosening was declared or witnessed. `github enqueue` and `github merge --admin`
 * re-run this comparison in their own code and refuse any loosening no witnessed record covers
 * (`src/codex/baselineBumpWitnessRun.ts`). Two residues stand, stated rather than discovered: a merge that
 * bypasses both landing verbs lands a loosening unchecked, and a change that edits the landing read or its
 * registry runs its own copy when landed from its own checkout — only a base-owned check would close that.
 *
 * ## Where it runs
 *
 * CI's `lint` job, judging the commit it checked out (`HEAD`, never the working tree), where
 * `SLOPWEAVER_COVERAGE_BASE_SHA` names the event's base (`./gitAtCommit.ts`). Locally there is no base, so it
 * says so and passes; `dev baseline-bump --dry-run` is the local reading.
 */

import { compareAgainstBase } from "./baselineComparison.js";
import { resolveFloorBase } from "./gitAtCommit.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

const GATE = "baseline-against-main";

/**
 * The line a clean comparison prints. Pure.
 *
 * @param count how many rows the change loosened against main
 * @param base main's commit
 * @returns the line, naming the landing obligation when anything was loosened
 */
export function cleanLine({ count, base }: { count: number; base: string }): string {
  const short = base.slice(0, 12);
  if (count === 0) {
    return `${GATE}: clean (nothing loosened against ${short})`;
  }
  return (
    `${GATE}: clean (${String(count)} loosening(s) against ${short}; landing owes a store bump record and a ` +
    `Codex witness for ${String(count)} loosening(s))`
  );
}

/**
 * IO edge: compare against the event's base and report what the change loosened.
 *
 * @returns 0 clean or skipped with no base, 1 refused or unable to read an input
 */
export function runBaselineAgainstMain(): number {
  const base = resolveFloorBase({ env: process.env });
  if (base.kind === "absent") {
    process.stdout.write(`${GATE}: skipped — ${base.reason}\n`);
    return 0;
  }
  if (base.kind === "invalid") {
    // devlint: not-a-refusal -- the base commit CI was asked to compare against is unusable, so the gate
    // never saw its subject
    process.stderr.write(`${GATE}: ${base.reason}\n`);
    return 1;
  }
  const compared = compareAgainstBase({ base: base.sha, head: "HEAD", root: repoRoot() });
  if (compared.isErr()) {
    if (compared.error.code === "REWRITTEN_BUMP_MANIFEST") {
      process.stderr.write(
        `${lintGateRefusal({ declaration: lintDeclarationFor({ id: GATE }), detail: compared.error.message })}\n`,
      );
      return 1;
    }
    // devlint: not-a-refusal -- an input could not be read or is not its declared shape, so this is a fact
    // about the inputs rather than a verdict on the change
    process.stderr.write(`${GATE}: ${compared.error.message}\n`);
    return 1;
  }
  process.stdout.write(`${cleanLine({ base: base.sha, count: compared.value.loosened.length })}\n`);
  return 0;
}
