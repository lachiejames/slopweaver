/**
 * {@link planPassKey}, {@link reviewPassKey}, {@link conclusivePass}, {@link findExactDuplicate} and
 * {@link admitPass} — the exact-duplicate refusal.
 *
 * Every case here turns one field of a key and asserts the answer flips, because the whole value of an EXACT
 * key is that it cannot fire on a pass that has not run. A gate that refuses something new is worse than no
 * gate: it teaches people to set the hatch permanently.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { admitFor } from "../../../cli/commands/codex/admitFor.js";
import {
  conclusivePass,
  duplicatePassDetail,
  findExactDuplicate,
  planPassKey,
  recordPassKey,
  reviewPassKey,
  sameExactPass,
} from "../../../codex/duplicate.js";
import { admitCodexPass, admitPass, admittedPass, reportAdmission } from "../../../codex/passAdmission.js";
import type { CodexArtifactRecord, PlanPassId, ReviewPassId } from "../../../codex/types.js";

const REPO = "/w/repo";
const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const OTHER_HEAD = "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const DIFF = "a".repeat(64);
const OTHER_DIFF = "b".repeat(64);

/** The fields every record needs and no test varies. */
const SHELL = {
  attempts: [],
  bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
  observedElapsedMs: 10,
  repoRoot: REPO,
  requestedApprovalPolicy: "never",
  requestedModel: "gpt-6-astra",
  requestedNetworkAccess: true,
  requestedReasoningEffort: "medium",
  requestedSandboxMode: "workspace-write",
  requestedWebSearch: true,
  requestedWritableRoots: [],
  schemaVersion: 1,
} as const;

function planRecord({
  branch = "feature",
  createdAtIso = "2026-09-13T01:00:00.000Z",
  headSha = HEAD,
  pass = "p2",
  verdict = "READY",
}: {
  branch?: string | null;
  createdAtIso?: string;
  headSha?: string;
  pass?: PlanPassId;
  verdict?: "READY" | "BLOCKED";
} = {}): CodexArtifactRecord {
  return {
    ...SHELL,
    artifactId: `plan-${pass}-${createdAtIso}`,
    createdAtIso,
    outcome: {
      answer: { blockers: [], bodyMarkdown: "", summary: "", verdict },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    scope: { mode: "plan", pass, promptBytes: 10, promptSha256: "c".repeat(64) },
    tree: { branch, dirtyBytes: 0, fingerprint: "d".repeat(64), headSha, treeSha: "e".repeat(40) },
  };
}

function reviewRecord({
  createdAtIso = "2026-09-13T01:00:00.000Z",
  diffSha256 = DIFF,
  headSha = HEAD,
  pass = "r1",
  propertyId = "r1-01",
  verdict = "CLEAN",
}: {
  createdAtIso?: string;
  diffSha256?: string;
  headSha?: string;
  pass?: ReviewPassId;
  propertyId?: string;
  verdict?: "CLEAN" | "BROKEN";
} = {}): CodexArtifactRecord {
  return {
    ...SHELL,
    artifactId: `review-${propertyId}-${createdAtIso}`,
    createdAtIso,
    outcome: {
      answer: { counterexample: "", evidence: "looked", propertyId, summary: "", verdict },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    scope: {
      baseRef: "origin/main",
      baseSha: "f".repeat(40),
      diffBytes: 100,
      diffSha256,
      headSha,
      mode: "review",
      pass,
      property: { id: propertyId, statement: "nothing is destructive" },
    },
    tree: { branch: "feature", dirtyBytes: 0, fingerprint: "d".repeat(64), headSha, treeSha: "e".repeat(40) },
  };
}

describe("planPassKey", () => {
  it("keys on branch, pass and HEAD", () => {
    expect(planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })).toEqual({
      branch: "feature",
      headSha: HEAD,
      mode: "plan",
      pass: "p2",
    });
  });

  it("cannot key a detached HEAD, so such a pass is never refused", () => {
    expect(planPassKey({ branch: null, headSha: HEAD, pass: "p2" })).toBeUndefined();
  });

  it("cannot key a pass whose HEAD was not captured", () => {
    expect(planPassKey({ branch: "feature", headSha: undefined, pass: "p2" })).toBeUndefined();
  });
});

describe("sameExactPass", () => {
  const base = planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })!;

  it("matches an identical plan key", () => {
    expect(sameExactPass({ left: base, right: planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })! })).toBe(
      true,
    );
  });

  it("does not match a different branch", () => {
    expect(sameExactPass({ left: base, right: planPassKey({ branch: "other", headSha: HEAD, pass: "p2" })! })).toBe(
      false,
    );
  });

  it("does not match a different HEAD", () => {
    expect(
      sameExactPass({ left: base, right: planPassKey({ branch: "feature", headSha: OTHER_HEAD, pass: "p2" })! }),
    ).toBe(false);
  });

  it("does not match a different pass id", () => {
    expect(sameExactPass({ left: base, right: planPassKey({ branch: "feature", headSha: HEAD, pass: "p3" })! })).toBe(
      false,
    );
  });

  it("never matches a review key against a plan key", () => {
    expect(
      sameExactPass({ left: base, right: reviewPassKey({ diffSha256: DIFF, pass: "r1", propertyId: "r1-01" }) }),
    ).toBe(false);
  });

  it("matches a review key on diff, property and pass alone", () => {
    const left = reviewPassKey({ diffSha256: DIFF, pass: "r1", propertyId: "r1-01" });

    expect(sameExactPass({ left, right: reviewPassKey({ diffSha256: DIFF, pass: "r1", propertyId: "r1-01" }) })).toBe(
      true,
    );
    expect(
      sameExactPass({ left, right: reviewPassKey({ diffSha256: OTHER_DIFF, pass: "r1", propertyId: "r1-01" }) }),
    ).toBe(false);
    expect(sameExactPass({ left, right: reviewPassKey({ diffSha256: DIFF, pass: "r2", propertyId: "r1-01" }) })).toBe(
      false,
    );
    expect(sameExactPass({ left, right: reviewPassKey({ diffSha256: DIFF, pass: "r1", propertyId: "r1-02" }) })).toBe(
      false,
    );
  });
});

describe("recordPassKey", () => {
  it("keys a review record WITHOUT its HEAD, so a rebase that changed no bytes is still the same pass", () => {
    const before = recordPassKey({ record: reviewRecord({ headSha: HEAD }) })!;
    const after = recordPassKey({ record: reviewRecord({ headSha: OTHER_HEAD }) })!;

    expect(sameExactPass({ left: before, right: after })).toBe(true);
  });

  it("keys a plan record WITH its HEAD, so a new commit is a new pass", () => {
    const before = recordPassKey({ record: planRecord({ headSha: HEAD }) })!;
    const after = recordPassKey({ record: planRecord({ headSha: OTHER_HEAD }) })!;

    expect(sameExactPass({ left: before, right: after })).toBe(false);
  });

  it("cannot key a plan record run on a detached HEAD", () => {
    expect(recordPassKey({ record: planRecord({ branch: null }) })).toBeUndefined();
  });

  it("keys a plan record on the branch its captured tree names", () => {
    expect(recordPassKey({ record: planRecord({ branch: "feature" }) })).toEqual({
      branch: "feature",
      headSha: HEAD,
      mode: "plan",
      pass: "p2",
    });
  });

  it("cannot key a plan record written before the tree was captured", () => {
    const { tree: _captured, ...legacy } = planRecord();

    expect(recordPassKey({ record: legacy })).toBeUndefined();
  });
});

describe("conclusivePass", () => {
  it("counts a READY plan and a BLOCKED plan alike — a negative verdict is still an answer", () => {
    expect(conclusivePass({ record: planRecord({ verdict: "READY" }) })).toBe(true);
    expect(conclusivePass({ record: planRecord({ verdict: "BLOCKED" }) })).toBe(true);
  });

  it("counts a CLEAN review and a BROKEN review alike", () => {
    expect(conclusivePass({ record: reviewRecord({ verdict: "CLEAN" }) })).toBe(true);
    expect(conclusivePass({ record: reviewRecord({ verdict: "BROKEN" }) })).toBe(true);
  });

  it("rejects a no-verdict record, which concluded nothing a re-run would reproduce", () => {
    const record: CodexArtifactRecord = {
      ...planRecord(),
      outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "off-track", salvage: null },
    };

    expect(conclusivePass({ record })).toBe(false);
  });

  it("rejects a fatal record", () => {
    const record: CodexArtifactRecord = {
      ...planRecord(),
      outcome: {
        cause: { quota: null, reported: null, thrown: "boom" },
        error: { kind: "http", message: "boom", operation: "codex.run" },
        kind: "fatal",
        salvage: null,
      },
    };

    expect(conclusivePass({ record })).toBe(false);
  });

  it("rejects a review record whose answer names a DIFFERENT property than its scope", () => {
    const record = reviewRecord({ propertyId: "r1-01" });
    const mismatched: CodexArtifactRecord = {
      ...record,
      outcome: {
        answer: { counterexample: "", evidence: "e", propertyId: "r1-99", summary: "", verdict: "CLEAN" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
    };

    expect(conclusivePass({ record: mismatched })).toBe(false);
  });

  it("rejects a review record carrying a PLAN's verdict, which read no diff at all", () => {
    const record = reviewRecord();
    const planVerdict: CodexArtifactRecord = {
      ...record,
      outcome: {
        answer: { blockers: [], bodyMarkdown: "", summary: "", verdict: "READY" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
    };

    expect(conclusivePass({ record: planVerdict })).toBe(false);
  });
});

describe("findExactDuplicate", () => {
  const key = planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })!;

  it("finds nothing among an empty ledger", () => {
    expect(findExactDuplicate({ key, records: [] })).toBeUndefined();
  });

  it("finds the conclusive record for this exact pass", () => {
    expect(findExactDuplicate({ key, records: [planRecord()] })?.artifactId).toBe("plan-p2-2026-09-13T01:00:00.000Z");
  });

  it("ignores a record for a different branch", () => {
    expect(findExactDuplicate({ key, records: [planRecord({ branch: "other" })] })).toBeUndefined();
  });

  it("ignores an inconclusive record for the same key", () => {
    const inconclusive: CodexArtifactRecord = {
      ...planRecord(),
      outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "off-track", salvage: null },
    };

    expect(findExactDuplicate({ key, records: [inconclusive] })).toBeUndefined();
  });

  it("returns the NEWEST of several matching records", () => {
    const older = planRecord({ createdAtIso: "2026-09-12T01:00:00.000Z" });
    const newer = planRecord({ createdAtIso: "2026-09-13T09:00:00.000Z" });

    expect(findExactDuplicate({ key, records: [older, newer] })?.createdAtIso).toBe("2026-09-13T09:00:00.000Z");
    expect(findExactDuplicate({ key, records: [newer, older] })?.createdAtIso).toBe("2026-09-13T09:00:00.000Z");
  });
});

describe("admitPass", () => {
  const key = planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })!;

  it("allows a pass with no duplicate", () => {
    expect(admitPass({ hatchOpen: false, key, records: [] })).toEqual({
      kind: "allowed",
      reason: "no conclusive record exists for this exact pass",
    });
  });

  it("allows a pass that cannot be keyed, rather than refusing on an absence of provenance", () => {
    expect(admitPass({ hatchOpen: false, key: undefined, records: [planRecord()] })).toEqual({
      kind: "allowed",
      reason: "this pass carries no branch or HEAD to key on, so no duplicate could be established",
    });
  });

  it("refuses an exact duplicate with the registered four-line refusal", () => {
    const admission = admitPass({ hatchOpen: false, key, records: [planRecord()] });

    expect(admission.kind).toBe("duplicate");
    expect(admission.kind === "duplicate" ? admission.refusal.length : 0).toBe(4);
    expect(admission.kind === "duplicate" ? admission.refusal[2] : "").toContain(
      "SLOPWEAVER_ALLOW_DUPLICATE_CODEX_PASS=1",
    );
  });

  it("allows the same pass once the hatch is open, and says the duplicate was overridden", () => {
    const admission = admitPass({ hatchOpen: true, key, records: [planRecord()] });

    expect(admission.kind).toBe("allowed");
    expect(admission.kind === "allowed" ? admission.reason : "").toContain("overridden by the escape hatch");
  });
});

describe("admittedPass — the only way to mint the proof a pass requires", () => {
  const key = planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })!;

  it("mints no proof for a duplicate, so a refused pass has nothing to run on", () => {
    expect(admittedPass({ admission: admitPass({ hatchOpen: false, key, records: [planRecord()] }) })).toBe(undefined);
  });

  it("mints the admission itself for an allowed pass", () => {
    const admission = admitPass({ hatchOpen: false, key, records: [] });
    expect(admittedPass({ admission })).toBe(admission);
  });

  it("mints the admission itself for a pass the hatch overrode", () => {
    const admission = admitPass({ hatchOpen: true, key, records: [planRecord()] });
    expect(admittedPass({ admission })).toBe(admission);
  });
});

describe("duplicatePassDetail", () => {
  it("names the trade a PLAN key makes, so a changed question is not silently refused", () => {
    const key = planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })!;
    const detail = duplicatePassDetail({ duplicate: planRecord(), key }).join(" ");

    expect(detail).toContain("does NOT include the question asked");
    expect(detail).toContain("plan-p2-2026-09-13T01:00:00.000Z");
    expect(detail).toContain("READY");
  });

  it("names the trade a REVIEW key makes — the commit is not part of it", () => {
    const key = reviewPassKey({ diffSha256: DIFF, pass: "r1", propertyId: "r1-01" });
    const detail = duplicatePassDetail({ duplicate: reviewRecord(), key }).join(" ");

    expect(detail).toContain("does NOT include the commit");
  });
});

describe("admitPass when the ledger itself could not be read", () => {
  const key = planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" })!;

  it("does NOT refuse a first-ever pass — a scan that failed established no duplicate", () => {
    // A Codex review supplied this exact counterexample: no pass had ever run for the repository, the
    // orchestration root was a regular file, and `ENOTDIR` refused a pass with no duplicate anywhere on the
    // machine. This gate refuses an EXACT REPEAT; the absence of evidence is not one.
    const admission = admitCodexPass({
      hatchOpen: false,
      key,
      orchestrationRoot: notADirectory(),
      repoRoot: REPO,
    });

    expect(admission.kind).toBe("unchecked");
    expect(reportAdmission({ admission })).toBe(false);
  });

  it("reports the unread ledger as its own state, never as a clean allowed", () => {
    const admission = admitCodexPass({
      hatchOpen: false,
      key,
      orchestrationRoot: notADirectory(),
      repoRoot: REPO,
    });

    expect(admission.kind === "unchecked" ? admission.reason : "").toContain("no duplicate could be established");
  });

  it("is unchanged by the hatch, because there is nothing here to escape", () => {
    const admission = admitCodexPass({
      hatchOpen: true,
      key,
      orchestrationRoot: notADirectory(),
      repoRoot: REPO,
    });

    expect(admission.kind).toBe("unchecked");
  });

  it("allows when the root has never existed — that is knowledge, not a read failure", () => {
    const admission = admitCodexPass({
      hatchOpen: false,
      key,
      orchestrationRoot: join(mkdtempSync(join(tmpdir(), "codex-admit-")), "never-created"),
      repoRoot: REPO,
    });

    expect(admission.kind).toBe("allowed");
    expect(admission.kind === "allowed" ? admission.reason : "").toContain(
      "no conclusive record exists for this exact pass",
    );
  });
});

const admitTempDirs: string[] = [];

/**
 * A path that EXISTS and is not a directory, so a ledger scan fails with `ENOTDIR` rather than `ENOENT`.
 *
 * The two errnos mean opposite things here — "the root is corrupt" versus "no pass has ever run" — and this
 * builds the first, which is the shape a Codex review used to show the refusal had no way out.
 *
 * @returns the path to a regular file standing where an orchestration root should be
 */
function notADirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-admit-"));
  admitTempDirs.push(dir);
  const path = join(dir, "orchestration");
  writeFileSync(path, "not a directory", "utf8");
  return path;
}

afterEach(() => {
  admitTempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("the admission key is built when admission is ASKED, never before the pass starts", () => {
  // A Codex review's counterexample: the plan key names a HEAD, and it was captured before `runPlanPass`
  // ran. Another process advancing the branch in between left the closure refusing the pass at the NEW HEAD
  // on the OLD HEAD's record — a refusal of a pass that has never run.
  const emptyRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "codex-admit-key-"));
    admitTempDirs.push(dir);
    return join(dir, "orchestration-never-created");
  };

  it("calls its key builder on every admission, so a moved HEAD is the one that is keyed", () => {
    const heads = [HEAD, OTHER_HEAD];
    let asked = 0;
    const admit = admitFor({
      keyAt: () => {
        const headSha = heads[asked];
        if (headSha === undefined) {
          throw new Error("the key builder was asked more often than the two admissions this case makes");
        }
        asked += 1;
        return planPassKey({ branch: "feature", headSha, pass: "p2" });
      },
      orchestrationRoot: emptyRoot(),
      repoRoot: REPO,
    });

    admit();
    admit();

    expect(asked).toBe(2);
  });

  it("refuses a duplicate at the head the builder reports, and allows once that head moves", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-admit-ledger-"));
    admitTempDirs.push(root);
    const runDir = join(root, "run-1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "artifact.md"), "# artifact", "utf8");
    writeFileSync(join(runDir, "record.json"), JSON.stringify(planRecord({ headSha: HEAD })), "utf8");
    let headSha = HEAD;
    const admit = admitFor({
      keyAt: () => planPassKey({ branch: "feature", headSha, pass: "p2" }),
      orchestrationRoot: root,
      repoRoot: REPO,
    });

    expect(admit().kind).toBe("duplicate");

    headSha = OTHER_HEAD;

    expect(admit().kind).toBe("allowed");
  });
});

describe("an unreadable ledger reaches the PRODUCTION admission path, not just the reporter", () => {
  // A Codex review found `unchecked` unreachable in practice: `passRoute.ts` returns `refused` only for a
  // duplicate and `reportInvocations` reports only refusals, so the module header promised a stderr warning
  // no production path emitted. `admitFor` — the closure the verbs actually pass — now reports it itself.
  it("returns unchecked from admitFor, the closure both verbs hand to a pass", () => {
    const admission = admitFor({
      keyAt: () => planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" }),
      orchestrationRoot: notADirectory(),
      repoRoot: REPO,
    })();

    expect(admission.kind).toBe("unchecked");
  });

  it("does not stop the caller, so a damaged orchestration root never blocks a pass", () => {
    const admission = admitFor({
      keyAt: () => planPassKey({ branch: "feature", headSha: HEAD, pass: "p2" }),
      orchestrationRoot: notADirectory(),
      repoRoot: REPO,
    })();

    expect(reportAdmission({ admission })).toBe(false);
  });
});
