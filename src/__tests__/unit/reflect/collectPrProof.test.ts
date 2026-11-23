/**
 * The PR-proof collector's grades and reservations — what a pull request the fleet touched below gold owes, and the
 * reservations nothing confirmed. Which pull request a record is about is `prIdentity.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { collectPrProofFriction } from "../../../reflect/collectPrProof.js";
import { FIX_BODY, formOf } from "../outbound/github/fixtures.js";
import { fakeReader, window } from "./substrateFixture.js";

describe("collectPrProofFriction", () => {
  it("names a pull request written below gold, and its cost names the grade and never claims it was opened", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { proof: { grade: "silver" } },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    expect(reading.findings[0]!.classKey).toBe("proof-graded-silver");
    expect(reading.findings[0]!.consequence).toBe(
      "1 pull request the fleet touched in this window is graded silver, not gold, so it still owes proof that it works end to end",
    );
  });

  it("judges a pull request by its LATEST record, so one later graded gold is no finding", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "gold" } },
            locus: "owner/repo#main...branch",
            number: 7,
          }),
          "/prs/b.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...branch",
            number: 7,
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
  });

  it("says nothing about a gold one", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { proof: { grade: "gold" } },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
  });

  it("says nothing about a C3 record, which publishes no grade, even beside one that does", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/c3.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: formOf({ body: FIX_BODY }),
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
          "/prs/legacy.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { proof: { grade: "silver" } },
            locus: "owner/repo#main...other",
            number: 8,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    expect(reading.findings.map((finding) => finding.classKey)).toStrictEqual(["proof-graded-silver"]);
    expect(reading.findings[0]!.consequence).toBe(
      "1 pull request the fleet touched in this window is graded silver, not gold, so it still owes proof that it works end to end",
    );
  });

  it("reads a reading-order record's grade off its review", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "bronze", reviewer: "codex", why: "no media" }, risk: {} },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    expect(reading.findings[0]!.classKey).toBe("solved-bronze");
  });

  it("names a reading-order record with no review yet as not recorded, and never claims a grade it does not carry", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { risk: {} },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    const finding = reading.findings[0]!;
    expect([finding.classKey, finding.consequence, finding.evidence]).toEqual([
      "review-not-recorded",
      "1 pull request the fleet touched in this window has no review grade yet, so it still owes proof that it works end to end",
      ["owner/repo#main...branch: no review recorded yet"],
    ]);
  });

  it.each<[string, unknown]>([
    ["a grade spelled like the absence of one", "unreviewed"],
    ["punctuation", ","],
    ["a number, never read as no review", 123],
    ["an empty string", ""],
    ["null", null],
  ])("never interpolates a recorded grade outside the enum — %s", (_label, grade) => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade, reviewer: "codex", why: "pending" } },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    const finding = reading.findings[0]!;
    expect([finding.classKey, finding.consequence, finding.evidence, finding.summary]).toEqual([
      "grade-not-recognised",
      // An unknown proof status is not a cost to the owner or the fleet, so it states none and is held.
      undefined,
      [`owner/repo#main...branch: review grade ${JSON.stringify(grade)} is not one this reader knows`],
      `1 pull request the fleet touched in this window carries a grade this reader does not recognise: owner/repo#main...branch: review grade ${JSON.stringify(grade)} is not one this reader knows`,
    ]);
  });

  it("judges a form carrying both a legacy proof and a review by its review", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { proof: { grade: "silver" }, review: { grade: "gold" } },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toEqual([]);
  });

  it("keeps a reviewer's own unproven grade apart from no review at all", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "unproven" } },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    const finding = reading.findings[0]!;
    expect([finding.classKey, finding.consequence]).toEqual([
      "solved-unproven",
      "1 pull request the fleet touched in this window is graded unproven, not gold, so it still owes proof that it works end to end",
    ]);
  });

  it("says nothing about a reading-order record a reviewer graded gold", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/one.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "gold", reviewer: "codex", why: "fails on main" } },
            locus: "owner/repo#main...branch",
            number: 7,
            reservedIso: "2026-08-27T00:30:00.000Z",
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
  });

  it("names a reservation nothing ever confirmed", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: { "/prs/one.json": JSON.stringify({ locus: "owner/repo", reservedIso: "2026-08-27T01:00:00.000Z" }) },
      }),
      window,
    });
    expect(reading.findings[0]!.classKey).toBe("reserved-but-never-confirmed");
    // Only what the window measures: a confirmation after it closed is outside this pass.
    expect([reading.findings[0]!.summary, reading.findings[0]!.evidence]).toStrictEqual([
      "1 pull request reservation was made in this window and not confirmed by the time it closed",
      ["owner/repo: reserved 2026-08-27T01:00:00.000Z and not confirmed by the time the window closed"],
    ]);
  });

  it("counts two unconfirmed reservations on one branch as TWO reservations", () => {
    const reserve = ({ at }: { at: string }) => JSON.stringify({ locus: "owner/repo#main...feature", reservedIso: at });
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": reserve({ at: "2026-08-27T01:00:00.000Z" }),
          "/prs/b.json": reserve({ at: "2026-08-27T02:00:00.000Z" }),
        },
      }),
      window,
    });
    expect(reading.findings.map((one) => [one.classKey, one.occurrences])).toStrictEqual([
      ["reserved-but-never-confirmed", 2],
    ]);
  });

  it("lets an unidentified graded record's confirmation settle the reservation before it, while its grade stays uncounted", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            locus: "owner/repo#main...feature",
            reservedIso: "2026-08-27T01:00:00.000Z",
          }),
          "/prs/b.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...feature",
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "1 graded pull request record carried no GitHub node id and no valid pull request number, so which pull request it names is unknown and its grade is not counted: owner/repo#main...feature",
    ]);
  });

  it("counts only the reservations made after the latest confirmation as unconfirmed", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            locus: "owner/repo#main...feature",
            reservedIso: "2026-08-27T01:00:00.000Z",
          }),
          "/prs/b.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "gold" } },
            locus: "owner/repo#main...feature",
            number: 7,
          }),
          "/prs/c.json": JSON.stringify({
            locus: "owner/repo#main...feature",
            reservedIso: "2026-08-27T03:00:00.000Z",
          }),
        },
      }),
      window,
    });
    expect(reading.findings.map((one) => [one.classKey, one.occurrences])).toStrictEqual([
      ["reserved-but-never-confirmed", 1],
    ]);
  });

  it("counts no reservation as never confirmed once a later record on its branch confirmed the pull request", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            locus: "owner/repo#main...feature",
            reservedIso: "2026-08-27T01:00:00.000Z",
          }),
          "/prs/b.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "gold" } },
            locus: "owner/repo#main...feature",
            number: 7,
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
  });
});
