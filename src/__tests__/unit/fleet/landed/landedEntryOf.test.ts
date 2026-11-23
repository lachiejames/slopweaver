/*
 * `landedEntryOf` — the whole join of one landed change to its row, the owner's words, the rule it merged under and its
 * proof, and every way the PR ledger misses, said rather than read as no record. It moved here when `fleet landed`'s
 * pure-join tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { landedEntryOf } from "../../../../fleet/landed.js";
import type { PrLedgerHit, PrLedgerRead } from "../../../../outbound/github/prLedgerByNumber.js";
import { FEATURE_BODY, FIX_BODY, formOf } from "../../outbound/github/fixtures.js";
import { HEARD, HELD, rowOf, SHA_A, selfMerged, URL_1843 } from "./harness.js";

const REPO = "lachiejames/slopweaver";

/** The ledger as read, holding one hit for the pull request or none, and how many files would not read. */
function ledgerOf({ hit, unread }: { hit: PrLedgerHit | undefined; unread: number }): PrLedgerRead {
  const hits = new Map<number, PrLedgerHit>();
  if (hit !== undefined) {
    hits.set(1843, hit);
  }
  return {
    hits,
    kind: "read",
    unread: Array.from({ length: unread }, (_, index) => ({ file: `bad-${String(index)}.json`, why: "not JSON" })),
  };
}

describe("landedEntryOf", () => {
  const commit = { mergedIso: "2026-10-05T02:54:54Z", sha: SHA_A, subject: "The sidebar says why (#1843)" };
  const acts = { acts: [selfMerged({ subject: URL_1843 })], kind: "read" } as const;

  it("joins a change to its row, the owner's words, the rule it merged under and its proof", () => {
    const entry = landedEntryOf({
      acts,
      commit,
      ledger: ledgerOf({
        hit: {
          form: { form: formOf({ body: FEATURE_BODY }), kind: "decoded" },
          kind: "one",
          locus: `${REPO}#main...x`,
        },
        unread: 0,
      }),
      repo: REPO,
      row: rowOf({ extra: HELD, slug: "x" }),
      reads: HEARD,
    });
    expect([entry.number, entry.title, entry.url, entry.branch]).toEqual([1843, "The sidebar says why", URL_1843, "x"]);
    expect(entry.row).toEqual({ archived: false, slug: "x" });
    expect([entry.words.kind, entry.under.kind, entry.proof.kind]).toEqual(["asked", "rule", "recorded"]);
  });

  it("keeps the rule but joins nothing when the ledger holds no record of the number", () => {
    const entry = landedEntryOf({
      acts,
      commit,
      ledger: ledgerOf({ hit: undefined, unread: 0 }),
      repo: REPO,
      row: undefined,
      reads: HEARD,
    });
    expect(entry.words).toEqual({ kind: "not-joined", why: "slopweaver's PR ledger holds no record of #1843" });
    expect(entry.under.kind).toBe("rule");
    expect(entry.proof.kind).toBe("unrecorded");
  });

  it("says ledger files would not read, rather than that the ledger holds no record", () => {
    const entry = landedEntryOf({
      acts,
      commit,
      ledger: ledgerOf({ hit: undefined, unread: 2 }),
      repo: REPO,
      row: undefined,
      reads: HEARD,
    });
    expect(entry.words).toEqual({
      kind: "not-joined",
      why: "slopweaver's PR ledger holds no readable record of #1843, and 2 of its files would not read",
    });
  });

  it("says the ledger would not list rather than that it holds no record", () => {
    const ledger: PrLedgerRead = { kind: "unreadable", why: "EACCES: permission denied" };
    const entry = landedEntryOf({ acts, commit, ledger, repo: REPO, row: undefined, reads: HEARD });
    expect(entry.words).toEqual({
      kind: "not-joined",
      why: "slopweaver's PR ledger would not list: EACCES: permission denied",
    });
  });

  it("reads no record when two claim one number", () => {
    const entry = landedEntryOf({
      acts,
      commit,
      ledger: ledgerOf({ hit: { count: 2, kind: "ambiguous" }, unread: 0 }),
      repo: REPO,
      row: undefined,
      reads: HEARD,
    });
    expect(entry.words).toEqual({ kind: "not-joined", why: "2 PR-ledger records claim #1843, so none is read" });
  });

  it("keeps the proof of a record whose locus names no branch", () => {
    const entry = landedEntryOf({
      acts,
      commit,
      ledger: ledgerOf({
        hit: { form: { form: formOf({ body: FIX_BODY }), kind: "decoded" }, kind: "one", locus: `${REPO}#main` },
        unread: 0,
      }),
      repo: REPO,
      row: undefined,
      reads: HEARD,
    });
    expect(entry.words).toEqual({ kind: "not-joined", why: `the ledger locus ${REPO}#main names no branch` });
    expect(entry.proof.kind).toBe("recorded");
  });

  it("names the commit by subject when it names no pull request", () => {
    const entry = landedEntryOf({
      acts,
      commit: { ...commit, subject: "Direct push" },
      ledger: ledgerOf({ hit: undefined, unread: 0 }),
      repo: REPO,
      row: undefined,
      reads: HEARD,
    });
    expect([entry.number, entry.title, entry.url, entry.under.kind]).toEqual([
      undefined,
      "Direct push",
      undefined,
      "none",
    ]);
  });
});
