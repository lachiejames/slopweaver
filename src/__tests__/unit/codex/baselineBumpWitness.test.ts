/*
 * The ratchet-bump witness predicate (`src/codex/baselineBumpWitness.ts`): one case per rejection, each
 * asserting the rejection list EXACTLY so a row failing for a second, unintended reason fails the case, plus the
 * one row that witnesses, and the carry of a STALE witness whose patch and floor are both unchanged.
 */
import { describe, expect, it } from "vitest";

import {
  type BaselineBumpCarryEvidence,
  baselineBumpHoldLine,
  unwitnessedDetail,
  unwitnessedManifests,
  witnessRejections,
} from "../../../codex/baselineBumpWitness.js";
import type { LedgerEntry } from "../../../codex/ledger.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import {
  type BumpManifest,
  type BumpRow,
  digestOf,
  witnessClaim,
  witnessCommand,
  witnessPropertyId,
} from "../../../devLint/baselineBump.js";

/** The main commit every fixture manifest is declared against. */
const DECLARED_BASE = "a".repeat(40);

const ROWS: readonly BumpRow[] = [
  { cause: "growth", entry: "offenders:src/a.ts", file: ".baselines/file-size-baseline.json", from: 300, to: 310 },
];

const MANIFEST: BumpManifest = {
  base: DECLARED_BASE,
  digest: digestOf({ base: DECLARED_BASE, rows: ROWS }),
  loosenings: ROWS,
  reason: "a register grew",
};
const PATH = "ledgers/baseline-bumps/widen.json";
const PROPERTY_ID = witnessPropertyId({ digest: MANIFEST.digest });
const CLAIM = witnessClaim({ manifest: MANIFEST });
const BASE = "ba5e0000";
const COMMAND = witnessCommand({ base: BASE, manifest: MANIFEST });
const HEAD = "cafe1234";
/** The review bases the run proved fixed commits main holds; every fixture record's base is one. */
const PINNED: ReadonlySet<string> = new Set([BASE]);
/** The diff digest every fixture record carries, and the landing patch when a case says the patch is unchanged. */
const REVIEWED_DIFF = "a".repeat(64);
const OTHER_DIFF = "b".repeat(64);
const STALE: LedgerEntry["freshness"] = { kind: "stale", reason: "the committed tree changed after the pass read it" };

/** No carry evidence: a stale row stays stale. */
const JUDGING = { floorHeldBases: new Set<string>(), landingDiffSha256: undefined, pinnedBases: PINNED };
/** The same patch on the same floor. */
const CARRY = { floorHeldBases: new Set([BASE]), landingDiffSha256: REVIEWED_DIFF, pinnedBases: PINNED };
const EVIDENCE: BaselineBumpCarryEvidence = {
  floorHeldBasesByDigest: new Map(),
  landingDiffSha256: undefined,
  pinnedBases: PINNED,
};
const CARRY_EVIDENCE: BaselineBumpCarryEvidence = {
  floorHeldBasesByDigest: new Map([[MANIFEST.digest, new Set([BASE])]]),
  landingDiffSha256: REVIEWED_DIFF,
  pinnedBases: PINNED,
};
/** The same patch, on a floor that moved. */
const MOVED_EVIDENCE: BaselineBumpCarryEvidence = { ...CARRY_EVIDENCE, floorHeldBasesByDigest: new Map() };

/** A Codex review row that witnesses {@link MANIFEST}; a case overrides the one field it is about. */
function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    artifactId: "witness-1",
    capped: false,
    createdAtIso: "2026-11-02T01:00:00.000Z",
    diffSha256: undefined,
    freshness: { kind: "current" },
    mode: "review",
    outcomeContext: undefined,
    pass: "r3",
    propertyId: PROPERTY_ID,
    provider: "codex",
    reviewSummary: undefined,
    superseded: undefined,
    verdict: "CLEAN",
    ...over,
  };
}

/** The pass record behind {@link entry}, with the claim it judged, the bytes it captured and the diff it read. */
function record({
  artifactId = "witness-1",
  statement = CLAIM,
  dirtyBytes = 0,
  pass = "r3",
  diffSha256 = REVIEWED_DIFF,
}: {
  artifactId?: string;
  statement?: string;
  dirtyBytes?: number;
  pass?: "r1" | "r2" | "r3";
  diffSha256?: string;
} = {}): CodexArtifactRecord {
  return {
    artifactId,
    attempts: [],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso: "2026-11-02T01:00:00.000Z",
    observedElapsedMs: 10,
    outcome: {
      answer: { counterexample: "", evidence: "read", propertyId: PROPERTY_ID, summary: "", verdict: "CLEAN" },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    repoRoot: "/w/repo",
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "xhigh",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: {
      baseRef: BASE,
      baseSha: BASE,
      diffBytes: 100,
      diffSha256,
      headSha: HEAD,
      mode: "review",
      pass,
      property: { id: PROPERTY_ID, statement },
    },
    tree: { branch: "feature", dirtyBytes, fingerprint: "d".repeat(64), headSha: HEAD, treeSha: "e".repeat(40) },
  };
}

describe("witnessRejections", () => {
  it("accepts a current, unretired, clean Codex review of the exact claim over a clean capture", () => {
    expect(witnessRejections({ claim: CLAIM, entry: entry(), judging: JUDGING, record: record() })).toEqual([]);
  });

  it("rejects a Claude fallback review, which is the implementing brain judging its own bump", () => {
    const fallback = entry({ fallbackGround: "cap", provider: "claude-code" });
    expect(witnessRejections({ claim: CLAIM, entry: fallback, judging: JUDGING, record: record() })).toEqual([
      "not-codex",
    ]);
  });

  it("rejects a plan pass", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ mode: "plan" }), judging: JUDGING, record: record() }),
    ).toEqual(["not-a-review"]);
  });

  it("rejects a clean r1 or r2 review of the exact claim: only the adversarial r3 witnesses a bump", () => {
    const r1 = witnessRejections({
      claim: CLAIM,
      entry: entry({ pass: "r1" }),
      judging: JUDGING,
      record: record({ pass: "r1" }),
    });
    const r2 = witnessRejections({
      claim: CLAIM,
      entry: entry({ pass: "r2" }),
      judging: JUDGING,
      record: record({ pass: "r2" }),
    });
    expect(r1).toEqual(["not-adversarial"]);
    expect(r2).toEqual(["not-adversarial"]);
  });

  it("rejects an r3 ledger row whose backing record says another pass, and the reverse", () => {
    const recordSaysR1 = witnessRejections({
      claim: CLAIM,
      entry: entry(),
      judging: JUDGING,
      record: record({ pass: "r1" }),
    });
    const rowSaysR2 = witnessRejections({
      claim: CLAIM,
      entry: entry({ pass: "r2" }),
      judging: JUDGING,
      record: record(),
    });
    expect(recordSaysR1).toEqual(["not-adversarial"]);
    expect(rowSaysR2).toEqual(["not-adversarial"]);
  });

  it("rejects any verdict but CLEAN", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ verdict: "BROKEN" }), judging: JUDGING, record: record() }),
    ).toEqual(["not-clean"]);
  });

  it("rejects a review the head has moved past", () => {
    const stale = entry({ freshness: { kind: "stale", reason: "the tree moved" } });
    expect(witnessRejections({ claim: CLAIM, entry: stale, judging: JUDGING, record: record() })).toEqual([
      "not-current",
    ]);
  });

  it("rejects a review whose freshness cannot be told", () => {
    const unknown = entry({ freshness: { kind: "unknown", reason: "no tree recorded" } });
    expect(witnessRejections({ claim: CLAIM, entry: unknown, judging: JUDGING, record: record() })).toEqual([
      "not-current",
    ]);
  });

  it("rejects a retired review", () => {
    const retired = entry({
      superseded: {
        artifactId: "witness-1",
        atIso: "2026-11-02T02:00:00.000Z",
        propertyId: PROPERTY_ID,
        reason: "reworded",
        replacedBy: "witness-2",
      },
    });
    expect(witnessRejections({ claim: CLAIM, entry: retired, judging: JUDGING, record: record() })).toEqual([
      "superseded",
    ]);
  });

  it("rejects a row no pass record backs, since its claim and capture cannot be checked", () => {
    expect(witnessRejections({ claim: CLAIM, entry: entry(), judging: JUDGING, record: undefined })).toEqual([
      "record-missing",
    ]);
  });

  it("rejects a review that read uncommitted bytes on top of its HEAD", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry(), judging: JUDGING, record: record({ dirtyBytes: 12 }) }),
    ).toEqual(["dirty-capture"]);
  });

  it("rejects a review whose statement is not the manifest's exact claim, a softened one included", () => {
    const softened = record({ statement: `${CLAIM} (mostly)` });
    expect(witnessRejections({ claim: CLAIM, entry: entry(), judging: JUDGING, record: softened })).toEqual([
      "claim-differs",
    ]);
  });

  it("rejects a review whose base the run could not prove a fixed commit main holds, such as HEAD", () => {
    const unpinned = { ...JUDGING, pinnedBases: new Set<string>() };
    expect(witnessRejections({ claim: CLAIM, entry: entry(), judging: unpinned, record: record() })).toEqual([
      "base-unpinned",
    ]);
  });
});

describe("witnessRejections carrying a stale witness", () => {
  it("accepts a stale review whose patch is the landing patch on a floor that held", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ freshness: STALE }), judging: CARRY, record: record() }),
    ).toEqual([]);
  });

  it("names a moved floor, and only that, when the patch matches but a file a row names differs", () => {
    const moved = { ...CARRY, floorHeldBases: new Set<string>() };
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ freshness: STALE }), judging: moved, record: record() }),
    ).toEqual(["floor-moved"]);
  });

  it("keeps a stale review stale when the landing patch differs, whatever the floor says", () => {
    const changed = { ...CARRY, landingDiffSha256: OTHER_DIFF };
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ freshness: STALE }), judging: changed, record: record() }),
    ).toEqual(["not-current"]);
  });

  it("never carries a record whose digest is not one: an old record is stale, not grandfathered", () => {
    const malformed = record({ diffSha256: "not-a-digest" });
    const carried = witnessRejections({
      claim: CLAIM,
      entry: entry({ freshness: STALE }),
      judging: CARRY,
      record: malformed,
    });
    expect(carried).toEqual(["not-current"]);
  });

  it("never carries a record written with no diff digest at all", () => {
    const legacy = { ...record(), scope: { ...record().scope } };
    expect(Reflect.deleteProperty(legacy.scope, "diffSha256")).toBe(true);
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ freshness: STALE }), judging: CARRY, record: legacy }),
    ).toEqual(["not-current"]);
  });

  it("never carries a row whose freshness cannot be told", () => {
    const unknown = entry({ freshness: { kind: "unknown", reason: "no tree recorded" } });
    expect(witnessRejections({ claim: CLAIM, entry: unknown, judging: CARRY, record: record() })).toEqual([
      "not-current",
    ]);
  });

  it("never carries an unpinned base, and asks nothing of its floor", () => {
    const unpinned = { ...CARRY, pinnedBases: new Set<string>() };
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ freshness: STALE }), judging: unpinned, record: record() }),
    ).toEqual(["not-current", "base-unpinned"]);
  });

  it("never carries a row no record backs", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ freshness: STALE }), judging: CARRY, record: undefined }),
    ).toEqual(["not-current", "record-missing"]);
  });

  it("leaves a current row current whatever the carry evidence says", () => {
    const changed = { floorHeldBases: new Set<string>(), landingDiffSha256: OTHER_DIFF, pinnedBases: PINNED };
    expect(witnessRejections({ claim: CLAIM, entry: entry(), judging: changed, record: record() })).toEqual([]);
  });
});

describe("unwitnessedManifests", () => {
  const manifests = [{ manifest: MANIFEST, path: PATH }];

  it("returns nothing when every manifest has its witness", () => {
    expect(
      unwitnessedManifests({ baseSha: BASE, entries: [entry()], evidence: EVIDENCE, manifests, records: [record()] }),
    ).toEqual([]);
  });

  it("returns nothing when no manifest is new", () => {
    expect(
      unwitnessedManifests({ baseSha: BASE, entries: [], evidence: EVIDENCE, manifests: [], records: [] }),
    ).toEqual([]);
  });

  it("names a manifest no review was ever taken for, with the command that takes one", () => {
    expect(unwitnessedManifests({ baseSha: BASE, entries: [], evidence: EVIDENCE, manifests, records: [] })).toEqual([
      {
        candidates: [],
        command: COMMAND,
        contradictedBy: [],
        digest: MANIFEST.digest,
        path: PATH,
        propertyId: PROPERTY_ID,
      },
    ]);
  });

  it("ignores a clean review carrying a different property id", () => {
    const elsewhere = entry({ propertyId: "r3-01" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [elsewhere],
      evidence: EVIDENCE,
      manifests,
      records: [record()],
    });
    expect(found.map((one) => one.candidates)).toEqual([[]]);
  });

  it("lists each candidate with its rejections when none witnesses", () => {
    const fallback = entry({ provider: "claude-code" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [fallback],
      evidence: EVIDENCE,
      manifests,
      records: [record()],
    });
    expect(found.map((one) => one.candidates)).toEqual([[{ artifactId: "witness-1", rejections: ["not-codex"] }]]);
  });

  it("refuses on a CURRENT BROKEN review of the claim even beside a clean witness", () => {
    const broken = entry({ artifactId: "broken-1", verdict: "BROKEN" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), broken],
      evidence: EVIDENCE,
      manifests,
      records: [record(), record({ artifactId: "broken-1" })],
    });
    expect(found.map((one) => one.contradictedBy)).toEqual([["broken-1"]]);
  });

  it("lets a RETIRED BROKEN review stand aside once a clean witness exists", () => {
    const retired = entry({
      artifactId: "broken-1",
      superseded: {
        artifactId: "broken-1",
        atIso: "2026-11-02T02:00:00.000Z",
        propertyId: PROPERTY_ID,
        reason: "reworded",
        replacedBy: "witness-1",
      },
      verdict: "BROKEN",
    });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), retired],
      evidence: EVIDENCE,
      manifests,
      records: [record(), record({ artifactId: "broken-1" })],
    });
    expect(found).toEqual([]);
  });

  it("lets a STALE BROKEN review stand aside once a clean witness exists", () => {
    const stale = entry({ artifactId: "broken-1", freshness: { kind: "stale", reason: "moved" }, verdict: "BROKEN" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), stale],
      evidence: EVIDENCE,
      manifests,
      records: [record(), record({ artifactId: "broken-1" })],
    });
    expect(found).toEqual([]);
  });
});

describe("unwitnessedManifests carrying a stale review", () => {
  const manifests = [{ manifest: MANIFEST, path: PATH }];
  const brokenRecord = record({ artifactId: "broken-1" });

  it("clears a manifest whose only witness is stale with its patch and floor unchanged", () => {
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry({ freshness: STALE })],
      evidence: CARRY_EVIDENCE,
      manifests,
      records: [record()],
    });
    expect(found).toEqual([]);
  });

  it("holds a manifest the evidence has no floor row for, naming the moved floor", () => {
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry({ freshness: STALE })],
      evidence: MOVED_EVIDENCE,
      manifests,
      records: [record()],
    });
    expect(found.map((one) => one.candidates)).toEqual([[{ artifactId: "witness-1", rejections: ["floor-moved"] }]]);
  });

  it("keeps refusing on a stale BROKEN review over the same patch on the same floor", () => {
    const broken = entry({ artifactId: "broken-1", freshness: STALE, verdict: "BROKEN" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), broken],
      evidence: CARRY_EVIDENCE,
      manifests,
      records: [record(), brokenRecord],
    });
    expect(found.map((one) => one.contradictedBy)).toEqual([["broken-1"]]);
  });

  it("lets a stale BROKEN review over the same patch stand aside once its floor moved", () => {
    const broken = entry({ artifactId: "broken-1", freshness: STALE, verdict: "BROKEN" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), broken],
      evidence: MOVED_EVIDENCE,
      manifests,
      records: [record(), brokenRecord],
    });
    expect(found).toEqual([]);
  });

  it("lets a retired stale BROKEN review over the same patch and floor stand aside", () => {
    const retired = entry({
      artifactId: "broken-1",
      freshness: STALE,
      superseded: {
        artifactId: "broken-1",
        atIso: "2026-11-02T02:00:00.000Z",
        propertyId: PROPERTY_ID,
        reason: "reworded",
        replacedBy: "witness-1",
      },
      verdict: "BROKEN",
    });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), retired],
      evidence: CARRY_EVIDENCE,
      manifests,
      records: [record(), brokenRecord],
    });
    expect(found).toEqual([]);
  });
});

describe("unwitnessedDetail", () => {
  it("says no review carries the property id, and prints the command", () => {
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [],
      evidence: EVIDENCE,
      manifests: [{ manifest: MANIFEST, path: PATH }],
      records: [],
    });
    expect(found.map((unwitnessed) => unwitnessedDetail({ unwitnessed }))).toEqual([
      `${PATH} has no Codex witness (no review carries property id ${PROPERTY_ID}); take it with: ${COMMAND}`,
    ]);
  });

  it("names the contradicting review and every rejected candidate's reasons", () => {
    const detail = unwitnessedDetail({
      unwitnessed: {
        candidates: [{ artifactId: "broken-1", rejections: ["not-clean", "dirty-capture"] }],
        command: COMMAND,
        contradictedBy: ["broken-1"],
        digest: MANIFEST.digest,
        path: PATH,
        propertyId: PROPERTY_ID,
      },
    });
    expect(detail).toBe(
      `${PATH} has no Codex witness (review broken-1 is CURRENT and BROKEN under this manifest's property id; broken-1: its verdict ` +
        `is not CLEAN, it read uncommitted bytes on top of its HEAD); take it with: ${COMMAND}`,
    );
  });

  it("says a carried patch met a moved floor", () => {
    const detail = unwitnessedDetail({
      unwitnessed: {
        candidates: [{ artifactId: "witness-1", rejections: ["floor-moved"] }],
        command: COMMAND,
        contradictedBy: [],
        digest: MANIFEST.digest,
        path: PATH,
        propertyId: PROPERTY_ID,
      },
    });
    expect(detail).toBe(
      `${PATH} has no Codex witness (witness-1: its reviewed patch matches the landing patch, but a file this ` +
        `manifest's rows name differs at the landing base or could not be read); take it with: ${COMMAND}`,
    );
  });
});

describe("baselineBumpHoldLine", () => {
  it("says there is no acknowledgement and no hatch, and what to do instead", () => {
    expect(baselineBumpHoldLine()).toBe(
      "baseline-bump-unwitnessed has no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all " +
        "do not reach it. Take the Codex witness review each line names on the pull request's head, then land again.",
    );
  });
});
