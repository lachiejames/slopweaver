/**
 * `freshnessOf`: whether a pass still describes the tree being judged — current, stale with the reason it
 * moved, or unknown when provenance cannot be read — and how a review whose diff did not move is carried
 * across a rebase.
 */
import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { freshnessOf, ledgerForBranch, loopFailures, type PassFreshness } from "../../../../codex/ledger.js";
import { renderLedger } from "../../../../codex/ledgerRender.js";
import type { CodexArtifactRecord } from "../../../../codex/types.js";
import { anyPassRecord, HEAD, OTHER_HEAD, planRecord, REPO, treeOn } from "./fixtures.js";

/**
 * A stale freshness's own reason, unwrapped by a throwing accessor rather than a conditional.
 *
 * `.claude/rules/testing.md` bans `?:` inside an assertion because a ternary silently yields the fallback for
 * every other shape, so the test passes on exactly the input it was written to catch. Throwing here fails the
 * test loudly instead, which is the non-null-assertion shape the rule points at.
 */
function staleReason({ freshness }: { freshness: PassFreshness }): string {
  if (freshness.kind !== "stale") {
    throw new Error(`expected a stale freshness, got ${freshness.kind}`);
  }
  return freshness.reason;
}

describe("freshnessOf", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });

  it("is current when the tree has not moved", () => {
    const record = planRecord({ pass: "p1", tree: treeOn({ branch: "b", headSha: HEAD, patch: "" }) });

    expect(freshnessOf({ now, record }).kind).toBe("current");
  });

  // The PR6 failure exactly: an hour of edits with no commit, which a HEAD comparison would call current.
  it("is stale when the working tree changed under an unchanged HEAD", () => {
    const record = planRecord({ pass: "p3", tree: treeOn({ branch: "b", headSha: HEAD, patch: "old" }) });
    const edited = treeFingerprint({ dirtyPatch: "new edits", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });

    const freshness = freshnessOf({ now: edited, record });

    // `kind` first, then the narrowed field: a ternary here would silently pass on a `current` result, which
    // is the shape `.claude/rules/testing.md` bans. Caught by a Codex review of this file's fixtures.
    expect(freshness.kind).toBe("stale");
    expect(staleReason({ freshness })).toBe("the working tree changed after the pass read it");
  });

  // The shape: a pass read uncommitted bytes, and the tree judged is the clean commit
  // a landing judges. "The working tree changed" is false there; the commit simply never carried them.
  it("names the uncommitted bytes a pass read when the tree being judged carries none", () => {
    const record = planRecord({ pass: "p3", tree: treeOn({ branch: "b", headSha: HEAD, patch: "old" }) });

    const freshness = freshnessOf({ now, record });

    expect(freshness.kind).toBe("stale");
    expect(staleReason({ freshness })).toBe(
      "the pass read 3 byte(s) of uncommitted change on top of HEAD 06e12d9aa1b2, and the tree being judged " +
        "carries none of it",
    );
  });

  it("names a commit that changed the files", () => {
    const record = planRecord({ pass: "p1", tree: treeOn({ branch: "b", headSha: OTHER_HEAD, patch: "" }) });

    const freshness = freshnessOf({ now, record });

    expect(freshness.kind).toBe("stale");
    expect(staleReason({ freshness })).toBe(
      "the committed tree changed after the pass read it (HEAD now 06e12d9aa1b2)",
    );
  });

  /**
   * "We cannot tell" must never be reported as "we checked and it is fine", NOR as "we checked and it moved".
   * A gate folding unknown into stale would reject every artifact predating this feature while claiming to
   * have detected drift.
   */
  it("is unknown, not stale, when the pass recorded no tree", () => {
    expect(freshnessOf({ now, record: planRecord({ pass: "p1", tree: undefined }) }).kind).toBe("unknown");
  });

  it("is unknown, not stale, for a record predating content-addressed provenance", () => {
    const withTree = treeOn({ branch: "b", headSha: HEAD, patch: "" });
    const { treeSha: _dropped, ...legacy } = withTree;
    const record = planRecord({ pass: "p1", tree: legacy });

    expect(freshnessOf({ now, record }).kind).toBe("unknown");
  });

  /**
   * `scanPassRecords` shallow-decodes disk JSON, so a record with no digest parses fine and would compare
   * unequal — printing STALE, which asserts drift nobody measured. Harmless while STALE only meant "do not
   * cite this"; the plan floor made STALE a positive REQUIREMENT. Found by a Codex review of that gate.
   */
  it("is unknown when the record carries no tree digest, rather than reporting drift it never measured", () => {
    const withTree = treeOn({ branch: "b", headSha: HEAD, patch: "" });
    const { fingerprint: _dropped, ...noDigest } = withTree;
    const record = { ...planRecord({ pass: "p1", tree: withTree }), tree: noDigest } as unknown as CodexArtifactRecord;

    expect(freshnessOf({ now, record }).kind).toBe("unknown");
  });

  /** `treeSha: null` is accepted by the decoder and is not `undefined`, so the old `=== undefined` test missed it. */
  it("is unknown when the recorded tree sha is null rather than absent", () => {
    const withTree = treeOn({ branch: "b", headSha: HEAD, patch: "" });
    const record = {
      ...planRecord({ pass: "p1", tree: withTree }),
      tree: { ...withTree, treeSha: null },
    } as unknown as CodexArtifactRecord;

    expect(freshnessOf({ now, record }).kind).toBe("unknown");
  });

  it("is unknown when the recorded digest is an empty string, which can never equal a real one", () => {
    const withTree = treeOn({ branch: "b", headSha: HEAD, patch: "" });
    const record = {
      ...planRecord({ pass: "p1", tree: withTree }),
      tree: { ...withTree, fingerprint: "" },
    } as unknown as CodexArtifactRecord;

    expect(freshnessOf({ now, record }).kind).toBe("unknown");
  });

  it("is unknown when the current tree cannot be read", () => {
    const record = planRecord({ pass: "p1", tree: treeOn({ branch: "b", headSha: HEAD, patch: "" }) });

    expect(freshnessOf({ now: undefined, record }).kind).toBe("unknown");
  });
});

/**
 * The duplicate-pass gate keys a review on its diff and refuses to re-run one after a conflict-free rebase;
 * the floor used to key the same review on the tree and call it STALE, so neither path let the branch land
 * A review is carried across the rebase exactly when its diff did not move.
 */
describe("freshnessOf and a review whose diff did not move", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
  const beforeRebase = treeOn({ branch: "feature", headSha: OTHER_HEAD, patch: "" });
  const REVIEWED = "d".repeat(64);

  it("is current, and says why, when the tree moved and the diff it judged is byte-identical", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    const freshness = freshnessOf({ diffsNow: new Map([["origin/main", REVIEWED]]), now, record });

    expect(freshness).toEqual({
      kind: "current",
      reason:
        "the committed tree changed after the pass read it (HEAD now 06e12d9aa1b2), " +
        "but the diff it judged against origin/main is byte-identical",
    });
  });

  it("stays stale when the diff moved", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    const freshness = freshnessOf({ diffsNow: new Map([["origin/main", "e".repeat(64)]]), now, record });

    expect(staleReason({ freshness })).toBe(
      "the committed tree changed after the pass read it (HEAD now 06e12d9aa1b2)",
    );
  });

  it("stays stale when no diff was taken against the record's own base ref", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    expect(freshnessOf({ diffsNow: new Map([["origin/dev", REVIEWED]]), now, record }).kind).toBe("stale");
    expect(freshnessOf({ now, record }).kind).toBe("stale");
  });

  /** A plan has no diff, and its floor REQUIRES stale — lifting one would break the order proof. */
  it("never lifts a plan", () => {
    const record = anyPassRecord({ pass: "p2", tree: beforeRebase });

    expect(freshnessOf({ diffsNow: new Map([["origin/main", REVIEWED]]), now, record }).kind).toBe("stale");
  });

  it("leaves unknown as unknown — there is no measured drift to carry across", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    expect(freshnessOf({ diffsNow: new Map([["origin/main", REVIEWED]]), now: undefined, record }).kind).toBe(
      "unknown",
    );
  });

  it("carries no reason on a review whose tree never moved", () => {
    const record = anyPassRecord({ pass: "r1", tree: treeOn({ branch: "feature", headSha: HEAD, patch: "" }) });

    expect(freshnessOf({ diffsNow: new Map([["origin/main", REVIEWED]]), now, record })).toEqual({ kind: "current" });
  });

  it("lets a rebased branch satisfy the review floor, and still reports a carried BROKEN", () => {
    const plan = anyPassRecord({ artifactId: "plan", pass: "p2", tree: beforeRebase });
    const clean = anyPassRecord({ artifactId: "clean", pass: "r1", tree: beforeRebase });
    const broken = anyPassRecord({ artifactId: "broken", pass: "r2", tree: beforeRebase, verdict: "BROKEN" });
    const diffsNow = new Map([["origin/main", REVIEWED]]);
    const build = ({ records, diffs }: { records: CodexArtifactRecord[]; diffs?: Map<string, string> }) =>
      ledgerForBranch({
        branch: "feature",
        now,
        records,
        repoRoot: REPO,
        ...(diffs === undefined ? {} : { diffsNow: diffs }),
      }).entries;

    expect(loopFailures({ entries: build({ diffs: diffsNow, records: [plan, clean] }) })).toEqual([]);
    expect(loopFailures({ entries: build({ records: [plan, clean] }) })).toHaveLength(1);
    expect(loopFailures({ entries: build({ diffs: diffsNow, records: [plan, clean, broken] }) })).toEqual([
      "r2 is CURRENT and BROKEN (r2-01) — fix it, then take the second and last review pass over the fixed diff",
    ]);
  });

  it("prints the carried reason on the row", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });
    const { entries } = ledgerForBranch({
      branch: "feature",
      diffsNow: new Map([["origin/main", REVIEWED]]),
      now,
      records: [record],
      repoRoot: REPO,
    });

    const lines = renderLedger({
      branch: "feature",
      entries,
      headSha: HEAD,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
      withoutSidecar: 0,
    });

    expect(lines).toContain(
      "  r1  CURRENT   CLEAN  r1-01  (the committed tree changed after the pass read it (HEAD now 06e12d9aa1b2), " +
        "but the diff it judged against origin/main is byte-identical)",
    );
  });
});

/**
 * A review taken against a PINNED base commit re-diffs, after a rebase, against that old commit and folds in
 * everything main gained since, so its own base ref never matches. The diff the pull request presents against
 * its current base is what carries it (`src/codex/diffCarry.ts`).
 */
describe("freshnessOf and the pull request's current base", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
  const beforeRebase = treeOn({ branch: "feature", headSha: OTHER_HEAD, patch: "" });
  const REVIEWED = "d".repeat(64);
  const NEW_BASE = "1234567890ab".padEnd(40, "c");
  const STALE = "the committed tree changed after the pass read it (HEAD now 06e12d9aa1b2)";
  /** The record's own base ref re-diffs to something else — main's intervening commits folded in. */
  const pinnedMiss = new Map([["origin/main", "e".repeat(64)]]);

  it("is current, naming the base, when the landing-base diff is byte-identical and the own-base one is not", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    const freshness = freshnessOf({
      diffsNow: pinnedMiss,
      landingBaseDiff: { baseSha: NEW_BASE, sha256: REVIEWED },
      now,
      record,
    });

    expect(freshness).toEqual({
      kind: "current",
      reason: `${STALE}, but the diff it judged is byte-identical against the pull request's current base 1234567890ab`,
    });
  });

  it("stays stale when the landing-base diff moved too — a changed patch is never carried", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    const freshness = freshnessOf({
      diffsNow: pinnedMiss,
      landingBaseDiff: { baseSha: NEW_BASE, sha256: "f".repeat(64) },
      now,
      record,
    });

    expect(staleReason({ freshness })).toBe(STALE);
  });

  it("stays stale with no landing-base diff, exactly as before", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    expect(staleReason({ freshness: freshnessOf({ diffsNow: pinnedMiss, now, record }) })).toBe(STALE);
  });

  it("never lifts a plan through the landing-base diff", () => {
    const record = anyPassRecord({ pass: "p2", tree: beforeRebase });

    const freshness = freshnessOf({ landingBaseDiff: { baseSha: NEW_BASE, sha256: REVIEWED }, now, record });

    expect(staleReason({ freshness })).toBe(STALE);
  });

  it("keeps the own-base reason when both diffs match", () => {
    const record = anyPassRecord({ pass: "r1", tree: beforeRebase });

    const freshness = freshnessOf({
      diffsNow: new Map([["origin/main", REVIEWED]]),
      landingBaseDiff: { baseSha: NEW_BASE, sha256: REVIEWED },
      now,
      record,
    });

    expect(freshness).toEqual({
      kind: "current",
      reason: `${STALE}, but the diff it judged against origin/main is byte-identical`,
    });
  });

  it("never lifts a recorded digest that is not one, even when the landing-base value equals it", () => {
    const review = anyPassRecord({ pass: "r1", tree: beforeRebase });
    const scope = review.scope.mode === "review" ? review.scope : undefined;
    const record: CodexArtifactRecord = { ...review, scope: { ...scope!, diffSha256: "not-a-digest" } };

    const freshness = freshnessOf({ landingBaseDiff: { baseSha: NEW_BASE, sha256: "not-a-digest" }, now, record });

    expect(staleReason({ freshness })).toBe(STALE);
  });

  it("lets a pinned review satisfy the floor through ledgerForBranch", () => {
    const plan = anyPassRecord({ artifactId: "plan", pass: "p2", tree: beforeRebase });
    const clean = anyPassRecord({ artifactId: "clean", pass: "r1", tree: beforeRebase });
    const build = ({ landing }: { landing?: { baseSha: string; sha256: string } }) =>
      ledgerForBranch({
        branch: "feature",
        diffsNow: pinnedMiss,
        now,
        records: [plan, clean],
        repoRoot: REPO,
        ...(landing === undefined ? {} : { landingBaseDiff: landing }),
      }).entries;

    expect(loopFailures({ entries: build({ landing: { baseSha: NEW_BASE, sha256: REVIEWED } }) })).toEqual([]);
    expect(loopFailures({ entries: build({}) })).toHaveLength(1);
  });
});
