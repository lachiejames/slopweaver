/**
 * Which pull request a proof record is about — `prIdentity.ts`, directly and through the PR-proof collector — so a
 * finding never counts one pull request twice, nor two it cannot tell apart.
 */
import { describe, expect, it } from "vitest";

import { collectPrProofFriction } from "../../../reflect/collectPrProof.js";
import { prIdentity } from "../../../reflect/prIdentity.js";
import { fakeReader, window } from "./substrateFixture.js";

describe("prIdentity", () => {
  it("keys a fully identified record by node id and case-folded repository and number, never its branch", () => {
    const identity = prIdentity({
      name: "a.json",
      record: { locus: "Acme/Repo#main...fix", nodeId: "PR_1", number: 7 },
    });
    expect(identity).toStrictEqual({ github: true, keys: ["node:PR_1", "number:acme/repo#7"] });
  });

  it("keys a partly identified record by its branch locus too, so a record naming the other half can join it", () => {
    const identity = prIdentity({ name: "a.json", record: { locus: "Acme/Repo#main...fix", number: 7 } });
    expect(identity).toStrictEqual({ github: true, keys: ["number:acme/repo#7", "locus:acme/repo#main...fix"] });
  });

  it("keys a record with no identity and no locus by its file alone", () => {
    expect(prIdentity({ name: "a.json", record: {} })).toStrictEqual({ github: false, keys: ["file:a.json"] });
  });
});

describe("collectPrProofFriction identity", () => {
  it("counts two records naming one pull request as ONE pull request", () => {
    const record = JSON.stringify({
      confirmedIso: "2026-08-27T01:00:00.000Z",
      form: { review: { grade: "silver" } },
      locus: "owner/repo#main...branch",
      number: 7,
      reservedIso: "2026-08-27T00:30:00.000Z",
    });
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({ files: { "/prs/one.json": record, "/prs/two.json": record } }),
      window,
    });
    expect(reading.findings.map((one) => one.consequence)).toStrictEqual([
      "1 pull request the fleet touched in this window is graded silver, not gold, so it still owes proof that it works end to end",
    ]);
    expect(reading.findings[0]!.summary).toBe(
      "1 pull request the fleet touched in this window has no gold grade, so gold is still owed: owner/repo#main...branch: review graded silver",
    );
  });

  it("counts one pull request under two branch loci ONCE, by GitHub's own identity", () => {
    const record = ({ locus }: { locus: string }) =>
      JSON.stringify({
        confirmedIso: "2026-08-27T01:00:00.000Z",
        form: { review: { grade: "silver" } },
        locus,
        nodeId: "PR_same",
        number: 42,
      });
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": record({ locus: "owner/repo#main...feature" }),
          "/prs/b.json": record({ locus: "owner/repo#release...feature" }),
        },
      }),
      window,
    });
    expect(reading.findings.map((one) => one.consequence)).toStrictEqual([
      "1 pull request the fleet touched in this window is graded silver, not gold, so it still owes proof that it works end to end",
    ]);
  });

  it("counts one pull request ONCE when two records spell its repository in different case", () => {
    const record = ({ locus, atIso }: { locus: string; atIso: string }) =>
      JSON.stringify({ confirmedIso: atIso, form: { review: { grade: "silver" } }, locus, number: 7 });
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": record({ atIso: "2026-08-27T01:00:00.000Z", locus: "Owner/Repo#main...feature" }),
          "/prs/b.json": record({ atIso: "2026-08-27T02:00:00.000Z", locus: "owner/repo#main...feature" }),
        },
      }),
      window,
    });
    expect(reading.findings.map((one) => one.consequence)).toStrictEqual([
      "1 pull request the fleet touched in this window is graded silver, not gold, so it still owes proof that it works end to end",
    ]);
  });

  it("counts one pull request ONCE when one record names it by node id and number and another by number alone", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...feature",
            nodeId: "PR_same",
            number: 7,
          }),
          "/prs/b.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...feature",
            number: 7,
          }),
          "/prs/c.json": JSON.stringify({
            confirmedIso: "2026-08-27T00:30:00.000Z",
            form: { review: { grade: "silver" } },
            nodeId: "PR_same",
          }),
        },
      }),
      window,
    });
    expect(reading.findings.map((one) => one.consequence)).toStrictEqual([
      "1 pull request the fleet touched in this window is graded silver, not gold, so it still owes proof that it works end to end",
    ]);
  });

  it("never counts a node-id-only and a number-only record on one branch as two pull requests, nor as one it cannot prove", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...feature",
            nodeId: "PR_same",
          }),
          "/prs/b.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...feature",
            number: 7,
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "2 pull request records carry GitHub identities that do not establish how many pull requests they are (two node ids, two numbers, or a node id and a number no one record ties together), so none is counted: owner/repo#main...feature",
    ]);
  });

  it("counts two fully identified pull requests on one reused branch as TWO", () => {
    const record = ({ at, nodeId, number }: { at: string; nodeId: string; number: number }) =>
      JSON.stringify({
        confirmedIso: at,
        form: { review: { grade: "silver" } },
        locus: "owner/repo#main...feature",
        nodeId,
        number,
      });
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": record({ at: "2026-08-27T01:00:00.000Z", nodeId: "PR_A", number: 1 }),
          "/prs/b.json": record({ at: "2026-08-27T02:00:00.000Z", nodeId: "PR_B", number: 2 }),
        },
      }),
      window,
    });
    expect(reading.findings.map((one) => one.consequence)).toStrictEqual([
      "2 pull requests the fleet touched in this window are graded silver, not gold, so each still owes proof that it works end to end",
    ]);
  });

  it("counts nothing when a bridging record ties two distinct node ids together, and says so", () => {
    const record = ({ at, nodeId, number }: { at: string; nodeId: string; number: number }) =>
      JSON.stringify({
        confirmedIso: at,
        form: { review: { grade: "silver" } },
        locus: `owner/repo#main...pr-${String(number)}`,
        nodeId,
        number,
      });
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": record({ at: "2026-08-27T01:00:00.000Z", nodeId: "PR_A", number: 1 }),
          "/prs/b.json": record({ at: "2026-08-27T02:00:00.000Z", nodeId: "PR_A", number: 2 }),
          "/prs/c.json": record({ at: "2026-08-27T03:00:00.000Z", nodeId: "PR_B", number: 2 }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "3 pull request records carry GitHub identities that do not establish how many pull requests they are (two node ids, two numbers, or a node id and a number no one record ties together), so none is counted: owner/repo#main...pr-1, owner/repo#main...pr-2",
    ]);
  });

  it("never counts a graded record with no GitHub identity as a distinct pull request, since a retargeted copy looks the same", () => {
    const record = ({ confirmedIso, locus }: { confirmedIso: string; locus: string }) =>
      JSON.stringify({ confirmedIso, form: { review: { grade: "silver" } }, locus });
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": record({ confirmedIso: "2026-08-27T01:00:00.000Z", locus: "owner/repo#main...feature" }),
          "/prs/b.json": record({ confirmedIso: "2026-08-27T02:00:00.000Z", locus: "owner/repo#release...feature" }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "2 graded pull request records carried no GitHub node id and no valid pull request number, so which pull request each names is unknown and their grades are not counted: owner/repo#main...feature, owner/repo#release...feature",
    ]);
  });

  it.each([0, -3, 1.5])("never reads %s as a pull request number GitHub issued", (number) => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...branch",
            number,
          }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "1 graded pull request record carried no GitHub node id and no valid pull request number, so which pull request it names is unknown and its grade is not counted: owner/repo#main...branch",
    ]);
  });

  it("names one unidentified graded record in the singular", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...feature",
          }),
        },
      }),
      window,
    });
    expect(reading.residue).toStrictEqual([
      "1 graded pull request record carried no GitHub node id and no valid pull request number, so which pull request it names is unknown and its grade is not counted: owner/repo#main...feature",
    ]);
  });

  it("never lets filename order pick between two equally latest records that disagree", () => {
    const at = { confirmedIso: "2026-08-27T01:00:00.000Z", locus: "owner/repo#main...branch", number: 7 };
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({ ...at, form: { review: { grade: "silver" } } }),
          "/prs/b.json": JSON.stringify({ ...at, form: { review: { grade: "gold" } } }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "1 pull request carried two records at the same instant that disagree, so its state is unknown and not counted: owner/repo#main...branch",
    ]);
  });

  it("counts neither of two pull requests named only by node id and only by number in one repository", () => {
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({
            confirmedIso: "2026-08-27T01:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#main...feature",
            nodeId: "PR_same",
          }),
          "/prs/b.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "owner/repo#release...feature",
            number: 7,
          }),
          "/prs/c.json": JSON.stringify({
            confirmedIso: "2026-08-27T02:00:00.000Z",
            form: { review: { grade: "silver" } },
            locus: "other/repo#main...feature",
            number: 9,
          }),
        },
      }),
      window,
    });
    expect([reading.findings.map(({ consequence }) => consequence), reading.residue]).toStrictEqual([
      [
        "1 pull request the fleet touched in this window is graded silver, not gold, so it still owes proof that it works end to end",
      ],
      [
        "2 pull request records carry GitHub identities that do not establish how many pull requests they are (two node ids, two numbers, or a node id and a number no one record ties together), so none is counted: owner/repo#main...feature, owner/repo#release...feature",
      ],
    ]);
  });

  it("never lets filename order pick between two equally latest records whose unrecognised grades differ", () => {
    const at = { confirmedIso: "2026-08-27T01:00:00.000Z", locus: "owner/repo#main...branch", number: 7 };
    const reading = collectPrProofFriction({
      prsDir: "/prs",
      reader: fakeReader({
        files: {
          "/prs/a.json": JSON.stringify({ ...at, form: { review: { grade: "bogus-a" } } }),
          "/prs/b.json": JSON.stringify({ ...at, form: { review: { grade: "bogus-b" } } }),
        },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "1 pull request carried two records at the same instant that disagree, so its state is unknown and not counted: owner/repo#main...branch",
    ]);
  });
});
