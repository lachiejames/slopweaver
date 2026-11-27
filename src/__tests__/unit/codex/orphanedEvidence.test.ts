/**
 * The adoption rule for a deleted checkout's evidence (`src/codex/orphanedEvidence.ts`), driven with literal probe
 * answers, and the `owner/name` binding it rests on (`src/codex/originBinding.ts`).
 *
 * Zero mocks: each probe is a plain function returning a literal, per `.claude/rules/testing.md`.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  embeddedOriginTrusted,
  originRepositoryField,
  recordedOriginRepository,
} from "../../../codex/originBinding.js";
import { liveOriginRepositoryField } from "../../../codex/originBindingLive.js";
import {
  adoptionTarget,
  type OrphanProbes,
  recordedBranchesOf,
  rehomeOrphanedReceipts,
  rehomeOrphanedRecords,
} from "../../../codex/orphanedEvidence.js";
import { recordedPathState } from "../../../codex/orphanedEvidenceProbes.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);
const SUBJECT = { branch: "feature", headSha: HEAD, repository: "acme/widget" };
const GONE = "/w/gone";
const TARGETS = ["/w/main", "/w/clone"];

/** Probes that answer every question the way a fully re-provable orphan would. */
function provingProbes(over: Partial<OrphanProbes> = {}): OrphanProbes {
  return {
    ancestry: () => "yes",
    holdsCommit: () => true,
    pathState: () => "missing",
    ...over,
  };
}

/** The placement of a fully re-provable record; a case overrides one field. */
function placement(over: Partial<Record<"branch" | "headSha" | "originRepository" | "recordedRoot", unknown>> = {}): {
  branch: unknown;
  headSha: unknown;
  originRepository: unknown;
  recordedRoot: unknown;
} {
  return { branch: "feature", headSha: HEAD, originRepository: "acme/widget", recordedRoot: GONE, ...over };
}

describe("recordedOriginRepository", () => {
  it("keeps a well-formed owner/name slug", () => {
    expect(recordedOriginRepository({ value: "acme/widget.js_2-x" })).toBe("acme/widget.js_2-x");
  });

  it("reads every malformed or absent value as absent", () => {
    const values: readonly unknown[] = [
      undefined,
      null,
      42,
      "",
      "acme",
      "acme/",
      "/widget",
      "acme/widget/extra",
      "-acme/widget",
      "acme/..",
      "acme/.",
      " acme/widget",
    ];
    expect(values.map((value) => recordedOriginRepository({ value }))).toEqual(values.map(() => undefined));
  });

  it("spreads the field only when it validates", () => {
    expect([originRepositoryField({ value: "acme/widget" }), originRepositoryField({ value: "acme/.." })]).toEqual([
      { originRepository: "acme/widget" },
      {},
    ]);
  });
});

describe("embeddedOriginTrusted", () => {
  const embedded = {
    originRepository: "acme/widget",
    repoRoot: GONE,
    tree: { branch: "feature", headSha: HEAD },
  };
  const file = { ...embedded, tree: { ...embedded.tree, dirtyBytes: 0 } };

  it("trusts an embedded origin only when the hash-bound file carries the same origin, path, branch and head", () => {
    const files: readonly unknown[] = [
      file,
      { ...file, originRepository: undefined },
      { ...file, originRepository: "fork/widget" },
      { ...file, originRepository: "acme/.." },
      { ...file, repoRoot: "/w/other" },
      { ...file, tree: { ...file.tree, branch: "other" } },
      { ...file, tree: { ...file.tree, headSha: OLDER } },
      { ...file, tree: undefined },
      "not a request",
    ];
    expect(files.map((onDisk) => embeddedOriginTrusted({ embedded, onDisk }))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("has nothing to trust in a copy that claims no origin", () => {
    const { originRepository: _none, ...unbound } = embedded;
    expect(embeddedOriginTrusted({ embedded: unbound, onDisk: "not a request" })).toBe(true);
  });
});

describe("adoptionTarget", () => {
  it("adopts a re-provable orphan into the FIRST target that proves it", () => {
    expect(
      adoptionTarget({ placement: placement(), probes: provingProbes(), subject: SUBJECT, targets: TARGETS }),
    ).toBe("/w/main");
  });

  it("skips a target that does not hold the recorded commit", () => {
    const probes = provingProbes({ holdsCommit: ({ root }) => root === "/w/clone" });
    expect(adoptionTarget({ placement: placement(), probes, subject: SUBJECT, targets: TARGETS })).toBe("/w/clone");
  });

  it("adopts a recorded head that is an ancestor, and asks no ancestry when it IS the head", () => {
    const asked: string[] = [];
    const probes = provingProbes({
      ancestry: ({ ancestor }) => {
        asked.push(ancestor);
        return "yes";
      },
    });
    const older = adoptionTarget({
      placement: placement({ headSha: OLDER }),
      probes,
      subject: SUBJECT,
      targets: TARGETS,
    });
    const same = adoptionTarget({ placement: placement(), probes, subject: SUBJECT, targets: TARGETS });
    expect({ asked, older, same }).toEqual({ asked: [OLDER], older: "/w/main", same: "/w/main" });
  });

  it("never adopts when one clause fails", () => {
    const cases: readonly { placement: ReturnType<typeof placement>; probes: OrphanProbes }[] = [
      { placement: placement(), probes: provingProbes({ pathState: () => "present" }) },
      { placement: placement(), probes: provingProbes({ pathState: () => "unknown" }) },
      { placement: placement({ originRepository: undefined }), probes: provingProbes() },
      { placement: placement({ originRepository: "fork/widget" }), probes: provingProbes() },
      { placement: placement({ originRepository: "acme/widget/x" }), probes: provingProbes() },
      { placement: placement({ branch: "other" }), probes: provingProbes() },
      { placement: placement({ branch: null }), probes: provingProbes() },
      { placement: placement({ headSha: "abc" }), probes: provingProbes() },
      { placement: placement({ headSha: undefined }), probes: provingProbes() },
      { placement: placement({ recordedRoot: null }), probes: provingProbes() },
      { placement: placement({ recordedRoot: "" }), probes: provingProbes() },
      { placement: placement({ recordedRoot: "/w/main" }), probes: provingProbes() },
      { placement: placement(), probes: provingProbes({ holdsCommit: () => false }) },
      { placement: placement({ headSha: OLDER }), probes: provingProbes({ ancestry: () => "no" }) },
      { placement: placement({ headSha: OLDER }), probes: provingProbes({ ancestry: () => "error" }) },
    ];
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.map((one) => adoptionTarget({ ...one, subject: SUBJECT, targets: TARGETS }))).toEqual(
      cases.map(() => undefined),
    );
  });

  it("asks no filesystem or git question of evidence on another branch or from another repository", () => {
    const asked: string[] = [];
    const probes: OrphanProbes = {
      ancestry: () => {
        asked.push("ancestry");
        return "yes";
      },
      holdsCommit: () => {
        asked.push("holds");
        return true;
      },
      pathState: () => {
        asked.push("path");
        return "missing";
      },
    };
    adoptionTarget({ placement: placement({ branch: "other" }), probes, subject: SUBJECT, targets: TARGETS });
    adoptionTarget({
      placement: placement({ originRepository: "fork/widget" }),
      probes,
      subject: SUBJECT,
      targets: TARGETS,
    });
    expect(asked).toEqual([]);
  });
});

describe("rehomeOrphanedRecords", () => {
  /** A record whose fields adoption reads; the rest is irrelevant to the rule. */
  function record(over: Partial<CodexArtifactRecord> = {}): CodexArtifactRecord {
    return {
      artifactId: "r1",
      createdAtIso: "2026-09-16T01:00:00.000Z",
      originRepository: "acme/widget",
      repoRoot: GONE,
      tree: { branch: "feature", dirtyBytes: 0, fingerprint: "f", headSha: HEAD },
      ...over,
    } as CodexArtifactRecord;
  }

  it("re-homes the adopted record and returns the rest untouched, in order", () => {
    // A record written before the binding existed carries no `originRepository` key at all.
    const { originRepository: _absent, ...legacy } = record({ artifactId: "legacy" });
    const records = [record({ artifactId: "adopted" }), legacy];
    const out = rehomeOrphanedRecords({
      probes: provingProbes(),
      recordedBranches: recordedBranchesOf({ receipts: undefined, records }),
      records,
      subject: SUBJECT,
      targets: TARGETS,
    });
    expect(out.map((one) => [one.artifactId, one.repoRoot])).toEqual([
      ["adopted", "/w/main"],
      ["legacy", GONE],
    ]);
  });

  it("holds an orphan to the branch it RECORDED, never one branch continuity relabelled it to", () => {
    const onDisk = [record({ tree: { branch: "draft", dirtyBytes: 0, fingerprint: "f", headSha: HEAD } })];
    const out = rehomeOrphanedRecords({
      probes: provingProbes(),
      recordedBranches: recordedBranchesOf({ receipts: undefined, records: onDisk }),
      records: [record()],
      subject: SUBJECT,
      targets: TARGETS,
    });
    expect(out.map((one) => one.repoRoot)).toEqual([GONE]);
  });

  it("leaves a record with no tree where it was", () => {
    const { tree: _tree, ...noTree } = record();
    const out = rehomeOrphanedRecords({
      probes: provingProbes(),
      recordedBranches: recordedBranchesOf({ receipts: undefined, records: [noTree] }),
      records: [noTree],
      subject: SUBJECT,
      targets: TARGETS,
    });
    expect(out.map((one) => one.repoRoot)).toEqual([GONE]);
  });
});

describe("rehomeOrphanedReceipts", () => {
  const request = {
    originRepository: "acme/widget",
    repoRoot: GONE,
    tree: { branch: "feature", dirtyBytes: 0, fingerprint: "f", headSha: HEAD },
  };

  /** A receipt scan holding the given bound receipts beside one foreign and one unbound receipt. */
  function scanOf({
    planRequest,
    reviewRequest,
  }: {
    planRequest: typeof request;
    reviewRequest: typeof request;
  }): Parameters<typeof rehomeOrphanedReceipts>[0]["receipts"] {
    return {
      foreign: 1,
      foreignModes: ["x"],
      foreignReceipts: [{ branch: "feature", mode: "x", repoRoot: GONE, requestId: "f" }],
      pending: 0,
      pendingPlans: 0,
      planReceipts: [{ receiptId: "plan", request: planRequest }],
      problems: [],
      receipts: [{ receiptId: "review", request: reviewRequest }],
      unboundReceipts: [{ branch: "feature", repoRoot: GONE, requestId: "u" }],
      unreadable: 0,
    } as unknown as Parameters<typeof rehomeOrphanedReceipts>[0]["receipts"];
  }

  it("re-homes a bound receipt and leaves foreign and unbound receipts alone", () => {
    const scan = scanOf({ planRequest: request, reviewRequest: { ...request, originRepository: "fork/widget" } });
    const out = rehomeOrphanedReceipts({
      probes: provingProbes(),
      receipts: scan,
      recordedBranches: recordedBranchesOf({ receipts: scan, records: [] }),
      subject: SUBJECT,
      targets: TARGETS,
    });
    expect({
      foreign: out.foreignReceipts.map((one) => one.repoRoot),
      plans: out.planReceipts.map((one) => one.request.repoRoot),
      reviews: out.receipts.map((one) => one.request.repoRoot),
      unbound: out.unboundReceipts.map((one) => one.repoRoot),
    }).toEqual({ foreign: [GONE], plans: ["/w/main"], reviews: [GONE], unbound: [GONE] });
  });

  it("holds a receipt to the branch its request RECORDED, never a relabelled one", () => {
    const draft = { ...request, tree: { ...request.tree, branch: "draft" } };
    const out = rehomeOrphanedReceipts({
      probes: provingProbes(),
      receipts: scanOf({ planRequest: request, reviewRequest: request }),
      recordedBranches: recordedBranchesOf({
        receipts: scanOf({ planRequest: draft, reviewRequest: draft }),
        records: [],
      }),
      subject: SUBJECT,
      targets: TARGETS,
    });
    expect([...out.planReceipts, ...out.receipts].map((one) => one.request.repoRoot)).toEqual([GONE, GONE]);
  });
});

describe("the live edges", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("binds a checkout's origin as owner/name, and binds nothing where there is no origin", () => {
    const withOrigin = mkdtempSync(join(tmpdir(), "slopweaver-origin-"));
    const without = mkdtempSync(join(tmpdir(), "slopweaver-origin-none-"));
    dirs.push(withOrigin, without);
    gitInTemp({ args: ["init", "--initial-branch=main"], cwd: withOrigin });
    gitInTemp({ args: ["remote", "add", "origin", "git@github.com:acme/widget.git"], cwd: withOrigin });
    gitInTemp({ args: ["init", "--initial-branch=main"], cwd: without });
    expect([
      liveOriginRepositoryField({ repoRoot: withOrigin }),
      liveOriginRepositoryField({ repoRoot: without }),
      liveOriginRepositoryField({ repoRoot: join(without, "gone") }),
    ]).toEqual([{ originRepository: "acme/widget" }, {}, {}]);
  });

  it("reads a gone path as missing, a standing one or a dangling symlink as present", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-pathstate-"));
    dirs.push(dir);
    const file = join(dir, "file");
    writeFileSync(file, "x");
    const dangling = join(dir, "dangling");
    symlinkSync(join(dir, "nowhere"), dangling);
    expect([
      recordedPathState({ path: join(dir, "nope") }),
      recordedPathState({ path: join(file, "under-a-file") }),
      recordedPathState({ path: dir }),
      recordedPathState({ path: dangling }),
    ]).toEqual(["missing", "missing", "present", "present"]);
  });
});
