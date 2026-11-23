import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  confirmSelfReviewRound,
  parseSelfReviewRound,
  pendingSelfReviewReservations,
  readSelfReviewReservation,
  readSelfReviewRound,
  releaseSelfReviewReservation,
  reserveSelfReviewRound,
  selfReviewFormHash,
  selfReviewLocus,
} from "../../../../outbound/github/selfReviewLedger.js";
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
    expect(reserveSelfReviewRound({ home, intent: { formHash, headSha: "one", locus, reservedIso: "t1" } })).toEqual({
      kind: "fresh",
      previous: null,
    });
    expect(
      confirmSelfReviewRound({
        home,
        record: { confirmedIso: "t2", formHash, headSha: "one", locus, threadIds: ["T1", "T2"] },
      }),
    ).toEqual({ kind: "confirmed" });
    expect(unwrap(readSelfReviewRound({ home, locus }))).toEqual({
      confirmedIso: "t2",
      formHash,
      headSha: "one",
      locus,
      threadIds: ["T1", "T2"],
    });
    expect(
      reserveSelfReviewRound({
        home,
        intent: { formHash: "next", headSha: "two", locus, reservedIso: "t3" },
      }),
    ).toEqual({
      kind: "fresh",
      previous: { confirmedIso: "t2", formHash, headSha: "one", locus, threadIds: ["T1", "T2"] },
    });
  });

  it("keeps a second caller out while an outcome is unresolved", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 8, owner: "o", repo: "r" });
    const intent = { formHash: "f", headSha: "h", locus, reservedIso: "now" };
    expect(reserveSelfReviewRound({ home, intent })).toEqual({ kind: "fresh", previous: null });
    expect(reserveSelfReviewRound({ home, intent })).toEqual({ kind: "taken", pending: intent });
  });

  it("releases a held reservation so a fresh one can be taken, and reports nothing held once gone", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 9, owner: "o", repo: "r" });
    const intent = { formHash: "f", headSha: "h", locus, reservedIso: "t1" };
    expect(reserveSelfReviewRound({ home, intent })).toEqual({ kind: "fresh", previous: null });
    expect(reserveSelfReviewRound({ home, intent })).toEqual({ kind: "taken", pending: intent });
    expect(releaseSelfReviewReservation({ home, locus })).toEqual(intent);
    expect(unwrap(readSelfReviewReservation({ home, locus }))).toBeNull();
    expect(reserveSelfReviewRound({ home, intent })).toEqual({ kind: "fresh", previous: null });
  });

  it("refuses a round record that is there but corrupt before it takes any reservation", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 11, owner: "o", repo: "r" });
    reserveSelfReviewRound({ home, intent: { formHash: "f", headSha: "h", locus, reservedIso: "t0" } });
    expect(
      confirmSelfReviewRound({
        home,
        record: { confirmedIso: "t0", formHash: "f", headSha: "h", locus, threadIds: ["T1"] },
      }),
    ).toEqual({ kind: "confirmed" });
    const ledger = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    const roundFile = readdirSync(ledger).find((name) => name.endsWith(".json"))!;
    writeFileSync(join(ledger, roundFile), "{");
    const read = unwrapErr(readSelfReviewRound({ home, locus }));
    expect(read[0]).toContain(`the self-review round record for ${locus} at `);
    expect(read[0]).toContain("is there but cannot be trusted (it is not a confirmed round for this pull request)");
    const intent = { formHash: "f", headSha: "h2", locus, reservedIso: "t1" };
    // A ledger nothing can be written into: a lock taken before the round was read would fail here and come back
    // as `taken`, so `unreadable` witnesses that the refusal came before any write was tried.
    chmodSync(ledger, 0o500);
    try {
      expect(reserveSelfReviewRound({ home, intent })).toEqual({ kind: "unreadable", reason: read[0] });
    } finally {
      chmodSync(ledger, 0o700);
    }
    expect(unwrap(readSelfReviewReservation({ home, locus }))).toBeNull();
  });

  it("refuses a reservation that is there but corrupt, and leaves it in place rather than taking or releasing it", () => {
    const home = tempHome();
    const locus = selfReviewLocus({ number: 13, owner: "o", repo: "r" });
    const intent = { formHash: "f", headSha: "h", locus, reservedIso: "t0" };
    reserveSelfReviewRound({ home, intent });
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
    expect(reserveSelfReviewRound({ home, intent })).toEqual({ kind: "unreadable", reason: read[0] });
    expect(releaseSelfReviewReservation({ home, locus })).toBe(undefined);
    expect(readFileSync(path, "utf8")).toBe("{");
  });

  it("reads a pull request with no confirmed round as none, never as a refusal", () => {
    expect(unwrap(readSelfReviewRound({ home: tempHome(), locus: "o/r#12" }))).toBeNull();
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
    });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "fresh", locus: "o/r#2", reservedIso: "2026-01-01T00:14:00.000Z" },
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
