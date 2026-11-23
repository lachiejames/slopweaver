/**
 * The reader for `fleet landed --json`: every arm the verb writes reads back exactly, and a landing missing a field
 * — rather than carrying it as `null` — refuses the whole reading, since a dropped landing or a quote read as absent
 * would misreport what the owner asked for.
 */
import { describe, expect, it } from "vitest";

import { readLanded } from "../../components/live/readLanded";

/** One landing as the verb writes it: the owner's words, the rule, a recorded proof. */
function asked(): Record<string, unknown> {
  return {
    branch: "what-landed",
    mergedIso: "2026-10-05T02:54:54Z",
    number: 1843,
    proof: {
      after: { evidence: "[image: the tile]", where: "this branch" },
      before: null,
      claims: [{ claim: "It reads.", detail: "yarn vitest run", verdict: "proven" }],
      kind: "recorded",
      problem: "No release history.",
    },
    row: { archived: true, slug: "what-landed" },
    sha: "a".repeat(40),
    title: "The sidebar says why",
    under: {
      actKind: "resolve-own-threads",
      anchor: "transcript:merge-rule",
      classId: "self-merge-own-prs",
      kind: "rule",
      words: "merge my PRs",
    },
    url: "https://github.com/lachiejames/slopweaver/pull/1843",
    words: {
      anchor: "talk-call:7a9be0d5#turn_A",
      atIso: "2026-10-05T03:01:21.246Z",
      cut: "end",
      kind: "asked",
      where: "call",
      words: "what has landed since I last looked",
    },
  };
}

/** One landing joined to nothing, every absent field written as null. */
function unjoined(): Record<string, unknown> {
  return {
    branch: null,
    mergedIso: "2026-10-05T03:29:37Z",
    number: 1838,
    proof: { kind: "unrecorded", why: "no record" },
    row: null,
    sha: "c".repeat(40),
    title: "Lock file maintenance",
    under: { kind: "none" },
    url: "https://github.com/lachiejames/slopweaver/pull/1838",
    words: { kind: "not-joined", why: "no record" },
  };
}

/** A whole report around some landings. */
function report({ landings }: { landings: readonly Record<string, unknown>[] }): Record<string, unknown> {
  return {
    landings,
    ledgerUnread: [],
    limit: 30,
    observedAtIso: "2026-10-05T04:00:00.000Z",
    ref: "origin/main",
    refSha: "d".repeat(40),
    repo: "lachiejames/slopweaver",
  };
}

describe("readLanded", () => {
  it("reads the owner's words, the rule and the proof exactly", () => {
    const read = readLanded(report({ landings: [unjoined(), asked()] }))!;
    expect(read.landings.map((one) => one.number)).toEqual([1838, 1843]);
    expect(read.landings[1]).toEqual({
      mergedIso: "2026-10-05T02:54:54Z",
      number: 1843,
      proof: {
        after: { evidence: "[image: the tile]", where: "this branch" },
        before: undefined,
        claims: [{ claim: "It reads.", detail: "yarn vitest run", verdict: "proven" }],
        kind: "recorded",
        problem: "No release history.",
      },
      row: { archived: true, slug: "what-landed" },
      sha: "a".repeat(40),
      title: "The sidebar says why",
      under: {
        actKind: "resolve-own-threads",
        anchor: "transcript:merge-rule",
        classId: "self-merge-own-prs",
        kind: "rule",
        words: "merge my PRs",
      },
      url: "https://github.com/lachiejames/slopweaver/pull/1843",
      words: {
        anchor: "talk-call:7a9be0d5#turn_A",
        atIso: "2026-10-05T03:01:21.246Z",
        cut: "end",
        kind: "asked",
        where: "call",
        words: "what has landed since I last looked",
      },
    });
  });

  it("reads a null field as the absence the verb wrote", () => {
    const read = readLanded(report({ landings: [unjoined()] }))!;
    expect([read.landings[0].row, read.landings[0].words.kind]).toEqual([undefined, "not-joined"]);
  });

  it("refuses the whole reading when one landing drops a field rather than writing null", () => {
    const { row: _dropped, ...missing } = unjoined();
    expect(readLanded(report({ landings: [asked(), missing] }))).toBe(undefined);
  });

  it("reads a ruling as the owner's words off its record with the session's note beside them, and refuses one without that note", () => {
    const ruling = {
      anchor: "talk-call:7a9be0d5#turn_B",
      atIso: "2026-10-05T01:28:00.000Z",
      cut: "none",
      decidedIso: null,
      kind: "ruling",
      recorded: "go with A",
      where: "call",
      words: "Um, yeah, A.",
    };
    const ruled = { ...asked(), words: ruling };
    expect(readLanded(report({ landings: [ruled] }))!.landings[0].words).toEqual({ ...ruling, decidedIso: undefined });
    const { recorded: _dropped, ...noNote } = ruling;
    expect(readLanded(report({ landings: [{ ...asked(), words: noNote }] }))).toBe(undefined);
  });

  it("refuses a quote whose where is not one the verb writes", () => {
    const bad = asked();
    bad["words"] = { ...(bad["words"] as Record<string, unknown>), where: "slack" };
    expect(readLanded(report({ landings: [bad] }))).toBe(undefined);
  });

  it("refuses a claim verdict it does not know", () => {
    const bad = asked();
    const proof = bad["proof"] as Record<string, unknown>;
    bad["proof"] = { ...proof, claims: [{ claim: "x", detail: "y", verdict: "probably" }] };
    expect(readLanded(report({ landings: [bad] }))).toBe(undefined);
  });

  it("carries every ledger file that would not read, and refuses a report that drops the list", () => {
    const unread = [{ file: "b.json", why: "not JSON" }];
    expect(readLanded({ ...report({ landings: [] }), ledgerUnread: unread })!.ledgerUnread).toEqual(unread);
    const { ledgerUnread: _dropped, ...missing } = report({ landings: [] });
    expect(readLanded(missing)).toBe(undefined);
  });

  it("refuses a payload that is not a report", () => {
    expect(readLanded([])).toBe(undefined);
    expect(readLanded({ ...report({ landings: [] }), limit: "30" })).toBe(undefined);
  });
});
