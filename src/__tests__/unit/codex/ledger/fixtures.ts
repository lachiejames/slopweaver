/*
 * The pure fixtures the Codex ledger test files share: the checkout and the two heads every case is judged
 * against, a tree fingerprint built the way a record stores one, a planning record, and a record for any pass
 * id carrying the scope and outcome its arm really has. Nothing here touches disk. It moved here when
 * `ledger.test.ts` was split by behaviour.
 */
import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { isPlanPass } from "../../../../codex/profiles.js";
import type {
  CodexArtifactRecord,
  CodexPassId,
  CodexPassTree,
  PlanPassId,
  ReviewAnswer,
} from "../../../../codex/types.js";

/** The checkout every record is recorded against. */
export const REPO = "/w/repo";
/** The HEAD the current tree sits on. */
export const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
/** A HEAD the current tree has moved away from. */
export const OTHER_HEAD = "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90";

/**
 * A tree fingerprint plus the loose parts a record stores, so the two always agree in a fixture.
 *
 * @returns the tree a record carries, its fingerprint derived from the same head and patch
 */
export function treeOn({
  branch,
  headSha,
  patch,
}: {
  branch: string | null;
  headSha: string;
  patch: string;
}): CodexPassTree {
  // A real-SHAPED tree sha, because `freshnessOf` now checks the shape: git yields 40 lowercase hex and a
  // placeholder like `t-<sha>` is not provenance, it is a string. Derived from `headSha` so two different
  // heads still give two different trees, which is what every case here turns on.
  const treeSha = `${headSha.slice(2)}ab`;
  const fp = treeFingerprint({ dirtyPatch: patch, headSha, treeSha });
  return { branch, dirtyBytes: fp.dirtyBytes, fingerprint: fp.digest, headSha, treeSha: fp.treeSha };
}

/**
 * A planning pass's record, answered with the verdict a case names.
 *
 * @returns a plan-mode record on {@link REPO}, carrying the tree only when one is given
 */
export function planRecord({
  pass,
  tree,
  verdict = "READY",
  createdAtIso = "2026-08-02T01:00:00.000Z",
}: {
  pass: PlanPassId;
  tree: CodexPassTree | undefined;
  verdict?: "READY" | "BLOCKED";
  createdAtIso?: string;
}): CodexArtifactRecord {
  return {
    artifactId: `id-${pass}-${createdAtIso}`,
    attempts: [],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso,
    observedElapsedMs: 10,
    outcome: {
      answer: { blockers: [], bodyMarkdown: "", summary: "", verdict },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    repoRoot: REPO,
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "xhigh",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: { mode: "plan", pass, promptBytes: 1, promptSha256: "abc" },
    ...(tree === undefined ? {} : { tree }),
  };
}

/** The artifact id a case named, or `id-<pass>` when it named none. */
function artifactIdFor({ artifactId, pass }: { artifactId: string | undefined; pass: CodexPassId }): string {
  if (artifactId === undefined) {
    return `id-${pass}`;
  }
  return artifactId;
}

/**
 * A record for ANY pass id, carrying the SCOPE its arm really has.
 *
 * The `mode` matters and used to be wrong here: this built every record with `mode: "plan"` and swapped only
 * the pass id, so an `r1` fixture claimed to be a planning pass. Nothing noticed while `loopFailures`
 * classified by the `p`/`r` prefix, and every review case in this file was silently a plan. A Codex review of
 * the gate pointed at that exact mismatch as a way to satisfy the plan floor with no plan.
 *
 * @returns a plan-mode record for a `p` pass, else a review-mode record answered with the verdict a case names
 */
export function anyPassRecord({
  pass,
  tree,
  artifactId,
  verdict = "CLEAN",
}: {
  pass: CodexPassId;
  tree: CodexPassTree;
  /** Override when a case needs two records of the same pass to be told apart. */
  artifactId?: string;
  verdict?: ReviewAnswer["verdict"];
}): CodexArtifactRecord {
  const base = planRecord({ pass: "p1", tree });
  if (isPlanPass(pass)) {
    return {
      ...base,
      artifactId: artifactIdFor({ artifactId, pass }),
      scope: { mode: "plan", pass, promptBytes: 1, promptSha256: "abc" },
    };
  }
  // The OUTCOME has to be a review's too, not just the scope. Copying the plan's `READY` answer onto a review
  // record is precisely the shape that let a record satisfy the review floor with no diff ever read, so a
  // fixture that did it would test the defect rather than the fix.
  return {
    ...base,
    artifactId: artifactIdFor({ artifactId, pass }),
    outcome: {
      answer: { counterexample: "", evidence: "", propertyId: `${pass}-01`, summary: "held", verdict },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    scope: {
      baseRef: "origin/main",
      baseSha: "b".repeat(40),
      diffBytes: 10,
      diffSha256: "d".repeat(64),
      headSha: tree.headSha,
      mode: "review",
      pass,
      property: { id: `${pass}-01`, statement: "a falsifiable claim" },
    },
  };
}
