/**
 * The two judgements that are GitHub's own: how a failure classifies, and what a read has to prove.
 *
 * The failure this guards is the one a reader cannot spot: a staled webhook looks exactly like a deleted
 * one, so a read that stopped early and staled everything it did not reach would be silently, confidently
 * wrong. There is a measured precedent in this repository — `src/corpus/github/orgApi.ts` stops after twenty
 * pages and returns no truncation flag — which is why the proof is a type rather than a convention.
 */
import { describe, expect, it } from "vitest";
import { GithubAtlasErrors } from "../../../../atlas/github/errors.js";
import type { GithubEntity } from "../../../../atlas/github/kindFiles.js";
import { classifyGithubGap, mergeGithubKind, provenCompleteRead } from "../../../../atlas/github/reconcile.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const LATER = "2026-09-06T00:00:00.000Z";

/** One stored secret name, with the id and state a caller wants. */
function secret({ id, state = "observed" }: { id: string; state?: "observed" | "stale" }): GithubEntity {
  return {
    createdAt: null,
    firstSeenAt: AT,
    id,
    name: id,
    providerId: id,
    scopeLevel: "organization",
    scopeRef: "example-org",
    selectedRepositoryIds: [],
    source: {
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "/orgs/example-org/actions/secrets",
      observedAt: AT,
      surface: "rest-live",
    },
    state,
    updatedAt: null,
    visibility: null,
  };
}

describe("provenCompleteRead", () => {
  it("proves a read that ran out of pages with no total to check against", () => {
    const proof = unwrap(
      provenCompleteRead({ kind: "secret-name", observed: 3, pagesExhausted: true, reportedTotal: null }),
    );
    expect(proof.observed).toBe(3);
    expect(proof.proof).toContain("no total for this listing");
  });

  it("proves a read that reached the total GitHub reported", () => {
    const proof = unwrap(
      provenCompleteRead({ kind: "secret-name", observed: 4, pagesExhausted: true, reportedTotal: 4 }),
    );
    expect(proof.proof).toContain("matching the 4");
  });

  it("accepts a read past the total GitHub reported, and says exceeding rather than matching", () => {
    const proof = unwrap(
      provenCompleteRead({ kind: "secret-name", observed: 5, pagesExhausted: true, reportedTotal: 4 }),
    );
    expect(proof.proof).toBe(
      "read 5 secret-name record(s) to the end of paging, exceeding the 4 GitHub reported, consistent with a record created mid-read",
    );
  });

  it("refuses a read that stopped before GitHub ran out of pages", () => {
    const proof = provenCompleteRead({
      kind: "secret-name",
      observed: 100,
      pagesExhausted: false,
      reportedTotal: null,
    });
    expect(proof.isErr()).toBe(true);
    expect(proof._unsafeUnwrapErr()[0]).toContain("must not be staled");
  });

  it("refuses a read that fell short of the total GitHub reported", () => {
    const proof = provenCompleteRead({ kind: "secret-name", observed: 2, pagesExhausted: true, reportedTotal: 9 });
    expect(proof.isErr()).toBe(true);
    expect(proof._unsafeUnwrapErr()[0]).toContain("of the 9");
  });
});

describe("mergeGithubKind", () => {
  it("stales an entity a PROVEN complete read no longer returned", () => {
    const complete = unwrap(
      provenCompleteRead({ kind: "secret-name", observed: 1, pagesExhausted: true, reportedTotal: null }),
    );
    const merged = unwrap(
      mergeGithubKind({
        at: LATER,
        complete,
        observed: [secret({ id: "a" })],
        stored: [secret({ id: "a" }), secret({ id: "b" })],
      }),
    );
    expect(merged.find((entry) => entry.id === "b")!.state).toBe("stale");
  });

  it("stales NOTHING when the read could not be proven complete", () => {
    const merged = unwrap(
      mergeGithubKind({
        at: LATER,
        complete: null,
        observed: [secret({ id: "a" })],
        stored: [secret({ id: "a" }), secret({ id: "b" })],
      }),
    );
    expect(merged.find((entry) => entry.id === "b")!.state).toBe("observed");
  });

  it("preserves the original first-seen stamp, so age survives a re-sync", () => {
    const merged = unwrap(
      mergeGithubKind({ at: LATER, complete: null, observed: [secret({ id: "a" })], stored: [secret({ id: "a" })] }),
    );
    expect(merged[0]!.firstSeenAt).toBe(AT);
  });

  it("stamps a first-seen for an entity this run saw for the first time", () => {
    const merged = unwrap(
      mergeGithubKind({ at: LATER, complete: null, observed: [secret({ id: "new" })], stored: [] }),
    );
    expect(merged[0]!.firstSeenAt).toBe(LATER);
  });

  it("refuses a run that produced the same id twice", () => {
    const merged = mergeGithubKind({
      at: LATER,
      complete: null,
      observed: [secret({ id: "a" }), secret({ id: "a" })],
      stored: [],
    });
    expect(merged.isErr()).toBe(true);
    expect(merged._unsafeUnwrapErr()[1]).toContain("double-count");
  });

  it("leaves an already-stale entity exactly as it was", () => {
    const complete = unwrap(
      provenCompleteRead({ kind: "secret-name", observed: 0, pagesExhausted: true, reportedTotal: null }),
    );
    const merged = unwrap(
      mergeGithubKind({ at: LATER, complete, observed: [], stored: [secret({ id: "b", state: "stale" })] }),
    );
    expect(merged[0]!.state).toBe("stale");
  });
});

describe("classifyGithubGap", () => {
  it("classifies a permission refusal as scope-refused", () => {
    expect(classifyGithubGap({ error: GithubAtlasErrors.scopeRefused({ route: "/x", scope: null }) })).toBe(
      "scope-refused",
    );
  });

  it("classifies a plan gap alongside an absent route, because neither is readable here", () => {
    expect(classifyGithubGap({ error: GithubAtlasErrors.planUnavailable({ feature: "x" }) })).toBe("route-absent");
    expect(classifyGithubGap({ error: GithubAtlasErrors.routeAbsent({ route: "/x" }) })).toBe("route-absent");
  });

  it("classifies an unreadable 200 body as schema drift", () => {
    expect(classifyGithubGap({ error: GithubAtlasErrors.unusableResponse({ reason: "r", route: "/x" }) })).toBe(
      "schema-drift",
    );
  });

  it("classifies a truncated read as incomplete", () => {
    expect(classifyGithubGap({ error: GithubAtlasErrors.incompleteRead({ observed: 1, route: "/x" }) })).toBe(
      "incomplete-read",
    );
  });
});
