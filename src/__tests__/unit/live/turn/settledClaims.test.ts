import { describe, expect, it } from "vitest";

import type { ReviewedClaim, ReviewVerdict } from "../../../../admit/reviewVerdict.js";
import { answerChangeLines, structuralChanges } from "../../../../live/turn/answerChange.js";
import {
  carriedForwardOf,
  carryStarvationBreakage,
  reReadClaimLines,
  reReadHighImpactClaims,
  settledClaimLines,
  settledHighImpactClaims,
  settledLiveHighImpactCount,
} from "../../../../live/turn/reviewRounds.js";

const verdictOf = ({ claims }: { claims: readonly ReviewedClaim[] }): ReviewVerdict => ({
  answerDigest: `sha256:${"a".repeat(64)}`,
  authorSession: "author workspace workspace:1 (id-1)",
  claims,
  outcome: "broken",
  reviewerSession: "reviewer workspace workspace:2 (id-2)",
  schemaVersion: 1,
});

describe("settledHighImpactClaims", () => {
  it("carries a supported high-impact claim the reviewer declared rests on the answer", () => {
    const settled = settledHighImpactClaims({
      verdict: verdictOf({
        claims: [
          {
            evidence: "counted the rows in the answer JSON: body[1].rows has length 7, and the lead says seven",
            impact: "high",
            restsOn: "answer",
            support: "supported",
            text: "the lead's count matches the table it introduces",
          },
        ],
      }),
    });

    expect(settled).toEqual([
      {
        evidence: "counted the rows in the answer JSON: body[1].rows has length 7, and the lead says seven",
        text: "the lead's count matches the table it introduces",
      },
    ]);
  });

  it("never carries a claim that rests on live state, which is the false-present-state failure", () => {
    const settled = settledHighImpactClaims({
      verdict: verdictOf({
        claims: [
          {
            evidence: "queried the metric myself and production is inside its normal band",
            impact: "high",
            restsOn: "live",
            support: "supported",
            text: "production is healthy",
          },
        ],
      }),
    });

    expect(settled).toEqual([]);
  });

  it("never carries a claim whose dependency the reviewer did not declare", () => {
    const settled = settledHighImpactClaims({
      verdict: verdictOf({
        claims: [
          {
            evidence: "checked it",
            impact: "high",
            support: "supported",
            text: "a claim from a reviewer that read an older packet",
          },
        ],
      }),
    });

    expect(settled).toEqual([]);
  });

  it("never carries either standing claim, however the reviewer prefixed it", () => {
    const settled = settledHighImpactClaims({
      verdict: verdictOf({
        claims: [
          {
            evidence: "re-read the thread tail at review time, nobody has replied since",
            impact: "high",
            restsOn: "answer",
            support: "supported",
            text: "STANDING: the thread has not already answered or contradicted this",
          },
          {
            evidence: "the ask names one artifact and the answer hands it back",
            impact: "high",
            restsOn: "answer",
            support: "supported",
            text: "STANDING: the answer delivers every artifact the question asked for",
          },
        ],
      }),
    });

    expect(settled).toEqual([]);
  });

  it("carries the voice claim — a material claim, not a standing one, by ruling", () => {
    // The voice phrase alone removed 123 of the 238 otherwise-eligible claims in the measured window while
    // the filter held the superset pending `canon-contradicts-itself-on-how-many-review-claims`.
    const settled = settledHighImpactClaims({
      verdict: verdictOf({
        claims: [
          {
            evidence: "scanned every rendered string, no em-dashes and the lead opens lowercase",
            impact: "high",
            restsOn: "answer",
            support: "supported",
            text: "the answer obeys every voice rule above",
          },
        ],
      }),
    });

    expect(settled).toEqual([
      {
        evidence: "scanned every rendered string, no em-dashes and the lead opens lowercase",
        text: "the answer obeys every voice rule above",
      },
    ]);
  });

  it("drops a settled claim carrying no evidence rather than carrying a bare assertion", () => {
    const settled = settledHighImpactClaims({
      verdict: verdictOf({
        claims: [{ impact: "high", restsOn: "answer", support: "supported", text: "it is fine" }],
      }),
    });

    expect(settled).toEqual([]);
  });
});

const LIVE_READ = {
  evidence: "JJJJ-646 is In Progress, assigned to the platform lead, no comment since 12 Sep",
  impact: "high",
  readAtIso: "2026-09-15T05:22:08.364Z",
  readCommand: "slopweaver linear read JJJJ-646 --json",
  restsOn: "live",
  support: "supported",
  text: "JJJJ-646 is still in progress",
} as const satisfies ReviewedClaim;

describe("reReadHighImpactClaims", () => {
  it("carries a supported high-impact live claim as the read that settled it", () => {
    const reads = reReadHighImpactClaims({ verdict: verdictOf({ claims: [LIVE_READ] }) });

    expect(reads).toEqual([
      {
        evidence: "JJJJ-646 is In Progress, assigned to the platform lead, no comment since 12 Sep",
        readAtIso: "2026-09-15T05:22:08.364Z",
        readCommand: "slopweaver linear read JJJJ-646 --json",
        text: "JJJJ-646 is still in progress",
      },
    ]);
  });

  it("treats an undeclared restsOn as live, exactly as the verdict type defines it", () => {
    const { restsOn: _declared, ...undeclared } = LIVE_READ;

    const reads = reReadHighImpactClaims({ verdict: verdictOf({ claims: [undeclared] }) });

    expect(reads.map((claim) => claim.readCommand)).toEqual(["slopweaver linear read JJJJ-646 --json"]);
  });

  it("never carries an answer-resting claim as a re-read — that is the settled list's", () => {
    const reads = reReadHighImpactClaims({ verdict: verdictOf({ claims: [{ ...LIVE_READ, restsOn: "answer" }] }) });

    expect(reads).toEqual([]);
  });

  it("drops a live claim whose read was not recorded — a re-read the next round cannot run", () => {
    const { readAtIso: _at, readCommand: _by, ...unread } = LIVE_READ;

    const reads = reReadHighImpactClaims({ verdict: verdictOf({ claims: [unread] }) });

    expect(reads).toEqual([]);
  });

  it("never carries the supersession claim as a re-read, though it always rests on the live thread", () => {
    const reads = reReadHighImpactClaims({
      verdict: verdictOf({
        claims: [
          {
            ...LIVE_READ,
            readCommand: "slopweaver slack read-thread <permalink>",
            text: "STANDING: the thread has not already answered or contradicted this",
          },
        ],
      }),
    });

    expect(reads).toEqual([]);
  });

  it("drops an unsupported, a low-impact and an evidence-less live claim alike", () => {
    const { evidence: _evidence, ...bare } = LIVE_READ;
    const reads = reReadHighImpactClaims({
      verdict: verdictOf({
        claims: [{ ...LIVE_READ, support: "unverifiable" }, { ...LIVE_READ, impact: "low" }, bare],
      }),
    });

    expect(reads).toEqual([]);
  });
});

describe("settledLiveHighImpactCount", () => {
  it("counts every supported high-impact non-standing LIVE claim, read or not, and nothing else", () => {
    const count = settledLiveHighImpactCount({
      verdict: verdictOf({
        claims: [
          LIVE_READ,
          { evidence: "counted", impact: "high", restsOn: "answer", support: "supported", text: "the count matches" },
          {
            evidence: "re-read the tail",
            impact: "high",
            support: "supported",
            text: "the thread has not already answered or contradicted this",
          },
          { impact: "high", support: "unsupported", text: "a missing link" },
          { evidence: "looked", impact: "low", support: "supported", text: "a nit" },
        ],
      }),
    });

    expect(count).toBe(1);
  });
});

describe("carriedForwardOf", () => {
  it("carries no settlement across a round whose reviewer died", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: ["a claim the round before left open"], round: 2 },
      previousVerdict: undefined,
    });

    expect(inherited.round).toBe(3);
    expect(inherited.carriedUnresolved).toEqual(["a claim the round before left open"]);
    expect(inherited.carriedSettled).toEqual([]);
    expect(inherited.carriedReads).toEqual([]);
    expect(inherited.previousSettledLiveCount).toBe(0);
    expect(inherited.settledDigest).toBeUndefined();
  });

  it("hands the next round the previous round's live reads beside its settled claims", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: [], round: 1 },
      previousVerdict: verdictOf({
        claims: [
          LIVE_READ,
          { evidence: "counted", impact: "high", restsOn: "answer", support: "supported", text: "the count matches" },
        ],
      }),
    });

    expect(inherited.carriedReads.map((claim) => claim.text)).toEqual(["JJJJ-646 is still in progress"]);
    expect(inherited.carriedSettled.map((claim) => claim.text)).toEqual(["the count matches"]);
    expect(inherited.previousSettledLiveCount).toBe(1);
  });

  it("binds a settlement to the digest its verdict named, so the answer can be read back exactly", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: [], round: 1 },
      previousVerdict: verdictOf({
        claims: [
          {
            evidence: "read both inline links through the door; each resolves",
            impact: "high",
            restsOn: "answer",
            support: "supported",
            text: "the inline links resolve to the records they name",
          },
        ],
      }),
    });

    expect(inherited.settledDigest).toBe(`sha256:${"a".repeat(64)}`);
    expect(inherited.carriedSettled).toHaveLength(1);
  });
});

describe("structuralChanges", () => {
  it("names the exact path that moved and nothing else", () => {
    const changes = structuralChanges({
      after: { body: [{ rows: 7 }], lead: "seven changes below" },
      before: { body: [{ rows: 7 }], lead: "six changes below" },
    });

    expect(changes).toEqual([{ kind: "changed", path: "/lead" }]);
  });

  it("sees a field it was never taught about, so a new form field cannot become invisible", () => {
    const changes = structuralChanges({
      after: { indexStyle: "plain", lead: "same" },
      before: { lead: "same" },
    });

    expect(changes).toEqual([{ kind: "added", path: "/indexStyle" }]);
  });

  it("marks the whole collection changed when an array's length moves, not just the tail", () => {
    const changes = structuralChanges({ after: { rows: ["a", "b"] }, before: { rows: ["a"] } });

    expect(changes).toEqual([
      { kind: "changed", path: "/rows" },
      { kind: "added", path: "/rows/1" },
    ]);
  });

  it("reports no change when only key order differs", () => {
    const changes = structuralChanges({ after: { a: 1, b: 2 }, before: { b: 2, a: 1 } });

    expect(changes).toEqual([]);
  });
});

describe("answerChangeLines", () => {
  it("says NOT KNOWN rather than nothing when the previous answer cannot be read back", () => {
    expect(answerChangeLines({ changes: undefined }).join("\n")).toContain("NOT KNOWN");
  });

  it("distinguishes that from a genuine no-change", () => {
    expect(answerChangeLines({ changes: [] }).join("\n")).toContain("NOTHING");
  });
});

describe("settledClaimLines", () => {
  const lines = ({ round }: { round: number }) =>
    settledClaimLines({
      carriedSettled: [{ evidence: "counted the rows myself", text: "the lead's count matches the table" }],
      changeLines: answerChangeLines({ changes: [{ kind: "changed", path: "/lead" }] }),
      round,
    }).join("\n");

  it("renders nothing on round 1, which has no previous round to carry", () => {
    expect(lines({ round: 1 })).toBe("");
  });

  it("tells the reviewer the change list proves nothing about live state", () => {
    expect(lines({ round: 2 })).toContain("it proves nothing about");
  });

  it("forbids copying the previous reviewer's evidence as its own", () => {
    expect(lines({ round: 2 })).toContain("copying forges the trail");
  });

  it("says overturning a carried claim is normal, so reuse is not the expected answer", () => {
    expect(lines({ round: 2 })).toContain("is a normal outcome, not an escalation");
  });
});

describe("carryStarvationBreakage", () => {
  const ask = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

  it("writes the row when the last round settled live high-impact claims and this round carries no re-read", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: [], round: 1 },
      previousVerdict: verdictOf({
        claims: [
          { evidence: "read it live", impact: "high", restsOn: "live", support: "supported", text: "prod is healthy" },
          { evidence: "read it live too", impact: "high", support: "supported", text: "the queue is empty" },
        ],
      }),
    });

    const breakage = carryStarvationBreakage({ askIdentity: ask, atIso: "2026-09-15T13:00:00.000Z", inherited });

    expect(breakage).toEqual({
      atIso: "2026-09-15T13:00:00.000Z",
      cause:
        "the previous reviewer settled live claims without recording a `readCommand` and `readAtIso` for any of " +
        "them, so the next round has nothing it can re-run and inherits a blank page",
      didInstead:
        "opened the round with no read to re-run — the previous reviewer wrote `readCommand` and `readAtIso` " +
        "on none of them; the reviewer rediscovers every one of those claims from nothing",
      error: "the previous verdict settled 2 high-impact live claim(s) and round 2 carries none of them as a re-read",
      thread: "C1/1785000000.000100",
      what: "turn review opened round 2 for this ask",
    });
  });

  it("writes nothing when one re-read is carried — the round is not on a blank page", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: [], round: 1 },
      previousVerdict: verdictOf({
        claims: [
          LIVE_READ,
          { evidence: "read it live", impact: "high", restsOn: "live", support: "supported", text: "prod is healthy" },
        ],
      }),
    });

    const breakage = carryStarvationBreakage({ askIdentity: ask, atIso: "2026-09-15T13:00:00.000Z", inherited });

    expect(breakage).toBeUndefined();
  });

  it("writes the row even when a settled ANSWER claim is carried — voice alone is not the pool that starves", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: [], round: 1 },
      previousVerdict: verdictOf({
        claims: [
          { evidence: "read it live", impact: "high", restsOn: "live", support: "supported", text: "prod is healthy" },
          {
            evidence: "scanned",
            impact: "high",
            restsOn: "answer",
            support: "supported",
            text: "the answer obeys every voice rule above",
          },
        ],
      }),
    });

    const breakage = carryStarvationBreakage({ askIdentity: ask, atIso: "2026-09-15T13:00:00.000Z", inherited });

    expect(breakage?.error).toBe(
      "the previous verdict settled 1 high-impact live claim(s) and round 2 carries none of them as a re-read",
    );
  });

  it("writes nothing when the last round settled nothing live", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: ["x"], round: 1 },
      previousVerdict: verdictOf({ claims: [{ impact: "high", support: "unsupported", text: "x" }] }),
    });

    const breakage = carryStarvationBreakage({ askIdentity: ask, atIso: "2026-09-15T13:00:00.000Z", inherited });

    expect(breakage).toBeUndefined();
  });

  it("writes nothing across a round whose reviewer wrote no verdict", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: ["x"], round: 1 },
      previousVerdict: undefined,
    });

    const breakage = carryStarvationBreakage({ askIdentity: ask, atIso: "2026-09-15T13:00:00.000Z", inherited });

    expect(breakage).toBeUndefined();
  });
});

describe("reReadClaimLines", () => {
  const lines = ({ round }: { round: number }) =>
    reReadClaimLines({
      carriedReads: [
        {
          evidence: "JJJJ-646 is In Progress, no comment since 12 Sep",
          readAtIso: "2026-09-15T05:22:08.364Z",
          readCommand: "slopweaver linear read JJJJ-646 --json",
          text: "JJJJ-646 is still in progress",
        },
      ],
      round,
    }).join("\n");

  it("renders nothing on round 1, which has no previous round to carry", () => {
    expect(lines({ round: 1 })).toBe("");
  });

  it("renders nothing when no read was carried, on any round", () => {
    expect(reReadClaimLines({ carriedReads: [], round: 3 })).toStrictEqual([]);
  });

  it("hands the reviewer the claim, the command and the instant, and tells it to run the read NOW", () => {
    const block = lines({ round: 2 });

    expect(block).toContain("## What the last round read live — re-run the read, do not rediscover the claim");
    expect(block).toContain("- **JJJJ-646 is still in progress**");
    expect(block).toContain("  - read at 2026-09-15T05:22:08.364Z by: `slopweaver linear read JJJJ-646 --json`");
    expect(block).toContain("  - the previous reviewer's evidence: JJJJ-646 is In Progress, no comment since 12 Sep");
    expect(block).toContain("run the command yourself, NOW");
  });

  it("says nothing about the read is carried as true, and a moved result is an ordinary overturn", () => {
    expect(lines({ round: 2 })).toContain("Nothing about that read is carried as true");
    expect(lines({ round: 2 })).toContain("A result that has moved is an ordinary overturn, not an escalation");
  });

  it("forbids reusing the previous instant, and says a command it cannot run is not a claim it may skip", () => {
    expect(lines({ round: 2 })).toContain("never the previous instant, which would forge the trail");
    expect(lines({ round: 2 })).toContain("A command\nyou cannot run as written is not a claim you may skip");
  });
});
