import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  assemblePrState,
  decodePrStateEntry,
  decodePrStateHeader,
  PR_STATE_VERSION,
  type PrStateEntry,
  prStateRows,
  remoteHasMoved,
} from "../../../../outbound/github/prStateCore.js";

/** One row, defaulted to a settled unchanged pull request so each test states only what it varies. */
const entry = (over: Partial<PrStateEntry> & { number: number }): PrStateEntry => ({
  baseRef: "main",
  headRef: `branch-${String(over.number)}`,
  kind: "pull-request",
  localBranchSha: null,
  observedBaseSha: "base-sha",
  preparation: { kind: "unchanged" },
  remoteHeadSha: `head-${String(over.number)}`,
  ...over,
});

const header = {
  generationId: "2026-09-09T16-00-00-000Z-abcd1234",
  kind: "header",
  recordedAtIso: "2026-09-09T16:00:00.000Z",
  repo: "lachiejames/slopweaver",
  version: PR_STATE_VERSION,
};

describe("decodePrStateHeader", () => {
  it("reads a well-formed header", () => {
    const decoded = decodePrStateHeader({ value: header });

    expect(decoded!.repo).toBe("lachiejames/slopweaver");
    expect(decoded!.generationId).toBe("2026-09-09T16-00-00-000Z-abcd1234");
  });

  it("refuses a version this reader does not know", () => {
    expect(decodePrStateHeader({ value: { ...header, version: 99 } })).toBe(undefined);
  });

  it("refuses a row that is not a header at all", () => {
    expect(decodePrStateHeader({ value: { kind: "pull-request" } })).toBe(undefined);
    expect(decodePrStateHeader({ value: "not even an object" })).toBe(undefined);
  });
});

describe("decodePrStateEntry", () => {
  it("reads a ready row with its prepared commit and ref", () => {
    const decoded = decodePrStateEntry({
      value: entry({ number: 540, preparation: { kind: "ready", preparedRef: "refs/x", preparedSha: "abc" } }),
    });

    expect(decoded!.number).toBe(540);
    expect(decoded!.preparation).toEqual({ kind: "ready", preparedRef: "refs/x", preparedSha: "abc" });
  });

  it("reads a blocked row with the reason it carries", () => {
    const decoded = decodePrStateEntry({
      value: entry({ number: 1, preparation: { kind: "blocked", reason: "why" } }),
    });

    expect(decoded!.preparation).toEqual({ kind: "blocked", reason: "why" });
  });

  it("keeps an explicit null apart from a missing field", () => {
    expect(decodePrStateEntry({ value: entry({ number: 1, observedBaseSha: null }) })!.observedBaseSha).toBe(null);
    const missing: Record<string, unknown> = { ...entry({ number: 1 }) };
    delete missing["observedBaseSha"];
    expect(decodePrStateEntry({ value: missing })).toBe(undefined);
  });

  it("refuses a pull-request number that is not a positive integer", () => {
    expect(decodePrStateEntry({ value: { ...entry({ number: 1 }), number: 0 } })).toBe(undefined);
    expect(decodePrStateEntry({ value: { ...entry({ number: 1 }), number: 1.5 } })).toBe(undefined);
  });

  it("refuses a preparation kind it does not know", () => {
    expect(decodePrStateEntry({ value: entry({ number: 1, preparation: { kind: "maybe" } as never }) })).toBe(
      undefined,
    );
  });
});

describe("assemblePrState", () => {
  it("orders rows by pull-request number whatever order they were written in", () => {
    const assembled = assemblePrState({
      path: "/snap.jsonl",
      repo: "lachiejames/slopweaver",
      rows: [header, entry({ number: 9 }), entry({ number: 2 })],
    });

    expect(unwrap(assembled).entries.map((row) => row.number)).toEqual([2, 9]);
  });

  it("refuses a snapshot that describes another repository", () => {
    const assembled = assemblePrState({
      path: "/snap.jsonl",
      repo: "acme/acme-admin",
      rows: [header, entry({ number: 1 })],
    });

    expect(assembled.isErr()).toBe(true);
    expect(assembled.isErr() ? assembled.error.code : "").toBe("STATE_INVALID");
    expect(assembled.isErr() ? assembled.error.message : "").toContain("describes lachiejames/slopweaver");
  });

  it("REFUSES one unreadable row rather than skipping it, so a partial snapshot cannot be trusted", () => {
    const assembled = assemblePrState({
      path: "/snap.jsonl",
      repo: "lachiejames/slopweaver",
      rows: [header, entry({ number: 1 }), { kind: "pull-request", number: "not a number" }],
    });

    expect(assembled.isErr()).toBe(true);
    expect(assembled.isErr() ? assembled.error.message : "").toContain("not a pull-request row this reads");
  });

  it("refuses two rows for the same pull request", () => {
    const assembled = assemblePrState({
      path: "/snap.jsonl",
      repo: "lachiejames/slopweaver",
      rows: [header, entry({ number: 7 }), entry({ number: 7, headRef: "other" })],
    });

    expect(assembled.isErr()).toBe(true);
    expect(assembled.isErr() ? assembled.error.message : "").toContain("two rows for #7");
  });

  it("refuses a file whose first line is not a header", () => {
    const assembled = assemblePrState({
      path: "/snap.jsonl",
      repo: "lachiejames/slopweaver",
      rows: [entry({ number: 1 })],
    });

    expect(assembled.isErr()).toBe(true);
    expect(assembled.isErr() ? assembled.error.message : "").toContain("first line is not a header");
  });

  it("accepts a header with no entries at all, which is what an operator with no open pull requests has", () => {
    const assembled = assemblePrState({ path: "/snap.jsonl", repo: "lachiejames/slopweaver", rows: [header] });

    expect(unwrap(assembled).entries).toEqual([]);
  });
});

describe("prStateRows", () => {
  it("puts the header first and the entries after it, in number order", () => {
    const rows = prStateRows({
      state: { entries: [entry({ number: 5 }), entry({ number: 3 })], header: { ...header, kind: "header" } },
    });

    expect(rows).toHaveLength(3);
    expect((rows[0] as { kind: string }).kind).toBe("header");
    expect((rows[1] as { number: number }).number).toBe(3);
    expect((rows[2] as { number: number }).number).toBe(5);
  });
});

describe("remoteHasMoved", () => {
  it("is false when the live head is the one the snapshot recorded", () => {
    expect(remoteHasMoved({ entry: entry({ number: 1, remoteHeadSha: "abc" }), liveHeadSha: "abc" })).toBe(false);
  });

  it("is true when someone else pushed to the pull request", () => {
    expect(remoteHasMoved({ entry: entry({ number: 1, remoteHeadSha: "abc" }), liveHeadSha: "def" })).toBe(true);
  });
});
