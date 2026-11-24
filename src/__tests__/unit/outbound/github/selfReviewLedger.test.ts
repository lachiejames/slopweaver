import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  confirmSelfReviewRound,
  pendingSelfReviewReservations,
  readSelfReviewReservation,
  readSelfReviewRound,
  releaseSelfReviewReservation,
  reserveSelfReviewRound,
  selfReviewFormHash,
  selfReviewLocus,
} from "../../../../outbound/github/selfReviewLedger.js";
import { parseSelfReviewRound } from "../../../../outbound/github/selfReviewRound.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "self-review-ledger-"));
  fixtureDirs.push(dir);
  return dir;
}

const FORM = {
  comments: [{ body: "This is the reviewer walkthrough.", kind: "explanation", line: 9, path: "src/a.ts" }],
} as const;

describe("self-review ledger", () => {
  it("carries only confirmed prior thread ids into the next exclusive reservation", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 7, owner: "Owner", repo: "Repo" });
    const formHash = selfReviewFormHash({ form: FORM });
    expect(locus).toBe("owner/repo#7");
    expect(
      reserveSelfReviewRound({
        home,
        intent: { formHash, headSha: "one", locus, reservedIso: "t1" },
        pullRequestId: "PR7",
      }),
    ).toEqual({ kind: "fresh", previous: { kind: "absent" } });
    const record = {
      confirmedIso: "t2",
      formHash,
      headSha: "one",
      locus,
      pullRequestId: "PR7",
      threadIds: ["T1", "T2"],
    };
    expect(confirmSelfReviewRound({ home, record })).toEqual({ kind: "confirmed" });
    expect(unwrap(readSelfReviewRound({ home, locus, pullRequestId: "PR7" }))).toEqual({ kind: "owned", record });
    expect(
      reserveSelfReviewRound({
        home,
        intent: { formHash: "next", headSha: "two", locus, reservedIso: "t3" },
        pullRequestId: "PR7",
      }),
    ).toEqual({ kind: "fresh", previous: { kind: "owned", record } });
  });

  it("sets aside a round another pull request confirmed at the same address, under the lock too", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 4, owner: "o", repo: "r" });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "h", locus, reservedIso: "t0" },
      pullRequestId: "ARCHIVED_PR4",
    });
    confirmSelfReviewRound({
      home,
      record: {
        confirmedIso: "t1",
        formHash: "f",
        headSha: "h",
        locus,
        pullRequestId: "ARCHIVED_PR4",
        threadIds: ["T1"],
      },
    });
    const setAside = { confirmedIso: "t1", kind: "set-aside", locus };
    expect(unwrap(readSelfReviewRound({ home, locus, pullRequestId: "NEW_PR4" }))).toEqual(setAside);
    expect(
      reserveSelfReviewRound({
        home,
        intent: { formHash: "g", headSha: "h2", locus, reservedIso: "t2" },
        pullRequestId: "NEW_PR4",
      }),
    ).toEqual({ kind: "fresh", previous: setAside });
    const losing = { formHash: "k", headSha: "h3", locus, reservedIso: "t3" };
    expect(reserveSelfReviewRound({ home, intent: losing, pullRequestId: "NEW_PR4" })).toEqual({
      kind: "taken",
      pending: { formHash: "g", headSha: "h2", locus, reservedIso: "t2" },
      previous: setAside,
    });
  });

  it("sets aside a round written before rounds named their pull request, granting none of its threads", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 5, owner: "o", repo: "r" });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "h", locus, reservedIso: "t0" },
      pullRequestId: "PR5",
    });
    confirmSelfReviewRound({
      home,
      record: { confirmedIso: "t1", formHash: "f", headSha: "h", locus, pullRequestId: "PR5", threadIds: ["T1"] },
    });
    const ledger = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    const roundFile = join(
      ledger,
      readdirSync(ledger).find((name) => name.endsWith(".json"))!,
    );
    writeFileSync(
      roundFile,
      JSON.stringify({ confirmedIso: "t1", formHash: "f", headSha: "h", locus, threadIds: ["T1"] }),
    );
    expect(unwrap(readSelfReviewRound({ home, locus, pullRequestId: "PR5" }))).toEqual({
      confirmedIso: "t1",
      kind: "set-aside",
      locus,
    });
  });

  it("decodes a round with no pull request id as unbound, and refuses an empty one as corrupt", () => {
    const base = { confirmedIso: "t", formHash: "f", headSha: "h", locus: "o/r#1", threadIds: ["T1"] };
    expect(parseSelfReviewRound({ raw: JSON.stringify(base) })).toEqual(base);
    expect(parseSelfReviewRound({ raw: JSON.stringify({ ...base, pullRequestId: "" }) })).toBe(undefined);
    expect(parseSelfReviewRound({ raw: JSON.stringify({ ...base, pullRequestId: 7 }) })).toBe(undefined);
  });

  it("keeps a second caller out while an outcome is unresolved", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 8, owner: "o", repo: "r" });
    const intent = { formHash: "f", headSha: "h", locus, reservedIso: "now" };
    expect(reserveSelfReviewRound({ home, intent, pullRequestId: "PR" })).toEqual({
      kind: "fresh",
      previous: { kind: "absent" },
    });
    expect(reserveSelfReviewRound({ home, intent, pullRequestId: "PR" })).toEqual({
      kind: "taken",
      pending: intent,
      previous: { kind: "absent" },
    });
  });

  it("releases a held reservation so a fresh one can be taken, and reports nothing held once gone", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 9, owner: "o", repo: "r" });
    const intent = { formHash: "f", headSha: "h", locus, reservedIso: "t1" };
    expect(reserveSelfReviewRound({ home, intent, pullRequestId: "PR" })).toEqual({
      kind: "fresh",
      previous: { kind: "absent" },
    });
    expect(reserveSelfReviewRound({ home, intent, pullRequestId: "PR" })).toEqual({
      kind: "taken",
      pending: intent,
      previous: { kind: "absent" },
    });
    expect(releaseSelfReviewReservation({ home, locus })).toEqual(intent);
    expect(unwrap(readSelfReviewReservation({ home, locus }))).toBeNull();
    expect(reserveSelfReviewRound({ home, intent, pullRequestId: "PR" })).toEqual({
      kind: "fresh",
      previous: { kind: "absent" },
    });
  });

  it("refuses a round record that is there but corrupt before it takes any reservation", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 11, owner: "o", repo: "r" });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "h", locus, reservedIso: "t0" },
      pullRequestId: "PR",
    });
    expect(
      confirmSelfReviewRound({
        home,
        record: { confirmedIso: "t0", formHash: "f", headSha: "h", locus, pullRequestId: "PR", threadIds: ["T1"] },
      }),
    ).toEqual({ kind: "confirmed" });
    const ledger = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    const roundFile = readdirSync(ledger).find((name) => name.endsWith(".json"))!;
    writeFileSync(join(ledger, roundFile), "{");
    const read = unwrapErr(readSelfReviewRound({ home, locus, pullRequestId: "PR" }));
    expect(read[0]).toContain(`the self-review round record for ${locus} at `);
    expect(read[0]).toContain("is there but cannot be trusted (it is not a confirmed round for this pull request)");
    const intent = { formHash: "f", headSha: "h2", locus, reservedIso: "t1" };
    // A ledger nothing can be written into: a lock taken before the round was read would fail here and come back
    // as `taken`, so `unreadable` witnesses that the refusal came before any write was tried.
    chmodSync(ledger, 0o500);
    try {
      expect(reserveSelfReviewRound({ home, intent, pullRequestId: "PR" })).toEqual({
        kind: "unreadable",
        reason: read[0],
      });
    } finally {
      chmodSync(ledger, 0o700);
    }
    expect(unwrap(readSelfReviewReservation({ home, locus }))).toBeNull();
  });

  it("refuses a reservation that is there but corrupt, and leaves it in place rather than taking or releasing it", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 13, owner: "o", repo: "r" });
    const intent = { formHash: "f", headSha: "h", locus, reservedIso: "t0" };
    reserveSelfReviewRound({ home, intent, pullRequestId: "PR" });
    const ledger = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    const path = join(
      ledger,
      readdirSync(ledger).find((name) => name.endsWith(".lock"))!,
      "reservation.json",
    );
    writeFileSync(path, "{");
    const read = unwrapErr(readSelfReviewReservation({ home, locus }));
    expect(read).toEqual([
      `the self-review reservation for ${locus} at ${path} is there but cannot be trusted (it is not a reservation ` +
        "for this pull request) — read the pull request back on GitHub to see whether that round landed, then delete it",
    ]);
    expect(reserveSelfReviewRound({ home, intent, pullRequestId: "PR" })).toEqual({
      kind: "unreadable",
      reason: read[0],
    });
    expect(releaseSelfReviewReservation({ home, locus })).toBe(undefined);
    expect(readFileSync(path, "utf8")).toBe("{");
  });

  it("reads a pull request with no confirmed round as none, never as a refusal", () => {
    expect(unwrap(readSelfReviewRound({ home: tempHome(), locus: "o/r#12", pullRequestId: "PR12" }))).toEqual({
      kind: "absent",
    });
  });

  it("releasing an absent reservation is a no-op that reports nothing released", () => {
    const home = tempHome();
    expect(releaseSelfReviewReservation({ home, locus: selfReviewLocus({ number: 1, owner: "o", repo: "r" }) })).toBe(
      undefined,
    );
  });

  it("surfaces only a reservation held at or past the age threshold, oldest first", () => {
    const home = tempHome();
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "old", locus: "o/r#1", reservedIso: "2026-01-01T00:00:00.000Z" },
      pullRequestId: "PR1",
    });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "fresh", locus: "o/r#2", reservedIso: "2026-01-01T00:14:00.000Z" },
      pullRequestId: "PR2",
    });
    const nowMs = Date.parse("2026-01-01T00:15:00.000Z");
    expect(pendingSelfReviewReservations({ home, nowMs, olderThanMs: 15 * 60_000 })).toEqual([
      { ageMs: 15 * 60_000, headSha: "old", locus: "o/r#1", reservedIso: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("grants no ownership to duplicate thread ids", () => {
    expect(
      parseSelfReviewRound({
        raw: JSON.stringify({
          confirmedIso: "2026-08-14T00:00:00Z",
          formHash: "f",
          headSha: "h",
          locus: "o/r#1",
          threadIds: ["T1", "T1"],
        }),
      }),
    ).toBe(undefined);
  });
});
