/*
 * The ratchet-bump witness predicate (`src/codex/baselineBumpWitness.ts`): one case per rejection, each
 * asserting the rejection list EXACTLY so a row failing for a second, unintended reason fails the case, plus the
 * one row that witnesses.
 */
import { describe, expect, it } from "vitest";

import {
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

/** The pass record behind {@link entry}, with the claim it judged and the bytes it captured. */
function record({
  artifactId = "witness-1",
  statement = CLAIM,
  dirtyBytes = 0,
  pass = "r3",
}: {
  artifactId?: string;
  statement?: string;
  dirtyBytes?: number;
  pass?: "r1" | "r2" | "r3";
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
      diffSha256: "a".repeat(64),
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
    expect(witnessRejections({ claim: CLAIM, entry: entry(), pinnedBases: PINNED, record: record() })).toEqual([]);
  });

  it("rejects a Claude fallback review, which is the implementing brain judging its own bump", () => {
    const fallback = entry({ fallbackGround: "cap", provider: "claude-code" });
    expect(witnessRejections({ claim: CLAIM, entry: fallback, pinnedBases: PINNED, record: record() })).toEqual([
      "not-codex",
    ]);
  });

  it("rejects a plan pass", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ mode: "plan" }), pinnedBases: PINNED, record: record() }),
    ).toEqual(["not-a-review"]);
  });

  it("rejects a clean r1 or r2 review of the exact claim: only the adversarial r3 witnesses a bump", () => {
    const r1 = witnessRejections({
      claim: CLAIM,
      entry: entry({ pass: "r1" }),
      pinnedBases: PINNED,
      record: record({ pass: "r1" }),
    });
    const r2 = witnessRejections({
      claim: CLAIM,
      entry: entry({ pass: "r2" }),
      pinnedBases: PINNED,
      record: record({ pass: "r2" }),
    });
    expect(r1).toEqual(["not-adversarial"]);
    expect(r2).toEqual(["not-adversarial"]);
  });

  it("rejects an r3 ledger row whose backing record says another pass, and the reverse", () => {
    const recordSaysR1 = witnessRejections({
      claim: CLAIM,
      entry: entry(),
      pinnedBases: PINNED,
      record: record({ pass: "r1" }),
    });
    const rowSaysR2 = witnessRejections({
      claim: CLAIM,
      entry: entry({ pass: "r2" }),
      pinnedBases: PINNED,
      record: record(),
    });
    expect(recordSaysR1).toEqual(["not-adversarial"]);
    expect(rowSaysR2).toEqual(["not-adversarial"]);
  });

  it("rejects any verdict but CLEAN", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry({ verdict: "BROKEN" }), pinnedBases: PINNED, record: record() }),
    ).toEqual(["not-clean"]);
  });

  it("rejects a review the head has moved past", () => {
    const stale = entry({ freshness: { kind: "stale", reason: "the tree moved" } });
    expect(witnessRejections({ claim: CLAIM, entry: stale, pinnedBases: PINNED, record: record() })).toEqual([
      "not-current",
    ]);
  });

  it("rejects a review whose freshness cannot be told", () => {
    const unknown = entry({ freshness: { kind: "unknown", reason: "no tree recorded" } });
    expect(witnessRejections({ claim: CLAIM, entry: unknown, pinnedBases: PINNED, record: record() })).toEqual([
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
    expect(witnessRejections({ claim: CLAIM, entry: retired, pinnedBases: PINNED, record: record() })).toEqual([
      "superseded",
    ]);
  });

  it("rejects a row no pass record backs, since its claim and capture cannot be checked", () => {
    expect(witnessRejections({ claim: CLAIM, entry: entry(), pinnedBases: PINNED, record: undefined })).toEqual([
      "record-missing",
    ]);
  });

  it("rejects a review that read uncommitted bytes on top of its HEAD", () => {
    expect(
      witnessRejections({ claim: CLAIM, entry: entry(), pinnedBases: PINNED, record: record({ dirtyBytes: 12 }) }),
    ).toEqual(["dirty-capture"]);
  });

  it("rejects a review whose statement is not the manifest's exact claim, a softened one included", () => {
    const softened = record({ statement: `${CLAIM} (mostly)` });
    expect(witnessRejections({ claim: CLAIM, entry: entry(), pinnedBases: PINNED, record: softened })).toEqual([
      "claim-differs",
    ]);
  });

  it("rejects a review whose base the run could not prove a fixed commit main holds, such as HEAD", () => {
    expect(witnessRejections({ claim: CLAIM, entry: entry(), pinnedBases: new Set(), record: record() })).toEqual([
      "base-unpinned",
    ]);
  });
});

describe("unwitnessedManifests", () => {
  const manifests = [{ manifest: MANIFEST, path: PATH }];

  it("returns nothing when every manifest has its witness", () => {
    expect(
      unwitnessedManifests({ baseSha: BASE, entries: [entry()], manifests, pinnedBases: PINNED, records: [record()] }),
    ).toEqual([]);
  });

  it("returns nothing when no manifest is new", () => {
    expect(
      unwitnessedManifests({ baseSha: BASE, entries: [], manifests: [], pinnedBases: PINNED, records: [] }),
    ).toEqual([]);
  });

  it("names a manifest no review was ever taken for, with the command that takes one", () => {
    expect(unwitnessedManifests({ baseSha: BASE, entries: [], manifests, pinnedBases: PINNED, records: [] })).toEqual([
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
      manifests,
      pinnedBases: PINNED,
      records: [record()],
    });
    expect(found.map((one) => one.candidates)).toEqual([[]]);
  });

  it("lists each candidate with its rejections when none witnesses", () => {
    const fallback = entry({ provider: "claude-code" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [fallback],
      manifests,
      pinnedBases: PINNED,
      records: [record()],
    });
    expect(found.map((one) => one.candidates)).toEqual([[{ artifactId: "witness-1", rejections: ["not-codex"] }]]);
  });

  it("refuses on a CURRENT BROKEN review of the claim even beside a clean witness", () => {
    const broken = entry({ artifactId: "broken-1", verdict: "BROKEN" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), broken],
      manifests,
      pinnedBases: PINNED,
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
      manifests,
      pinnedBases: PINNED,
      records: [record(), record({ artifactId: "broken-1" })],
    });
    expect(found).toEqual([]);
  });

  it("lets a STALE BROKEN review stand aside once a clean witness exists", () => {
    const stale = entry({ artifactId: "broken-1", freshness: { kind: "stale", reason: "moved" }, verdict: "BROKEN" });
    const found = unwitnessedManifests({
      baseSha: BASE,
      entries: [entry(), stale],
      manifests,
      pinnedBases: PINNED,
      records: [record(), record({ artifactId: "broken-1" })],
    });
    expect(found).toEqual([]);
  });
});

describe("unwitnessedDetail", () => {
  it("says no review carries the property id, and prints the command", () => {
    const [unwitnessed] = unwitnessedManifests({
      baseSha: BASE,
      entries: [],
      manifests: [{ manifest: MANIFEST, path: PATH }],
      pinnedBases: PINNED,
      records: [],
    });
    expect(unwitnessedDetail({ unwitnessed: unwitnessed! })).toBe(
      `${PATH} has no Codex witness (no review carries property id ${PROPERTY_ID}); take it with: ${COMMAND}`,
    );
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
});

describe("baselineBumpHoldLine", () => {
  it("says there is no acknowledgement and no hatch, and what to do instead", () => {
    expect(baselineBumpHoldLine()).toBe(
      "baseline-bump-unwitnessed has no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all " +
        "do not reach it. Take the Codex witness review each line names on the pull request's head, then land again.",
    );
  });
});
